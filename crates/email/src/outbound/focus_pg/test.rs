use chrono::Duration;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use serde_json::Value;
use sqlx::{Pool, Postgres};

use super::*;
use crate::domain::{
    focus::{
        ClassifyOutcome, FocusAnswers, FocusClassifier, FocusClassifierError, FocusNotifier,
        FocusQueries, FocusQuestion, FocusService, FocusThread, FocusVerdict, ProfileSource,
    },
    models::calendar_invitation::{CalendarInvitation, InvitationDateTime, InvitationMethod},
};

const OWNER_LINK: Uuid = uuid::uuid!("00000000-0000-0000-0000-000000000f01");
const OTHER_LINK: Uuid = uuid::uuid!("00000000-0000-0000-0000-000000000f02");
const OTHER_THREAD: Uuid = uuid::uuid!("00000000-0000-0000-0000-00000000f207");
const INVOICE: Uuid = uuid::uuid!("00000000-0000-0000-0000-00000000f201");
const ARCHIVED: Uuid = uuid::uuid!("00000000-0000-0000-0000-00000000f202");
const BULK: Uuid = uuid::uuid!("00000000-0000-0000-0000-00000000f204");
const FIRST_MESSAGE: Uuid = uuid::uuid!("00000000-0000-0000-0000-00000000f501");
const LATEST_MESSAGE: Uuid = uuid::uuid!("00000000-0000-0000-0000-00000000f503");
// Threads in the email_focus_waiting fixture.
const REPLIED_LAST: Uuid = uuid::uuid!("00000000-0000-0000-0000-00000000f301");
const REPLIED_YESTERDAY: Uuid = uuid::uuid!("00000000-0000-0000-0000-00000000f302");
const REPLIED_THEN_DONE: Uuid = uuid::uuid!("00000000-0000-0000-0000-00000000f303");
const CLOSED_WITH_THANKS: Uuid = uuid::uuid!("00000000-0000-0000-0000-00000000f304");
const ONLY_SENT: Uuid = uuid::uuid!("00000000-0000-0000-0000-00000000f305");
const RESCHEDULE: Uuid = uuid::uuid!("00000000-0000-0000-0000-00000000f306");
const RSVP: Uuid = uuid::uuid!("00000000-0000-0000-0000-00000000f307");
const NOISE: Uuid = uuid::uuid!("00000000-0000-0000-0000-00000000f308");
const CALENDAR_FILE: Uuid = uuid::uuid!("00000000-0000-0000-0000-00000000f309");
const RECENT_CONTACT: Uuid = uuid::uuid!("00000000-0000-0000-0000-00000000f30a");
/// In the email_focus_waiting fixture: someone the owner never wrote to, and labels.
const STRANGER: Uuid = uuid::uuid!("00000000-0000-0000-0000-0000000cf006");
const INBOX_LABEL: Uuid = uuid::uuid!("00000000-0000-0000-0000-0000000bf002");
const UPDATES_LABEL: Uuid = uuid::uuid!("00000000-0000-0000-0000-0000000bf004");
/// Answers that earn nothing: only key mail and the wait bring a thread in.
const LOW_ANSWERS: [f32; 8] = [0.05, 0.0, 0.9, 0.0, 0.0, 0.0, 0.0, 0.0];
/// Answers that earn Focus on their own.
const HIGH_ANSWERS: [f32; 8] = [0.9, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0];

struct NoProfile;

impl ProfileSource for NoProfile {
    async fn profile(&self, _owner: &MacroUserIdStr<'static>) -> Result<Option<String>, Report> {
        Ok(None)
    }
}

/// Answers every thread the same; fails the test's expectation by being called
/// when the caller asserted it wouldn't be.
#[derive(Clone)]
struct FixedClassifier {
    answers: Result<Vec<f32>, FocusClassifierError>,
}

impl FocusClassifier for FixedClassifier {
    async fn answer(
        &self,
        _owner: &MacroUserIdStr<'static>,
        _thread_id: Uuid,
        _input: &Value,
        _questions: &[&'static str],
    ) -> Result<Vec<f32>, FocusClassifierError> {
        self.answers.clone()
    }

    fn model(&self) -> &'static str {
        "jev-test"
    }
}

struct NoReaders;

impl FocusNotifier for NoReaders {
    fn focus_changed(&self, _owner: &MacroUserIdStr<'static>, _link_id: Uuid) {}
}

fn worker(
    repo: &FocusPgRepository,
    answers: Result<Vec<f32>, FocusClassifierError>,
) -> FocusService<FocusPgRepository, NoProfile, FixedClassifier, NoReaders> {
    FocusService::new(
        repo.clone(),
        NoProfile,
        FixedClassifier { answers },
        NoReaders,
        vec!["acme.example".to_owned()],
    )
}

/// A message in a fixture thread, from Casey or the owner.
async fn insert_message(
    pool: &Pool<Postgres>,
    thread_id: Uuid,
    is_sent: bool,
    at: DateTime<Utc>,
) -> Result<(), Report> {
    let from_contact_id = if is_sent {
        uuid::uuid!("00000000-0000-0000-0000-0000000cf002")
    } else {
        uuid::uuid!("00000000-0000-0000-0000-0000000cf001")
    };
    insert_message_from(pool, thread_id, from_contact_id, is_sent, at).await
}

async fn insert_message_from(
    pool: &Pool<Postgres>,
    thread_id: Uuid,
    from_contact_id: Uuid,
    is_sent: bool,
    at: DateTime<Utc>,
) -> Result<(), Report> {
    let id = macro_uuid::generate_uuid_v7();
    sqlx::query!(
        r#"
        INSERT INTO email_messages (
            id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts,
            has_attachments, is_read, is_starred, is_draft, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, false, true, false, false, NOW(), NOW())
        "#,
        id,
        thread_id,
        OWNER_LINK,
        id.to_string(),
        is_sent,
        from_contact_id,
        at,
    )
    .execute(pool)
    .await?;
    Ok(())
}

/// Project every fixture thread's labels onto it, as ingestion does.
async fn project_threads(pool: &Pool<Postgres>) -> Result<(), Report> {
    let mut conn = pool.acquire().await?;
    for thread in [
        REPLIED_LAST,
        REPLIED_YESTERDAY,
        REPLIED_THEN_DONE,
        CLOSED_WITH_THANKS,
        ONLY_SENT,
        RESCHEDULE,
        RSVP,
        NOISE,
        CALENDAR_FILE,
        RECENT_CONTACT,
    ] {
        email_db_client::threads::update::recompute_thread_metadata(&mut conn, thread, OWNER_LINK)
            .await?;
    }
    Ok(())
}

async fn load_thread(
    repo: &FocusPgRepository,
    thread_id: Uuid,
) -> Result<Option<FocusThread>, Report> {
    let Some(inbox) = repo.thread_inbox(thread_id).await? else {
        return Ok(None);
    };
    let mail = repo.thread_mail(&inbox).await?;
    Ok(Some(FocusThread::new(inbox, mail)))
}

fn owner() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("owner@acme.example").unwrap()
}

