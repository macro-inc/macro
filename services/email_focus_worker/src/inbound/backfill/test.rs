use std::collections::HashSet;

use email::{domain::focus::FocusService, outbound::FocusPgRepository};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::{Pool, Postgres};
use uuid::Uuid;

use super::*;
use crate::test_support::{
    Enrolled, NoDueDates, NoProfile, NoReaders, OTHERS_THREAD, OWNERS_LINK, RecordingClassifier,
    seed_inbox,
};

fn inbox(n: u128) -> FocusInboxOwner {
    FocusInboxOwner {
        link_id: Uuid::from_u128(n),
        owner: MacroUserIdStr::try_from_email(&format!("owner{n}@acme.example")).unwrap(),
    }
}

/// Passes started, and each one's inbox number and pass.
type Started = (Vec<(Waiting, Pass)>, Vec<(u128, Pass)>);

/// Start every pass that may start, returning them and their inbox numbers.
fn start(backfills: &mut Backfills) -> Started {
    let passes: Vec<_> = std::iter::from_fn(|| backfills.next()).collect();
    let started = passes
        .iter()
        .map(|(waiting, pass)| (waiting.inbox.link_id.as_u128(), *pass))
        .collect();
    (passes, started)
}

/// Finish every pass in `passes` as completed.
fn complete(backfills: &mut Backfills, passes: Vec<(Waiting, Pass)>) {
    for (waiting, pass) in passes {
        backfills.done(waiting, pass, true, false);
    }
}

#[test]
fn every_first_pass_goes_before_any_rest() {
    let mut backfills = Backfills::default();
    backfills.found((1..=3).map(inbox).collect(), Instant::now());

    let (passes, started) = start(&mut backfills);
    assert_eq!(started, vec![(1, Pass::First), (2, Pass::First)]);
    complete(&mut backfills, passes);
    let (passes, started) = start(&mut backfills);
    assert_eq!(started, vec![(3, Pass::First), (1, Pass::Rest)]);
    complete(&mut backfills, passes);
    let (passes, started) = start(&mut backfills);
    assert_eq!(started, vec![(2, Pass::Rest), (3, Pass::Rest)]);
    complete(&mut backfills, passes);
    assert_eq!(start(&mut backfills).1, Vec::new());
}

#[test]
fn an_inbox_is_filled_once_while_its_owner_stays_in() {
    let mut backfills = Backfills::default();
    backfills.found(vec![inbox(1)], Instant::now());
    let (passes, _) = start(&mut backfills);

    // Found again while running, waiting and after: never queued twice.
    backfills.found(vec![inbox(1)], Instant::now());
    assert_eq!(start(&mut backfills).1, Vec::new());
    complete(&mut backfills, passes);
    backfills.found(vec![inbox(1)], Instant::now());
    let (passes, started) = start(&mut backfills);
    assert_eq!(started, vec![(1, Pass::Rest)]);
    complete(&mut backfills, passes);
    backfills.found(vec![inbox(1)], Instant::now());
    assert_eq!(start(&mut backfills).1, Vec::new());
}

#[test]
fn an_owner_who_leaves_and_comes_back_is_filled_again() {
    let mut backfills = Backfills::default();
    backfills.found(vec![inbox(1)], Instant::now());
    for _ in 0..2 {
        let (passes, _) = start(&mut backfills);
        complete(&mut backfills, passes);
    }

    backfills.found(Vec::new(), Instant::now());
    backfills.found(vec![inbox(1)], Instant::now());
    assert_eq!(start(&mut backfills).1, vec![(1, Pass::First)]);
}

#[test]
fn a_stopped_pass_holds_the_rest_until_the_next_look_and_runs_again() {
    let mut backfills = Backfills::default();
    backfills.found((1..=3).map(inbox).collect(), Instant::now());
    let (mut passes, _) = start(&mut backfills);

    let (first, pass) = passes.remove(0);
    backfills.done(first, pass, false, true);
    assert_eq!(start(&mut backfills).1, Vec::new());

    backfills.found((1..=3).map(inbox).collect(), Instant::now());
    let (more, started) = start(&mut backfills);
    assert_eq!(started, vec![(3, Pass::First)]);
    complete(&mut backfills, passes);
    complete(&mut backfills, more);
    assert_eq!(
        start(&mut backfills).1,
        vec![(1, Pass::First), (2, Pass::Rest)]
    );
}

type TestService = FocusService<
    FocusPgRepository,
    NoProfile,
    RecordingClassifier,
    NoReaders,
    NoDueDates,
    Enrolled,
>;

