//! The invariants that decide whether an email may go out, against Postgres
//! and the real email step store.

use super::*;
use crate::domain::{
    models::{CrmPerson, EnrollSkip, EnrollmentAction, SequenceError},
    ports::{NewSequence, OwnerAccess, SequencesApi as _},
    render::{InvalidSequence, Problem},
    service::{EnrollRequest, MAX_ENROLL, SequencePatch, Sequences},
};
use email::outbound::PgSequenceSteps;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};

const TEAM: Uuid = uuid::uuid!("7e000000-0000-0000-0000-000000000001");
const OWNER: &str = "macro|owner@example.com";
const MATE: &str = "macro|mate@example.com";
const OWNER_LINK: Uuid = uuid::uuid!("11111111-0000-0000-0000-000000000001");
const MATE_LINK: Uuid = uuid::uuid!("11111111-0000-0000-0000-000000000002");
const ADA: Uuid = uuid::uuid!("cc000000-0000-0000-0000-000000000001");
const BOB: Uuid = uuid::uuid!("cc000000-0000-0000-0000-000000000002");
/// Ada's address in other letters, on a person with no name.
const ADA_AGAIN: Uuid = uuid::uuid!("cc000000-0000-0000-0000-000000000003");
/// A person in another team.
const STRANGER: Uuid = uuid::uuid!("cc000000-0000-0000-0000-000000000009");

/// Team membership and CRM state the test can flip.
#[derive(Clone)]
struct Access {
    member: Arc<AtomicBool>,
    crm_on: Arc<AtomicBool>,
}

impl OwnerAccess for Access {
    type Err = std::convert::Infallible;

    async fn team_of(&self, _: &str) -> Result<Option<Uuid>, Self::Err> {
        Ok(self.member.load(Ordering::SeqCst).then_some(TEAM))
    }

    async fn crm_enabled(&self, _: Uuid) -> Result<bool, Self::Err> {
        Ok(self.crm_on.load(Ordering::SeqCst))
    }

    async fn people(&self, _: &str, ids: &[Uuid]) -> Result<Vec<CrmPerson>, Self::Err> {
        Ok([
            (ADA, "Ada@Example.com", Some("Ada Lovelace"), TEAM),
            (BOB, "bob@example.com", Some("Bob"), TEAM),
            (ADA_AGAIN, " ADA@EXAMPLE.COM", None, TEAM),
            (STRANGER, "eve@example.com", Some("Eve"), Uuid::nil()),
        ]
        .into_iter()
        .filter(|(id, ..)| ids.contains(id))
        .map(|(id, email, name, team_id)| CrmPerson {
            id,
            team_id,
            email: email.to_owned(),
            name: name.map(str::to_owned),
        })
        .collect())
    }
}

type Svc = Sequences<PgSequenceRepo, PgSequenceSteps, Access>;

fn service(pool: &PgPool) -> (Svc, Access) {
    let access = Access {
        member: Arc::new(AtomicBool::new(true)),
        crm_on: Arc::new(AtomicBool::new(true)),
    };
    let service = Sequences::new(
        PgSequenceRepo::new(pool.clone()),
        PgSequenceSteps,
        access.clone(),
        "https://email.test",
    );
    (service, access)
}

fn step(subject: &str, body: &str, as_reply: bool) -> Step {
    Step {
        delay_days: 0,
        subject: subject.to_owned(),
        body: body.to_owned(),
        as_reply,
    }
}

fn two_steps() -> Vec<Step> {
    vec![
        step("Hello {{firstName}}", "First", false),
        step("", "Following up", true),
    ]
}

async fn active_sequence(svc: &Svc, user: &str, link: Uuid, steps: Vec<Step>) -> Uuid {
    let created = svc
        .create(
            user,
            NewSequence {
                name: "Intro".to_owned(),
                link_id: Some(link),
                footer: "Sent by Macro".to_owned(),
                steps,
            },
        )
        .await
        .unwrap();
    svc.update(
        user,
        created.id,
        SequencePatch {
            version: created.version,
            status: Some(SequenceStatus::Active),
            ..SequencePatch::default()
        },
    )
    .await
    .unwrap();
    created.id
}

async fn enroll(svc: &Svc, user: &str, sequence: Uuid, contact: Uuid) -> Uuid {
    svc.enroll(
        user,
        sequence,
        EnrollRequest {
            crm_contact_ids: vec![contact],
            start: Utc::now(),
            timezone: "America/New_York".to_owned(),
        },
    )
    .await
    .unwrap()[0]
        .enrollment_id
        .unwrap()
}

async fn make_due(pool: &PgPool, enrollment: Uuid) {
    sqlx::query!(
        "UPDATE email_sequence_enrollments SET due_at = now() - interval '1 second' WHERE id = $1",
        enrollment
    )
    .execute(pool)
    .await
    .unwrap();
}

async fn status(pool: &PgPool, enrollment: Uuid) -> (String, Option<String>, i16) {
    let row = sqlx::query!(
        "SELECT status, reason, next_step FROM email_sequence_enrollments WHERE id = $1",
        enrollment
    )
    .fetch_one(pool)
    .await
    .unwrap();
    (row.status, row.reason, row.next_step)
}

async fn in_flight(pool: &PgPool, enrollment: Uuid) -> Option<Uuid> {
    sqlx::query_scalar!(
        "SELECT message_id FROM email_sequence_steps WHERE enrollment_id = $1 AND status = 'scheduled'",
        enrollment
    )
    .fetch_optional(pool)
    .await
    .unwrap()
}

