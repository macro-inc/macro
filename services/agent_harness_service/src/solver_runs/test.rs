use std::time::Duration;

use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use sqlx::PgPool;
use uuid::Uuid;

use super::pg::PgSolverRuns;
use super::*;
use crate::captcha_gateway::VendorErrorKind;

pub(crate) const AGENT: &str = "macro|sam-rivera-abc123@agents.macro.invalid";
pub(crate) const OTHER_AGENT: &str = "macro|kai-lopez-def456@agents.macro.invalid";

/// Make `agent` a `"User"`, which runs and solves belong to.
pub(crate) async fn insert_agent(pool: &PgPool, agent: &str) -> anyhow::Result<()> {
    let id = macro_uuid::generate_uuid_v7();
    sqlx::query!(
        "INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $2, $2)",
        id,
        agent
    )
    .execute(pool)
    .await?;
    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, $1, $2)"#,
        agent,
        id
    )
    .execute(pool)
    .await?;
    Ok(())
}

fn agent(id: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(id).unwrap().into_owned()
}

async fn started(runs: &PgSolverRuns, who: &MacroUserIdStr<'static>) -> SolverRunId {
    match runs.start(who).await.unwrap() {
        RunStart::Started { run_id, .. } => run_id,
        refused => panic!("{refused:?}"),
    }
}

async fn expire(pool: &PgPool, run: SolverRunId) {
    sqlx::query!(
        "UPDATE agent_captcha_runs SET expires_at = now() - interval '1 second' WHERE id = $1",
        run.0
    )
    .execute(pool)
    .await
    .unwrap();
}

const CAPS: SolveCaps = SolveCaps {
    concurrent: 1,
    hourly: 20,
    daily: 100,
    abandoned_after: Duration::from_secs(180),
};

