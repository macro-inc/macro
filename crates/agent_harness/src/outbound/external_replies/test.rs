use super::*;
use crate::domain::model::{AnnounceOrigin, ReplyOutcome};
use agent_fold::domain::model::TurnId;
use agent_session::domain::agent_conversation::{AgentConversation, AgentConversationRepo};
use channels::{domain::agent_dm::AgentDmRepo, outbound::pg_channels_repo::PgChannelsRepo};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn completion_before_target_survives_reconnect_and_keeps_the_original_reply(pool: PgPool) {
    let user = MacroUserIdStr::try_from_email("external@example.com").unwrap();
    let channel = PgChannelsRepo::new(pool.clone())
        .ensure(user.clone(), bot_id::MACRO_NEW_BOT_ID)
        .await
        .unwrap()
        .dm
        .channel_id;
    let session = crate::testing::postgres_sessions(pool.clone())
        .current_or_create(AgentConversation {
            channel_id: channel,
            bot_id: bot_id::MACRO_NEW_BOT_ID,
        })
        .await
        .unwrap();
    let action = AgentActionId::from_uuid(macro_uuid::generate_uuid_v7());
    sqlx::query!("INSERT INTO agent_session (id, owner_id, bot_id, model, harness, workspace, for_warming) VALUES ($1, $2, $3, 'fixed', 'macrod', '/workspace', false)", session.as_uuid(), user.as_ref(), bot_id::MACRO_NEW_BOT_ID.as_uuid()).execute(&pool).await.unwrap();
    let store = PgExternalReplyStore::new(pool.clone());
    store
        .complete(
            session,
            action,
            &ExternalReplyCompletion {
                turn: TurnId(0),
                outcome: ReplyOutcome::Answered("I am Eric Hayes.".into()),
            },
        )
        .await
        .unwrap();
    assert!(store.pending(10).await.unwrap().is_empty());
    let target = ExternalReplyTarget {
        origin: AnnounceOrigin {
            reuse_origin_message: false,
            reply_placement: Default::default(),
            parent: messages::domain::models::MessageParent::Channel(channel),
            thread_id: action.as_uuid(),
            message_id: action.as_uuid(),
        },
        actor: user,
        message_id: macro_uuid::generate_uuid_v7(),
    };
    store.reserve(session, action, &target).await.unwrap();
    let reconnected = PgExternalReplyStore::new(pool);
    reconnected
        .reserve(
            session,
            action,
            &ExternalReplyTarget {
                message_id: macro_uuid::generate_uuid_v7(),
                ..target.clone()
            },
        )
        .await
        .unwrap();
    reconnected
        .complete(
            session,
            action,
            &ExternalReplyCompletion {
                turn: TurnId(1),
                outcome: ReplyOutcome::Failed,
            },
        )
        .await
        .unwrap();
    let record = reconnected.get(session, action).await.unwrap().unwrap();
    assert_eq!(record.target.unwrap().message_id, target.message_id);
    assert_eq!(
        record.completion.unwrap().outcome,
        ReplyOutcome::Answered("I am Eric Hayes.".into())
    );
    let lease = store.claim(session, action).await.unwrap().unwrap();
    assert!(reconnected.claim(session, action).await.unwrap().is_none());
    drop(lease);
    reconnected.finalize(session, action).await.unwrap();
    assert!(reconnected.pending(10).await.unwrap().is_empty());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn unfinished_and_failed_replies_do_not_starve_later_recovery(pool: PgPool) {
    let user = MacroUserIdStr::try_from_email("recovery@example.com").unwrap();
    let channel = PgChannelsRepo::new(pool.clone())
        .ensure(user.clone(), bot_id::MACRO_NEW_BOT_ID)
        .await
        .unwrap()
        .dm
        .channel_id;
    let session = crate::testing::postgres_sessions(pool.clone())
        .current_or_create(AgentConversation {
            channel_id: channel,
            bot_id: bot_id::MACRO_NEW_BOT_ID,
        })
        .await
        .unwrap();
    sqlx::query!("INSERT INTO agent_session (id, owner_id, bot_id, model, harness, workspace, for_warming) VALUES ($1, $2, $3, 'fixed', 'macrod', '/workspace', false)", session.as_uuid(), user.as_ref(), bot_id::MACRO_NEW_BOT_ID.as_uuid()).execute(&pool).await.unwrap();
    let store = PgExternalReplyStore::new(pool.clone());
    let target = ExternalReplyTarget {
        origin: AnnounceOrigin {
            reuse_origin_message: false,
            reply_placement: Default::default(),
            parent: messages::domain::models::MessageParent::Channel(channel),
            thread_id: macro_uuid::generate_uuid_v7(),
            message_id: macro_uuid::generate_uuid_v7(),
        },
        actor: user,
        message_id: macro_uuid::generate_uuid_v7(),
    };
    for _ in 0..101 {
        store
            .reserve(
                session,
                AgentActionId::from_uuid(macro_uuid::generate_uuid_v7()),
                &target,
            )
            .await
            .unwrap();
    }
    let first = store.pending(100).await.unwrap();
    assert_eq!(first.len(), 100);
    for reply in &first {
        let _lease = store
            .claim(session, reply.action_id)
            .await
            .unwrap()
            .unwrap();
        // A failed HTTP call drops the lease without finalizing.
    }
    let next = store.pending(1).await.unwrap();
    assert!(
        !first
            .iter()
            .any(|reply| reply.action_id == next[0].action_id)
    );
    store.finalize(session, next[0].action_id).await.unwrap();
    assert!(
        store
            .get(session, next[0].action_id)
            .await
            .unwrap()
            .unwrap()
            .finalized
    );

    // Old unmatched replies back off but remain eligible for late answers.
    let action = first[0].action_id;
    sqlx::query!("UPDATE agent_external_replies SET created_at = now() - interval '25 hours', updated_at = now() WHERE session_id = $1 AND action_id = $2", session.as_uuid(), action.as_uuid()).execute(&pool).await.unwrap();
    assert!(
        !store
            .pending(200)
            .await
            .unwrap()
            .iter()
            .any(|row| row.action_id == action)
    );
    sqlx::query!("UPDATE agent_external_replies SET updated_at = now() - interval '2 hours' WHERE session_id = $1 AND action_id = $2", session.as_uuid(), action.as_uuid()).execute(&pool).await.unwrap();
    assert!(
        store
            .pending(200)
            .await
            .unwrap()
            .iter()
            .any(|row| row.action_id == action)
    );
    drop(store.claim(session, action).await.unwrap().unwrap());
    assert!(
        !store
            .pending(200)
            .await
            .unwrap()
            .iter()
            .any(|row| row.action_id == action)
    );
    store.mark_announced(session, action).await.unwrap();
    let created_at = store
        .get(session, action)
        .await
        .unwrap()
        .unwrap()
        .created_at;
    let completion = ExternalReplyCompletion {
        turn: TurnId(0),
        outcome: ReplyOutcome::Answered("Late answer".into()),
    };
    store.complete(session, action, &completion).await.unwrap();
    assert!(
        store
            .pending(200)
            .await
            .unwrap()
            .iter()
            .any(|row| row.action_id == action)
    );
    store.reserve(session, action, &target).await.unwrap();
    let row = store.get(session, action).await.unwrap().unwrap();
    assert!(!row.finalized);
    assert!(row.announced);
    assert_eq!(row.created_at, created_at);
    assert_eq!(row.completion.unwrap().outcome, completion.outcome);
    store.finalize(session, action).await.unwrap();
    store.complete(session, action, &completion).await.unwrap();
    assert!(store.get(session, action).await.unwrap().unwrap().finalized);
}