async fn pending_schedules(pool: &PgPool) -> i64 {
    sqlx::query_scalar!(
        r#"SELECT count(*) AS "count!" FROM email_scheduled_messages WHERE source IS NOT NULL AND NOT sent"#
    )
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn message_exists(pool: &PgPool, message: Uuid) -> bool {
    sqlx::query_scalar!(
        r#"SELECT EXISTS (SELECT 1 FROM email_messages WHERE id = $1) AS "exists!""#,
        message
    )
    .fetch_one(pool)
    .await
    .unwrap()
}

/// Leave a step as scheduled delivery's `complete()` does.
async fn deliver(pool: &PgPool, message: Uuid) {
    sqlx::query!(
        r#"UPDATE email_scheduled_messages
           SET sent = true, processing = false, delivery_started_at = COALESCE(delivery_started_at, now()),
               delivery_message_id = $2
           WHERE message_id = $1"#,
        message,
        format!("{message}@send.test"),
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"UPDATE email_messages SET is_sent = true, is_draft = false, provider_id = $2,
               provider_thread_id = $3, internal_date_ts = now()
           WHERE id = $1"#,
        message,
        format!("gmail-{message}"),
        format!("thread-{message}"),
    )
    .execute(pool)
    .await
    .unwrap();
}

/// Store an incoming message the way inbox sync does, a second from now.
async fn incoming(
    pool: &PgPool,
    link: Uuid,
    from: &str,
    headers: serde_json::Value,
    replying_to: Option<Uuid>,
) -> Uuid {
    let thread = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO email_threads (id, link_id) VALUES ($1, $2)",
        thread,
        link
    )
    .execute(pool)
    .await
    .unwrap();
    let contact = sqlx::query_scalar!(
        r#"INSERT INTO email_contacts (id, link_id, email_address) VALUES ($1, $2, $3)
           ON CONFLICT (link_id, email_address) DO UPDATE SET email_address = EXCLUDED.email_address
           RETURNING id"#,
        Uuid::now_v7(),
        link,
        from,
    )
    .fetch_one(pool)
    .await
    .unwrap();
    let message = Uuid::now_v7();
    sqlx::query!(
        r#"INSERT INTO email_messages (id, thread_id, link_id, from_contact_id, headers_jsonb, replying_to_id, internal_date_ts)
           VALUES ($1, $2, $3, $4, $5, $6, now() + interval '1 second')"#,
        message,
        thread,
        link,
        contact,
        headers,
        replying_to,
    )
    .execute(pool)
    .await
    .unwrap();
    message
}

