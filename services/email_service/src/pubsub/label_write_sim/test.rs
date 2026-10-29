//! Deterministic races between Macro's Gmail label writes, Gmail's answers
//! and inbox syncs, through the production worker and domain code.

use super::fake_gmail::{Kind, PauseAt, Reply};
use super::sim::{Action, Queue, Sim, Source};
use super::wiring;
use super::world::{
    INBOX, MESSAGES, STARRED, THREADS, UNREAD, WORK, World, on_worker_stacks, owner,
};
use sqlx::PgPool;

const T1: usize = 0;
const T2: usize = 1;
const T3: usize = 2;
const M1A: usize = 0;
const M1B: usize = 1;
const M1C: usize = 2;
const M2A: usize = 3;
const M2B: usize = 4;
const M3A: usize = 5;

/// Defines `$name` as a module with the scenario run once for each label
/// write format: one operation per message, which producers send by default,
/// and batches. The two runs use different mailboxes, so they don't share the
/// request gate's state.
macro_rules! scenario {
    ($name:ident, $shard:expr, |$world:ident| $body:block) => {
        mod $name {
            use super::*;

            #[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
            async fn single_message_writes(pool: PgPool) {
                run(World::new(pool, $shard, false).await).await;
            }

            #[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
            async fn batched_writes(pool: PgPool) {
                run(World::new(pool, $shard + 100, true).await).await;
            }

            async fn run(mut $world: World) $body
        }
    };
}

async fn in_inbox(sim: &Sim<'_>, thread: usize) -> bool {
    sim.world.thread_inbox_visible(THREADS[thread]).await
}

async fn db_has(sim: &Sim<'_>, message: usize, label: &str) -> bool {
    sim.world.db_labels().await[MESSAGES[message].0].contains(label)
}

fn gmail_has(sim: &Sim<'_>, message: usize, label: &str) -> bool {
    sim.world.gmail_labels()[MESSAGES[message].0].contains(label)
}

async fn live_markers(sim: &Sim<'_>) -> usize {
    let ids: Vec<_> = sim.world.message_ids.values().copied().collect();
    wiring::markers(&sim.world.db, &ids)
        .await
        .into_iter()
        .filter(|marker| marker.live)
        .count()
}

async fn sync_thread(sim: &mut Sim<'_>, thread: usize) {
    for (index, (_, thread_id, _)) in MESSAGES.iter().enumerate() {
        if *thread_id == THREADS[thread] {
            sim.sync(index).await;
        }
    }
}

scenario!(
    a_rate_limited_archive_survives_sync_and_resync_until_gmail_accepts_it,
    901,
    |world| {
        let sim = &mut Sim::new(&mut world, 1);
        sim.act(Action::Archive(T1, true), false).await.unwrap();
        sim.deliver_all(Queue::Ops, Reply::RateLimited).await;
        let operations = if sim.world.label_write_batches { 1 } else { 3 };
        assert_eq!(sim.queue_len(Queue::OpsRetry), operations);

        sim.sync(M1A).await;
        sim.resync(M1B).await;
        assert!(gmail_has(sim, M1A, INBOX));
        assert!(!in_inbox(sim, T1).await);
        assert!(!db_has(sim, M1A, INBOX).await);
        assert!(!db_has(sim, M1B, INBOX).await);

        while sim.deliver_from(Queue::OpsRetry, Reply::Ok, false).await {}
        sync_thread(sim, T1).await;
        assert!([M1A, M1B, M1C].iter().all(|m| !gmail_has(sim, *m, INBOX)));
        assert!(!in_inbox(sim, T1).await);
        assert_eq!(live_markers(sim).await, 0);
        assert!(sim.world.flag_mismatches().await.is_empty());
    }
);

