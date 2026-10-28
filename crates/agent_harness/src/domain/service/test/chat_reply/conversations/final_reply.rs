use super::*;
use crate::domain::conversation_turns::{ConversationTurnState, ConversationTurnStore};
use agent_fold::domain::model::{ProjectedSegment, Segment, SegmentKind};

fn passage(index: u32, text: &str) -> ProjectedSegment {
    ProjectedSegment {
        segment: Segment {
            index,
            kind: SegmentKind::Prose,
            start: index,
            end: index + 1,
            sealed: true,
            rows: Vec::new(),
        },
        text: Some(text.to_owned()),
    }
}

/// A response can be lost after the message commits. A stale replica and
/// recovery must both reuse every reserved ID, without rerunning the model.
async fn committed_reply_recovery(pool: sqlx::PgPool, extra_passage: bool) {
    let journal = pg_journal(&pool);
    let (service, announcer, _, container, command) =
        journaled_conversation(pool, journal.clone()).await;
    let source = mention_origin(&command).message_id;
    let record = journal.get(source, command.bot_id).await.unwrap().unwrap();
    let mut stale = record.in_flight.unwrap();
    if extra_passage {
        stale.presented.push(macro_uuid::generate_uuid_v7());
        stale.announcement_message_id = stale.presented.last().copied();
        journal
            .record_flight(record.action_id, &stale)
            .await
            .unwrap();
        journal
            .save_reply(
                record.action_id,
                &[passage(0, "First passage."), passage(1, "Final passage.")],
            )
            .await
            .unwrap();
    }
    let outcome = ReplyOutcome::Failed;
    journal
        .finish(
            record.action_id,
            ConversationTurnState::Failed,
            outcome.clone(),
        )
        .await
        .unwrap();
    service.inner.busy.take(record.session_id);
    announcer.fails_after_presenting("committed, but response was lost");
    service
        .inner
        .resolve_reply(record.session_id, Some(&stale), outcome.clone())
        .await;
    let reserved = journal.by_action(record.action_id).await.unwrap().unwrap();
    let ids = reserved.in_flight.unwrap().presented;
    assert_eq!(ids.len(), if extra_passage { 2 } else { 1 });
    assert!(!reserved.reply_finalized);
    assert!(
        announcer
            .presented()
            .iter()
            .all(|reply| ids.contains(&reply.message_id))
    );
    assert_eq!(announcer.presented().len(), ids.len());
    assert!(
        !journal
            .retry(source, command.bot_id, record.action_id)
            .await
            .unwrap(),
        "a reply with a lost response must reconcile before retry"
    );
    assert!(
        !journal
            .for_conversation(record.channel_id, command.bot_id, 10)
            .await
            .unwrap()[0]
            .retryable
    );
    assert!(
        service.inner.busy.turn(record.session_id).is_none(),
        "final reservation must not make a finished turn busy again"
    );

    // Recover with no local projection or successful-shape cache, as on a
    // second replica. The original caller still carries the shorter flight.
    announcer.recovers();
    let ((replica, _, _, replica_announcer, _), _) = harness_with_ports_and_journal(
        PromptContextMock::default(),
        PromptComposerMock::default(),
        KindDefaultPolicies,
        HarnessDefaultCodingAgents,
        PromptMentionsMock::new(),
        EgressProvisionerMock::new(),
        Some(journal.clone()),
    );
    // Both callers deliberately keep their old snapshot. At least one must
    // reconcile using the IDs reloaded under its lease, rather than needing a
    // caller that already knows the new IDs.
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        loop {
            tokio::join!(
                service
                    .inner
                    .resolve_reply(record.session_id, Some(&stale), outcome.clone()),
                replica
                    .inner
                    .resolve_reply(record.session_id, Some(&stale), outcome.clone()),
            );
            if journal
                .by_action(record.action_id)
                .await
                .unwrap()
                .unwrap()
                .reply_finalized
            {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        }
    })
    .await
    .expect("stale reconcilers reload the durable IDs after the prior lease releases");
    service.recover_conversations().await.unwrap();
    let all_presented = announcer
        .presented()
        .into_iter()
        .chain(replica_announcer.presented())
        .collect::<Vec<_>>();
    assert!(
        all_presented
            .iter()
            .all(|reply| ids.contains(&reply.message_id))
    );
    assert!(
        all_presented.len() > ids.len(),
        "a stale reconciler really reposted the committed reply"
    );
    let finalized = journal.by_action(record.action_id).await.unwrap().unwrap();
    assert_eq!(finalized.in_flight.unwrap().presented, ids);
    assert!(
        announcer
            .presented()
            .iter()
            .all(|reply| ids.contains(&reply.message_id))
    );
    assert_eq!(prompts(&container.agent()).len(), 1);
    assert!(
        journal
            .retry(source, command.bot_id, record.action_id)
            .await
            .unwrap()
    );
    // An old terminal snapshot cannot post after retry changed its action ID.
    let before = announcer.presented().len();
    service
        .inner
        .resolve_reply(record.session_id, Some(&stale), ReplyOutcome::Failed)
        .await;
    assert_eq!(announcer.presented().len(), before);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn outcome_only_reply_ids_survive_a_lost_post_response_and_stale_reconciliation(
    pool: sqlx::PgPool,
) {
    committed_reply_recovery(pool, false).await;
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn extra_final_passage_ids_survive_a_lost_post_response_and_stale_reconciliation(
    pool: sqlx::PgPool,
) {
    committed_reply_recovery(pool, true).await;
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn failed_final_id_persistence_posts_nothing_until_recovery_can_reserve_ids(
    pool: sqlx::PgPool,
) {
    use std::sync::atomic::{AtomicBool, Ordering};
    let journal = Arc::new(FlakyJournal {
        inner: crate::outbound::conversation_turns::PgConversationTurnStore::new(pool.clone()),
        fail_finish: AtomicBool::new(false),
        fail_reply_flight: AtomicBool::new(true),
    });
    let (service, announcer, _, _, command) = journaled_conversation(pool, journal.clone()).await;
    let record = journal
        .get(mention_origin(&command).message_id, command.bot_id)
        .await
        .unwrap()
        .unwrap();
    journal
        .finish(
            record.action_id,
            ConversationTurnState::Failed,
            ReplyOutcome::Failed,
        )
        .await
        .unwrap();
    service.inner.busy.take(record.session_id);
    service
        .inner
        .resolve_reply(
            record.session_id,
            record.in_flight.as_ref(),
            ReplyOutcome::Failed,
        )
        .await;
    assert!(announcer.presented().is_empty());
    let unposted = journal.by_action(record.action_id).await.unwrap().unwrap();
    assert!(!unposted.reply_finalized);
    assert!(unposted.in_flight.unwrap().presented.is_empty());
    journal.fail_reply_flight.store(false, Ordering::SeqCst);
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        loop {
            service.recover_conversations().await.unwrap();
            if journal
                .by_action(record.action_id)
                .await
                .unwrap()
                .unwrap()
                .reply_finalized
            {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        }
    })
    .await
    .expect("IDs are saved before recovery posts");
    let saved = journal.by_action(record.action_id).await.unwrap().unwrap();
    assert_eq!(
        announcer.presented()[0].message_id,
        saved.in_flight.unwrap().presented[0]
    );
}