fn record(thread_id: Uuid, message_id: Uuid, at: DateTime<Utc>, importance: u8) -> FocusRecord {
    FocusRecord {
        thread_id,
        link_id: OWNER_LINK,
        classified_message_id: message_id,
        classified_message_ts: at,
        verdict: FocusVerdict {
            is_focus: true,
            pinned: false,
            calendar_hold_until: None,
            category: FocusCategory::Customer,
            needs_reply: true,
            needs_follow_up: false,
            awaiting_reply: false,
            importance,
        },
        answers: FocusAnswers::from_probabilities(&[0.5; FocusQuestion::ALL.len()]).unwrap(),
        model: "jev-test".to_owned(),
        classified_at: Utc::now(),
    }
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("email_focus"))
)]
async fn reads_a_thread_with_its_relationship(pool: Pool<Postgres>) -> Result<(), Report> {
    let repo = FocusPgRepository(pool);
    let thread = load_thread(&repo, INVOICE).await?.expect("thread exists");

    assert_eq!(thread.owner, owner());
    assert_eq!(thread.owner_email, "owner@acme.example");
    assert!(thread.is_signal && thread.inbox_visible);
    assert_eq!(thread.classified, None);
    // Oldest first; the trashed follow-up is left out.
    let ids = thread.messages.iter().map(|m| m.id).collect::<Vec<_>>();
    assert_eq!(ids.first(), Some(&FIRST_MESSAGE));
    assert_eq!(ids.last(), Some(&LATEST_MESSAGE));
    assert_eq!(ids.len(), 3);
    let first = &thread.messages[0];
    assert_eq!(first.from_email.as_deref(), Some("Casey@Customer.example"));
    assert_eq!(first.from_name.as_deref(), Some("Casey"));
    assert_eq!(first.to, vec!["owner@acme.example"]);
    assert_eq!(first.cc, vec!["jacob@acme.example"]);
    assert!(first.has_attachments && !first.bulk);
    assert_eq!(thread.messages[2].from_name.as_deref(), Some("Casey C."));
    assert!(thread.messages[1].is_sent);
    let [note] = thread.sent_notes.as_slice() else {
        panic!("expected one sent note, got {:?}", thread.sent_notes);
    };
    assert_eq!(note.recipient, "casey@customer.example");
    assert_eq!(
        note.body.as_deref(),
        Some("Thanks, I will take a look today.")
    );
    assert_eq!(note.at, thread.messages[1].at);
    assert!(load_thread(&repo, Uuid::new_v4()).await?.is_none());
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("email_focus"))
)]
async fn marks_bulk_mail_and_finds_brush_offs(pool: Pool<Postgres>) -> Result<(), Report> {
    let repo = FocusPgRepository(pool);
    let thread = load_thread(&repo, BULK).await?.expect("thread exists");
    assert!(thread.messages[0].bulk);
    let [note] = thread.sent_notes.as_slice() else {
        panic!("expected one sent note, got {:?}", thread.sent_notes);
    };
    assert_eq!(note.recipient, "seller@leads.example");
    assert_eq!(note.body.as_deref(), Some("No thanks"));
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("email_focus"))
)]
async fn stale_threads_cover_enabled_inbox_signal_mail_in_the_window(
    pool: Pool<Postgres>,
) -> Result<(), Report> {
    let repo = FocusPgRepository(pool);
    let since = Utc::now() - Duration::days(30);
    let enabled = vec!["acme.example".to_owned()];
    let stale = async |limit| -> Result<Vec<Uuid>, Report> {
        Ok(repo
            .stale_threads(since, &enabled, None, limit)
            .await?
            .into_iter()
            .map(|stale| stale.thread_id)
            .collect())
    };

    assert_eq!(stale(10).await?, vec![INVOICE, BULK]);
    assert_eq!(stale(1).await?, vec![INVOICE]);
    assert!(repo.stale_threads(since, &[], None, 10).await?.is_empty());

    // Each page starts past the last thread of the one before.
    let first = repo.stale_threads(since, &enabled, None, 1).await?;
    let second = repo
        .stale_threads(since, &enabled, first.last().copied(), 1)
        .await?;
    assert_eq!(
        second
            .iter()
            .map(|stale| stale.thread_id)
            .collect::<Vec<_>>(),
        vec![BULK]
    );
    let third = repo
        .stale_threads(since, &enabled, second.last().copied(), 1)
        .await?;
    assert!(third.is_empty());
    // Classified at an older message: still stale. At the latest: done.
    let thread = load_thread(&repo, INVOICE).await?.unwrap();
    repo.save(&record(INVOICE, FIRST_MESSAGE, thread.messages[0].at, 50))
        .await?;
    assert_eq!(stale(10).await?, vec![INVOICE, BULK]);
    let latest = thread.messages.last().unwrap();
    repo.save(&record(INVOICE, latest.id, latest.at, 50))
        .await?;
    assert_eq!(stale(10).await?, vec![BULK]);
    let stored = load_thread(&repo, INVOICE).await?.unwrap().classified;
    assert_eq!(stored.map(|stored| stored.message_id), Some(LATEST_MESSAGE));
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("email_focus"))
)]
async fn threads_with_the_same_latest_mail_do_not_fall_between_pages(
    pool: Pool<Postgres>,
) -> Result<(), Report> {
    let repo = FocusPgRepository(pool.clone());
    let since = Utc::now() - Duration::days(30);
    let enabled = vec!["acme.example".to_owned()];
    sqlx::query!(
        r#"
        UPDATE email_threads
        SET latest_inbound_message_ts = $1, latest_outbound_message_ts = NULL
        WHERE id = ANY($2)
        "#,
        Utc::now(),
        &[INVOICE, BULK],
    )
    .execute(&pool)
    .await?;
    let first = repo.stale_threads(since, &enabled, None, 1).await?;
    let second = repo
        .stale_threads(since, &enabled, first.last().copied(), 1)
        .await?;
    let mut both = first
        .iter()
        .chain(&second)
        .map(|stale| stale.thread_id)
        .collect::<Vec<_>>();
    both.sort_unstable();
    assert_eq!(both, vec![INVOICE, BULK]);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("email_focus"))
)]
async fn an_older_classification_never_replaces_a_newer_one(
    pool: Pool<Postgres>,
) -> Result<(), Report> {
    let repo = FocusPgRepository(pool);
    let thread = load_thread(&repo, INVOICE).await?.unwrap();
    let latest = thread.messages.last().unwrap();
    assert!(
        repo.save(&record(INVOICE, latest.id, latest.at, 80))
            .await?
    );
    assert!(
        !repo
            .save(&record(INVOICE, FIRST_MESSAGE, thread.messages[0].at, 10))
            .await?
    );

    let stored = repo
        .focus_for_threads(&owner(), &[INVOICE], Utc::now(), Utc::now())
        .await?;
    let focus = stored.get(&INVOICE).expect("stored");
    assert_eq!(focus.importance, 80);
    assert_eq!(focus.category, FocusCategory::Customer);
    assert!(focus.needs_reply && !focus.needs_follow_up && focus.is_focus);
    let classified = load_thread(&repo, INVOICE).await?.unwrap().classified;
    assert_eq!(
        classified.map(|stored| stored.message_id),
        Some(LATEST_MESSAGE)
    );

    // Reclassifying the same message replaces the result.
    assert!(
        repo.save(&record(INVOICE, latest.id, latest.at, 70))
            .await?
    );
    let stored = repo
        .focus_for_threads(&owner(), &[INVOICE], Utc::now(), Utc::now())
        .await?;
    assert_eq!(stored.get(&INVOICE).expect("stored").importance, 70);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("email_focus"))
)]
async fn focus_list_is_the_owners_inbox_newest_first(pool: Pool<Postgres>) -> Result<(), Report> {
    let repo = FocusPgRepository(pool.clone());
    let now = Utc::now();
    let since = now - Duration::days(30);
    repo.save(&record(INVOICE, LATEST_MESSAGE, now, 10)).await?;
    repo.save(&record(BULK, Uuid::new_v4(), now, 90)).await?;
    // Archived threads leave Focus even with a stored verdict.
    repo.save(&record(ARCHIVED, Uuid::new_v4(), now, 99))
        .await?;
    // Someone else's inbox, not linked to the owner.
    repo.save(&FocusRecord {
        link_id: OTHER_LINK,
        ..record(OTHER_THREAD, Uuid::new_v4(), now, 95)
    })
    .await?;

    // Importance plays no part: mail from 20 hours ago at 10 comes before mail
    // from 3 days ago at 90, and the limit keeps the newer one.
    assert_eq!(
        repo.focus_thread_ids(&owner(), since, now, now, 10).await?,
        vec![INVOICE, BULK]
    );
    assert_eq!(
        repo.focus_thread_ids(&owner(), since, now, now, 1).await?,
        vec![INVOICE]
    );
    assert_eq!(
        repo.focus_thread_ids(&owner(), now - Duration::days(1), now, now, 10)
            .await?,
        vec![INVOICE]
    );

    // A newer message in either direction moves a thread up: the owner's reply
    // an hour ago brings BULK ahead of INVOICE's newer inbound mail.
    insert_message(&pool, BULK, true, now - Duration::hours(1)).await?;
    assert_eq!(
        repo.focus_thread_ids(&owner(), since, now, now, 10).await?,
        vec![BULK, INVOICE]
    );
    assert_eq!(
        repo.focus_thread_ids(&owner(), since, now, now, 1).await?,
        vec![BULK]
    );

    // The other inbox's owner sees only their own thread.
    let stranger = MacroUserIdStr::try_from_email("other@elsewhere.example").unwrap();
    assert_eq!(
        repo.focus_thread_ids(&stranger, since, now, now, 10)
            .await?,
        vec![OTHER_THREAD]
    );
    assert!(
        repo.focus_for_threads(&stranger, &[INVOICE, BULK], now, now)
            .await?
            .is_empty()
    );
    assert_eq!(
        repo.focus_for_threads(&owner(), &[INVOICE, BULK, ARCHIVED], now, now)
            .await?
            .len(),
        3
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../fixtures",
        scripts("email_focus", "email_focus_linked")
    )
)]
async fn focus_covers_inboxes_linked_to_the_owner(pool: Pool<Postgres>) -> Result<(), Report> {
    let repo = FocusPgRepository(pool);
    let now = Utc::now();
    repo.save(&FocusRecord {
        link_id: OTHER_LINK,
        ..record(OTHER_THREAD, Uuid::new_v4(), now, 70)
    })
    .await?;

    // The other inbox is linked to the owner's account, so its Focus is theirs too.
    assert_eq!(
        repo.focus_thread_ids(&owner(), now - Duration::days(30), now, now, 10)
            .await?,
        vec![OTHER_THREAD]
    );
    assert!(
        repo.focus_for_threads(&owner(), &[OTHER_THREAD], now, now)
            .await?
            .contains_key(&OTHER_THREAD)
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../fixtures",
        scripts("email_focus", "email_focus_waiting")
    )
)]
async fn a_thread_the_owner_answered_last_reaches_the_list_after_the_wait(
    pool: Pool<Postgres>,
) -> Result<(), Report> {
    project_threads(&pool).await?;
    let repo = FocusPgRepository(pool.clone());
    let worker = worker(&repo, Ok(LOW_ANSWERS.to_vec()));
    let queries = FocusQueries::new(repo.clone());

    // In the inbox, so the client shows it with no change: `done` is
    // `!inboxVisible`, and this thread's incoming mail keeps its INBOX label.
    let inbox = repo.thread_inbox(REPLIED_LAST).await?.expect("thread");
    assert!(inbox.inbox_visible);

    for thread in [REPLIED_LAST, REPLIED_YESTERDAY] {
        let ClassifyOutcome::Classified(verdict) = worker.classify_thread(thread).await? else {
            panic!("expected {thread} to be classified");
        };
        assert!(verdict.awaiting_reply);
    }
    let listed = queries.focus_thread_ids(&owner(), 30).await?;
    assert!(listed.contains(&REPLIED_LAST));
    assert!(!listed.contains(&REPLIED_YESTERDAY));

    let focus = queries
        .focus_for_threads(&owner(), &[REPLIED_LAST, REPLIED_YESTERDAY])
        .await?;
    let waiting = focus.get(&REPLIED_LAST).expect("stored");
    assert!(waiting.is_focus && waiting.needs_follow_up && !waiting.needs_reply);
    assert_eq!(waiting.importance, 55);
    let not_yet = focus.get(&REPLIED_YESTERDAY).expect("stored");
    assert!(!not_yet.is_focus && !not_yet.needs_follow_up);

    // Its signal score plays no part.
    sqlx::query!(
        "UPDATE email_threads SET is_signal = false WHERE id = $1",
        REPLIED_LAST
    )
    .execute(&pool)
    .await?;
    assert!(
        queries
            .focus_thread_ids(&owner(), 30)
            .await?
            .contains(&REPLIED_LAST)
    );

    // Editing a draft moves the thread's inbound time, as recompute_thread_metadata
    // does, but nobody wrote: it still waits and still reads as a follow-up.
    sqlx::query!(
        "UPDATE email_threads SET latest_inbound_message_ts = $1 WHERE id = $2",
        Utc::now(),
        REPLIED_LAST,
    )
    .execute(&pool)
    .await?;
    assert!(
        queries
            .focus_thread_ids(&owner(), 30)
            .await?
            .contains(&REPLIED_LAST)
    );
    let focus = queries.focus_for_threads(&owner(), &[REPLIED_LAST]).await?;
    let drafting = focus.get(&REPLIED_LAST).expect("stored");
    assert!(drafting.needs_follow_up && !drafting.needs_reply);

    // An answer ends the wait at once, ahead of the worker. Until the worker
    // reads it the thread keeps no label it no longer has.
    insert_message(&pool, REPLIED_LAST, false, Utc::now()).await?;
    assert!(
        !queries
            .focus_thread_ids(&owner(), 30)
            .await?
            .contains(&REPLIED_LAST)
    );
    let focus = queries.focus_for_threads(&owner(), &[REPLIED_LAST]).await?;
    let answered = focus.get(&REPLIED_LAST).expect("stored");
    assert!(!answered.is_focus && !answered.needs_follow_up);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../fixtures",
        scripts("email_focus", "email_focus_waiting")
    )
)]
async fn the_owner_writing_again_restarts_the_wait(pool: Pool<Postgres>) -> Result<(), Report> {
    project_threads(&pool).await?;
    let repo = FocusPgRepository(pool.clone());
    let worker = worker(&repo, Ok(LOW_ANSWERS.to_vec()));
    let queries = FocusQueries::new(repo);
    worker.classify_thread(REPLIED_LAST).await?;
    assert!(
        queries
            .focus_thread_ids(&owner(), 30)
            .await?
            .contains(&REPLIED_LAST)
    );

    // Ahead of the worker, the stored row still describes the older message.
    insert_message(&pool, REPLIED_LAST, true, Utc::now()).await?;
    assert!(
        !queries
            .focus_thread_ids(&owner(), 30)
            .await?
            .contains(&REPLIED_LAST)
    );
    let focus = queries.focus_for_threads(&owner(), &[REPLIED_LAST]).await?;
    let restarted = focus.get(&REPLIED_LAST).expect("stored");
    assert!(!restarted.is_focus && !restarted.needs_follow_up);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../fixtures",
        scripts("email_focus", "email_focus_waiting")
    )
)]
async fn an_answer_ends_the_wait_however_long_ago_it_came(
    pool: Pool<Postgres>,
) -> Result<(), Report> {
    project_threads(&pool).await?;
    let repo = FocusPgRepository(pool.clone());
    let worker = worker(&repo, Ok(LOW_ANSWERS.to_vec()));
    let queries = FocusQueries::new(repo);
    worker.classify_thread(REPLIED_LAST).await?;

    // Answered past the wait. Outside the signal inbox the worker can leave this
    // row as it is, so only who wrote last says the wait is over.
    insert_message(&pool, REPLIED_LAST, false, Utc::now() - Duration::days(4)).await?;
    assert!(
        !queries
            .focus_thread_ids(&owner(), 30)
            .await?
            .contains(&REPLIED_LAST)
    );
    let focus = queries.focus_for_threads(&owner(), &[REPLIED_LAST]).await?;
    let answered = focus.get(&REPLIED_LAST).expect("stored");
    assert!(!answered.is_focus && !answered.needs_follow_up);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../fixtures",
        scripts("email_focus", "email_focus_waiting")
    )
)]
async fn a_thread_of_only_sent_mail_stays_out(pool: Pool<Postgres>) -> Result<(), Report> {
    project_threads(&pool).await?;
    let repo = FocusPgRepository(pool);
    let now = Utc::now();
    let since = now - Duration::days(30);

    let inbox = repo.thread_inbox(ONLY_SENT).await?.expect("thread");
    assert!(!inbox.inbox_visible);
    let stale = repo
        .stale_threads(since, &["acme.example".to_owned()], None, 100)
        .await?;
    assert!(!stale.iter().any(|stale| stale.thread_id == ONLY_SENT));
    // Failing the classifier proves it was never asked.
    let worker = worker(&repo, Err(FocusClassifierError::Rejected));
    assert_eq!(
        worker.classify_thread(ONLY_SENT).await?,
        ClassifyOutcome::NotSignal
    );

    // Nothing classifies one, and a row could not bring it in anyway.
    let at = now - Duration::days(5);
    let mut waiting = record(ONLY_SENT, Uuid::new_v4(), at, 55);
    waiting.verdict.awaiting_reply = true;
    repo.save(&waiting).await?;
    assert!(
        !repo
            .focus_thread_ids(&owner(), since, now, now, 100)
            .await?
            .contains(&ONLY_SENT)
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../fixtures",
        scripts("email_focus", "email_focus_waiting")
    )
)]
async fn done_threads_and_closed_exchanges_are_not_waiting(
    pool: Pool<Postgres>,
) -> Result<(), Report> {
    project_threads(&pool).await?;
    let repo = FocusPgRepository(pool);
    let now = Utc::now();
    let since = now - Duration::days(30);
    let worker = worker(&repo, Ok(LOW_ANSWERS.to_vec()));

    // Marked Done: out of the inbox, so never classified or listed.
    assert_eq!(
        worker.classify_thread(REPLIED_THEN_DONE).await?,
        ClassifyOutcome::NotSignal
    );
    let at = now - Duration::days(5);
    let mut waiting = record(REPLIED_THEN_DONE, Uuid::new_v4(), at, 55);
    waiting.verdict.awaiting_reply = true;
    repo.save(&waiting).await?;
    assert!(
        !repo
            .focus_thread_ids(&owner(), since, now, now, 100)
            .await?
            .contains(&REPLIED_THEN_DONE)
    );

    // "Thanks!" leaves nobody owing a reply.
    let ClassifyOutcome::Classified(verdict) = worker.classify_thread(CLOSED_WITH_THANKS).await?
    else {
        panic!("expected a classification");
    };
    assert!(!verdict.awaiting_reply);
    assert!(
        !repo
            .focus_thread_ids(&owner(), since, now, now, 100)
            .await?
            .contains(&CLOSED_WITH_THANKS)
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../fixtures",
        scripts("email_focus", "email_focus_waiting")
    )
)]
async fn a_reschedule_reaches_focus_from_outside_the_signal_inbox(
    pool: Pool<Postgres>,
) -> Result<(), Report> {
    project_threads(&pool).await?;
    let repo = FocusPgRepository(pool);
    let now = Utc::now();
    let since = now - Duration::days(30);
    let worker = worker(&repo, Ok(LOW_ANSWERS.to_vec()));

    // Gmail filed these under Updates, so they are not signal threads.
    let reschedule = load_thread(&repo, RESCHEDULE).await?.expect("thread");
    assert!(!reschedule.is_signal);
    assert!(matches!(
        reschedule.messages[0].calendar_part,
        Some(CalendarPart::Change { .. })
    ));
    let rsvp = load_thread(&repo, RSVP).await?.expect("thread");
    assert_eq!(rsvp.messages[0].calendar_part, Some(CalendarPart::Rsvp));
    let file = load_thread(&repo, CALENDAR_FILE).await?.expect("thread");
    assert_eq!(file.messages[0].calendar_part, Some(CalendarPart::Unparsed));

    // The sweep finds only the change; the others have no reason to be read.
    let stale = repo
        .stale_threads(since, &["acme.example".to_owned()], None, 100)
        .await?
        .into_iter()
        .map(|stale| stale.thread_id)
        .collect::<Vec<_>>();
    assert!(stale.contains(&RESCHEDULE));
    for other in [RSVP, CALENDAR_FILE, NOISE] {
        assert!(!stale.contains(&other), "{other}");
    }

    let ClassifyOutcome::Classified(verdict) = worker.classify_thread(RESCHEDULE).await? else {
        panic!("expected the reschedule to be classified");
    };
    assert!(verdict.calendar_hold_until.is_some());
    assert!(!verdict.is_focus);
    // None of these is key mail, so none reaches the classifier.
    for other in [RSVP, CALENDAR_FILE, NOISE] {
        assert_eq!(
            worker.classify_thread(other).await?,
            ClassifyOutcome::NotSignal,
            "{other}"
        );
    }

    let listed = repo
        .focus_thread_ids(&owner(), since, now, now, 100)
        .await?;
    assert_eq!(listed, vec![RESCHEDULE]);
    let focus = repo
        .focus_for_threads(&owner(), &[RESCHEDULE], now, now)
        .await?;
    let held = focus.get(&RESCHEDULE).expect("stored");
    assert!(held.is_focus);
    assert_eq!(held.category, FocusCategory::Calendar);
    assert_eq!(held.importance, 50);
    Ok(())
}