scenario!(
    an_old_archive_retried_after_a_newer_unarchive_sends_nothing,
    902,
    |world| {
        let sim = &mut Sim::new(&mut world, 1);
        sim.act(Action::Archive(T1, true), false).await.unwrap();
        sim.deliver_all(Queue::Ops, Reply::RateLimited).await;
        sim.act(Action::Archive(T1, false), false).await.unwrap();
        sim.deliver_all(Queue::Ops, Reply::Ok).await;

        let requests_before = sim.world.gmail.lock().log.len();
        while sim.deliver_from(Queue::OpsRetry, Reply::Ok, false).await {}
        assert_eq!(sim.world.gmail.lock().log.len(), requests_before);
        sync_thread(sim, T1).await;
        assert!(gmail_has(sim, M1A, INBOX));
        assert!(in_inbox(sim, T1).await);
    }
);

scenario!(
    an_older_star_rejected_after_unstar_and_star_keeps_the_last_star,
    903,
    |world| {
        let sim = &mut Sim::new(&mut world, 1);
        sim.act(Action::Star(T3, true), false).await.unwrap();
        sim.deliver_all(Queue::Ops, Reply::RateLimited).await;
        sim.act(Action::Star(T3, false), false).await.unwrap();
        sim.act(Action::Star(T3, true), false).await.unwrap();
        sim.deliver_all(Queue::Ops, Reply::Ok).await;
        while sim
            .deliver_from(Queue::OpsRetry, Reply::Rejected, false)
            .await
        {}

        sim.sync(M3A).await;
        assert!(db_has(sim, M3A, STARRED).await);
        assert!(gmail_has(sim, M3A, STARRED));
        assert!(sim.world.flag_mismatches().await.is_empty());
    }
);

scenario!(
    an_unarchive_that_cannot_be_queued_leaves_the_queued_archive_in_charge,
    904,
    |world| {
        let sim = &mut Sim::new(&mut world, 1);
        sim.act(Action::Archive(T1, true), false).await.unwrap();
        sim.deliver_all(Queue::Ops, Reply::RateLimited).await;
        assert!(sim.act(Action::Archive(T1, false), true).await.is_err());
        assert!(!in_inbox(sim, T1).await);
        assert_eq!(live_markers(sim).await, 3);

        sim.sync(M1A).await;
        sim.resync(M1B).await;
        assert!(!in_inbox(sim, T1).await);
        while sim.deliver_from(Queue::OpsRetry, Reply::Ok, false).await {}
        sync_thread(sim, T1).await;
        assert!(!gmail_has(sim, M1A, INBOX));
        assert!(!in_inbox(sim, T1).await);
    }
);

/// Gmail answers a read before the archive lands, the archive lands and
/// clears its marker, the echo sync runs, and only then does the stale
/// answer arrive.
async fn stale_fetch_after_the_write_lands(sim: &mut Sim<'_>, resync: bool) {
    sim.act(Action::Archive(T1, true), false).await.unwrap();
    sim.deliver_all(Queue::Ops, Reply::RateLimited).await;
    let (source, kind) = if resync {
        (Source::Resync(M1A), Kind::ReadFull)
    } else {
        (Source::Sync(M1A), Kind::ReadLabels)
    };
    let paused = sim
        .start_paused(source, kind, PauseAt::AfterApply)
        .await
        .unwrap();
    while sim.deliver_from(Queue::OpsRetry, Reply::Ok, false).await {}
    sim.sync(M1A).await;
    assert!(!db_has(sim, M1A, INBOX).await);
    sim.finish_paused(paused).await;

    assert!(!db_has(sim, M1A, INBOX).await);
    assert!(!in_inbox(sim, T1).await);
    assert!(!gmail_has(sim, M1A, INBOX));
}

scenario!(
    a_stale_label_fetch_does_not_bring_back_an_archive_that_landed_meanwhile,
    905,
    |world| {
        stale_fetch_after_the_write_lands(&mut Sim::new(&mut world, 1), false).await;
    }
);