/// Create step 0 and record it sent.
async fn first_step_sent(svc: &Svc, pool: &PgPool, enrollment: Uuid) -> Uuid {
    make_due(pool, enrollment).await;
    svc.sweep(Utc::now()).await;
    let message = in_flight(pool, enrollment).await.unwrap();
    deliver(pool, message).await;
    svc.sweep(Utc::now()).await;
    assert_eq!(status(pool, enrollment).await.2, 1, "step 0 recorded sent");
    message
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("sequences"))
)]
async fn i1_one_unsent_step_even_when_two_sweeps_race(pool: PgPool) {
    let (svc, _) = service(&pool);
    let sequence = active_sequence(&svc, OWNER, OWNER_LINK, two_steps()).await;
    let enrollment = enroll(&svc, OWNER, sequence, ADA).await;
    make_due(&pool, enrollment).await;

    let now = Utc::now();
    tokio::join!(svc.sweep(now), svc.sweep(now));
    svc.sweep(Utc::now()).await;

    assert_eq!(pending_schedules(&pool).await, 1);
    let message = in_flight(&pool, enrollment).await.unwrap();
    let schedule = sqlx::query!(
        "SELECT source, list_unsubscribe_url, send_time > now() AS \"future!\" FROM email_scheduled_messages WHERE message_id = $1",
        message
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(schedule.source.as_deref(), Some("sequence"));
    assert!(
        schedule
            .list_unsubscribe_url
            .is_some_and(|url| url.starts_with("https://email.test/public/sequences/unsubscribe/"))
    );
    assert!(schedule.future);
    // The database refuses a second unsent step outright.
    let second = sqlx::query!(
        "INSERT INTO email_sequence_steps (enrollment_id, step, message_id, status, scheduled_at) VALUES ($1, 1, $2, 'scheduled', now())",
        enrollment,
        Uuid::now_v7(),
    )
    .execute(&pool)
    .await;
    assert!(second.is_err());
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("sequences"))
)]
async fn i2_every_check_stops_or_flags_instead_of_sending(pool: PgPool) {
    let (svc, access) = service(&pool);
    let mut enrollments = Vec::new();
    for _ in 0..5 {
        let sequence = active_sequence(&svc, OWNER, OWNER_LINK, two_steps()).await;
        enrollments.push(enroll(&svc, OWNER, sequence, ADA).await);
    }
    let check = |enrollment| {
        let svc = &svc;
        let pool = &pool;
        async move {
            make_due(pool, enrollment).await;
            svc.sweep(Utc::now()).await;
            assert_eq!(in_flight(pool, enrollment).await, None, "no step created");
            status(pool, enrollment).await
        }
    };

    access.crm_on.store(false, Ordering::SeqCst);
    assert_eq!(
        check(enrollments[0]).await,
        ("stopped".into(), Some("access_lost".into()), 0)
    );
    access.crm_on.store(true, Ordering::SeqCst);
    // Access back: resuming picks up where it stopped.
    svc.act(OWNER, enrollments[0], EnrollmentAction::Resume)
        .await
        .unwrap();
    assert_eq!(
        status(&pool, enrollments[0]).await,
        ("active".into(), None, 0)
    );

    access.member.store(false, Ordering::SeqCst);
    assert_eq!(
        check(enrollments[1]).await,
        ("stopped".into(), Some("access_lost".into()), 0)
    );
    access.member.store(true, Ordering::SeqCst);

    sqlx::query!(
        "UPDATE email_links SET needs_reauth = true WHERE id = $1",
        OWNER_LINK
    )
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(
        check(enrollments[2]).await,
        (
            "needs_attention".into(),
            Some("inbox_unavailable".into()),
            0
        )
    );
    sqlx::query!(
        "UPDATE email_links SET needs_reauth = false WHERE id = $1",
        OWNER_LINK
    )
    .execute(&pool)
    .await
    .unwrap();

    // Someone else's inbox (a delegated one) is never a sender.
    sqlx::query!(
        "UPDATE email_sequence_enrollments SET link_id = $2 WHERE id = $1",
        enrollments[3],
        MATE_LINK
    )
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(
        check(enrollments[3]).await,
        (
            "needs_attention".into(),
            Some("inbox_unavailable".into()),
            0
        )
    );

    // A reply the hook never saw is found before the next step.
    let reply_enrollment = enrollments[4];
    first_step_sent(&svc, &pool, reply_enrollment).await;
    incoming(
        &pool,
        OWNER_LINK,
        "ada@example.com",
        serde_json::json!([]),
        None,
    )
    .await;
    assert_eq!(
        check(reply_enrollment).await,
        ("stopped".into(), Some("replied".into()), 1)
    );

    // An unsubscribed address gets nothing more from any sequence.
    let sequence = active_sequence(&svc, OWNER, OWNER_LINK, two_steps()).await;
    let unsubscribed = enroll(&svc, OWNER, sequence, ADA).await;
    sqlx::query!(
        "UPDATE email_sequence_recipients SET unsubscribed_at = now(), source = 'manual' WHERE team_id = $1",
        TEAM
    )
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(
        check(unsubscribed).await,
        ("stopped".into(), Some("unsubscribed".into()), 0)
    );
    assert_eq!(pending_schedules(&pool).await, 0);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("sequences"))
)]
async fn i3_sends_advance_once_and_a_withdrawn_step_is_created_again(pool: PgPool) {
    let (svc, _) = service(&pool);
    let sequence = active_sequence(
        &svc,
        OWNER,
        OWNER_LINK,
        vec![
            step("Hello", "First", false),
            step("", "Second", true),
            step("Last", "Third", false),
        ],
    )
    .await;
    let enrollment = enroll(&svc, OWNER, sequence, ADA).await;
    let first = first_step_sent(&svc, &pool, enrollment).await;
    svc.sweep(Utc::now()).await;
    assert_eq!(status(&pool, enrollment).await, ("active".into(), None, 1));

    // The reply step threads under the sent step.
    make_due(&pool, enrollment).await;
    svc.sweep(Utc::now()).await;
    let reply = in_flight(&pool, enrollment).await.unwrap();
    let row = sqlx::query!(
        "SELECT subject, replying_to_id FROM email_messages WHERE id = $1",
        reply
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(row.replying_to_id, Some(first));
    assert_eq!(row.subject.as_deref(), Some("Re: Hello"));

    // Pause withdraws it entirely; resume creates step 1 again.
    svc.act(OWNER, enrollment, EnrollmentAction::Pause)
        .await
        .unwrap();
    assert_eq!(in_flight(&pool, enrollment).await, None);
    assert!(!message_exists(&pool, reply).await);
    assert_eq!(pending_schedules(&pool).await, 0);
    svc.act(OWNER, enrollment, EnrollmentAction::Resume)
        .await
        .unwrap();
    make_due(&pool, enrollment).await;
    svc.sweep(Utc::now()).await;
    let again = in_flight(&pool, enrollment).await.unwrap();
    assert_ne!(again, reply);
    assert_eq!(status(&pool, enrollment).await, ("active".into(), None, 1));

    deliver(&pool, again).await;
    svc.sweep(Utc::now()).await;
    svc.sweep(Utc::now()).await;
    assert_eq!(status(&pool, enrollment).await.2, 2);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("sequences"))
)]
async fn i4_stop_withdraws_a_new_step_and_records_one_already_sending(pool: PgPool) {
    let (svc, _) = service(&pool);
    let sequence = active_sequence(&svc, OWNER, OWNER_LINK, two_steps()).await;

    // Stop right after the step is created.
    let ada = enroll(&svc, OWNER, sequence, ADA).await;
    make_due(&pool, ada).await;
    svc.sweep(Utc::now()).await;
    let created = in_flight(&pool, ada).await.unwrap();
    svc.act(OWNER, ada, EnrollmentAction::Stop).await.unwrap();
    assert_eq!(
        status(&pool, ada).await,
        ("stopped".into(), Some("manual".into()), 0)
    );
    assert_eq!(in_flight(&pool, ada).await, None);
    assert!(!message_exists(&pool, created).await);

    // Stop racing the sweep: whichever wins, nothing is left to send.
    let bob = enroll(&svc, OWNER, sequence, BOB).await;
    make_due(&pool, bob).await;
    let (_, stopped) = tokio::join!(
        svc.sweep(Utc::now()),
        svc.act(OWNER, bob, EnrollmentAction::Stop)
    );
    stopped.unwrap();
    assert_eq!(status(&pool, bob).await.0, "stopped");
    assert_eq!(in_flight(&pool, bob).await, None);
    assert_eq!(pending_schedules(&pool).await, 0);

    // A step Gmail is already sending can't be withdrawn; it is recorded sent.
    let other = active_sequence(&svc, OWNER, OWNER_LINK, two_steps()).await;
    let late = enroll(&svc, OWNER, other, ADA).await;
    make_due(&pool, late).await;
    svc.sweep(Utc::now()).await;
    let sending = in_flight(&pool, late).await.unwrap();
    sqlx::query!(
        r#"UPDATE email_scheduled_messages SET processing = true, delivery_claim_id = $2,
               delivery_started_at = now(), delivery_lease_expires_at = now() + interval '5 minutes'
           WHERE message_id = $1"#,
        sending,
        Uuid::now_v7(),
    )
    .execute(&pool)
    .await
    .unwrap();
    svc.act(OWNER, late, EnrollmentAction::Stop).await.unwrap();
    assert_eq!(in_flight(&pool, late).await, Some(sending));
    deliver(&pool, sending).await;
    svc.sweep(Utc::now()).await;
    assert_eq!(
        status(&pool, late).await,
        ("stopped".into(), Some("manual".into()), 1)
    );
    assert_eq!(in_flight(&pool, late).await, None);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("sequences"))
)]
async fn i5_every_in_flight_step_is_resolved(pool: PgPool) {
    let (svc, _) = service(&pool);
    let mut enrollments = Vec::new();
    for _ in 0..3 {
        let sequence = active_sequence(&svc, OWNER, OWNER_LINK, two_steps()).await;
        enrollments.push(enroll(&svc, OWNER, sequence, ADA).await);
        enrollments.push(enroll(&svc, OWNER, sequence, BOB).await);
    }
    // One inbox sends 30 s apart and steps are created only when their slot is
    // near, so create them one sweep at a time, freeing the slot after each.
    for enrollment in &enrollments {
        make_due(&pool, *enrollment).await;
        svc.sweep(Utc::now()).await;
        sqlx::query!(
            "UPDATE email_scheduled_messages SET send_time = now() - interval '1 minute' WHERE message_id = $1",
            in_flight(&pool, *enrollment).await.unwrap()
        )
        .execute(&pool)
        .await
        .unwrap();
    }
    let step = |at: usize| {
        let pool = &pool;
        let enrollment = enrollments[at];
        async move { in_flight(pool, enrollment).await.unwrap() }
    };
    let (refused, refused_again, withdrawn, gone, stuck) = (
        step(0).await,
        step(1).await,
        step(2).await,
        step(3).await,
        step(4).await,
    );

    // Gmail refused it: retried automatically, then handed to the owner.
    for message in [refused, refused_again] {
        sqlx::query!(
            "UPDATE email_scheduled_messages SET delivery_status = 'failed', processing = true WHERE message_id = $1",
            message
        )
        .execute(&pool)
        .await
        .unwrap();
    }
    sqlx::query!(
        "UPDATE email_sequence_enrollments SET attempts = 3 WHERE id = $1",
        enrollments[1]
    )
    .execute(&pool)
    .await
    .unwrap();
    // Removed from the schedule and discarded outside the sequence.
    sqlx::query!(
        "DELETE FROM email_scheduled_messages WHERE message_id = $1",
        withdrawn
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"UPDATE email_messages SET mailbox_state = '{"provider_missing": true}' WHERE id = $1"#,
        withdrawn
    )
    .execute(&pool)
    .await
    .unwrap();
    // Gone without a trace: it may have been sent.
    sqlx::query!("DELETE FROM email_messages WHERE id = $1", gone)
        .execute(&pool)
        .await
        .unwrap();
    // Still unsent well past its time.
    sqlx::query!(
        "UPDATE email_scheduled_messages SET send_time = now() - interval '31 minutes' WHERE message_id = $1",
        stuck
    )
    .execute(&pool)
    .await
    .unwrap();

    svc.sweep(Utc::now()).await;

    let (state, _, _) = status(&pool, enrollments[0]).await;
    assert_eq!(state, "active");
    assert_eq!(
        in_flight(&pool, enrollments[0]).await,
        None,
        "retry withdrew it"
    );
    assert!(!message_exists(&pool, refused).await);
    let retry = sqlx::query!(
        "SELECT attempts, due_at > now() + interval '4 minutes' AS \"later!\" FROM email_sequence_enrollments WHERE id = $1",
        enrollments[0]
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!((retry.attempts, retry.later), (1, true));

    assert_eq!(
        status(&pool, enrollments[1]).await,
        ("needs_attention".into(), Some("step_failed".into()), 0)
    );
    assert_eq!(in_flight(&pool, enrollments[1]).await, Some(refused_again));

    assert_eq!(
        status(&pool, enrollments[2]).await,
        ("needs_attention".into(), Some("step_withdrawn".into()), 0)
    );
    assert_eq!(in_flight(&pool, enrollments[2]).await, None);
    assert!(!message_exists(&pool, withdrawn).await);

    assert_eq!(
        status(&pool, enrollments[3]).await,
        ("needs_attention".into(), Some("step_unknown".into()), 1)
    );
    let unknown = sqlx::query_scalar!(
        "SELECT status FROM email_sequence_steps WHERE message_id = $1",
        gone
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(unknown, "unknown");

    assert_eq!(
        status(&pool, enrollments[4]).await,
        ("needs_attention".into(), Some("step_stuck".into()), 0)
    );
    assert_eq!(in_flight(&pool, enrollments[4]).await, Some(stuck));

    // Resume never resends a step that may have gone out.
    svc.act(OWNER, enrollments[3], EnrollmentAction::Resume)
        .await
        .unwrap();
    assert_eq!(
        status(&pool, enrollments[3]).await,
        ("active".into(), None, 1)
    );

    // A stuck step that sends after all moves the enrollment on.
    deliver(&pool, stuck).await;
    svc.sweep(Utc::now()).await;
    assert_eq!(
        status(&pool, enrollments[4]).await,
        ("active".into(), None, 1)
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("sequences"))
)]
async fn reply_rules_each_stop_the_enrollment(pool: PgPool) {
    let (svc, _) = service(&pool);
    let mut cases = Vec::new();
    for _ in 0..5 {
        let sequence = active_sequence(&svc, OWNER, OWNER_LINK, two_steps()).await;
        let enrollment = enroll(&svc, OWNER, sequence, ADA).await;
        let sent = first_step_sent(&svc, &pool, enrollment).await;
        cases.push((enrollment, sent));
    }
    // Step 1 is in flight when the rule-3 reply lands; the stop withdraws it.
    make_due(&pool, cases[2].0).await;
    svc.sweep(Utc::now()).await;
    let pending_reply = in_flight(&pool, cases[2].0).await.unwrap();

    let messages = [
        // 1: another address, a new thread, In-Reply-To names the step's Message-ID.
        incoming(
            &pool,
            OWNER_LINK,
            "colleague@example.com",
            serde_json::json!([{ "name": "In-Reply-To", "value": format!("<{}@send.test>", cases[0].1) }]),
            None,
        )
        .await,
        // 2: inbox sync resolved it as a reply to the step.
        incoming(&pool, OWNER_LINK, "colleague@example.com", serde_json::json!([]), Some(cases[1].1)).await,
        // 3: the contact, a new thread, no In-Reply-To.
        incoming(&pool, OWNER_LINK, "ada@example.com", serde_json::json!([]), None).await,
        // 4: Gmail's bounce naming the contact.
        incoming(
            &pool,
            OWNER_LINK,
            "mailer-daemon@googlemail.com",
            serde_json::json!([{ "name": "X-Failed-Recipients", "value": "ada@example.com" }]),
            None,
        )
        .await,
    ];
    // Rule 3 and 4 match every ADA enrollment on the inbox: run each rule
    // against a fresh state by checking only its own case afterwards.
    svc.message_synced(OWNER_LINK, messages[0]).await.unwrap();
    assert_eq!(
        status(&pool, cases[0].0).await.1.as_deref(),
        Some("replied")
    );
    assert_eq!(status(&pool, cases[1].0).await.0, "active");
    svc.message_synced(OWNER_LINK, messages[1]).await.unwrap();
    assert_eq!(
        status(&pool, cases[1].0).await.1.as_deref(),
        Some("replied")
    );
    assert_eq!(status(&pool, cases[2].0).await.0, "active");

    // An out-of-office from the contact changes nothing.
    let away = incoming(
        &pool,
        OWNER_LINK,
        "ada@example.com",
        serde_json::json!([{ "name": "Auto-Submitted", "value": "auto-replied" }]),
        None,
    )
    .await;
    svc.message_synced(OWNER_LINK, away).await.unwrap();
    assert_eq!(status(&pool, cases[2].0).await.0, "active");

    svc.message_synced(OWNER_LINK, messages[3]).await.unwrap();
    for (enrollment, _) in &cases[2..] {
        assert_eq!(
            status(&pool, *enrollment).await.1.as_deref(),
            Some("bounced")
        );
    }
    assert!(
        !message_exists(&pool, pending_reply).await,
        "the stop withdrew step 1"
    );

    // Rule 3 on its own, on a new enrollment.
    let sequence = active_sequence(&svc, OWNER, OWNER_LINK, two_steps()).await;
    let bob = enroll(&svc, OWNER, sequence, BOB).await;
    first_step_sent(&svc, &pool, bob).await;
    let from_bob = incoming(
        &pool,
        OWNER_LINK,
        "bob@example.com",
        serde_json::json!([]),
        None,
    )
    .await;
    svc.message_synced(OWNER_LINK, from_bob).await.unwrap();
    assert_eq!(
        status(&pool, bob).await,
        ("stopped".into(), Some("replied".into()), 1)
    );
    // A reply never unsubscribes, but the owner can add the address after one.
    let unsubscribed = || async {
        sqlx::query_scalar!(
            r#"SELECT count(*) AS "count!" FROM email_sequence_recipients WHERE unsubscribed_at IS NOT NULL"#
        )
        .fetch_one(&pool)
        .await
        .unwrap()
    };
    assert_eq!(unsubscribed().await, 0);
    svc.act(OWNER, bob, EnrollmentAction::Unsubscribe)
        .await
        .unwrap();
    assert_eq!(unsubscribed().await, 1);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("sequences"))
)]
async fn a_step_the_owner_takes_over_in_mail_stays_theirs(pool: PgPool) {
    let (svc, _) = service(&pool);
    let sequence = active_sequence(&svc, OWNER, OWNER_LINK, two_steps()).await;
    let enrollment = enroll(&svc, OWNER, sequence, ADA).await;
    make_due(&pool, enrollment).await;
    svc.sweep(Utc::now()).await;
    let step = in_flight(&pool, enrollment).await.unwrap();
    sqlx::query!(
        "UPDATE email_scheduled_messages SET delivery_status = 'failed', processing = true WHERE message_id = $1",
        step
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        "UPDATE email_sequence_enrollments SET attempts = 3 WHERE id = $1",
        enrollment
    )
    .execute(&pool)
    .await
    .unwrap();
    svc.sweep(Utc::now()).await;
    assert_eq!(
        status(&pool, enrollment).await.1.as_deref(),
        Some("step_failed")
    );

    // The owner restores the failed draft in Mail to fix it.
    sqlx::query!(
        "DELETE FROM email_scheduled_messages WHERE message_id = $1",
        step
    )
    .execute(&pool)
    .await
    .unwrap();
    svc.sweep(Utc::now()).await;
    svc.act(OWNER, enrollment, EnrollmentAction::Pause)
        .await
        .unwrap();
    assert!(
        message_exists(&pool, step).await,
        "pause leaves their draft"
    );

    // Then schedules it themselves; the sweep leaves their send alone.
    sqlx::query!(
        r#"INSERT INTO email_scheduled_messages (link_id, message_id, send_time)
           VALUES ($1, $2, now() + interval '10 seconds')"#,
        OWNER_LINK,
        step
    )
    .execute(&pool)
    .await
    .unwrap();
    svc.sweep(Utc::now()).await;
    assert!(message_exists(&pool, step).await);
    assert_eq!(in_flight(&pool, enrollment).await, Some(step));
    assert!(matches!(
        svc.act(OWNER, enrollment, EnrollmentAction::Resume).await,
        Err(SequenceError::StepTakenOver)
    ));

    // Once it is sent, it counts as the sequence's step.
    deliver(&pool, step).await;
    svc.sweep(Utc::now()).await;
    assert_eq!(status(&pool, enrollment).await, ("paused".into(), None, 1));
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("sequences"))
)]
async fn unsubscribe_link_is_idempotent_and_stops_every_owner(pool: PgPool) {
    let (svc, _) = service(&pool);
    let mine = active_sequence(&svc, OWNER, OWNER_LINK, two_steps()).await;
    let theirs = active_sequence(&svc, MATE, MATE_LINK, two_steps()).await;
    let my_enrollment = enroll(&svc, OWNER, mine, ADA).await;
    let their_enrollment = enroll(&svc, MATE, theirs, ADA).await;
    make_due(&pool, their_enrollment).await;
    svc.sweep(Utc::now()).await;
    let in_flight_step = in_flight(&pool, their_enrollment).await.unwrap();

    let token = sqlx::query_scalar!(
        "SELECT token FROM email_sequence_recipients WHERE team_id = $1 AND email = 'ada@example.com'",
        TEAM
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(svc.unsubscribe(&token).await.unwrap());
    let first = sqlx::query!(
        "SELECT unsubscribed_at, source FROM email_sequence_recipients WHERE token = $1",
        token
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(first.source.as_deref(), Some("link"));
    for enrollment in [my_enrollment, their_enrollment] {
        assert_eq!(
            status(&pool, enrollment).await,
            ("stopped".into(), Some("unsubscribed".into()), 0)
        );
    }
    assert!(!message_exists(&pool, in_flight_step).await);
    assert_eq!(pending_schedules(&pool).await, 0);

    // Replaying the link changes nothing; unknown tokens are refused.
    assert!(svc.unsubscribe(&token).await.unwrap());
    let replayed = sqlx::query_scalar!(
        "SELECT unsubscribed_at FROM email_sequence_recipients WHERE token = $1",
        token
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(replayed, first.unsubscribed_at);
    assert!(!svc.unsubscribe("not-a-token").await.unwrap());
    assert!(!svc.unsubscribe(&"A".repeat(43)).await.unwrap());

    // The link outlives its sequence, and the address can't be enrolled again.
    svc.delete(OWNER, mine).await.unwrap();
    assert!(svc.unsubscribe(&token).await.unwrap());
    let other = active_sequence(&svc, OWNER, OWNER_LINK, two_steps()).await;
    let result = svc
        .enroll(
            OWNER,
            other,
            EnrollRequest {
                crm_contact_ids: vec![ADA, BOB],
                start: Utc::now(),
                timezone: "Europe/London".to_owned(),
            },
        )
        .await
        .unwrap();
    assert_eq!(result[0].skipped, Some(EnrollSkip::Unsubscribed));
    assert!(result[1].enrollment_id.is_some());
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("sequences"))
)]
async fn enrolling_takes_each_address_once_from_the_owners_team(pool: PgPool) {
    let (svc, access) = service(&pool);
    let sequence = active_sequence(&svc, OWNER, OWNER_LINK, two_steps()).await;
    let request = |crm_contact_ids: Vec<Uuid>| EnrollRequest {
        crm_contact_ids,
        start: Utc::now(),
        timezone: "Europe/London".to_owned(),
    };

    access.member.store(false, Ordering::SeqCst);
    assert!(matches!(
        svc.enroll(OWNER, sequence, request(vec![ADA])).await,
        Err(SequenceError::NoTeam)
    ));
    access.member.store(true, Ordering::SeqCst);
    access.crm_on.store(false, Ordering::SeqCst);
    assert!(matches!(
        svc.enroll(OWNER, sequence, request(vec![ADA])).await,
        Err(SequenceError::CrmDisabled)
    ));
    access.crm_on.store(true, Ordering::SeqCst);
    assert!(matches!(
        svc.enroll(OWNER, sequence, request(vec![ADA; MAX_ENROLL + 1]))
            .await,
        Err(SequenceError::TooManyContacts)
    ));

    let results = svc
        .enroll(
            OWNER,
            sequence,
            request(vec![ADA, ADA_AGAIN, STRANGER, ADA, BOB]),
        )
        .await
        .unwrap();
    let mut outcomes: Vec<_> = results
        .iter()
        .map(|result| (result.crm_contact_id, result.skipped))
        .collect();
    outcomes.sort_by_key(|(id, _)| *id);
    assert_eq!(
        outcomes,
        [
            (ADA, None),
            (BOB, None),
            (ADA_AGAIN, Some(EnrollSkip::AlreadyEnrolled)),
            (STRANGER, Some(EnrollSkip::NotFound)),
        ]
    );
    let emails = sqlx::query_scalar!(
        "SELECT email FROM email_sequence_enrollments WHERE sequence_id = $1 ORDER BY email",
        sequence
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(emails, ["ada@example.com", "bob@example.com"]);
    let again = svc
        .enroll(OWNER, sequence, request(vec![ADA_AGAIN]))
        .await
        .unwrap();
    assert_eq!(again[0].skipped, Some(EnrollSkip::AlreadyEnrolled));

    // One unsubscribe list entry per address, whatever its letters.
    let other = active_sequence(&svc, OWNER, OWNER_LINK, two_steps()).await;
    let unnamed = enroll(&svc, OWNER, other, ADA_AGAIN).await;
    let recipients = sqlx::query_scalar!(
        r#"SELECT count(*) AS "count!" FROM email_sequence_recipients WHERE team_id = $1"#,
        TEAM
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(recipients, 2);
    // A person with no name is greeted without one.
    let subject = sqlx::query_scalar!(
        r#"SELECT steps->0->>'subject' AS "subject!" FROM email_sequence_enrollments WHERE id = $1"#,
        unnamed
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(subject, "Hello there");
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("sequences"))
)]
async fn only_the_owner_reaches_a_sequence_and_only_from_their_gmail(pool: PgPool) {
    let (svc, _) = service(&pool);
    let sequence = active_sequence(&svc, OWNER, OWNER_LINK, two_steps()).await;
    let enrollment = enroll(&svc, OWNER, sequence, ADA).await;

    assert!(svc.list(MATE).await.unwrap().is_empty());
    assert!(matches!(
        svc.get(MATE, sequence).await,
        Err(SequenceError::NotFound)
    ));
    let pause = SequencePatch {
        version: 1,
        status: Some(SequenceStatus::Paused),
        ..SequencePatch::default()
    };
    assert!(matches!(
        svc.update(MATE, sequence, pause).await,
        Err(SequenceError::NotFound)
    ));
    let request = EnrollRequest {
        crm_contact_ids: vec![BOB],
        start: Utc::now(),
        timezone: "UTC".to_owned(),
    };
    assert!(matches!(
        svc.enroll(MATE, sequence, request).await,
        Err(SequenceError::NotFound)
    ));
    assert!(matches!(
        svc.enrollment(MATE, enrollment).await,
        Err(SequenceError::NotFound)
    ));
    assert!(matches!(
        svc.act(MATE, enrollment, EnrollmentAction::Stop).await,
        Err(SequenceError::NotFound)
    ));
    assert!(matches!(
        svc.delete(MATE, sequence).await,
        Err(SequenceError::NotFound)
    ));

    // A teammate's inbox is never a sender, and neither is Outlook.
    let draft = |link_id| NewSequence {
        name: "Mine".to_owned(),
        link_id: Some(link_id),
        footer: String::new(),
        steps: two_steps(),
    };
    let unavailable = |result: Result<Sequence, SequenceError>| {
        matches!(
            result,
            Err(SequenceError::Invalid(InvalidSequence {
                problem: Problem::SenderUnavailable,
                ..
            }))
        )
    };
    assert!(unavailable(svc.create(OWNER, draft(MATE_LINK)).await));
    sqlx::query!(
        "UPDATE email_links SET provider = 'OUTLOOK' WHERE id = $1",
        OWNER_LINK
    )
    .execute(&pool)
    .await
    .unwrap();
    assert!(unavailable(svc.create(OWNER, draft(OWNER_LINK)).await));
    make_due(&pool, enrollment).await;
    svc.sweep(Utc::now()).await;
    assert_eq!(in_flight(&pool, enrollment).await, None);
    assert_eq!(
        status(&pool, enrollment).await,
        (
            "needs_attention".into(),
            Some("inbox_unavailable".into()),
            0
        )
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("sequences"))
)]
async fn pausing_or_deleting_a_sequence_withdraws_its_steps(pool: PgPool) {
    let (svc, _) = service(&pool);
    let sequence = active_sequence(&svc, OWNER, OWNER_LINK, two_steps()).await;
    let ada = enroll(&svc, OWNER, sequence, ADA).await;
    let bob = enroll(&svc, OWNER, sequence, BOB).await;
    make_due(&pool, ada).await;
    make_due(&pool, bob).await;
    svc.sweep(Utc::now()).await;
    let (ada_step, bob_step) = (
        in_flight(&pool, ada).await.unwrap(),
        in_flight(&pool, bob).await.unwrap(),
    );
    // Gmail is already sending Bob's.
    sqlx::query!(
        "UPDATE email_scheduled_messages SET processing = true, delivery_started_at = now() WHERE message_id = $1",
        bob_step
    )
    .execute(&pool)
    .await
    .unwrap();
    let set_status = |status| {
        let svc = &svc;
        async move {
            let (current, _) = svc.get(OWNER, sequence).await.unwrap();
            let patch = SequencePatch {
                version: current.version,
                status: Some(status),
                ..SequencePatch::default()
            };
            svc.update(OWNER, sequence, patch).await.unwrap();
        }
    };

    set_status(SequenceStatus::Paused).await;
    assert_eq!(in_flight(&pool, ada).await, None);
    assert!(!message_exists(&pool, ada_step).await);
    assert_eq!(in_flight(&pool, bob).await, Some(bob_step));
    // Bob's step goes out and is recorded; nothing more is created while paused.
    deliver(&pool, bob_step).await;
    make_due(&pool, ada).await;
    svc.sweep(Utc::now()).await;
    assert_eq!(status(&pool, bob).await, ("active".into(), None, 1));
    assert_eq!(in_flight(&pool, ada).await, None);
    assert_eq!(pending_schedules(&pool).await, 0);

    // Resuming the sequence creates Ada's first step again.
    set_status(SequenceStatus::Active).await;
    svc.sweep(Utc::now()).await;
    let recreated = in_flight(&pool, ada).await.unwrap();
    assert_ne!(recreated, ada_step);

    svc.delete(OWNER, sequence).await.unwrap();
    assert!(!message_exists(&pool, recreated).await);
    assert_eq!(pending_schedules(&pool).await, 0);
    let left = sqlx::query_scalar!(
        r#"SELECT count(*) AS "count!" FROM email_sequence_enrollments WHERE sequence_id = $1"#,
        sequence
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(left, 0);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("sequences"))
)]
async fn an_inbox_disconnected_mid_sequence_needs_attention(pool: PgPool) {
    let (svc, _) = service(&pool);
    let sequence = active_sequence(&svc, OWNER, OWNER_LINK, two_steps()).await;
    let enrollment = enroll(&svc, OWNER, sequence, ADA).await;
    first_step_sent(&svc, &pool, enrollment).await;
    make_due(&pool, enrollment).await;
    svc.sweep(Utc::now()).await;
    let step = in_flight(&pool, enrollment).await.unwrap();

    sqlx::query!("DELETE FROM email_links WHERE id = $1", OWNER_LINK)
        .execute(&pool)
        .await
        .unwrap();
    svc.sweep(Utc::now()).await;

    // The step went with the inbox; it may have been sent, so never again.
    assert_eq!(
        status(&pool, enrollment).await,
        (
            "needs_attention".into(),
            Some("inbox_unavailable".into()),
            2
        )
    );
    let recorded = sqlx::query_scalar!(
        "SELECT status FROM email_sequence_steps WHERE message_id = $1",
        step
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(recorded, "unknown");
    assert_eq!(pending_schedules(&pool).await, 0);

    // With no inbox, nobody joins and nobody resumes until one is chosen.
    let sender_unavailable = |result: Result<_, SequenceError>| {
        matches!(
            result,
            Err(SequenceError::Invalid(InvalidSequence {
                problem: Problem::SenderUnavailable,
                ..
            }))
        )
    };
    let request = EnrollRequest {
        crm_contact_ids: vec![BOB],
        start: Utc::now(),
        timezone: "UTC".to_owned(),
    };
    assert!(sender_unavailable(
        svc.enroll(OWNER, sequence, request).await.map(|_| ())
    ));
    assert!(sender_unavailable(
        svc.act(OWNER, enrollment, EnrollmentAction::Resume)
            .await
            .map(|_| ())
    ));
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("sequences"))
)]
async fn pausing_before_the_start_keeps_the_start(pool: PgPool) {
    let (svc, _) = service(&pool);
    let mut steps = two_steps();
    // A wait before the first email means nothing: it goes at the start.
    steps[0].delay_days = 3;
    let sequence = active_sequence(&svc, OWNER, OWNER_LINK, steps).await;
    let (stored, _) = svc.get(OWNER, sequence).await.unwrap();
    assert_eq!(stored.steps[0].delay_days, 0);

    let start = Utc::now() + chrono::Duration::days(3);
    let enrollment = svc
        .enroll(
            OWNER,
            sequence,
            EnrollRequest {
                crm_contact_ids: vec![ADA],
                start,
                timezone: "UTC".to_owned(),
            },
        )
        .await
        .unwrap()[0]
        .enrollment_id
        .unwrap();
    let due = || async {
        sqlx::query_scalar!(
            "SELECT due_at FROM email_sequence_enrollments WHERE id = $1",
            enrollment
        )
        .fetch_one(&pool)
        .await
        .unwrap()
    };
    let planned = due().await.unwrap();

    svc.act(OWNER, enrollment, EnrollmentAction::Pause)
        .await
        .unwrap();
    let paused = svc.enrollment(OWNER, enrollment).await.unwrap();
    assert_eq!(
        paused.enrollment.next_send_at, None,
        "a paused row shows no send"
    );
    svc.act(OWNER, enrollment, EnrollmentAction::Resume)
        .await
        .unwrap();
    assert_eq!(due().await, Some(planned));

    // A step withdrawn by a pause goes as soon as allowed after resuming.
    make_due(&pool, enrollment).await;
    svc.sweep(Utc::now()).await;
    assert!(in_flight(&pool, enrollment).await.is_some());
    svc.act(OWNER, enrollment, EnrollmentAction::Pause)
        .await
        .unwrap();
    let before = Utc::now();
    svc.act(OWNER, enrollment, EnrollmentAction::Resume)
        .await
        .unwrap();
    let resumed = due().await.unwrap();
    assert!(resumed >= before + chrono::Duration::minutes(2));
    assert!(resumed < before + chrono::Duration::minutes(3));
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("sequences"))
)]
async fn the_sweep_catches_a_bounce_in_a_thread_of_its_own(pool: PgPool) {
    let (svc, _) = service(&pool);
    let sequence = active_sequence(&svc, OWNER, OWNER_LINK, two_steps()).await;
    let enrollment = enroll(&svc, OWNER, sequence, ADA).await;
    first_step_sent(&svc, &pool, enrollment).await;

    // A delay notice changes nothing: the provider is still trying.
    incoming(
        &pool,
        OWNER_LINK,
        "mailer-daemon@googlemail.com",
        serde_json::json!([
            {"name": "Subject", "value": "Delivery Status Notification (Delay)"},
            {"name": "Content-Type", "value": "multipart/report; report-type=delivery-status"}
        ]),
        None,
    )
    .await;
    make_due(&pool, enrollment).await;
    svc.sweep(Utc::now()).await;
    let step = in_flight(&pool, enrollment).await.unwrap();
    assert_eq!(status(&pool, enrollment).await, ("active".into(), None, 1));

    // The bounce the hook missed is found while the next step waits, and
    // the step is withdrawn.
    incoming(
        &pool,
        OWNER_LINK,
        "MAILER-DAEMON@mx.example.org",
        serde_json::json!([{"name": "X-Failed-Recipients", "value": "ada@example.com"}]),
        None,
    )
    .await;
    svc.sweep(Utc::now()).await;
    assert_eq!(in_flight(&pool, enrollment).await, None);
    assert!(!message_exists(&pool, step).await);
    assert_eq!(
        status(&pool, enrollment).await,
        ("stopped".into(), Some("bounced".into()), 1)
    );
}
