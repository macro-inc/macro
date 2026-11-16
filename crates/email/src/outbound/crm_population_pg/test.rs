use super::*;
use chrono::{DateTime, Utc};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::{Pool, Postgres};

const LEASE: Duration = Duration::from_secs(600);

/// A contributing mailbox of the fixture, or with `3` the one without consent.
fn link(index: u128) -> Uuid {
    Uuid::from_u128(0xf1000000_0000_0000_0000_000000000000 + index)
}

fn at(seconds: i64) -> DateTime<Utc> {
    DateTime::from_timestamp(seconds, 0).unwrap()
}

fn received(email: &str, at_seconds: i64) -> PopulateCrmContactPayload {
    PopulateCrmContactPayload {
        contact_email: email.into(),
        contact_name: None,
        first_at: at(at_seconds),
        last_at: at(at_seconds),
        is_sent: false,
    }
}

fn sent(email: &str, name: &str, first: i64, last: i64) -> PopulateCrmContactPayload {
    PopulateCrmContactPayload {
        contact_email: email.into(),
        contact_name: Some(name.into()),
        first_at: at(first),
        last_at: at(last),
        is_sent: true,
    }
}

/// A request's schedule, with times as seconds from now.
#[derive(Debug)]
struct Stored {
    generation: i64,
    attempts: i16,
    due_in: f64,
    claimed: bool,
    parked: bool,
    last_error: Option<String>,
}

async fn stored(pool: &PgPool, link: Uuid, email: &str) -> Option<Stored> {
    sqlx::query_as!(
        Stored,
        r#"SELECT generation, attempts,
                  EXTRACT(EPOCH FROM due_at - now())::float8 AS "due_in!",
                  claimed_until IS NOT NULL AS "claimed!",
                  parked_at IS NOT NULL AS "parked!",
                  last_error
           FROM crm_population_requests WHERE link_id = $1 AND contact_email = $2"#,
        link,
        email
    )
    .fetch_optional(pool)
    .await
    .unwrap()
}

/// Request one received message per address and make the requests due, the
/// first address longest ago.
async fn due(pool: &PgPool, link: Uuid, emails: &[&str]) {
    let requests: Vec<_> = emails.iter().map(|email| received(email, 100)).collect();
    request(pool, link, &requests, None).await.unwrap();
    for (position, email) in emails.iter().enumerate() {
        sqlx::query!(
            "UPDATE crm_population_requests SET due_at = now() - make_interval(secs => $3)
             WHERE link_id = $1 AND contact_email = $2",
            link,
            email,
            (emails.len() - position) as f64,
        )
        .execute(pool)
        .await
        .unwrap();
    }
}

/// A per-mailbox limit under a fleet limit that never applies.
fn limits(mailbox: u8) -> Concurrency {
    Concurrency {
        mailbox,
        fleet: u8::MAX,
    }
}

/// The first claim of a pass that starts before the first mailbox.
async fn claim(ledger: &PgCrmPopulationLedger, concurrency: u8) -> Option<ClaimedPopulation> {
    claim_after(ledger, Uuid::nil(), concurrency).await.0
}

/// The next claim of a pass that has reached `after`, and where the pass
/// continues: `None` once it is over.
async fn claim_after(
    ledger: &PgCrmPopulationLedger,
    mut after: Uuid,
    concurrency: u8,
) -> (Option<ClaimedPopulation>, Option<Uuid>) {
    loop {
        let claim = ledger
            .claim(after, LEASE, limits(concurrency))
            .await
            .unwrap();
        assert!(!claim.busy);
        match (claim.claimed, claim.resume_after) {
            (None, Some(next)) => after = next,
            (claimed, resume_after) => return (claimed, resume_after),
        }
    }
}

fn failure(error: &str, retry_after: Option<u64>, mailbox_failures: u32) -> FailedAttempt<'_> {
    FailedAttempt {
        error,
        retry_after: retry_after.map(Duration::from_secs),
        mailbox_failures,
        pause: Duration::from_secs(30),
    }
}