scenario!(
    a_stale_resync_does_not_bring_back_an_archive_that_landed_meanwhile,
    906,
    |world| {
        stale_fetch_after_the_write_lands(&mut Sim::new(&mut world, 1), true).await;
    }
);

scenario!(
    a_resync_with_no_gmail_labels_removes_all_but_the_pending_ones,
    907,
    |world| {
        let sim = &mut Sim::new(&mut world, 1);
        sim.act(Action::Read(T3, true), false).await.unwrap();
        sim.deliver_all(Queue::Ops, Reply::RateLimited).await;
        // In Gmail's own UI the user archives, unlabels and reads it.
        sim.world
            .gmail
            .external_change("m3a", &[], &[INBOX, WORK, UNREAD]);

        sim.resync(M3A).await;
        assert!(!db_has(sim, M3A, INBOX).await);
        assert!(!db_has(sim, M3A, WORK).await);
        assert!(!db_has(sim, M3A, UNREAD).await);
        assert!(!in_inbox(sim, T3).await);
        assert!(sim.world.flag_mismatches().await.is_empty());
    }
);

scenario!(
    a_rejected_write_restores_the_labels_and_the_thread_state,
    908,
    |world| {
        let sim = &mut Sim::new(&mut world, 1);
        sim.act(Action::Archive(T2, true), false).await.unwrap();
        sim.deliver_all(Queue::Ops, Reply::Rejected).await;
        assert!(db_has(sim, M2A, INBOX).await);
        assert!(in_inbox(sim, T2).await);

        sim.act(Action::Read(T2, true), false).await.unwrap();
        sim.deliver_all(Queue::Ops, Reply::Rejected).await;
        assert!(db_has(sim, M2A, UNREAD).await);
        assert!(sim.world.flag_mismatches().await.is_empty());
    }
);

scenario!(
    a_rejected_unarchive_lets_the_older_archive_waiting_behind_it_reach_gmail,
    909,
    |world| {
        let sim = &mut Sim::new(&mut world, 1);
        sim.act(Action::Archive(T3, true), false).await.unwrap();
        sim.deliver_all(Queue::Ops, Reply::RateLimited).await;
        sim.act(Action::Archive(T3, false), false).await.unwrap();
        // The archive's retry runs while the unarchive is still queued: it waits.
        let requests_before = sim.world.gmail.lock().log.len();
        sim.deliver_from(Queue::OpsRetry, Reply::Ok, false).await;
        assert_eq!(sim.world.gmail.lock().log.len(), requests_before);
        assert_eq!(sim.queue_len(Queue::OpsRetry), 1);

        sim.deliver_all(Queue::Ops, Reply::Rejected).await;
        assert!(!in_inbox(sim, T3).await);
        while sim.deliver_from(Queue::OpsRetry, Reply::Ok, false).await {}
        assert!(!gmail_has(sim, M3A, INBOX));
        assert_eq!(live_markers(sim).await, 0);
        sim.sync(M3A).await;
        assert!(!in_inbox(sim, T3).await);
    }
);

scenario!(
    a_failed_enqueue_and_a_rejection_keep_the_first_archive_they_took_over,
    910,
    |world| {
        let sim = &mut Sim::new(&mut world, 1);
        sim.act(Action::Archive(T3, true), false).await.unwrap();
        sim.deliver_all(Queue::Ops, Reply::RateLimited).await;
        sim.act(Action::Archive(T3, false), false).await.unwrap();
        assert!(sim.act(Action::Archive(T3, true), true).await.is_err());
        sim.deliver_all(Queue::Ops, Reply::Rejected).await;
        assert!(!in_inbox(sim, T3).await);

        let requests_before = sim.world.gmail.lock().log.len();
        while sim.deliver_from(Queue::OpsRetry, Reply::Ok, false).await {}
        assert!(sim.world.gmail.lock().log.len() > requests_before);
        assert!(!gmail_has(sim, M3A, INBOX));
        sim.sync(M3A).await;
        assert!(!in_inbox(sim, T3).await);
    }
);

