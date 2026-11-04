use chrono::Duration;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use serde_json::Value;
use sqlx::{Pool, Postgres};

use super::*;
use crate::domain::focus::{
    ClassifyOutcome, FocusAnswers, FocusClassifier, FocusClassifierError, FocusQueries,
    FocusQuestion, FocusService, FocusThread, FocusVerdict, ProfileSource,
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
/// Answers that earn nothing: only key mail and the wait bring a thread in.
const LOW_ANSWERS: [f32; 8] = [0.05, 0.0, 0.9, 0.0, 0.0, 0.0, 0.0, 0.0];

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

fn worker(
    repo: &FocusPgRepository,
    answers: Result<Vec<f32>, FocusClassifierError>,
) -> FocusService<FocusPgRepository, NoProfile, FixedClassifier> {
    FocusService::new(
        repo.clone(),
        NoProfile,
        FixedClassifier { answers },
        vec!["acme.example".to_owned()],
    )
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
            .stale_threads(since, &enabled, limit)
            .await?
            .into_iter()
            .map(|stale| stale.thread_id)
            .collect())
    };

    assert_eq!(stale(10).await?, vec![INVOICE, BULK]);
    assert_eq!(stale(1).await?, vec![INVOICE]);
    assert!(repo.stale_threads(since, &[], 10).await?.is_empty());

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
        .focus_for_threads(&owner(), &[INVOICE], Utc::now())
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
        .focus_for_threads(&owner(), &[INVOICE], Utc::now())
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
        repo.focus_thread_ids(&owner(), since, now, 10).await?,
        vec![INVOICE, BULK]
    );
    assert_eq!(
        repo.focus_thread_ids(&owner(), since, now, 1).await?,
        vec![INVOICE]
    );
    assert_eq!(
        repo.focus_thread_ids(&owner(), now - Duration::days(1), now, 10)
            .await?,
        vec![INVOICE]
    );

    // A newer message in either direction moves a thread up: the owner's reply
    // yesterday brings BULK ahead of nothing inbound in days.
    sqlx::query!(
        "UPDATE email_threads SET latest_outbound_message_ts = $1 WHERE id = $2",
        now - Duration::hours(1),
        BULK,
    )
    .execute(&pool)
    .await?;
    assert_eq!(
        repo.focus_thread_ids(&owner(), since, now, 10).await?,
        vec![BULK, INVOICE]
    );
    assert_eq!(
        repo.focus_thread_ids(&owner(), since, now, 1).await?,
        vec![BULK]
    );

    // The other inbox's owner sees only their own thread.
    let stranger = MacroUserIdStr::try_from_email("other@elsewhere.example").unwrap();
    assert_eq!(
        repo.focus_thread_ids(&stranger, since, now, 10).await?,
        vec![OTHER_THREAD]
    );
    assert!(
        repo.focus_for_threads(&stranger, &[INVOICE, BULK], now)
            .await?
            .is_empty()
    );
    assert_eq!(
        repo.focus_for_threads(&owner(), &[INVOICE, BULK, ARCHIVED], now)
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
        repo.focus_thread_ids(&owner(), now - Duration::days(30), now, 10)
            .await?,
        vec![OTHER_THREAD]
    );
    assert!(
        repo.focus_for_threads(&owner(), &[OTHER_THREAD], now)
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

    // An answer ends the wait at once, ahead of the worker. Until the worker
    // reads it the thread keeps no label it no longer has.
    sqlx::query!(
        "UPDATE email_threads SET latest_inbound_message_ts = $1 WHERE id = $2",
        Utc::now(),
        REPLIED_LAST,
    )
    .execute(&pool)
    .await?;
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
        .stale_threads(since, &["acme.example".to_owned()], 100)
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
            .focus_thread_ids(&owner(), since, now, 100)
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
            .focus_thread_ids(&owner(), since, now, 100)
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
            .focus_thread_ids(&owner(), since, now, 100)
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
async fn calendar_mail_reaches_focus_from_outside_the_signal_inbox(
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
    assert_eq!(
        reschedule.messages[0].calendar_part,
        Some(CalendarPart::Scheduling)
    );
    let rsvp = load_thread(&repo, RSVP).await?.expect("thread");
    assert_eq!(rsvp.messages[0].calendar_part, Some(CalendarPart::Rsvp));
    let file = load_thread(&repo, CALENDAR_FILE).await?.expect("thread");
    assert_eq!(file.messages[0].calendar_part, Some(CalendarPart::Unparsed));

    // The sweep finds them; plain mail outside the signal inbox it leaves alone.
    let stale = repo
        .stale_threads(since, &["acme.example".to_owned()], 100)
        .await?
        .into_iter()
        .map(|stale| stale.thread_id)
        .collect::<Vec<_>>();
    assert!(stale.contains(&RESCHEDULE) && stale.contains(&RSVP) && stale.contains(&CALENDAR_FILE));
    assert!(!stale.contains(&NOISE));
    assert_eq!(
        worker.classify_thread(NOISE).await?,
        ClassifyOutcome::NotSignal
    );

    let ClassifyOutcome::Classified(verdict) = worker.classify_thread(RESCHEDULE).await? else {
        panic!("expected the reschedule to be classified");
    };
    assert!(verdict.is_focus && verdict.pinned);
    assert_eq!(verdict.category, FocusCategory::Calendar);
    assert!(matches!(
        worker.classify_thread(CALENDAR_FILE).await?,
        ClassifyOutcome::Classified(_)
    ));
    // An RSVP is not key mail: it never reaches the classifier.
    assert_eq!(
        worker.classify_thread(RSVP).await?,
        ClassifyOutcome::NotSignal
    );

    let listed = repo.focus_thread_ids(&owner(), since, now, 100).await?;
    assert!(listed.contains(&RESCHEDULE) && listed.contains(&CALENDAR_FILE));
    assert!(!listed.contains(&RSVP) && !listed.contains(&NOISE));
    let focus = repo.focus_for_threads(&owner(), &[RESCHEDULE], now).await?;
    assert_eq!(
        focus.get(&RESCHEDULE).expect("stored").category,
        FocusCategory::Calendar
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
            .focus_thread_ids(&owner(), since, now, 10)
            .await?
            .contains(&INVOICE)
    );

    let mut pinned = record(INVOICE, LATEST_MESSAGE, now, 60);
    pinned.verdict.pinned = true;
    repo.save(&pinned).await?;
    assert!(
        repo.focus_thread_ids(&owner(), since, now, 10)
            .await?
            .contains(&INVOICE)
    );
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

    // As the previous rule stored it: a follow-up on Casey's message, left out
    // of Focus on a low score that Jev also said needs a reply.
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
        VALUES ($1, $2, $3, $4, false, 'low_relevance', 6, false, true, $5, 'jev-earlier', $6)
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
    let focus = repo.focus_for_threads(&owner(), &[INVOICE], now).await?;
    let stored = focus.get(&INVOICE).expect("stored");
    assert!(stored.needs_reply && !stored.needs_follow_up);

    // The sweep finds it even though its latest message was classified.
    let stale = repo.stale_threads(since, &enabled, 10).await?;
    assert!(stale.iter().any(|stale| stale.thread_id == INVOICE));

    // Failing the classifier proves it was never asked.
    let worker = worker(&repo, Err(FocusClassifierError::Rejected));
    let ClassifyOutcome::Redecided(verdict) = worker.classify_thread(INVOICE).await? else {
        panic!("expected the row to be decided again");
    };
    assert!(verdict.is_focus && verdict.needs_reply && !verdict.needs_follow_up);
    assert_eq!(verdict.importance, 70);

    assert!(
        repo.focus_thread_ids(&owner(), since, now, 10)
            .await?
            .contains(&INVOICE)
    );
    let classified = load_thread(&repo, INVOICE).await?.unwrap().classified;
    let classified = classified.expect("stored");
    assert_eq!(classified.rule_version, FOCUS_RULE_VERSION);
    assert_eq!(classified.model, "jev-earlier");
    let stale = repo.stale_threads(since, &enabled, 10).await?;
    assert!(!stale.iter().any(|stale| stale.thread_id == INVOICE));
    assert_eq!(
        worker.classify_thread(INVOICE).await?,
        ClassifyOutcome::UpToDate
    );
    Ok(())
}
