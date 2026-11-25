//! Record a manual dev update through MacroDB and wait for the operator.

use std::path::PathBuf;
use std::time::Duration;

use clap::Parser;
use hosted_runtimes::domain::ids::ComputerId;
use hosted_runtimes::domain::lifecycle::BillingPolicy;
use hosted_runtimes::domain::runtime_update::{
    RuntimeBundle, RuntimeUpdateOutcome, RuntimeUpdates,
};
use hosted_runtimes::outbound::pg::PgComputerRepo;
use rootcause::Report;

#[derive(Clone, clap::ValueEnum)]
enum Environment {
    Dev,
}

#[derive(Parser)]
struct Args {
    #[arg(long, value_enum)]
    environment: Environment,
    #[arg(long)]
    computer: ComputerId,
    #[arg(long)]
    request: PathBuf,
    #[arg(long)]
    database_url_file: PathBuf,
}

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<(), Report> {
    let args = Args::parse();
    let Environment::Dev = args.environment;
    let bundle: RuntimeBundle = serde_json::from_slice(&std::fs::read(args.request)?)?;
    if !bundle.valid() {
        return Err(rootcause::report!("invalid runtime bundle request"));
    }
    let url = std::fs::read_to_string(args.database_url_file)?;
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(2)
        .connect(url.trim())
        .await?;
    let repo = PgComputerRepo::new(pool, BillingPolicy::from_days(30, 7)?);
    let id = repo
        .request_runtime_update(args.computer, &bundle)
        .await?
        .ok_or_else(|| {
            rootcause::report!(
                "computer is not an eligible Firecracker teammate or is already held"
            )
        })?;
    println!("Runtime update request {id} recorded");
    let deadline = tokio::time::Instant::now() + Duration::from_secs(67 * 60);
    loop {
        if let Some(outcome) = repo.runtime_update_outcome(id).await? {
            println!("Runtime update {id}: {}", outcome.as_ref());
            return (outcome == RuntimeUpdateOutcome::Applied)
                .then_some(())
                .ok_or_else(|| rootcause::report!("runtime update did not become ready"));
        }
        if tokio::time::Instant::now() >= deadline {
            return Err(rootcause::report!(
                "runtime update {id} never returned an outcome"
            ));
        }
        tokio::time::sleep(Duration::from_secs(10)).await;
    }
}