/// A star staged, sent and confirmed entirely while a sync's Gmail fetch is
/// in flight.
async fn star_inside_the_fetch(sim: &mut Sim<'_>, resync: bool) {
    let (source, kind) = if resync {
        (Source::Resync(M1A), Kind::ReadFull)
    } else {
        (Source::Sync(M1A), Kind::ReadLabels)
    };
    let paused = sim
        .start_paused(source, kind, PauseAt::AfterApply)
        .await
        .unwrap();
    sim.act(Action::Star(T1, true), false).await.unwrap();
    sim.deliver_all(Queue::Ops, Reply::Ok).await;
    sim.sync(M1A).await;
    assert!(db_has(sim, M1A, STARRED).await);
    sim.finish_paused(paused).await;

    assert!(db_has(sim, M1A, STARRED).await);
    assert!(gmail_has(sim, M1A, STARRED));
    assert!(sim.world.flag_mismatches().await.is_empty());
}

scenario!(
    a_resync_keeps_a_write_made_and_confirmed_during_its_fetch,
    911,
    |world| {
        star_inside_the_fetch(&mut Sim::new(&mut world, 1), true).await;
    }
);

scenario!(
    a_label_sync_keeps_a_write_made_and_confirmed_during_its_fetch,
    912,
    |world| {
        star_inside_the_fetch(&mut Sim::new(&mut world, 1), false).await;
    }
);

scenario!(
    a_recovery_backfill_does_not_bring_back_an_archive_that_landed_during_its_fetch,
    913,
    |world| {
        use models_email::email::service::backfill::{BackfillMessagePayload, JobScopedPayload};
        let sim = &mut Sim::new(&mut world, 1);
        sim.act(Action::Archive(T1, true), false).await.unwrap();
        sim.deliver_all(Queue::Ops, Reply::RateLimited).await;
        let ctx = sim.world.sync.clone();
        let link = email_db_client::links::get::fetch_link_by_id(&ctx.db, sim.world.link_id)
            .await
            .unwrap()
            .unwrap();
        let scope = JobScopedPayload {
            link_id: link.id,
            job_id: uuid::Uuid::from_u128(0xb0),
            payload: BackfillMessagePayload {
                thread_provider_id: THREADS[T1].to_string(),
                thread_db_id: sim.world.thread_ids[THREADS[T1]],
                message_provider_id: MESSAGES[M1A].0.to_string(),
            },
        };
        wiring::reset_admission(&mut sim.world.redis, sim.world.link_id).await;
        let pause = sim
            .world
            .gmail
            .pause_next(Kind::ReadFull, Some("m1a"), PauseAt::AfterApply);
        let mut backfill = tokio::spawn(async move {
            let _ =
                crate::pubsub::backfill::backfill_message::backfill_message(&ctx, &scope, &link)
                    .await;
        });
        let arrived = tokio::select! {
            _ = &mut backfill => false,
            arrived = pause.arrived => arrived.is_ok(),
        };
        assert!(arrived, "the backfill's fetch reaches Gmail");
        while sim.deliver_from(Queue::OpsRetry, Reply::Ok, false).await {}
        sim.sync(M1A).await;
        assert!(!db_has(sim, M1A, INBOX).await);
        let _ = pause.release.send(());
        backfill.await.unwrap();

        assert!(!db_has(sim, M1A, INBOX).await);
        assert!(!gmail_has(sim, M1A, INBOX));
        assert!(sim.world.flag_mismatches().await.is_empty());
    }
);