fn invite(method: InvitationMethod, sequence: u32, end: DateTime<Utc>) -> CalendarInvitation {
    CalendarInvitation {
        id: macro_uuid::generate_uuid_v7().to_string(),
        uid: "event@numbers.example".to_owned(),
        method,
        sequence,
        dtstamp: None,
        last_modified: None,
        status: None,
        recurrence_id: None,
        recurrence_id_raw: None,
        title: None,
        organizer: None,
        attendees: Vec::new(),
        comment: None,
        location: None,
        description: None,
        start: None,
        end: Some(InvitationDateTime::Zoned {
            value: end.to_rfc3339(),
            time_zone: "UTC".to_owned(),
        }),
        recurrence: Some(Vec::new()),
        conference_url: None,
    }
}

/// A new thread holding one message from a stranger, received `at`, with what
/// ingestion would store for it. Filed under Updates it is outside the signal
/// inbox, so only what the message is can bring it in.
async fn notice_thread(
    pool: &Pool<Postgres>,
    subject: &str,
    invite: Option<CalendarInvitation>,
    at: DateTime<Utc>,
    filed_under_updates: bool,
) -> Result<Uuid, Report> {
    let thread_id = macro_uuid::generate_uuid_v7();
    let message_id = macro_uuid::generate_uuid_v7();
    sqlx::query!(
        r#"
        INSERT INTO email_threads (id, link_id, inbox_visible, is_read, is_signal, created_at, updated_at)
        VALUES ($1, $2, false, true, false, NOW(), NOW())
        "#,
        thread_id,
        OWNER_LINK,
    )
    .execute(pool)
    .await?;
    sqlx::query!(
        r#"
        INSERT INTO email_messages (
            id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts,
            subject, body_text, has_attachments, is_read, is_starred, is_draft, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, false, $5, $6, $7, '', false, true, false, false, NOW(), NOW())
        "#,
        message_id,
        thread_id,
        OWNER_LINK,
        message_id.to_string(),
        STRANGER,
        at,
        subject,
    )
    .execute(pool)
    .await?;
    let mut labels = vec![INBOX_LABEL];
    labels.extend(filed_under_updates.then_some(UPDATES_LABEL));
    for label in labels {
        sqlx::query!(
            "INSERT INTO email_message_labels (message_id, label_id) VALUES ($1, $2)",
            message_id,
            label,
        )
        .execute(pool)
        .await?;
    }
    if let Some(invite) = invite {
        sqlx::query!(
            r#"
            INSERT INTO email_message_calendar_invites (message_id, component_id, snapshot)
            VALUES ($1, $2, $3)
            "#,
            message_id,
            invite.id,
            serde_json::to_value(&invite)?,
        )
        .execute(pool)
        .await?;
    }
    let mut conn = pool.acquire().await?;
    email_db_client::threads::update::recompute_thread_metadata(&mut conn, thread_id, OWNER_LINK)
        .await?;
    Ok(thread_id)
}

