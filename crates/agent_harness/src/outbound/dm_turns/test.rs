use super::*;
use crate::domain::direct_messages::{
    AgentDmConversations, AgentDmConversationsService, AgentDmError,
};
use crate::domain::model::{
    AgentKind, AgentRuntimeConfig, AnnounceOrigin, MentionOrigin, ReplyPlacement,
};
use agent_fold::domain::model::TurnId;
use agent_session::domain::agent_dm::AgentDmConversationRepo;
use bots::domain::ports::{AgentDmEligibility, BotError, MockBotRepo};
use channels::{domain::agent_dm::AgentDmRepo, outbound::pg_channels_repo::PgChannelsRepo};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;
use std::sync::Arc;

struct Eligibility(bool);
impl AgentDmEligibility for Eligibility {
    async fn authorize_agent_dm(
        &self,
        _: MacroUserIdStr<'static>,
        _: bot_id::BotId,
    ) -> std::result::Result<(), BotError> {
        if self.0 {
            Ok(())
        } else {
            Err(BotError::Unauthorized)
        }
    }
}

fn conversations(pool: PgPool, store: PgDmTurnStore, eligible: bool) -> impl AgentDmConversations {
    AgentDmConversationsService::new(
        PgChannelsRepo::new(pool.clone()),
        Eligibility(eligible),
        MockBotRepo::new(),
        crate::testing::postgres_sessions(pool),
    )
    .with_turns(Arc::new(store))
}

async fn setup(pool: PgPool) -> (PgDmTurnStore, AgentSessionId, Uuid, OpenSession) {
    let user = macro_user_id::user_id::MacroUserIdStr::try_from_email("dm@example.com").unwrap();
    let channel = PgChannelsRepo::new(pool.clone())
        .ensure(user.clone(), bot_id::MACRO_NEW_BOT_ID)
        .await
        .unwrap()
        .dm
        .channel_id;
    let session = crate::testing::postgres_sessions(pool.clone())
        .current_or_create(channel)
        .await
        .unwrap();
    let source = macro_uuid::generate_uuid_v7();
    let command = OpenSession {
        bot_id: bot_id::MACRO_NEW_BOT_ID,
        runtime: AgentRuntimeConfig {
            kind: AgentKind::InMemory,
            model: "test".to_owned(),
            harness: "macro-inmem".to_owned(),
            instructions: "Keep decisions".to_owned(),
            mcp_servers: agent_session::domain::model::AgentMcpServers::OwnerConnections,
        },
        origin: crate::domain::model::SessionOrigin::Mention(MentionOrigin {
            reply_placement: ReplyPlacement::Timeline,
            parent: messages::domain::models::MessageParent::Channel(channel),
            thread_id: source,
            message_id: source,
            sender: user,
            content: "Remember this".to_owned(),
            attachments: vec![],
        }),
    };
    (PgDmTurnStore::new(pool), session, channel, command)
}