scenario!(
    an_unqueued_mark_unread_reverts_without_undoing_a_newer_mark_read,
    914,
    |world| {
        use email::domain::models::mailbox_action::MailboxAction;
        use email::domain::ports::EmailService;
        let sim = &mut Sim::new(&mut world, 1);
        let (arrived, release) = sim.world.sqs.pause_next_send();
        let owner = owner();
        let thread = sim.world.thread_ids[THREADS[T1]];
        let email = sim.world.email.clone();
        // Mark t1 unread; its enqueue is held, then fails.
        let first = {
            let email = email.clone();
            let owner = owner.clone();
            tokio::spawn(async move {
                email
                    .change_thread_mailbox_state(owner, thread, MailboxAction::Read(false))
                    .await
            })
        };
        arrived.await.unwrap();
        // Meanwhile the user marks t1 read; this write is queued normally.
        let second = email
            .change_thread_mailbox_state(owner, thread, MailboxAction::Read(true))
            .await;
        sim.world.sqs.set_outage(true);
        let _ = release.send(());
        let first = first.await.unwrap();
        sim.world.sqs.set_outage(false);

        assert!(first.is_err());
        assert!(second.is_ok());
        for message in [M1A, M1B, M1C] {
            assert!(!db_has(sim, message, UNREAD).await);
        }
        assert!(sim.world.flag_mismatches().await.is_empty());
    }
);

/// With label write batches off, archiving a three-message thread queues one
/// operation per message, all for the same write. Each settles only its own
/// message: an accepted one clears its marker, a rejected one puts its
/// message back, and one still queued keeps its message archived through a
/// sync.
#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn single_message_writes_each_settle_their_own_message(pool: PgPool) {
    let mut world = World::new(pool, 916, false).await;
    let sim = &mut Sim::new(&mut world, 1);
    sim.act(Action::Archive(T1, true), false).await.unwrap();
    assert_eq!(sim.queue_len(Queue::Ops), 3);
    assert_eq!(live_markers(sim).await, 3);

    sim.deliver_from(Queue::Ops, Reply::Ok, false).await;
    let accepted = only(
        T1_MESSAGES
            .into_iter()
            .filter(|m| !gmail_has(sim, *m, INBOX)),
    );
    assert_eq!(live_markers(sim).await, 2);

    sim.deliver_from(Queue::Ops, Reply::Rejected, false).await;
    let mut back_in_inbox = Vec::new();
    for message in T1_MESSAGES {
        if db_has(sim, message, INBOX).await {
            back_in_inbox.push(message);
        }
    }
    let rejected = only(back_in_inbox.into_iter());
    assert!(in_inbox(sim, T1).await);
    assert_eq!(live_markers(sim).await, 1);

    let queued = only(
        T1_MESSAGES
            .into_iter()
            .filter(|m| *m != accepted && *m != rejected),
    );
    sim.sync(queued).await;
    assert!(gmail_has(sim, queued, INBOX));
    assert!(!db_has(sim, queued, INBOX).await);

    sim.deliver_from(Queue::Ops, Reply::Ok, false).await;
    sync_thread(sim, T1).await;
    assert_eq!(live_markers(sim).await, 0);
    for message in T1_MESSAGES {
        assert_eq!(db_has(sim, message, INBOX).await, message == rejected);
        assert_eq!(gmail_has(sim, message, INBOX), message == rejected);
    }
    assert!(sim.world.flag_mismatches().await.is_empty());
}

/// With batches on, a write to fewer than ten messages goes to Gmail one
/// request per message. When Gmail rejects one after accepting another, only
/// the messages it hasn't accepted go back, so the database already agrees
/// with Gmail and no marker is left.
#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn a_rejection_partway_through_a_batch_keeps_what_gmail_accepted(pool: PgPool) {
    let mut world = World::new(pool, 917, true).await;
    let sim = &mut Sim::new(&mut world, 1);
    sim.act(Action::Archive(T1, true), false).await.unwrap();
    assert_eq!(sim.queue_len(Queue::Ops), 1);

    sim.deliver_answering(Queue::Ops, &[Reply::Ok, Reply::Rejected], false)
        .await;
    let accepted = only(
        T1_MESSAGES
            .into_iter()
            .filter(|m| !gmail_has(sim, *m, INBOX)),
    );
    assert_eq!(live_markers(sim).await, 0);
    assert_t1_inbox_is_all_but(sim, accepted).await;

    sync_thread(sim, T1).await;
    assert_t1_inbox_is_all_but(sim, accepted).await;
    assert!(in_inbox(sim, T1).await);
    assert!(sim.world.flag_mismatches().await.is_empty());
}