fn service(
    pool: Pool<Postgres>,
    classifier: RecordingClassifier,
    due_dates: NoDueDates,
    enrolled: Enrolled,
) -> Arc<TestService> {
    Arc::new(FocusService::new(
        FocusPgRepository(pool),
        NoProfile,
        classifier,
        NoReaders,
        due_dates,
        enrolled,
    ))
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../crates/email/fixtures", scripts("email_focus"))
)]
async fn an_enrolled_inbox_fills_with_no_mail_arriving(pool: Pool<Postgres>) {
    seed_inbox(&pool, OWNERS_LINK, "owner@acme.example", 40, 20).await;
    let classifier = RecordingClassifier::new(Duration::ZERO);
    let mut asked = classifier.asked_count.subscribe();
    let service = service(
        pool,
        classifier.clone(),
        NoDueDates::default(),
        Enrolled::owner("owner@acme.example"),
    );
    let shutdown = CancellationToken::new();
    let backfills = tokio::spawn(run_backfills(service, 30, shutdown.clone()));

    // The seeded threads and the fixture's own signal mail in the window.
    tokio::time::timeout(
        Duration::from_secs(30),
        asked.wait_for(|asked| *asked >= 41),
    )
    .await
    .expect("the inbox fills within the first look")
    .unwrap();
    shutdown.cancel();
    backfills.await.unwrap().unwrap();

    let asked = classifier.asked.lock().unwrap().clone();
    let distinct: HashSet<_> = asked.iter().collect();
    assert_eq!(distinct.len(), asked.len(), "no thread is classified twice");
    assert!(
        !asked.contains(&OTHERS_THREAD),
        "the other owner is not enrolled"
    );
}

/// How fast inboxes fill with the classifier and due date latencies measured
/// on dev (Jev about 150 ms; a due date about 250 ms for the 3 threads in 10
/// that land in Focus). Run with
/// `cargo test -p email_focus_worker fill_speed -- --ignored --nocapture`.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
#[ignore = "a timing measurement, not a check"]
async fn fill_speed(pool: Pool<Postgres>) {
    let classifier = RecordingClassifier::new(Duration::from_millis(150)).focus_in_tenths(3);
    let due_dates = NoDueDates {
        latency: Duration::from_millis(250),
        ..NoDueDates::default()
    };

    // One new inbox, by its threads in the window.
    for (n, threads) in [(1_u128, 300), (2, 1_000), (3, 3_000)] {
        let owner = format!("size{n}@acme.example");
        let link_id = Uuid::from_u128(0xb000 + n);
        seed_inbox(&pool, link_id, &owner, threads, 29).await;
        let service = service(
            pool.clone(),
            classifier.clone(),
            due_dates.clone(),
            Enrolled::owner(&owner),
        );
        let started = Instant::now();
        let report = service
            .backfill(
                &FocusInboxOwner {
                    link_id,
                    owner: MacroUserIdStr::try_from_email(&owner).unwrap(),
                },
                chrono::Duration::days(30),
                THREADS_AT_ONCE,
                DueDates::Read,
            )
            .await
            .unwrap();
        println!(
            "one inbox, {threads} threads: classified {} in {:.1}s",
            report.classified,
            started.elapsed().as_secs_f64()
        );
    }

    // A rollout step: many inboxes found at once, filled by the worker's loop.
    let inboxes: u128 = 24;
    let threads: i32 = 500;
    let mut owners = HashSet::new();
    for n in 0..inboxes {
        let owner = format!("step{n}@acme.example");
        seed_inbox(&pool, Uuid::from_u128(0xc000 + n), &owner, threads, 29).await;
        owners.insert(MacroUserIdStr::try_from_email(&owner).unwrap());
    }
    let classifier = RecordingClassifier::new(Duration::from_millis(150)).focus_in_tenths(3);
    let mut asked = classifier.asked_count.subscribe();
    let due_dates = NoDueDates {
        latency: Duration::from_millis(250),
        ..NoDueDates::default()
    };
    let service = service(pool, classifier, due_dates.clone(), Enrolled(owners));
    let shutdown = CancellationToken::new();
    let started = Instant::now();
    let backfills = tokio::spawn(run_backfills(service, 30, shutdown.clone()));
    let total = usize::try_from(inboxes).unwrap() * usize::try_from(threads).unwrap();
    // The first passes cover 3 of the 29 days seeded.
    asked
        .wait_for(|asked| *asked >= total * 3 / 29)
        .await
        .unwrap();
    let first = started.elapsed().as_secs_f64();
    asked.wait_for(|asked| *asked >= total).await.unwrap();
    let took = started.elapsed().as_secs_f64();
    shutdown.cancel();
    backfills.await.unwrap().unwrap();
    println!(
        "rollout step, {inboxes} inboxes of {threads} threads: last 3 days of every inbox \
         in {first:.1}s, all {total} in {took:.1}s ({:.1} threads/s, due dates {})",
        f64::from(u32::try_from(total).unwrap()) / took,
        due_dates.calls.lock().unwrap()
    );
}