fn claim(solve_id: u128, run: SolverRunId, who: &MacroUserIdStr<'static>) -> SolveClaim {
    SolveClaim {
        solve_id: Uuid::from_u128(solve_id),
        run,
        agent: who.clone(),
        caps: CAPS,
        key_blocked: false,
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_run_lives_six_minutes_and_one_is_live_at_a_time(pool: PgPool) -> anyhow::Result<()> {
    insert_agent(&pool, AGENT).await?;
    insert_agent(&pool, OTHER_AGENT).await?;
    let runs = PgSolverRuns::new(pool.clone(), RunLimits::default());

    let RunStart::Started { run_id, expires_at } = runs.start(&agent(AGENT)).await? else {
        panic!("the first run starts");
    };
    let lifetime = expires_at - chrono::Utc::now();
    assert!(
        lifetime > chrono::Duration::minutes(5) && lifetime <= chrono::Duration::minutes(6),
        "{lifetime}"
    );
    assert_eq!(run_id.0.get_version_num(), 7);
    assert_eq!(
        runs.start(&agent(AGENT)).await?,
        RunStart::BudgetExceeded(BudgetLimit::Concurrent)
    );
    // Another agent has its own runs.
    started(&runs, &agent(OTHER_AGENT)).await;

    expire(&pool, run_id).await;
    started(&runs, &agent(AGENT)).await;
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_hourly_and_daily_run_caps_count_rows(pool: PgPool) -> anyhow::Result<()> {
    insert_agent(&pool, AGENT).await?;
    let who = agent(AGENT);
    for (limits, limit) in [
        (
            RunLimits {
                concurrent: 10,
                hourly: 2,
                ..RunLimits::default()
            },
            BudgetLimit::Hourly,
        ),
        (
            RunLimits {
                concurrent: 10,
                hourly: 10,
                daily: 2,
                ..RunLimits::default()
            },
            BudgetLimit::Daily,
        ),
    ] {
        sqlx::query!("DELETE FROM agent_captcha_runs")
            .execute(&pool)
            .await?;
        // Two stores share the rows, as two replicas do.
        let first = PgSolverRuns::new(pool.clone(), limits);
        let second = PgSolverRuns::new(pool.clone(), limits);
        started(&first, &who).await;
        started(&second, &who).await;
        assert_eq!(first.start(&who).await?, RunStart::BudgetExceeded(limit));
    }

    // A run from yesterday counts toward neither.
    sqlx::query!("UPDATE agent_captcha_runs SET created_at = now() - interval '25 hours'")
        .execute(&pool)
        .await?;
    let runs = PgSolverRuns::new(
        pool.clone(),
        RunLimits {
            concurrent: 10,
            hourly: 2,
            daily: 2,
            ..RunLimits::default()
        },
    );
    started(&runs, &who).await;
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn model_calls_need_a_live_run_of_the_caller(pool: PgPool) -> anyhow::Result<()> {
    insert_agent(&pool, AGENT).await?;
    insert_agent(&pool, OTHER_AGENT).await?;
    let runs = PgSolverRuns::new(pool.clone(), RunLimits::default());
    let run = started(&runs, &agent(AGENT)).await;

    assert_eq!(runs.take_model_call(run, &agent(AGENT)).await?, Ok(()));
    assert_eq!(
        runs.take_model_call(run, &agent(OTHER_AGENT)).await?,
        Err(RunRefusal::Required)
    );
    assert_eq!(
        runs.take_model_call(SolverRunId(Uuid::now_v7()), &agent(AGENT))
            .await?,
        Err(RunRefusal::Required)
    );
    expire(&pool, run).await;
    assert_eq!(
        runs.take_model_call(run, &agent(AGENT)).await?,
        Err(RunRefusal::Expired)
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_per_run_call_cap_and_the_in_flight_cap_hold(pool: PgPool) -> anyhow::Result<()> {
    insert_agent(&pool, AGENT).await?;
    let who = agent(AGENT);
    let limits = RunLimits {
        model_calls: 3,
        model_calls_in_flight: 2,
        ..RunLimits::default()
    };
    let first = PgSolverRuns::new(pool.clone(), limits);
    let second = PgSolverRuns::new(pool.clone(), limits);
    let run = started(&first, &who).await;

    assert_eq!(first.take_model_call(run, &who).await?, Ok(()));
    assert_eq!(second.take_model_call(run, &who).await?, Ok(()));
    // Two are running, on either replica.
    assert_eq!(
        first.take_model_call(run, &who).await?,
        Err(RunRefusal::Busy)
    );
    second.release_model_call(run).await?;
    assert_eq!(first.take_model_call(run, &who).await?, Ok(()));
    first.release_model_call(run).await?;
    first.release_model_call(run).await?;
    // Three taken in all: the run is used up, with nothing in flight.
    assert_eq!(
        second.take_model_call(run, &who).await?,
        Err(RunRefusal::Exhausted)
    );
    // A release never goes below zero.
    first.release_model_call(run).await?;
    let in_flight = sqlx::query_scalar!(
        "SELECT model_calls_in_flight FROM agent_captcha_runs WHERE id = $1",
        run.0
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(in_flight, 0);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_solve_is_claimed_once_and_replays_once_finished(pool: PgPool) -> anyhow::Result<()> {
    insert_agent(&pool, AGENT).await?;
    insert_agent(&pool, OTHER_AGENT).await?;
    let who = agent(AGENT);
    let runs = PgSolverRuns::new(pool.clone(), RunLimits::default());
    let replica = PgSolverRuns::new(pool.clone(), RunLimits::default());
    let run = started(&runs, &who).await;
    let other_run = started(&runs, &agent(OTHER_AGENT)).await;

    assert_eq!(runs.claim(&claim(1, run, &who)).await?, Claimed::New);
    assert_eq!(
        replica.claim(&claim(1, run, &who)).await?,
        Claimed::InProgress
    );
    assert_eq!(
        replica
            .claim(&claim(1, other_run, &agent(OTHER_AGENT)))
            .await?,
        Claimed::OtherAgent
    );
    let outcome = SolveOutcome::Unsolvable;
    runs.finish(Uuid::from_u128(1), &outcome, Some("task-1"))
        .await?;
    assert_eq!(
        replica.claim(&claim(1, run, &who)).await?,
        Claimed::Finished(outcome)
    );
    // A replay took nothing from the run: its second solve is still there.
    assert_eq!(replica.claim(&claim(2, run, &who)).await?, Claimed::New);
    runs.finish(Uuid::from_u128(2), &SolveOutcome::Timeout, None)
        .await?;
    assert_eq!(
        runs.claim(&claim(3, run, &who)).await?,
        Claimed::Refused(RunRefusal::Exhausted)
    );
    let task_id = sqlx::query_scalar!(
        "SELECT task_id FROM agent_captcha_solves WHERE solve_id = $1",
        Uuid::from_u128(1)
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(task_id.as_deref(), Some("task-1"));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn solve_caps_count_rows_and_refusals_give_the_run_its_solve_back(
    pool: PgPool,
) -> anyhow::Result<()> {
    insert_agent(&pool, AGENT).await?;
    let who = agent(AGENT);
    let runs = PgSolverRuns::new(
        pool.clone(),
        RunLimits {
            concurrent: 10,
            solves: 10,
            ..RunLimits::default()
        },
    );
    let run = started(&runs, &who).await;

    assert_eq!(runs.claim(&claim(1, run, &who)).await?, Claimed::New);
    assert_eq!(
        runs.claim(&claim(2, run, &who)).await?,
        Claimed::BudgetExceeded(BudgetLimit::Concurrent)
    );
    runs.finish(Uuid::from_u128(1), &SolveOutcome::Unsolvable, None)
        .await?;
    let hourly = SolveClaim {
        caps: SolveCaps { hourly: 1, ..CAPS },
        ..claim(2, run, &who)
    };
    assert_eq!(
        runs.claim(&hourly).await?,
        Claimed::BudgetExceeded(BudgetLimit::Hourly)
    );
    let blocked = SolveClaim {
        key_blocked: true,
        ..claim(2, run, &who)
    };
    assert_eq!(runs.claim(&blocked).await?, Claimed::KeyBlocked);
    let used = sqlx::query_scalar!(
        "SELECT solves_used FROM agent_captcha_runs WHERE id = $1",
        run.0
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(used, 1);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_solve_its_process_left_unfinished_stops_counting(pool: PgPool) -> anyhow::Result<()> {
    insert_agent(&pool, AGENT).await?;
    let who = agent(AGENT);
    let runs = PgSolverRuns::new(pool.clone(), RunLimits::default());
    let run = started(&runs, &who).await;
    assert_eq!(runs.claim(&claim(1, run, &who)).await?, Claimed::New);
    sqlx::query!("UPDATE agent_captcha_solves SET created_at = now() - interval '10 minutes'")
        .execute(&pool)
        .await?;

    assert_eq!(
        runs.claim(&claim(1, run, &who)).await?,
        Claimed::Finished(SolveOutcome::VendorError {
            kind: VendorErrorKind::Unavailable,
        })
    );
    assert_eq!(runs.claim(&claim(2, run, &who)).await?, Claimed::New);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_ended_run_frees_the_agent_for_the_next_one(pool: PgPool) -> anyhow::Result<()> {
    insert_agent(&pool, AGENT).await?;
    insert_agent(&pool, OTHER_AGENT).await?;
    let who = agent(AGENT);
    let runs = PgSolverRuns::new(pool.clone(), RunLimits::default());
    let run = started(&runs, &who).await;

    // Another agent can't end it.
    runs.end(run, &agent(OTHER_AGENT)).await?;
    assert_eq!(
        runs.start(&who).await?,
        RunStart::BudgetExceeded(BudgetLimit::Concurrent)
    );

    runs.end(run, &who).await?;
    runs.end(run, &who).await?;
    // Ended, not expired and not used up: said as it is.
    assert_eq!(
        runs.take_model_call(run, &who).await?,
        Err(RunRefusal::Ended)
    );
    assert_eq!(
        runs.claim(&claim(1, run, &who)).await?,
        Claimed::Refused(RunRefusal::Ended)
    );
    started(&runs, &who).await;
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_runs_last_solve_ends_it(pool: PgPool) -> anyhow::Result<()> {
    insert_agent(&pool, AGENT).await?;
    let who = agent(AGENT);
    let runs = PgSolverRuns::new(pool.clone(), RunLimits::default());
    let run = started(&runs, &who).await;

    assert_eq!(runs.claim(&claim(1, run, &who)).await?, Claimed::New);
    runs.finish(Uuid::from_u128(1), &SolveOutcome::Unsolvable, None)
        .await?;
    // One solve left: the run goes on.
    assert_eq!(
        runs.start(&who).await?,
        RunStart::BudgetExceeded(BudgetLimit::Concurrent)
    );

    assert_eq!(runs.claim(&claim(2, run, &who)).await?, Claimed::New);
    runs.finish(Uuid::from_u128(2), &SolveOutcome::Timeout, None)
        .await?;
    started(&runs, &who).await;
    Ok(())
}