/// Seeds 4000735 and 8000641: with batches on, Gmail accepts a write's first
/// message and the next one is rate limited. The retry doesn't send the
/// accepted message again, and when Gmail rejects it, only the messages Gmail
/// never accepted go back.
#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn a_rejected_retry_keeps_the_messages_gmail_accepted_before_it(pool: PgPool) {
    let mut world = World::new(pool, 918, true).await;
    let sim = &mut Sim::new(&mut world, 1);
    sim.act(Action::Archive(T1, true), false).await.unwrap();
    sim.deliver_answering(Queue::Ops, &[Reply::Ok, Reply::RateLimited], false)
        .await;
    let accepted = only(
        T1_MESSAGES
            .into_iter()
            .filter(|m| !gmail_has(sim, *m, INBOX)),
    );
    assert_eq!(live_markers(sim).await, 2);
    assert_eq!(sim.queue_len(Queue::OpsRetry), 1);

    let requests_before = sim.world.gmail.lock().log.len();
    sim.deliver_answering(Queue::OpsRetry, &[Reply::Rejected], false)
        .await;
    let resent: Vec<String> = sim.world.gmail.lock().log[requests_before..]
        .iter()
        .flat_map(|request| request.ids.clone())
        .collect();
    assert!(!resent.contains(&MESSAGES[accepted].0.to_string()));
    assert_eq!(live_markers(sim).await, 0);
    assert_t1_inbox_is_all_but(sim, accepted).await;

    sync_thread(sim, T1).await;
    assert_t1_inbox_is_all_but(sim, accepted).await;
    assert!(in_inbox(sim, T1).await);
    assert!(sim.world.flag_mismatches().await.is_empty());
}

/// Seed 7000286: with batches on, an archive of a three-message thread is held
/// after Gmail applies its first message. The user unarchives the thread and
/// that write reaches Gmail first. When the archive resumes, it leaves the
/// other two messages to the unarchive.
#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn a_resumed_older_write_skips_messages_a_newer_write_took_over(pool: PgPool) {
    let mut world = World::new(pool, 919, true).await;
    let sim = &mut Sim::new(&mut world, 1);
    sim.act(Action::Archive(T1, true), false).await.unwrap();
    let paused = sim
        .start_paused(Source::Queued(Queue::Ops), Kind::Write, PauseAt::AfterApply)
        .await
        .unwrap();
    sim.act(Action::Archive(T1, false), false).await.unwrap();
    sim.deliver_all(Queue::Ops, Reply::Ok).await;
    let requests_before = sim.world.gmail.lock().log.len();
    sim.finish_paused(paused).await;

    assert_eq!(sim.world.gmail.lock().log.len(), requests_before);
    for message in T1_MESSAGES {
        assert!(gmail_has(sim, message, INBOX));
        assert!(db_has(sim, message, INBOX).await);
    }
    assert_eq!(live_markers(sim).await, 0);
    sync_thread(sim, T1).await;
    for message in T1_MESSAGES {
        assert!(db_has(sim, message, INBOX).await);
    }
    assert!(in_inbox(sim, T1).await);
    assert!(sim.world.flag_mismatches().await.is_empty());
}