fn flight(record: &DmTurn) -> InFlightTurn {
    InFlightTurn {
        action_id: record.action_id,
        turn: TurnId(0),
        actor: Some(mention_origin(&record.command).sender.clone()),
        announce: Some(AnnounceOrigin {
            reuse_origin_message: false,
            reply_placement: ReplyPlacement::Timeline,
            parent: mention_origin(&record.command).parent.clone(),
            thread_id: record.source_message_id,
            message_id: record.source_message_id,
        }),
        announcement_message_id: Some(macro_uuid::generate_uuid_v7()),
        dispatched_at: chrono::Utc::now(),
        bot_id: None,
        speaks_as_chip: false,
        presented: Vec::new(),
        held_tool_calls: Vec::new(),
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn replay_after_reset_retains_the_original_segment_payload_and_terminal_deduplication(
    pool: PgPool,
) {
    let (store, session, channel, command) = setup(pool.clone()).await;
    let original = store
        .admit(session, channel, command.clone())
        .await
        .unwrap();
    let turn = flight(&original);
    assert!(store.claim(original.action_id, &turn).await.unwrap());
    store
        .finish(
            original.action_id,
            DmTurnState::Succeeded,
            ReplyOutcome::Answered("Done".into()),
        )
        .await
        .unwrap();
    let new_session = crate::testing::postgres_sessions(pool)
        .start_fresh(channel)
        .await
        .unwrap();
    let mut edited = command;
    mention_origin_mut(&mut edited).content = "An edited message must not rerun".to_owned();
    let duplicate = store.admit(new_session, channel, edited).await.unwrap();
    assert_eq!(duplicate.session_id, session);
    assert_eq!(mention_origin(&duplicate.command).content, "Remember this");
    assert_eq!(duplicate.state, DmTurnState::Succeeded);
    assert!(!store.claim(duplicate.action_id, &turn).await.unwrap());
    assert_eq!(store.pending_replies(10).await.unwrap().len(), 1);
    store
        .finalize_reply(duplicate.action_id, &ReplyOutcome::Answered("Done".into()))
        .await
        .unwrap();
    assert!(store.pending_replies(10).await.unwrap().is_empty());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn concurrent_replicas_admit_one_record_and_only_one_claim_can_run(pool: PgPool) {
    let (store, session, channel, command) = setup(pool).await;
    let (a, b) = tokio::join!(
        store.admit(session, channel, command.clone()),
        store.admit(session, channel, command)
    );
    let (a, b) = (a.unwrap(), b.unwrap());
    assert_eq!(a.action_id, b.action_id);
    assert_eq!(store.for_channel(channel).await.unwrap().len(), 1);
    let turn = flight(&a);
    let (a, b) = tokio::join!(
        store.claim(a.action_id, &turn),
        store.claim(b.action_id, &turn)
    );
    assert_ne!(a.unwrap(), b.unwrap());
    assert!(store.pending(10).await.unwrap().is_empty());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn interrupted_work_holds_its_segment_queue_until_an_explicit_decision(pool: PgPool) {
    let (store, session, channel, mut command) = setup(pool.clone()).await;
    let interrupted = store
        .admit(session, channel, command.clone())
        .await
        .unwrap();
    store
        .claim(interrupted.action_id, &flight(&interrupted))
        .await
        .unwrap();
    store
        .finish(
            interrupted.action_id,
            DmTurnState::Interrupted,
            ReplyOutcome::Failed,
        )
        .await
        .unwrap();
    mention_origin_mut(&mut command).message_id = macro_uuid::generate_uuid_v7();
    store
        .admit(session, channel, command.clone())
        .await
        .unwrap();
    assert!(store.pending(10).await.unwrap().is_empty());
    let fresh = crate::testing::postgres_sessions(pool)
        .start_fresh(channel)
        .await
        .unwrap();
    mention_origin_mut(&mut command).message_id = macro_uuid::generate_uuid_v7();
    store.admit(fresh, channel, command).await.unwrap();
    let pending = store.pending(10).await.unwrap();
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0].session_id, fresh);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_explicit_retry_waits_for_reply_reconciliation_and_mints_only_one_new_attempt(
    pool: PgPool,
) {
    let (store, session, channel, command) = setup(pool).await;
    let first = store.admit(session, channel, command).await.unwrap();
    store.claim(first.action_id, &flight(&first)).await.unwrap();
    store
        .finish(first.action_id, DmTurnState::Failed, ReplyOutcome::Failed)
        .await
        .unwrap();
    assert!(
        !store
            .retry(first.source_message_id, first.action_id)
            .await
            .unwrap()
    );
    assert!(store.pending(10).await.unwrap().is_empty());
    store
        .finalize_reply(first.action_id, &ReplyOutcome::Failed)
        .await
        .unwrap();
    let (a, b) = tokio::join!(
        store.retry(first.source_message_id, first.action_id),
        store.retry(first.source_message_id, first.action_id)
    );
    assert_ne!(a.unwrap(), b.unwrap());
    let next = store.get(first.source_message_id).await.unwrap().unwrap();
    assert_ne!(next.action_id, first.action_id);
    assert_eq!(next.state, DmTurnState::Queued);
    assert_eq!(
        mention_origin(&next.command).content,
        mention_origin(&first.command).content
    );
    assert!(next.in_flight.is_none());
    assert!(store.by_action(first.action_id).await.unwrap().is_none());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn reply_claims_release_on_drop_and_stale_finalizers_cannot_hide_a_late_answer(pool: PgPool) {
    let (store, session, channel, command) = setup(pool.clone()).await;
    let other_replica = PgDmTurnStore::new(pool);
    let record = store.admit(session, channel, command).await.unwrap();
    store
        .claim(record.action_id, &flight(&record))
        .await
        .unwrap();
    let lease = store.claim_reply(record.action_id).await.unwrap().unwrap();
    assert!(
        other_replica
            .claim_reply(record.action_id)
            .await
            .unwrap()
            .is_none()
    );
    drop(lease);
    let lease = tokio::time::timeout(std::time::Duration::from_secs(2), async {
        loop {
            if let Some(lease) = other_replica.claim_reply(record.action_id).await.unwrap() {
                break lease;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    store
        .finish(
            record.action_id,
            DmTurnState::Interrupted,
            ReplyOutcome::Failed,
        )
        .await
        .unwrap();
    store
        .finish(
            record.action_id,
            DmTurnState::Succeeded,
            ReplyOutcome::Answered("Completed before disconnect".into()),
        )
        .await
        .unwrap();
    store
        .finalize_reply(record.action_id, &ReplyOutcome::Failed)
        .await
        .unwrap();
    let updated = store.get(record.source_message_id).await.unwrap().unwrap();
    assert!(!updated.reply_finalized);
    assert_eq!(updated.state, DmTurnState::Succeeded);
    drop(lease);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn starting_fresh_requires_owner_and_current_persona_access(pool: PgPool) {
    let (store, session, channel, command) = setup(pool.clone()).await;
    let stranger = MacroUserIdStr::try_from_email("stranger@example.com").unwrap();
    let service = conversations(pool.clone(), store.clone(), true);
    assert!(matches!(
        service.start_fresh(stranger, channel, session).await,
        Err(AgentDmError::NotFound)
    ));
    let service = conversations(pool.clone(), store, false);
    assert!(matches!(
        service
            .start_fresh(mention_origin(&command).sender.clone(), channel, session)
            .await,
        Err(AgentDmError::NotRetryable)
    ));
    assert_eq!(
        crate::testing::postgres_sessions(pool)
            .current(channel)
            .await
            .unwrap(),
        Some(session)
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_running_turn_blocks_reset_and_completed_context_is_retained(pool: PgPool) {
    let (store, session, channel, command) = setup(pool.clone()).await;
    let owner = mention_origin(&command).sender.clone();
    let record = store.admit(session, channel, command).await.unwrap();
    let service = conversations(pool.clone(), store.clone(), true);
    assert!(
        store
            .claim(record.action_id, &flight(&record))
            .await
            .unwrap()
    );
    assert!(matches!(
        service.start_fresh(owner.clone(), channel, session).await,
        Err(AgentDmError::ContextBusy)
    ));
    store
        .finish(
            record.action_id,
            DmTurnState::Succeeded,
            ReplyOutcome::Answered("Remembered".into()),
        )
        .await
        .unwrap();
    service
        .start_fresh(owner.clone(), channel, session)
        .await
        .unwrap();
    assert!(matches!(
        service.start_fresh(owner, channel, session).await,
        Err(AgentDmError::ContextBusy)
    ));
    let segments = crate::testing::postgres_sessions(pool)
        .segments(channel)
        .await
        .unwrap();
    assert_eq!(segments.len(), 2);
    assert_eq!(segments[0].session_id, session);
    assert!(!segments[0].is_current);
    assert!(segments[1].is_current);
    assert_eq!(
        store
            .get(record.source_message_id)
            .await
            .unwrap()
            .unwrap()
            .state,
        DmTurnState::Succeeded
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn reset_cancels_undispatched_work_and_serializes_with_claims(pool: PgPool) {
    let (store, session, channel, command) = setup(pool.clone()).await;
    let owner = mention_origin(&command).sender.clone();
    let record = store.admit(session, channel, command).await.unwrap();
    let other = PgDmTurnStore::new(pool.clone());
    let lease = store.claim_context(session).await.unwrap().unwrap();
    assert!(other.claim_context(session).await.unwrap().is_none());
    let mut claiming = tokio::spawn({
        let other = other.clone();
        let turn = flight(&record);
        async move { other.claim(turn.action_id, &turn).await }
    });
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(30), &mut claiming)
            .await
            .is_err()
    );
    // The reset's cancellation is visible before a blocked claimant can run.
    store.cancel_queued(session).await.unwrap();
    drop(lease);
    assert!(!claiming.await.unwrap().unwrap());
    conversations(pool, other, true)
        .start_fresh(owner, channel, session)
        .await
        .unwrap();
    assert_eq!(
        store
            .get(record.source_message_id)
            .await
            .unwrap()
            .unwrap()
            .state,
        DmTurnState::Stopped
    );
    assert!(store.pending(10).await.unwrap().is_empty());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn settings_remain_pinned_after_reconnect_and_new_segments_adopt_edits(pool: PgPool) {
    let (store, session, channel, command) = setup(pool.clone()).await;
    let original = DmSessionSettings {
        runtime: command.runtime,
        permissions: crate::domain::model::PermissionPolicyConfig::Persona {
            kind: AgentKind::External,
            harness_allows_bypass: Some(true),
            auto_accept_permissions: Some(false),
        },
    };
    store.pin_settings(session, original.clone()).await.unwrap();
    let mut edited = original.clone();
    edited.runtime.instructions = "New instructions".into();
    edited.runtime.model = "new-model".into();
    edited.permissions = crate::domain::model::PermissionPolicyConfig::Fixed(AgentKind::InMemory);
    let reconnected = PgDmTurnStore::new(pool.clone());
    assert_eq!(
        reconnected
            .pin_settings(session, edited.clone())
            .await
            .unwrap(),
        original
    );
    let fresh = crate::testing::postgres_sessions(pool)
        .start_fresh(channel)
        .await
        .unwrap();
    assert_eq!(
        reconnected
            .pin_settings(fresh, edited.clone())
            .await
            .unwrap(),
        edited
    );
    assert_eq!(reconnected.settings(session).await.unwrap(), Some(original));
}

fn mention_origin(command: &OpenSession) -> &MentionOrigin {
    let crate::domain::model::SessionOrigin::Mention(origin) = &command.origin else {
        panic!("expected a mention");
    };
    origin
}

fn mention_origin_mut(command: &mut OpenSession) -> &mut MentionOrigin {
    let crate::domain::model::SessionOrigin::Mention(origin) = &mut command.origin else {
        panic!("expected a mention");
    };
    origin
}