async fn end_pause(pool: &PgPool, link: Uuid) {
    sqlx::query!(
        "UPDATE crm_population_pauses SET paused_until = now() WHERE link_id = $1",
        link
    )
    .execute(pool)
    .await
    .unwrap();
}

async fn paused(pool: &PgPool, link: Uuid) -> Option<(i32, String)> {
    sqlx::query!(
        "SELECT failures, last_error FROM crm_population_pauses WHERE link_id = $1",
        link
    )
    .fetch_optional(pool)
    .await
    .unwrap()
    .map(|row| (row.failures, row.last_error))
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("crm_population"))
)]
async fn only_a_contributing_mailbox_records_requests(pool: Pool<Postgres>) -> Result<(), Report> {
    let requests = [received("a@acme.test", 100)];

    request(&pool, link(3), &requests, None).await?;
    assert!(stored(&pool, link(3), "a@acme.test").await.is_none());

    request(&pool, link(0), &requests, None).await?;
    let row = stored(&pool, link(0), "a@acme.test").await.unwrap();
    assert_eq!((row.generation, row.attempts), (1, 0));
    assert!(!row.claimed && !row.parked);
    assert!((9.0..=10.0).contains(&row.due_in), "{row:?}");

    sqlx::query!(
        "UPDATE crm_email_consent SET enabled = FALSE WHERE link_id = $1",
        link(0)
    )
    .execute(&pool)
    .await?;
    request(&pool, link(0), &[received("b@acme.test", 100)], None).await?;
    assert!(stored(&pool, link(0), "b@acme.test").await.is_none());
    request(&pool, link(1), &[], None).await?;
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("crm_population"))
)]
async fn requests_for_one_correspondent_merge(pool: Pool<Postgres>) -> Result<(), Report> {
    request(&pool, link(0), &[received("a@acme.test", 500)], None).await?;
    // One batch may name a correspondent more than once.
    request(
        &pool,
        link(0),
        &[
            sent("a@acme.test", "Ada", 300, 300),
            received("a@acme.test", 900),
            sent("a@acme.test", "Ada L.", 400, 400),
        ],
        Some("00-trace-span-01"),
    )
    .await?;
    // A received message older than every sent one does not move the anchor.
    request(&pool, link(0), &[received("a@acme.test", 100)], None).await?;

    let row = sqlx::query!(
        "SELECT contact_name, first_at, last_at, is_sent, generation, traceparent
         FROM crm_population_requests WHERE link_id = $1",
        link(0)
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(row.contact_name.as_deref(), Some("Ada"));
    assert_eq!((row.first_at, row.last_at), (at(300), at(900)));
    assert!(row.is_sent);
    assert_eq!(row.generation, 3);
    assert_eq!(row.traceparent.as_deref(), Some("00-trace-span-01"));
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("crm_population"))
)]
async fn further_requests_postpone_an_attempt_only_up_to_a_bound(
    pool: Pool<Postgres>,
) -> Result<(), Report> {
    let again = [received("a@acme.test", 200)];
    request(&pool, link(0), &again, None).await?;

    // Requested five seconds ago: the attempt waits for the new request to settle.
    sqlx::query!(
        "UPDATE crm_population_requests
         SET requested_at = now() - interval '5 seconds', due_at = now() + interval '5 seconds'"
    )
    .execute(&pool)
    .await?;
    request(&pool, link(0), &again, None).await?;
    let row = stored(&pool, link(0), "a@acme.test").await.unwrap();
    assert!((9.0..=10.0).contains(&row.due_in), "{row:?}");

    // Requested long ago: nothing postpones the attempt any further.
    sqlx::query!(
        "UPDATE crm_population_requests
         SET requested_at = now() - interval '119 seconds', due_at = now() - interval '1 second'"
    )
    .execute(&pool)
    .await?;
    request(&pool, link(0), &again, None).await?;
    let row = stored(&pool, link(0), "a@acme.test").await.unwrap();
    assert!((0.0..=1.0).contains(&row.due_in), "{row:?}");
    request(&pool, link(0), &again, None).await?;
    let row = stored(&pool, link(0), "a@acme.test").await.unwrap();
    assert!((0.0..=1.0).contains(&row.due_in), "{row:?}");
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("crm_population"))
)]
async fn due_requests_are_claimed_oldest_first_under_a_lease(
    pool: Pool<Postgres>,
) -> Result<(), Report> {
    let ledger = PgCrmPopulationLedger(pool.clone());
    request(&pool, link(0), &[sent("new@acme.test", "New", 1, 2)], None).await?;
    assert!(
        claim(&ledger, 4).await.is_none(),
        "a request is not due until it has settled"
    );

    due(&pool, link(0), &["first@acme.test", "second@acme.test"]).await;
    let first = claim(&ledger, 4).await.unwrap();
    assert_eq!(first.link_id, link(0));
    assert_eq!(first.owner, "macro|p0@team.test");
    assert_eq!(first.mailbox, "p0@team.test");
    assert_eq!(first.request, received("first@acme.test", 100));
    assert_eq!(
        (first.generation, first.attempt, first.mailbox_failures),
        (1, 1, 0)
    );
    let row = stored(&pool, link(0), "first@acme.test").await.unwrap();
    assert!(
        row.claimed && (599.0..=600.0).contains(&row.due_in),
        "{row:?}"
    );

    let second = claim(&ledger, 4).await.unwrap();
    assert_eq!(second.request.contact_email, "second@acme.test");
    assert!(claim(&ledger, 4).await.is_none());

    // A lease that lapses makes its request due again, as a further attempt.
    sqlx::query!(
        "UPDATE crm_population_requests
         SET claimed_until = now() - interval '1 second', due_at = now() - interval '1 second'
         WHERE contact_email = 'first@acme.test'"
    )
    .execute(&pool)
    .await?;
    let again = claim(&ledger, 4).await.unwrap();
    assert_eq!(again.request.contact_email, "first@acme.test");
    assert_eq!(again.attempt, 2);
    assert_ne!(again.lease, first.lease);
    // The lapsed attempt's outcome no longer settles anything.
    assert_eq!(
        ledger.complete(&first, Duration::from_secs(10)).await?,
        Completion::Superseded
    );
    assert!(
        stored(&pool, link(0), "first@acme.test")
            .await
            .unwrap()
            .claimed
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("crm_population"))
)]
async fn a_mailbox_holds_at_most_its_share_of_attempts(pool: Pool<Postgres>) -> Result<(), Report> {
    let ledger = PgCrmPopulationLedger(pool.clone());
    due(
        &pool,
        link(0),
        &["a@acme.test", "b@acme.test", "c@acme.test"],
    )
    .await;

    assert!(claim(&ledger, 2).await.is_some());
    assert!(claim(&ledger, 2).await.is_some());
    assert!(
        claim(&ledger, 2).await.is_none(),
        "the third request waits for one of the two attempts"
    );

    due(&pool, link(1), &["a@acme.test"]).await;
    assert_eq!(claim(&ledger, 2).await.unwrap().link_id, link(1));
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("crm_population"))
)]
async fn nothing_is_claimed_while_the_fleet_has_its_share_in_flight(
    pool: Pool<Postgres>,
) -> Result<(), Report> {
    let ledger = PgCrmPopulationLedger(pool.clone());
    let fleet_of_two = Concurrency {
        mailbox: 1,
        fleet: 2,
    };
    for mailbox in 0..3 {
        due(&pool, link(mailbox), &["a@acme.test"]).await;
    }

    let first = ledger.claim(Uuid::nil(), LEASE, fleet_of_two).await?;
    let second = ledger.claim(link(0), LEASE, fleet_of_two).await?;
    assert_eq!(second.claimed.map(|claimed| claimed.link_id), Some(link(1)));

    // The pass neither moves nor ends while the fleet is busy.
    let third = ledger.claim(link(1), LEASE, fleet_of_two).await?;
    assert!(third.busy && third.claimed.is_none());
    assert_eq!(third.resume_after, None);

    // A lapsed lease no longer counts.
    sqlx::query!(
        "UPDATE crm_population_requests SET claimed_until = now() - interval '1 second'
         WHERE link_id = $1",
        link(1)
    )
    .execute(&pool)
    .await?;
    let third = ledger.claim(link(1), LEASE, fleet_of_two).await?;
    assert!(!third.busy);
    assert_eq!(third.claimed.map(|claimed| claimed.link_id), Some(link(2)));

    let first = first.claimed.unwrap();
    ledger.complete(&first, Duration::from_secs(10)).await?;
    assert!(!ledger.claim(link(2), LEASE, fleet_of_two).await?.busy);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("crm_population"))
)]
async fn mailboxes_take_turns_whatever_their_backlog(pool: Pool<Postgres>) -> Result<(), Report> {
    let ledger = PgCrmPopulationLedger(pool.clone());
    let backlog: Vec<String> = (0..300).map(|i| format!("c{i}@acme.test")).collect();
    let backlog: Vec<&str> = backlog.iter().map(String::as_str).collect();
    due(&pool, link(0), &backlog).await;
    due(&pool, link(1), &["only@acme.test"]).await;
    due(&pool, link(2), &["one@acme.test", "two@acme.test"]).await;

    // Each pass serves every mailbox with due requests once.
    let mut served = vec![];
    for _pass in 0..3 {
        let mut after = Some(Uuid::nil());
        while let Some(position) = after {
            let (claimed, resume_after) = claim_after(&ledger, position, u8::MAX).await;
            served.extend(claimed.map(|claimed| claimed.link_id));
            after = resume_after;
        }
    }
    assert_eq!(
        served,
        [link(0), link(1), link(2), link(0), link(2), link(0)]
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("crm_population"))
)]
async fn a_claim_looks_at_a_bounded_number_of_mailboxes(
    pool: Pool<Postgres>,
) -> Result<(), Report> {
    let ledger = PgCrmPopulationLedger(pool.clone());
    // Forty mailboxes ahead of the fixture's hold requests that are not due.
    let waiting =
        |index: i32| Uuid::from_u128(0xe1000000_0000_0000_0000_000000000000 + index as u128);
    for index in 0..40 {
        sqlx::query!(
            "INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider)
             VALUES ($1, 'macro|p0@team.test', $2, $3, 'GMAIL')",
            waiting(index),
            format!("fa-waiting-{index}"),
            format!("waiting{index}@team.test"),
        )
        .execute(&pool)
        .await?;
        sqlx::query!(
            "INSERT INTO crm_population_requests
                 (link_id, contact_email, first_at, last_at, is_sent, due_at)
             VALUES ($1, 'a@acme.test', now(), now(), TRUE, now() + interval '1 hour')",
            waiting(index),
        )
        .execute(&pool)
        .await?;
    }
    due(&pool, link(0), &["a@acme.test"]).await;

    let first = ledger.claim(Uuid::nil(), LEASE, limits(4)).await?;
    assert!(first.claimed.is_none());
    assert_eq!(first.resume_after, Some(waiting(MAX_HOPS - 1)));

    let second = ledger
        .claim(waiting(MAX_HOPS - 1), LEASE, limits(4))
        .await?;
    assert_eq!(second.claimed.map(|claimed| claimed.link_id), Some(link(0)));
    assert_eq!(second.resume_after, Some(link(0)));

    let third = ledger.claim(link(0), LEASE, limits(4)).await?;
    assert!(third.claimed.is_none());
    assert_eq!(third.resume_after, None, "the pass is over");
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("crm_population"))
)]
async fn completing_removes_a_request_unless_it_was_requested_again(
    pool: Pool<Postgres>,
) -> Result<(), Report> {
    let ledger = PgCrmPopulationLedger(pool.clone());
    let settle = Duration::from_secs(10);
    due(&pool, link(0), &["a@acme.test"]).await;

    let claimed = claim(&ledger, 4).await.unwrap();
    assert_eq!(
        ledger.complete(&claimed, settle).await?,
        Completion::Removed
    );
    assert!(stored(&pool, link(0), "a@acme.test").await.is_none());

    due(&pool, link(0), &["a@acme.test"]).await;
    let claimed = claim(&ledger, 4).await.unwrap();
    request(&pool, link(0), &[received("a@acme.test", 300)], None).await?;
    let row = stored(&pool, link(0), "a@acme.test").await.unwrap();
    assert!(
        row.claimed && row.due_in > 590.0,
        "a request during an attempt leaves its lease alone: {row:?}"
    );
    assert_eq!(
        ledger.complete(&claimed, settle).await?,
        Completion::Requeued
    );
    let row = stored(&pool, link(0), "a@acme.test").await.unwrap();
    assert_eq!((row.generation, row.attempts), (2, 0));
    assert!(
        !row.claimed && (9.0..=10.0).contains(&row.due_in),
        "{row:?}"
    );

    assert_eq!(
        ledger.complete(&claimed, settle).await?,
        Completion::Superseded
    );
    assert!(stored(&pool, link(0), "a@acme.test").await.is_some());
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("crm_population"))
)]
async fn a_failing_mailbox_pauses_then_takes_one_probe_at_a_time(
    pool: Pool<Postgres>,
) -> Result<(), Report> {
    let ledger = PgCrmPopulationLedger(pool.clone());
    due(
        &pool,
        link(0),
        &["a@acme.test", "b@acme.test", "c@acme.test"],
    )
    .await;

    let failed = claim(&ledger, 4).await.unwrap();
    ledger
        .fail(&failed, &failure("lock timeout", Some(60), 1))
        .await?;
    let row = stored(&pool, link(0), "a@acme.test").await.unwrap();
    assert!(!row.claimed && !row.parked, "{row:?}");
    assert!((59.0..=60.0).contains(&row.due_in), "{row:?}");
    assert_eq!(row.last_error.as_deref(), Some("lock timeout"));
    assert_eq!(
        paused(&pool, link(0)).await,
        Some((1, "lock timeout".into()))
    );

    // The pause keeps the mailbox's other due requests back, and only its own.
    assert!(claim(&ledger, 4).await.is_none());
    due(&pool, link(1), &["a@acme.test"]).await;
    assert_eq!(claim(&ledger, 4).await.unwrap().link_id, link(1));

    end_pause(&pool, link(0)).await;
    let probe = claim(&ledger, 4).await.unwrap();
    assert_eq!(probe.request.contact_email, "b@acme.test");
    assert_eq!(probe.mailbox_failures, 1);
    assert!(
        claim(&ledger, 4).await.is_none(),
        "a failing mailbox has one attempt in flight"
    );

    // A second failure keeps the higher count and the later pause.
    ledger
        .fail(&probe, &failure("still down", Some(60), 2))
        .await?;
    ledger.fail(&probe, &failure("stale", Some(60), 1)).await?;
    assert_eq!(paused(&pool, link(0)).await.map(|pause| pause.0), Some(2));

    end_pause(&pool, link(0)).await;
    let probe = claim(&ledger, 4).await.unwrap();
    assert_eq!(probe.request.contact_email, "c@acme.test");
    assert_eq!(
        ledger.complete(&probe, Duration::from_secs(10)).await?,
        Completion::Removed
    );
    assert_eq!(
        paused(&pool, link(0)).await,
        None,
        "a success ends the pause"
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("crm_population"))
)]
async fn spent_attempts_park_a_request_until_the_cooldown_passes(
    pool: Pool<Postgres>,
) -> Result<(), Report> {
    let ledger = PgCrmPopulationLedger(pool.clone());
    due(&pool, link(0), &["a@acme.test"]).await;
    let claimed = claim(&ledger, 4).await.unwrap();
    let long_error = "x".repeat(5_000);
    ledger
        .fail(&claimed, &failure(&long_error, None, 1))
        .await?;
    end_pause(&pool, link(0)).await;

    let row = stored(&pool, link(0), "a@acme.test").await.unwrap();
    assert!(row.parked && !row.claimed, "{row:?}");
    assert_eq!(row.last_error.map(|error| error.len()), Some(2_000));
    sqlx::query!("UPDATE crm_population_requests SET due_at = now() - interval '1 hour'")
        .execute(&pool)
        .await?;
    assert!(
        claim(&ledger, 4).await.is_none(),
        "parked requests stay put"
    );

    // Mail that arrives soon after is merged but does not start it again.
    request(&pool, link(0), &[received("a@acme.test", 300)], None).await?;
    let row = stored(&pool, link(0), "a@acme.test").await.unwrap();
    assert!(
        row.parked && row.generation == 2 && row.attempts == 1,
        "{row:?}"
    );
    assert!(claim(&ledger, 4).await.is_none());

    sqlx::query!("UPDATE crm_population_requests SET parked_at = now() - interval '25 hours'")
        .execute(&pool)
        .await?;
    request(&pool, link(0), &[received("a@acme.test", 400)], None).await?;
    let row = stored(&pool, link(0), "a@acme.test").await.unwrap();
    assert!(!row.parked && row.attempts == 0, "{row:?}");
    assert!((9.0..=10.0).contains(&row.due_in), "{row:?}");
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("crm_population"))
)]
async fn a_released_request_is_due_at_once_and_uncounted(
    pool: Pool<Postgres>,
) -> Result<(), Report> {
    let ledger = PgCrmPopulationLedger(pool.clone());
    due(&pool, link(0), &["a@acme.test"]).await;
    let claimed = claim(&ledger, 4).await.unwrap();

    ledger.release(&claimed).await?;
    let row = stored(&pool, link(0), "a@acme.test").await.unwrap();
    assert!(
        !row.claimed && row.attempts == 0 && row.due_in <= 0.0,
        "{row:?}"
    );
    assert_eq!(paused(&pool, link(0)).await, None);

    let again = claim(&ledger, 4).await.unwrap();
    assert_eq!(again.attempt, 1);
    // The released claim settles nothing any more, and pauses nothing.
    ledger.release(&claimed).await?;
    ledger.fail(&claimed, &failure("late", None, 1)).await?;
    let row = stored(&pool, link(0), "a@acme.test").await.unwrap();
    assert!(row.claimed && !row.parked, "{row:?}");
    assert_eq!(paused(&pool, link(0)).await, None);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("crm_population"))
)]
async fn a_deleted_mailbox_takes_its_requests_with_it(pool: Pool<Postgres>) -> Result<(), Report> {
    let ledger = PgCrmPopulationLedger(pool.clone());
    due(&pool, link(0), &["a@acme.test", "b@acme.test"]).await;
    let claimed = claim(&ledger, 4).await.unwrap();
    ledger.fail(&claimed, &failure("down", Some(60), 1)).await?;

    sqlx::query!("DELETE FROM email_links WHERE id = $1", link(0))
        .execute(&pool)
        .await?;

    let left = sqlx::query_scalar!(
        r#"SELECT (SELECT count(*) FROM crm_population_requests)
                + (SELECT count(*) FROM crm_population_pauses) AS "left!""#
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(left, 0);
    assert!(claim(&ledger, 4).await.is_none());
    Ok(())
}