/// Two bulk writes reach t1 and t2 in opposite orders, so each is the newer
/// one on a thread: the archive on t2, the unarchive on t1. On t2 the
/// archive drew the earlier id, as when requests race. The unarchive sends t1
/// before it waits for the archive on t2, and when Gmail rejects the archive,
/// t2 goes back to the unarchive, which then sends it.
#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn crossing_bulk_writes_each_send_where_they_are_newest_and_fall_back_on_rejection(
    pool: PgPool,
) {
    use crate::pubsub::gmail_ops::operations::OperationError;
    use crate::pubsub::gmail_ops::operations::modify_message_labels::modify_message_labels;
    use email::domain::ports::EmailRepo;
    use models_email::gmail::gmail_ops::{GmailMessageRef, ModifyMessageLabelsBatchPayload};
    use uuid::Uuid;

    let mut world = World::new(pool, 920, true).await;
    let sim = &mut Sim::new(&mut world, 1);
    sim.act(Action::Archive(T2, true), false).await.unwrap();
    sim.deliver_all(Queue::Ops, Reply::Ok).await;

    let archive = Uuid::from_u128(0xc1);
    let unarchive = Uuid::from_u128(0xc2);
    let repo = email::outbound::EmailPgRepo::new(sim.world.db.clone());
    for (thread, add, write_id) in [
        (T1, false, archive),
        (T2, true, unarchive),
        (T1, true, unarchive),
        (T2, false, archive),
    ] {
        repo.stage_thread_label_change(
            sim.world.thread_ids[THREADS[thread]],
            sim.world.link_id,
            INBOX,
            add,
            write_id,
        )
        .await
        .unwrap()
        .unwrap();
    }
    let write = |add: bool, write_id: Uuid, messages: [usize; 5]| {
        let inbox = vec![INBOX.to_string()];
        ModifyMessageLabelsBatchPayload {
            messages: messages
                .iter()
                .map(|message| GmailMessageRef {
                    db_message_id: sim.world.message_ids[MESSAGES[*message].0],
                    provider_message_id: MESSAGES[*message].0.to_string(),
                })
                .collect(),
            labels_to_add: if add { inbox.clone() } else { vec![] },
            labels_to_remove: if add { vec![] } else { inbox },
            pending_write_id: Some(write_id),
        }
    };
    let archive = write(false, archive, [M1A, M1B, M1C, M2A, M2B]);
    let unarchive = write(true, unarchive, [M2A, M2B, M1A, M1B, M1C]);
    let link = email_db_client::links::get::fetch_link_by_id(&sim.world.db, sim.world.link_id)
        .await
        .unwrap()
        .unwrap();

    wiring::reset_admission(&mut sim.world.redis, sim.world.link_id).await;
    let requests_before = sim.world.gmail.lock().log.len();
    let result = modify_message_labels(&sim.world.ops, &link, &unarchive).await;
    assert!(matches!(result, Err(OperationError::WaitingForNewerWrite)));
    let sent: Vec<String> = sim.world.gmail.lock().log[requests_before..]
        .iter()
        .filter(|request| request.kind == Kind::Write)
        .flat_map(|request| request.ids.clone())
        .collect();
    assert_eq!(sent, ["m1a", "m1b", "m1c"]);

    wiring::reset_admission(&mut sim.world.redis, sim.world.link_id).await;
    sim.world
        .gmail
        .lock()
        .next_writes
        .push_back(Reply::Rejected);
    let result = modify_message_labels(&sim.world.ops, &link, &archive).await;
    assert!(matches!(result, Err(OperationError::Gmail(_))));
    assert!(in_inbox(sim, T2).await);

    wiring::reset_admission(&mut sim.world.redis, sim.world.link_id).await;
    modify_message_labels(&sim.world.ops, &link, &unarchive)
        .await
        .unwrap();
    for message in [M1A, M1B, M1C, M2A, M2B] {
        assert!(db_has(sim, message, INBOX).await);
        assert!(gmail_has(sim, message, INBOX));
    }
    assert_eq!(live_markers(sim).await, 0);
    assert!(sim.world.flag_mismatches().await.is_empty());
}

