//! The invariants that decide whether an email may go out, against Postgres
//! and the real email step store.

use super::*;
use crate::domain::{
    models::{CrmPerson, EnrollSkip, EnrollmentAction, SequenceError},
    ports::{NewSequence, OwnerAccess, SequencesApi as _},
    service::{EnrollRequest, SequencePatch, Sequences},
    sweep::DAILY_LIMIT,
};
use email::outbound::PgSequenceSteps;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, Ordering},
};

const TEAM: Uuid = uuid::uuid!("7e000000-0000-0000-0000-000000000001");
const OWNER: &str = "macro|owner@example.com";
const MATE: &str = "macro|mate@example.com";
const OWNER_LINK: Uuid = uuid::uuid!("11111111-0000-0000-0000-000000000001");
const MATE_LINK: Uuid = uuid::uuid!("11111111-0000-0000-0000-000000000002");
const ADA: Uuid = uuid::uuid!("cc000000-0000-0000-0000-000000000001");
const BOB: Uuid = uuid::uuid!("cc000000-0000-0000-0000-000000000002");

/// Team membership, CRM state and CRM people the test can change.
#[derive(Clone)]
struct Access {
    member: Arc<AtomicBool>,
    crm_on: Arc<AtomicBool>,
    bob_in_crm: Arc<AtomicBool>,
    ada_name: Arc<Mutex<&'static str>>,
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
        let ada_name = *self.ada_name.lock().unwrap();
        Ok([
            (ADA, "Ada@Example.com", ada_name),
            (BOB, "bob@example.com", "Bob"),
        ]
        .into_iter()
        .filter(|(id, _, _)| ids.contains(id))
        .filter(|(id, _, _)| *id != BOB || self.bob_in_crm.load(Ordering::SeqCst))
        .map(|(id, email, name)| CrmPerson {
            id,
            team_id: TEAM,
            email: Some(email.to_owned()),
            name: Some(name.to_owned()),
        })
        .collect())
    }
}

type Svc = Sequences<PgSequenceRepo, PgSequenceSteps, Access>;

