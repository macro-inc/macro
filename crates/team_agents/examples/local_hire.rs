//! Disposable Hire review over a private stdin/stdout pipe, with local Postgres.

use std::{
    env, io,
    io::{BufRead, Write},
    path::Path,
    sync::Arc,
};

use hosted_runtimes::{
    domain::{
        lifecycle::BillingPolicy,
        models::FleetAttachment,
        operator::ComputerOperator,
        overcommit::MemoryReport,
        ports::{ComputerRepo, Fleet, OvercommitRepo, StaticFleetAttachment},
        rollout::ComputerRollout,
        service::{ComputerService, SystemClock},
    },
    outbound::pg::PgComputerRepo,
};
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use sqlx::postgres::{PgConnectOptions, PgPoolOptions};
use team_agents::{
    domain::service::TeamAgentServiceImpl,
    outbound::{
        hosted_runtimes_computers::HostedRuntimesComputers, pg_team_agents_repo::PgTeamAgentsRepo,
    },
};
use teams::outbound::team_repo::TeamRepositoryImpl;
use uuid::Uuid;

#[path = "local_hire_support/resources.rs"]
mod resources;
#[path = "local_hire_support/review.rs"]
mod review;

#[path = "local_hire_support/fleet.rs"]
mod fleet;

use resources::{DisabledBilling, LocalComp, LocalOnly, Unwired};
use review::{IncludedMembership, Review, ReviewRequest};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = env::args().skip(1);
    let path = std::fs::canonicalize(args.next().ok_or("expected disposable socket directory")?)?;
    let username = args.next().ok_or("expected local postgres role")?;
    let team = args.next().ok_or("expected seeded team")?.parse::<Uuid>()?;
    let reviewer = args.next().ok_or("expected seeded reviewer")?;
    let actor = MacroUserIdStr::parse_from_str(&reviewer)?.into_owned();
    if args.next().is_some()
        || !actor.as_ref().ends_with("@example.test")
        || path.parent() != Some(Path::new("/tmp"))
        || !path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.starts_with("macro-hire-local."))
    {
        return Err("expected a disposable review cluster and synthetic identity".into());
    }

    let pool = PgPoolOptions::new()
        .max_connections(4)
        .connect_with(
            PgConnectOptions::new()
                .socket(&path)
                .username(&username)
                .database("bots_hire_review"),
        )
        .await?;
    let _lock = std::fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .open(path.join("review.lock"))?;
    _lock.try_lock()?;
    let repo = PgComputerRepo::new(pool.clone(), BillingPolicy::from_days(14, 3)?);
    let teams = TeamRepositoryImpl::new(pool.clone());
    let journal = path.join("hire-receipts");
    if !journal.exists() {
        std::fs::create_dir(&journal)?;
    }
    if std::fs::canonicalize(&journal)? != journal {
        return Err("expected private review receipt directory".into());
    }
    let mut review = Review::new(teams, actor.clone(), team, journal);
    review.verify_seed().await?;

    let fleet = fleet::LocalFleet::new(std::path::PathBuf::from("/bin/sh"))?;
    let host = repo.register_host(fleet.host().await?).await?;
    let operator = ComputerOperator::start(
        repo.clone(),
        fleet,
        Unwired,
        Unwired,
        SystemClock,
        Arc::new(Unwired),
    )
    .await?;
    let computer_service = ComputerService::new(
        repo.clone(),
        DisabledBilling,
        SystemClock,
        StaticFleetAttachment(FleetAttachment::Attached),
    )
    .with_comp_policy(LocalComp(team))
    .with_rollout(ComputerRollout::new(LocalOnly(actor.clone())));
    let agents = TeamAgentServiceImpl::new(
        PgTeamAgentsRepo::new(pool.clone()),
        IncludedMembership(TeamRepositoryImpl::new(pool)),
        Unwired,
        Unwired,
        HostedRuntimesComputers::new(Arc::new(computer_service), repo.clone()),
        Unwired,
        Some(LocalOnly(actor)),
        Unwired,
        Unwired,
    );

    let stdout = io::stdout();
    let mut out = stdout.lock();
    for line in io::stdin().lock().lines() {
        let line = line?;
        let request = serde_json::from_str::<ReviewRequest>(&line);
        if request
            .as_ref()
            .is_ok_and(ReviewRequest::is_offer_or_confirm)
            && let Ok(request) = &request
            && review.authorized(request).await
        {
            repo.record_memory_report(
                host.id,
                MemoryReport {
                    // Admission telemetry for this isolated process-backed host.
                    resident_memory_mib: 64,
                    reported_at: chrono::Utc::now(),
                },
            )
            .await?;
        }
        let reply = match request {
            Ok(request) if request.is_fleet_pass() => {
                if review.authorized(&request).await {
                    match operator.run_fleet_effects().await {
                        Ok(count) => serde_json::json!({"status":"ran","count":count}),
                        Err(_) => serde_json::json!({"status":"unavailable"}),
                    }
                } else {
                    serde_json::json!({"status":"denied"})
                }
            }
            Ok(request) => review.handle(&agents, &repo, request).await,
            Err(_) => serde_json::json!({"status":"invalid"}),
        };
        serde_json::to_writer(&mut out, &reply)?;
        writeln!(out)?;
        out.flush()?;
    }
    Ok(())
}