/// Every message of t1 but `archived` is in the inbox, in the database and at
/// Gmail.
async fn assert_t1_inbox_is_all_but(sim: &Sim<'_>, archived: usize) {
    for message in T1_MESSAGES {
        assert_eq!(db_has(sim, message, INBOX).await, message != archived);
        assert_eq!(gmail_has(sim, message, INBOX), message != archived);
    }
}

const T1_MESSAGES: [usize; 3] = [M1A, M1B, M1C];

fn only(mut messages: impl Iterator<Item = usize>) -> usize {
    let message = messages.next().expect("one message");
    assert!(messages.next().is_none(), "exactly one message");
    message
}

/// Local stacks run the email workers unoptimized on tokio's 2 MiB worker
/// stacks. A label write and a label sync of the same mailbox, run at the same
/// time, must fit well within that: a Gmail read passed by value once made the
/// sync path overflow it.
fn label_writes_and_a_label_sync_fit_on_small_worker_stacks(
    pool: PgPool,
    shard: u32,
    label_write_batches: bool,
) {
    use aws_sdk_sqs::types::{Message, MessageSystemAttributeName};
    use email::domain::ports::EmailService;
    use models_email::gmail::inbox_sync::{
        InboxSyncOperation, InboxSyncPubsubMessage, UpdateLabelsPayload,
    };
    let message = |id: String, body: String| {
        Message::builder()
            .receipt_handle(format!("{id}#1"))
            .message_id(id)
            .body(body)
            .attributes(MessageSystemAttributeName::ApproximateReceiveCount, "1")
            .build()
    };
    on_worker_stacks(&pool, 1536 << 10, move |pool| async move {
        let mut world = World::new(pool, shard, label_write_batches).await;
        for round in 0..3 {
            world.reset().await;
            world
                .email
                .set_thread_archived(owner(), world.thread_ids[THREADS[T1]], true)
                .await
                .unwrap();
            let (sent, _) = world.sqs.take();
            let writes: Vec<_> = sent
                .into_iter()
                .filter(|sent| sent.queue_url == world.queues.ops)
                .enumerate()
                .map(|(index, sent)| message(format!("write-{round}-{index}"), sent.body))
                .collect();
            let label_sync = serde_json::to_string(&InboxSyncPubsubMessage {
                link_id: world.link_id,
                operation: InboxSyncOperation::UpdateLabels(UpdateLabelsPayload {
                    provider_message_id: MESSAGES[M1A].0.to_string(),
                }),
            })
            .unwrap();
            let label_sync = message(format!("label-sync-{round}"), label_sync);
            let sync = world.sync.clone();
            let label_sync = tokio::spawn(async move {
                crate::pubsub::inbox_sync::process::process_message(sync, &label_sync).await
            });
            let writes: Vec<_> = writes
                .into_iter()
                .map(|write| {
                    let ops = world.ops.clone();
                    tokio::spawn(async move {
                        crate::pubsub::gmail_ops::process::process_message(ops, &write).await
                    })
                })
                .collect();
            for write in writes {
                write.await.unwrap().unwrap();
            }
            label_sync.await.unwrap().unwrap();
        }
        assert!(!gmail_has_inbox_on_t1(&world));
    });
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn single_message_writes_and_a_label_sync_fit_on_small_worker_stacks(pool: PgPool) {
    label_writes_and_a_label_sync_fit_on_small_worker_stacks(pool, 915, false);
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn a_label_write_batch_and_a_label_sync_fit_on_small_worker_stacks(pool: PgPool) {
    label_writes_and_a_label_sync_fit_on_small_worker_stacks(pool, 1015, true);
}

fn gmail_has_inbox_on_t1(world: &World) -> bool {
    let gmail = world.gmail_labels();
    [M1A, M1B, M1C]
        .iter()
        .any(|message| gmail[MESSAGES[*message].0].contains(INBOX))
}