fn service(pool: &PgPool) -> (Svc, Access) {
    let access = Access {
        member: Arc::new(AtomicBool::new(true)),
        crm_on: Arc::new(AtomicBool::new(true)),
        bob_in_crm: Arc::new(AtomicBool::new(true)),
        ada_name: Arc::new(Mutex::new("Ada Lovelace")),
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
        id: Uuid::now_v7(),
        delay_days: 1,
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
            status: Some(SequenceStatus::Active),
            // Tests send on any day of the week.
            weekdays_only: Some(false),
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

/// Status, reason, and how many steps were sent or skipped.
async fn status(pool: &PgPool, enrollment: Uuid) -> (String, Option<String>, i64) {
    let row = sqlx::query!(
        r#"SELECT status, reason,
                  (SELECT count(*) FROM email_sequence_steps h
                   WHERE h.enrollment_id = e.id AND h.status <> 'scheduled') AS "sent!"
           FROM email_sequence_enrollments e WHERE id = $1"#,
        enrollment
    )
    .fetch_one(pool)
    .await
    .unwrap();
    (row.status, row.reason, row.sent)
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
        r#"SELECT count(*) AS "count!" FROM email_scheduled_messages WHERE NOT sent"#
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

/// Create the first step and record it sent.
async fn first_step_sent(svc: &Svc, pool: &PgPool, enrollment: Uuid) -> Uuid {
    make_due(pool, enrollment).await;
    svc.sweep(Utc::now()).await;
    let message = in_flight(pool, enrollment).await.unwrap();
    deliver(pool, message).await;
    svc.sweep(Utc::now()).await;
    assert_eq!(
        status(pool, enrollment).await.2,
        1,
        "first step recorded sent"
    );
    message
}

/// Free the inbox's send slot, as time passing would.
async fn free_slot(pool: &PgPool, message: Uuid) {
    sqlx::query!(
        "UPDATE email_scheduled_messages SET send_time = now() - interval '1 minute' WHERE message_id = $1",
        message
    )
    .execute(pool)
    .await
    .unwrap();
}

async fn body(pool: &PgPool, message: Uuid) -> (Option<String>, Option<String>) {
    let row = sqlx::query!(
        "SELECT subject, body_text FROM email_messages WHERE id = $1",
        message
    )
    .fetch_one(pool)
    .await
    .unwrap();
    (row.subject, row.body_text)
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
        "SELECT list_unsubscribe_url, send_time > now() AS \"future!\" FROM email_scheduled_messages WHERE message_id = $1",
        message
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(
        schedule
            .list_unsubscribe_url
            .is_some_and(|url| url.starts_with("https://email.test/public/sequences/unsubscribe/"))
    );
    assert!(schedule.future);
    // The database refuses a second unsent step outright.
    let second = sqlx::query!(
        "INSERT INTO email_sequence_steps (enrollment_id, step_id, message_id, status, scheduled_at) VALUES ($1, $2, $3, 'scheduled', now())",
        enrollment,
        Uuid::now_v7(),
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
async fn i2_every_check_stops_or_waits_instead_of_sending(pool: PgPool) {
    let (svc, access) = service(&pool);
    let sequence = active_sequence(&svc, OWNER, OWNER_LINK, two_steps()).await;
    let ada = enroll(&svc, OWNER, sequence, ADA).await;
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
    let waiting = ("active".to_owned(), None, 0);

    // Nothing goes while the owner lacks access or the inbox can't send; the
    // enrollment waits and carries on once it can.
    access.crm_on.store(false, Ordering::SeqCst);
    assert_eq!(check(ada).await, waiting);
    access.crm_on.store(true, Ordering::SeqCst);
    access.member.store(false, Ordering::SeqCst);
    assert_eq!(check(ada).await, waiting);
    access.member.store(true, Ordering::SeqCst);
    sqlx::query!(
        "UPDATE email_links SET needs_reauth = true WHERE id = $1",
        OWNER_LINK
    )
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(check(ada).await, waiting);
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
        ada,
        MATE_LINK
    )
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(check(ada).await, waiting);
    sqlx::query!(
        "UPDATE email_sequence_enrollments SET link_id = NULL WHERE id = $1",
        ada
    )
    .execute(&pool)
    .await
    .unwrap();

    // A reply the hook never saw is found before the next step.
    first_step_sent(&svc, &pool, ada).await;
    incoming(
        &pool,
        OWNER_LINK,
        "ada@example.com",
        serde_json::json!([]),
        None,
    )
    .await;
    assert_eq!(
        check(ada).await,
        ("stopped".into(), Some("replied".into()), 1)
    );

    // A person no longer in the CRM gets nothing until they are back.
    let bob = enroll(&svc, OWNER, sequence, BOB).await;
    access.bob_in_crm.store(false, Ordering::SeqCst);
    assert_eq!(
        check(bob).await,
        ("stopped".into(), Some("contact_removed".into()), 0)
    );
    access.bob_in_crm.store(true, Ordering::SeqCst);
    svc.act(OWNER, bob, EnrollmentAction::Resume).await.unwrap();
    assert_eq!(status(&pool, bob).await, waiting);

    // An unsubscribed address gets nothing more from any sequence.
    sqlx::query!(
        "UPDATE email_sequence_recipients SET unsubscribed_at = now(), source = 'manual' WHERE team_id = $1",
        TEAM
    )
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(
        check(bob).await,
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
            step("Ignored", "Second", true),
            step("Last", "Third", false),
        ],
    )
    .await;
    let enrollment = enroll(&svc, OWNER, sequence, ADA).await;
    let first = first_step_sent(&svc, &pool, enrollment).await;
    svc.sweep(Utc::now()).await;
    assert_eq!(status(&pool, enrollment).await, ("active".into(), None, 1));

    // The reply step threads under the sent email, with its subject.
    sqlx::query!(
        "UPDATE email_messages SET subject = 'Hello, as sent' WHERE id = $1",
        first
    )
    .execute(&pool)
    .await
    .unwrap();
    make_due(&pool, enrollment).await;
    svc.sweep(Utc::now()).await;
    let reply = in_flight(&pool, enrollment).await.unwrap();
    let replying_to = sqlx::query_scalar!(
        "SELECT replying_to_id FROM email_messages WHERE id = $1",
        reply
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(replying_to, Some(first));
    assert_eq!(
        body(&pool, reply).await.0.as_deref(),
        Some("Re: Hello, as sent")
    );

    // Pause withdraws it entirely; resume creates it again.
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

    // One the owner rescheduled themselves in Mail is theirs: a stop leaves it.
    let third = active_sequence(&svc, OWNER, OWNER_LINK, two_steps()).await;
    let theirs = enroll(&svc, OWNER, third, BOB).await;
    make_due(&pool, theirs).await;
    svc.sweep(Utc::now()).await;
    let rescheduled = in_flight(&pool, theirs).await.unwrap();
    sqlx::query!(
        "UPDATE email_scheduled_messages SET source = NULL WHERE message_id = $1",
        rescheduled
    )
    .execute(&pool)
    .await
    .unwrap();
    svc.act(OWNER, theirs, EnrollmentAction::Stop).await.unwrap();
    assert!(message_exists(&pool, rescheduled).await);
    deliver(&pool, rescheduled).await;
    svc.sweep(Utc::now()).await;
    assert_eq!(
        status(&pool, theirs).await,
        ("stopped".into(), Some("manual".into()), 1)
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("sequences"))
)]
async fn i5_every_email_that_did_not_go_out_needs_attention(pool: PgPool) {
    let (svc, _) = service(&pool);
    let mut enrollments = Vec::new();
    for _ in 0..2 {
        let sequence = active_sequence(&svc, OWNER, OWNER_LINK, two_steps()).await;
        enrollments.push(enroll(&svc, OWNER, sequence, ADA).await);
        enrollments.push(enroll(&svc, OWNER, sequence, BOB).await);
    }
    // One inbox sends 30 s apart and steps are created only when their slot is
    // near, so create them one sweep at a time, freeing the slot after each.
    let mut steps = Vec::new();
    for enrollment in &enrollments {
        make_due(&pool, *enrollment).await;
        svc.sweep(Utc::now()).await;
        let message = in_flight(&pool, *enrollment).await.unwrap();
        free_slot(&pool, message).await;
        steps.push(message);
    }
    let [refused, cancelled, gone, stuck] = steps[..] else {
        panic!("four steps");
    };
    sqlx::query!(
        "UPDATE email_scheduled_messages SET delivery_status = 'failed', processing = true WHERE message_id = $1",
        refused
    )
    .execute(&pool)
    .await
    .unwrap();
    // The owner cancels it in Mail.
    sqlx::query!(
        "DELETE FROM email_scheduled_messages WHERE message_id = $1",
        cancelled
    )
    .execute(&pool)
    .await
    .unwrap();
    // Gone without a trace: it may have been sent.
    sqlx::query!("DELETE FROM email_messages WHERE id = $1", gone)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query!(
        "UPDATE email_scheduled_messages SET send_time = now() - interval '31 minutes' WHERE message_id = $1",
        stuck
    )
    .execute(&pool)
    .await
    .unwrap();

    svc.sweep(Utc::now()).await;
    for (enrollment, sent) in enrollments.iter().zip([0, 0, 1, 0]) {
        assert_eq!(
            status(&pool, *enrollment).await,
            ("needs_attention".into(), None, sent)
        );
    }
    assert!(
        message_exists(&pool, refused).await,
        "a refused email stays in Mail"
    );

    // Resume creates an email that didn't go out again, and never resends one
    // that may have.
    for enrollment in &enrollments[..3] {
        svc.act(OWNER, *enrollment, EnrollmentAction::Resume)
            .await
            .unwrap();
    }
    assert!(!message_exists(&pool, refused).await);
    assert_eq!(
        status(&pool, enrollments[0]).await,
        ("active".into(), None, 0)
    );
    assert_eq!(
        status(&pool, enrollments[2]).await,
        ("active".into(), None, 1)
    );

    // A late email that goes out after all moves its enrollment on.
    deliver(&pool, stuck).await;
    svc.sweep(Utc::now()).await;
    assert_eq!(
        status(&pool, enrollments[3]).await,
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
    // The second step is in flight when the rule-3 reply lands; the stop withdraws it.
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
            "mailer-daemon@remote.example",
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
        "the stop withdrew the second step"
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
async fn edits_reach_every_email_not_yet_created(pool: PgPool) {
    let (svc, access) = service(&pool);
    let first = step("Hi {{firstName}}", "Welcome", false);
    let follow_up = Step {
        delay_days: 3,
        ..step("", "Following up, {{firstName}}", true)
    };
    let last = Step {
        delay_days: 1,
        ..step("Last", "Bye", false)
    };
    let sequence = active_sequence(
        &svc,
        OWNER,
        OWNER_LINK,
        vec![first.clone(), follow_up.clone(), last],
    )
    .await;
    let ada = enroll(&svc, OWNER, sequence, ADA).await;
    let sent = first_step_sent(&svc, &pool, ada).await;
    assert_eq!(body(&pool, sent).await.0.as_deref(), Some("Hi Ada"));
    let due = async || {
        sqlx::query_scalar!(
            "SELECT due_at FROM email_sequence_enrollments WHERE id = $1",
            ada
        )
        .fetch_one(&pool)
        .await
        .unwrap()
        .unwrap()
    };
    let three_days_out = due().await;

    // While it sends: a new follow-up a day out goes first, the last email
    // goes, and the CRM name in use changes.
    let inserted = Step {
        delay_days: 1,
        ..step("", "Quick note, {{firstName}}", true)
    };
    svc.update(
        OWNER,
        sequence,
        SequencePatch {
            steps: Some(vec![first.clone(), inserted.clone(), follow_up.clone()]),
            ..SequencePatch::default()
        },
    )
    .await
    .unwrap();
    // Two days sooner, give or take a daylight-saving change.
    assert!((47..=49).contains(&(three_days_out - due().await).num_hours()));
    *access.ada_name.lock().unwrap() = "Augusta King";
    make_due(&pool, ada).await;
    svc.sweep(Utc::now()).await;
    let note = in_flight(&pool, ada).await.unwrap();
    assert_eq!(
        body(&pool, note).await.1.unwrap().lines().next(),
        Some("Quick note, Augusta")
    );

    // An email already created goes as it is.
    let edited = Step {
        body: "Edited".to_owned(),
        ..inserted.clone()
    };
    svc.update(
        OWNER,
        sequence,
        SequencePatch {
            steps: Some(vec![first.clone(), edited, follow_up.clone()]),
            ..SequencePatch::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(
        body(&pool, note).await.1.unwrap().lines().next(),
        Some("Quick note, Augusta")
    );

    deliver(&pool, note).await;
    svc.sweep(Utc::now()).await;
    make_due(&pool, ada).await;
    svc.sweep(Utc::now()).await;
    let last_email = in_flight(&pool, ada).await.unwrap();
    assert_eq!(
        body(&pool, last_email).await.1.unwrap().lines().next(),
        Some("Following up, Augusta")
    );
    deliver(&pool, last_email).await;
    svc.sweep(Utc::now()).await;
    assert_eq!(status(&pool, ada).await, ("completed".into(), None, 3));

    // A sending sequence must stay complete.
    let emptied = Step {
        body: String::new(),
        ..follow_up
    };
    assert!(matches!(
        svc.update(
            OWNER,
            sequence,
            SequencePatch {
                steps: Some(vec![first, emptied]),
                ..SequencePatch::default()
            },
        )
        .await,
        Err(SequenceError::Invalid(_))
    ));
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("sequences"))
)]
async fn an_inbox_sends_at_most_its_daily_limit(pool: PgPool) {
    let (svc, _) = service(&pool);
    let sequence = active_sequence(&svc, OWNER, OWNER_LINK, two_steps()).await;
    // Bob's finished enrollment stands in for a day of sends from the inbox.
    let bob = enroll(&svc, OWNER, sequence, BOB).await;
    sqlx::query!(
        "UPDATE email_sequence_enrollments SET status = 'completed', due_at = NULL, link_id = $2 WHERE id = $1",
        bob,
        OWNER_LINK,
    )
    .execute(&pool)
    .await
    .unwrap();
    let sent: Vec<Uuid> = (0..DAILY_LIMIT).map(|_| Uuid::now_v7()).collect();
    sqlx::query!(
        r#"INSERT INTO email_sequence_steps (enrollment_id, step_id, message_id, status, scheduled_at, sent_at)
           SELECT $1, id, id, 'sent', now() - interval '23 hours', now() - interval '23 hours'
           FROM unnest($2::uuid[]) AS t(id)"#,
        bob,
        &sent,
    )
    .execute(&pool)
    .await
    .unwrap();
    let ada = enroll(&svc, OWNER, sequence, ADA).await;
    make_due(&pool, ada).await;

    svc.sweep(Utc::now()).await;
    assert_eq!(in_flight(&pool, ada).await, None);
    assert_eq!(status(&pool, ada).await.0, "active");

    // Once the earliest of them is a day old, Ada's step goes.
    sqlx::query!(
        "UPDATE email_sequence_steps SET scheduled_at = now() - interval '25 hours' WHERE message_id = $1",
        sent[0]
    )
    .execute(&pool)
    .await
    .unwrap();
    svc.sweep(Utc::now()).await;
    assert!(in_flight(&pool, ada).await.is_some());
}