/// Whether the list holds `thread` at `now`, and how it reads then.
async fn read_at(
    repo: &FocusPgRepository,
    thread: Uuid,
    now: DateTime<Utc>,
) -> Result<(bool, ThreadFocus), Report> {
    let since = now - Duration::days(90);
    let waiting_before = now - Duration::days(3);
    let listed = repo
        .focus_thread_ids(&owner(), since, waiting_before, now, 100)
        .await?
        .contains(&thread);
    let focus = repo
        .focus_for_threads(&owner(), &[thread], waiting_before, now)
        .await?;
    Ok((listed, focus.get(&thread).expect("stored").clone()))
}

async fn is_stale(repo: &FocusPgRepository, thread: Uuid) -> Result<bool, Report> {
    let since = Utc::now() - Duration::days(30);
    let enabled = vec!["acme.example".to_owned()];
    let stale = repo.stale_threads(since, &enabled, None, 100).await?;
    Ok(stale.iter().any(|stale| stale.thread_id == thread))
}

/// A change for an event that isn't over: found, classified, listed as Calendar.
async fn assert_held(repo: &FocusPgRepository, thread: Uuid) -> Result<(), Report> {
    assert!(is_stale(repo, thread).await?);
    let verdict = worker(repo, Ok(LOW_ANSWERS.to_vec()))
        .classify_thread(thread)
        .await?;
    assert!(matches!(verdict, ClassifyOutcome::Classified(_)));
    let (listed, focus) = read_at(repo, thread, Utc::now()).await?;
    assert!(listed && focus.is_focus);
    assert_eq!(focus.category, FocusCategory::Calendar);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../fixtures",
        scripts("email_focus", "email_focus_waiting")
    )
)]
async fn an_upcoming_reschedule_is_in_until_the_event_is_over(
    pool: Pool<Postgres>,
) -> Result<(), Report> {
    let repo = FocusPgRepository(pool.clone());
    let now = Utc::now();
    let end = now + Duration::days(2);
    let thread = notice_thread(
        &pool,
        "Moved: Demo",
        Some(invite(InvitationMethod::Request, 2, end)),
        now - Duration::hours(1),
        true,
    )
    .await?;
    assert_held(&repo, thread).await?;

    let (listed, focus) = read_at(&repo, thread, end - Duration::minutes(1)).await?;
    assert!(listed && focus.is_focus);
    assert_eq!(focus.category, FocusCategory::Calendar);

    // Over: both reads agree it is out, and it no longer reads as Calendar.
    let (listed, focus) = read_at(&repo, thread, end).await?;
    assert!(!listed && !focus.is_focus);
    assert!(!focus.needs_reply && !focus.needs_follow_up);
    assert_ne!(focus.category, FocusCategory::Calendar);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../fixtures",
        scripts("email_focus", "email_focus_waiting")
    )
)]
async fn a_held_thread_that_needs_a_reply_loses_the_flag_with_the_hold(
    pool: Pool<Postgres>,
) -> Result<(), Report> {
    let repo = FocusPgRepository(pool.clone());
    let now = Utc::now();
    let end = now + Duration::days(2);
    let thread = notice_thread(
        &pool,
        "Moved: Demo",
        Some(invite(InvitationMethod::Request, 2, end)),
        now - Duration::hours(1),
        true,
    )
    .await?;
    // Reads as automated, yet Jev says it asks the owner something.
    let asks = worker(&repo, Ok(vec![0.05, 0.0, 0.9, 0.0, 0.0, 0.0, 0.9, 0.0]));
    assert!(matches!(
        asks.classify_thread(thread).await?,
        ClassifyOutcome::Classified(_)
    ));
    let (_, focus) = read_at(&repo, thread, now).await?;
    assert!(focus.is_focus && focus.needs_reply);

    let (_, focus) = read_at(&repo, thread, end).await?;
    assert!(!focus.is_focus && !focus.needs_reply);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../fixtures",
        scripts("email_focus", "email_focus_waiting")
    )
)]
async fn a_new_invite_stays_out(pool: Pool<Postgres>) -> Result<(), Report> {
    let repo = FocusPgRepository(pool.clone());
    let now = Utc::now();
    let at = now - Duration::hours(1);
    let upcoming = now + Duration::days(2);
    let refuses = worker(&repo, Err(FocusClassifierError::Rejected));
    let earns = worker(&repo, Ok(HIGH_ANSWERS.to_vec()));

    // Outside the signal inbox: never found, never read by the classifier.
    for thread in [
        notice_thread(
            &pool,
            "Demo",
            Some(invite(InvitationMethod::Request, 0, upcoming)),
            at,
            true,
        )
        .await?,
        notice_thread(&pool, "Invitation: Demo @ Thu", None, at, true).await?,
        notice_thread(&pool, "New event: Demo", None, at, true).await?,
    ] {
        assert!(!is_stale(&repo, thread).await?);
        assert_eq!(
            refuses.classify_thread(thread).await?,
            ClassifyOutcome::NotSignal
        );
    }

    // In the signal inbox: out however much Jev likes it. Calendar names why.
    let thread = notice_thread(
        &pool,
        "Invitation: Demo @ Thu",
        Some(invite(InvitationMethod::Request, 0, upcoming)),
        at,
        false,
    )
    .await?;
    let ClassifyOutcome::Classified(verdict) = earns.classify_thread(thread).await? else {
        panic!("expected a classification");
    };
    assert!(!verdict.is_focus && verdict.calendar_hold_until.is_none());
    let (listed, focus) = read_at(&repo, thread, now).await?;
    assert!(!listed && !focus.is_focus);
    assert_eq!(focus.category, FocusCategory::Calendar);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../fixtures",
        scripts("email_focus", "email_focus_waiting")
    )
)]
async fn an_update_to_an_event_already_over_stays_out(pool: Pool<Postgres>) -> Result<(), Report> {
    let repo = FocusPgRepository(pool.clone());
    let now = Utc::now();
    let at = now - Duration::hours(3);
    let over = now - Duration::hours(1);

    // Outside the signal inbox the sweep reads it, and the classifier never does.
    let outside = notice_thread(
        &pool,
        "Updated invitation: Demo",
        Some(invite(InvitationMethod::Request, 1, over)),
        at,
        true,
    )
    .await?;
    assert_eq!(
        worker(&repo, Err(FocusClassifierError::Rejected))
            .classify_thread(outside)
            .await?,
        ClassifyOutcome::NotSignal
    );

    // In the signal inbox with nothing else going for it: out.
    let signal = notice_thread(
        &pool,
        "Updated invitation: Demo",
        Some(invite(InvitationMethod::Request, 1, over)),
        at,
        false,
    )
    .await?;
    let low = worker(&repo, Ok(LOW_ANSWERS.to_vec()));
    assert!(matches!(
        low.classify_thread(signal).await?,
        ClassifyOutcome::Classified(_)
    ));
    let (listed, focus) = read_at(&repo, signal, now).await?;
    assert!(!listed && !focus.is_focus);
    assert_ne!(focus.category, FocusCategory::Calendar);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../fixtures",
        scripts("email_focus", "email_focus_waiting")
    )
)]
async fn a_thread_in_focus_for_more_than_the_hold_stays_after_the_event(
    pool: Pool<Postgres>,
) -> Result<(), Report> {
    let repo = FocusPgRepository(pool.clone());
    let now = Utc::now();
    let end = now + Duration::days(2);
    let high = worker(&repo, Ok(HIGH_ANSWERS.to_vec()));

    // Jev says it is worth reading: in for that reason once the event is over,
    // when it reads as its sender's category, since Calendar means a live change.
    let signal = notice_thread(
        &pool,
        "Rescheduled: Demo",
        Some(invite(InvitationMethod::Request, 1, end)),
        now - Duration::hours(1),
        false,
    )
    .await?;
    high.classify_thread(signal).await?;
    let (listed, focus) = read_at(&repo, signal, now).await?;
    assert!(listed && focus.is_focus);
    assert_eq!(focus.category, FocusCategory::Calendar);
    let (listed, focus) = read_at(&repo, signal, end).await?;
    assert!(listed && focus.is_focus);
    assert_eq!(focus.category, FocusCategory::Other);

    // The same answers outside the signal inbox earn nothing: only the hold had it in.
    let outside = notice_thread(
        &pool,
        "Rescheduled: Demo",
        Some(invite(InvitationMethod::Request, 1, end)),
        now - Duration::hours(1),
        true,
    )
    .await?;
    high.classify_thread(outside).await?;
    let (listed, focus) = read_at(&repo, outside, now).await?;
    assert!(listed && focus.is_focus);
    let (listed, focus) = read_at(&repo, outside, end).await?;
    assert!(!listed && !focus.is_focus);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../fixtures",
        scripts("email_focus", "email_focus_waiting")
    )
)]
async fn a_change_subject_on_a_first_revision_holds_by_the_events_own_time(
    pool: Pool<Postgres>,
) -> Result<(), Report> {
    let repo = FocusPgRepository(pool.clone());
    let now = Utc::now();
    let at = now - Duration::hours(1);

    // Further ahead than the fallback: still held when the fallback would have ended.
    let end = now + Duration::days(20);
    let ahead = notice_thread(
        &pool,
        "Updated invitation: Demo",
        Some(invite(InvitationMethod::Request, 0, end)),
        at,
        true,
    )
    .await?;
    assert_held(&repo, ahead).await?;
    let (listed, _) = read_at(&repo, ahead, now + Duration::days(10)).await?;
    assert!(listed);
    let (listed, _) = read_at(&repo, ahead, end).await?;
    assert!(!listed);

    // Already over: not held at all, and the classifier is never asked.
    let over = notice_thread(
        &pool,
        "Updated invitation: Demo",
        Some(invite(
            InvitationMethod::Request,
            0,
            now - Duration::minutes(5),
        )),
        at,
        true,
    )
    .await?;
    assert_eq!(
        worker(&repo, Err(FocusClassifierError::Rejected))
            .classify_thread(over)
            .await?,
        ClassifyOutcome::NotSignal
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../fixtures",
        scripts("email_focus", "email_focus_waiting")
    )
)]
async fn a_held_thread_marked_done_leaves_focus(pool: Pool<Postgres>) -> Result<(), Report> {
    let repo = FocusPgRepository(pool.clone());
    let now = Utc::now();
    let thread = notice_thread(
        &pool,
        "Rescheduled: Demo",
        Some(invite(
            InvitationMethod::Request,
            1,
            now + Duration::days(2),
        )),
        now - Duration::hours(1),
        true,
    )
    .await?;
    assert_held(&repo, thread).await?;
    sqlx::query!(
        "UPDATE email_threads SET inbox_visible = false WHERE id = $1",
        thread
    )
    .execute(&pool)
    .await?;
    let (listed, focus) = read_at(&repo, thread, now).await?;
    assert!(!listed && !focus.is_focus);
    assert_ne!(focus.category, FocusCategory::Calendar);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../fixtures",
        scripts("email_focus", "email_focus_waiting")
    )
)]
async fn the_sweep_ignores_a_change_only_in_the_owners_mail_or_a_draft(
    pool: Pool<Postgres>,
) -> Result<(), Report> {
    let repo = FocusPgRepository(pool.clone());
    let now = Utc::now();
    for (is_sent, is_draft) in [(false, true), (true, false)] {
        let thread = notice_thread(&pool, "Lunch?", None, now - Duration::hours(2), true).await?;
        let id = macro_uuid::generate_uuid_v7();
        sqlx::query!(
            r#"
            INSERT INTO email_messages (
                id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts,
                subject, body_text, has_attachments, is_read, is_starred, is_draft, created_at, updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, 'Rescheduled: Demo', '', false, true, false, $8, NOW(), NOW())
            "#,
            id,
            thread,
            OWNER_LINK,
            id.to_string(),
            is_sent,
            STRANGER,
            now - Duration::hours(1),
            is_draft,
        )
        .execute(&pool)
        .await?;
        assert!(!is_stale(&repo, thread).await?, "{is_sent} {is_draft}");
    }
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../fixtures",
        scripts("email_focus", "email_focus_waiting")
    )
)]
async fn a_cancellation_is_in(pool: Pool<Postgres>) -> Result<(), Report> {
    let repo = FocusPgRepository(pool.clone());
    let now = Utc::now();
    let end = now + Duration::days(2);
    let thread = notice_thread(
        &pool,
        "Demo",
        Some(invite(InvitationMethod::Cancel, 0, end)),
        now - Duration::hours(1),
        true,
    )
    .await?;
    assert_held(&repo, thread).await?;
    let (listed, _) = read_at(&repo, thread, end).await?;
    assert!(!listed);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../fixtures",
        scripts("email_focus", "email_focus_waiting")
    )
)]
async fn a_counter_proposal_is_in(pool: Pool<Postgres>) -> Result<(), Report> {
    let repo = FocusPgRepository(pool.clone());
    let now = Utc::now();
    let end = now + Duration::days(2);
    let thread = notice_thread(
        &pool,
        "Demo",
        Some(invite(InvitationMethod::Counter, 0, end)),
        now - Duration::hours(1),
        true,
    )
    .await?;
    assert_held(&repo, thread).await?;
    let (listed, _) = read_at(&repo, thread, end).await?;
    assert!(!listed);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../fixtures",
        scripts("email_focus", "email_focus_waiting")
    )
)]
async fn a_series_or_a_subject_alone_holds_for_a_week_after_the_notice(
    pool: Pool<Postgres>,
) -> Result<(), Report> {
    let repo = FocusPgRepository(pool.clone());
    let now = Utc::now();
    let at = now - Duration::hours(1);
    // The series began long ago, so its own dates say nothing about what's ahead.
    let mut series = invite(InvitationMethod::Request, 3, now - Duration::days(200));
    series.recurrence = Some(vec!["RRULE:FREQ=WEEKLY".to_owned()]);
    let mut wall_time = invite(InvitationMethod::Cancel, 0, now);
    wall_time.end = Some(InvitationDateTime::Unresolved {
        value: "2026-11-05T11:00:00".to_owned(),
        time_zone: None,
    });
    for thread in [
        notice_thread(&pool, "Standup", Some(series), at, true).await?,
        notice_thread(&pool, "Standup", Some(wall_time), at, true).await?,
        notice_thread(&pool, "Rescheduled: Demo", None, at, true).await?,
        notice_thread(&pool, "Canceled event: Demo", None, at, true).await?,
    ] {
        assert_held(&repo, thread).await?;
        let last = at + Duration::days(7);
        let (listed, _) = read_at(&repo, thread, last - Duration::minutes(1)).await?;
        assert!(listed);
        let (listed, focus) = read_at(&repo, thread, last).await?;
        assert!(!listed && !focus.is_focus);
    }
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../fixtures",
        scripts("email_focus", "email_focus_waiting")
    )
)]
async fn a_person_writing_after_a_notice_makes_it_a_conversation(
    pool: Pool<Postgres>,
) -> Result<(), Report> {
    let repo = FocusPgRepository(pool.clone());
    let now = Utc::now();
    let at = now - Duration::hours(2);
    let end = now + Duration::days(2);
    let low = worker(&repo, Ok(LOW_ANSWERS.to_vec()));
    let high = worker(&repo, Ok(HIGH_ANSWERS.to_vec()));

    // A change: the reply ends the hold right away, ahead of the worker.
    let outside = notice_thread(
        &pool,
        "Rescheduled: Demo",
        Some(invite(InvitationMethod::Request, 1, end)),
        at,
        true,
    )
    .await?;
    assert_held(&repo, outside).await?;
    insert_message_from(&pool, outside, STRANGER, false, now - Duration::hours(1)).await?;
    let (listed, focus) = read_at(&repo, outside, now).await?;
    assert!(!listed && !focus.is_focus);
    assert_ne!(focus.category, FocusCategory::Calendar);
    // Filed outside the signal inbox, the conversation is no key mail either.
    assert_eq!(
        low.classify_thread(outside).await?,
        ClassifyOutcome::NotSignal
    );

    // In the signal inbox it takes the normal rule, whichever way that goes.
    let signal = notice_thread(
        &pool,
        "Rescheduled: Demo",
        Some(invite(InvitationMethod::Request, 1, end)),
        at,
        false,
    )
    .await?;
    insert_message_from(&pool, signal, STRANGER, false, now - Duration::hours(1)).await?;
    let ClassifyOutcome::Classified(verdict) = low.classify_thread(signal).await? else {
        panic!("expected a classification");
    };
    assert!(!verdict.is_focus && verdict.calendar_hold_until.is_none());
    let (listed, _) = read_at(&repo, signal, now).await?;
    assert!(!listed);

    // A hold already stored is gone with the reclassification, not just hidden.
    let held = notice_thread(
        &pool,
        "Rescheduled: Demo",
        Some(invite(InvitationMethod::Request, 1, end)),
        at,
        false,
    )
    .await?;
    assert_held(&repo, held).await?;
    insert_message_from(&pool, held, STRANGER, false, now - Duration::hours(1)).await?;
    assert!(matches!(
        low.classify_thread(held).await?,
        ClassifyOutcome::Classified(_)
    ));
    let (listed, focus) = read_at(&repo, held, now).await?;
    assert!(!listed && !focus.is_focus);

    // New invites and RSVPs are no veto once someone has written after them.
    for (subject, invite) in [
        (
            "Invitation: Demo",
            Some(invite(InvitationMethod::Request, 0, end)),
        ),
        (
            "Accepted: Demo",
            Some(invite(InvitationMethod::Reply, 0, end)),
        ),
    ] {
        let thread = notice_thread(&pool, subject, invite, at, false).await?;
        insert_message_from(&pool, thread, STRANGER, false, now - Duration::hours(1)).await?;
        let ClassifyOutcome::Classified(verdict) = high.classify_thread(thread).await? else {
            panic!("expected a classification");
        };
        assert!(verdict.is_focus, "{subject}");
        let (listed, focus) = read_at(&repo, thread, now).await?;
        assert!(listed, "{subject}");
        assert_eq!(focus.category, FocusCategory::Other, "{subject}");
    }
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../fixtures",
        scripts("email_focus", "email_focus_waiting")
    )
)]
async fn the_owner_answering_a_notice_ends_the_hold(pool: Pool<Postgres>) -> Result<(), Report> {
    let repo = FocusPgRepository(pool.clone());
    let now = Utc::now();
    let end = now + Duration::days(20);
    let thread = notice_thread(
        &pool,
        "Rescheduled: Demo",
        Some(invite(InvitationMethod::Request, 1, end)),
        now - Duration::days(6),
        true,
    )
    .await?;
    assert_held(&repo, thread).await?;

    // Ahead of the worker, and whatever it later makes of the answer.
    insert_message(&pool, thread, true, now - Duration::days(5)).await?;
    let (listed, focus) = read_at(&repo, thread, now).await?;
    assert!(!listed && !focus.is_focus);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../fixtures",
        scripts("email_focus", "email_focus_waiting")
    )
)]
async fn mail_from_a_recent_contact_is_found_and_pinned_outside_the_signal_inbox(
    pool: Pool<Postgres>,
) -> Result<(), Report> {
    project_threads(&pool).await?;
    let repo = FocusPgRepository(pool);
    let now = Utc::now();
    let since = now - Duration::days(30);

    // No event covers mail from before an inbox was enabled: the sweep finds it.
    let thread = load_thread(&repo, RECENT_CONTACT).await?.expect("thread");
    assert!(!thread.is_signal);
    let stale = repo
        .stale_threads(since, &["acme.example".to_owned()], None, 100)
        .await?;
    assert!(stale.iter().any(|stale| stale.thread_id == RECENT_CONTACT));

    let worker = worker(&repo, Ok(vec![0.05, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]));
    let ClassifyOutcome::Classified(verdict) = worker.classify_thread(RECENT_CONTACT).await? else {
        panic!("expected the recent contact's mail to be classified");
    };
    assert!(verdict.is_focus && verdict.pinned);
    assert!(
        repo.focus_thread_ids(&owner(), since, now, now, 100)
            .await?
            .contains(&RECENT_CONTACT)
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("email_focus"))
)]
async fn a_thread_that_lost_signal_leaves_focus_unless_pinned(
    pool: Pool<Postgres>,
) -> Result<(), Report> {
    let repo = FocusPgRepository(pool.clone());
    let now = Utc::now();
    let since = now - Duration::days(30);
    repo.save(&record(INVOICE, LATEST_MESSAGE, now, 60)).await?;
    sqlx::query!(
        "UPDATE email_threads SET is_signal = false WHERE id = $1",
        INVOICE
    )
    .execute(&pool)
    .await?;
    assert!(
        !repo
            .focus_thread_ids(&owner(), since, now, now, 10)
            .await?
            .contains(&INVOICE)
    );

    // The labels read the same as the list, so nothing reads as owed.
    let focus = repo
        .focus_for_threads(&owner(), &[INVOICE], now, now)
        .await?;
    let out = focus.get(&INVOICE).expect("stored");
    assert!(!out.is_focus && !out.needs_reply && !out.needs_follow_up);

    let mut pinned = record(INVOICE, LATEST_MESSAGE, now, 60);
    pinned.verdict.pinned = true;
    repo.save(&pinned).await?;
    assert!(
        repo.focus_thread_ids(&owner(), since, now, now, 10)
            .await?
            .contains(&INVOICE)
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../fixtures",
        scripts("email_focus", "email_focus_waiting")
    )
)]
async fn a_follow_up_that_lost_signal_reads_as_out(pool: Pool<Postgres>) -> Result<(), Report> {
    project_threads(&pool).await?;
    let repo = FocusPgRepository(pool.clone());
    let now = Utc::now();
    let thread = load_thread(&repo, REPLIED_YESTERDAY)
        .await?
        .expect("thread");
    let latest = thread.messages.last().expect("message");
    let mut flagged = record(REPLIED_YESTERDAY, latest.id, latest.at, 60);
    flagged.verdict.needs_reply = false;
    flagged.verdict.needs_follow_up = true;
    repo.save(&flagged).await?;
    sqlx::query!(
        "UPDATE email_threads SET is_signal = false WHERE id = $1",
        REPLIED_YESTERDAY
    )
    .execute(&pool)
    .await?;
    let focus = repo
        .focus_for_threads(&owner(), &[REPLIED_YESTERDAY], now - Duration::days(3), now)
        .await?;
    let out = focus.get(&REPLIED_YESTERDAY).expect("stored");
    assert!(!out.is_focus && !out.needs_follow_up);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("email_focus"))
)]
async fn rows_from_an_older_rule_read_right_and_are_decided_again_without_the_classifier(
    pool: Pool<Postgres>,
) -> Result<(), Report> {
    let repo = FocusPgRepository(pool.clone());
    let now = Utc::now();
    let since = now - Duration::days(30);
    let enabled = vec!["acme.example".to_owned()];

    // As the previous rule stored it: a follow-up on Casey's message, on answers
    // that Jev also said need a reply.
    let thread = load_thread(&repo, INVOICE).await?.expect("thread");
    let latest = thread.messages.last().expect("message");
    let scores = serde_json::to_value(FocusAnswers::from_probabilities(&[
        0.1, 0.0, 0.0, 0.0, 0.0, 0.0, 0.9, 0.9,
    ]))?;
    sqlx::query!(
        r#"
        INSERT INTO email_thread_focus (
            thread_id, link_id, classified_message_id, classified_message_ts, is_focus,
            category, importance, needs_reply, needs_follow_up, scores, model, classified_at
        )
        VALUES ($1, $2, $3, $4, true, 'known', 6, false, true, $5, 'jev-earlier', $6)
        "#,
        INVOICE,
        OWNER_LINK,
        latest.id,
        latest.at,
        scores,
        now,
    )
    .execute(&pool)
    .await?;

    // Right away, with no worker: someone else wrote last, so it reads as a reply.
    let focus = repo
        .focus_for_threads(&owner(), &[INVOICE], now, now)
        .await?;
    let stored = focus.get(&INVOICE).expect("stored");
    assert!(stored.needs_reply && !stored.needs_follow_up);

    // The sweep finds it even though its latest message was classified.
    let stale = repo.stale_threads(since, &enabled, None, 10).await?;
    assert!(stale.iter().any(|stale| stale.thread_id == INVOICE));

    // Failing the classifier proves it was never asked.
    let worker = worker(&repo, Err(FocusClassifierError::Rejected));
    let ClassifyOutcome::Redecided(verdict) = worker.classify_thread(INVOICE).await? else {
        panic!("expected the row to be decided again");
    };
    assert!(verdict.is_focus && verdict.needs_reply && !verdict.needs_follow_up);
    assert_eq!(verdict.importance, 70);

    assert!(
        repo.focus_thread_ids(&owner(), since, now, now, 10)
            .await?
            .contains(&INVOICE)
    );
    let classified = load_thread(&repo, INVOICE).await?.unwrap().classified;
    let classified = classified.expect("stored");
    assert_eq!(classified.rule_version, FOCUS_RULE_VERSION);
    assert_eq!(classified.model, "jev-earlier");
    let stale = repo.stale_threads(since, &enabled, None, 10).await?;
    assert!(!stale.iter().any(|stale| stale.thread_id == INVOICE));
    assert_eq!(
        worker.classify_thread(INVOICE).await?,
        ClassifyOutcome::UpToDate
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../fixtures",
        scripts("email_focus", "email_focus_waiting")
    )
)]
async fn a_row_from_an_older_rule_is_swept_even_outside_the_signal_inbox(
    pool: Pool<Postgres>,
) -> Result<(), Report> {
    project_threads(&pool).await?;
    let repo = FocusPgRepository(pool.clone());
    let enabled = vec!["acme.example".to_owned()];
    let since = Utc::now() - Duration::days(30);
    let thread = load_thread(&repo, NOISE).await?.expect("thread");
    assert!(!thread.is_signal);
    let latest = thread.messages.last().expect("message");
    repo.save(&record(NOISE, latest.id, latest.at, 40)).await?;

    // Under the current rule there is nothing to do for it.
    let stale = repo.stale_threads(since, &enabled, None, 100).await?;
    assert!(!stale.iter().any(|stale| stale.thread_id == NOISE));

    sqlx::query!(
        "UPDATE email_thread_focus SET rule_version = 0 WHERE thread_id = $1",
        NOISE
    )
    .execute(&pool)
    .await?;
    let stale = repo.stale_threads(since, &enabled, None, 100).await?;
    assert!(stale.iter().any(|stale| stale.thread_id == NOISE));
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../fixtures",
        scripts("email_focus", "email_focus_waiting")
    )
)]
async fn editing_a_draft_never_changes_who_wrote_last(pool: Pool<Postgres>) -> Result<(), Report> {
    project_threads(&pool).await?;
    let repo = FocusPgRepository(pool.clone());
    let now = Utc::now();
    // Jev flagged an open loop on the owner's own message, inside the wait.
    let thread = load_thread(&repo, REPLIED_YESTERDAY)
        .await?
        .expect("thread");
    let latest = thread.messages.last().expect("message");
    let mut flagged = record(REPLIED_YESTERDAY, latest.id, latest.at, 60);
    flagged.verdict.needs_reply = false;
    flagged.verdict.needs_follow_up = true;
    repo.save(&flagged).await?;

    // Editing a draft moves the thread's inbound time, as recompute_thread_metadata does.
    sqlx::query!(
        "UPDATE email_threads SET latest_inbound_message_ts = $1 WHERE id = $2",
        now,
        REPLIED_YESTERDAY,
    )
    .execute(&pool)
    .await?;
    let waiting_before = now - Duration::days(3);
    let focus = repo
        .focus_for_threads(&owner(), &[REPLIED_YESTERDAY], waiting_before, now)
        .await?;
    let drafting = focus.get(&REPLIED_YESTERDAY).expect("stored");
    assert!(drafting.needs_follow_up && !drafting.needs_reply);

    // Mail from someone else does change it.
    insert_message(&pool, REPLIED_YESTERDAY, false, now).await?;
    let focus = repo
        .focus_for_threads(&owner(), &[REPLIED_YESTERDAY], waiting_before, now)
        .await?;
    let answered = focus.get(&REPLIED_YESTERDAY).expect("stored");
    assert!(answered.needs_reply && !answered.needs_follow_up);
    Ok(())
}
