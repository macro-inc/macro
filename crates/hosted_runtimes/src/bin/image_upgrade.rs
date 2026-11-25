//! Start an image upgrade and wait for it, straight against MacroDB: the
//! `firecracker-image-rollout` workflow runs it on the in-VPC runner with the
//! environment's database URL. The control plane's upgrade pass does the
//! rest (`hosted_runtimes::domain::image_upgrade`).
//!
//! ```sh
//! image-upgrade start --environment dev --database-url-file db.url \
//!   --manifest manifest.json --computers <id>,<id> --batch-size 1 \
//!   --idle-wait-minutes 30 --reconnect-timeout-minutes 10 --created-by <run url>
//! image-upgrade wait --environment dev --database-url-file db.url \
//!   --upgrade-id <id> --timeout-minutes 120
//! ```
//!
//! `start` prints the upgrade id. `wait` prints every change and exits 0 once
//! the upgrade is done with no computer rolled back, 1 otherwise.

use std::collections::HashMap;
use std::path::PathBuf;
use std::time::Duration;

use clap::{Parser, Subcommand, ValueEnum};
use hosted_runtimes::domain::ids::ComputerId;
use hosted_runtimes::domain::image_upgrade::{
    ComputerUpgrade, ComputerUpgradeState, ImageSource, ImageUpgrade, ImageUpgrades, ImageVersion,
    NewImageUpgrade, UpgradeId, UpgradeState,
};
use hosted_runtimes::domain::lifecycle::BillingPolicy;
use hosted_runtimes::domain::operator::start_image_upgrade;
use hosted_runtimes::outbound::pg::PgComputerRepo;
use rootcause::Report;
use serde::Deserialize;

/// Where to roll out. Production is not a choice: its rollouts need their
/// own approval.
#[derive(Debug, Clone, Copy, ValueEnum)]
enum Environment {
    Dev,
}

#[derive(Parser)]
struct Args {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Record an upgrade; prints its id.
    Start {
        #[command(flatten)]
        target: Target,
        /// `{"image": "...", "sources": [{"file": {"name", "sha256",
        /// "bytes"}, "url"}]}`, the build job's manifest.
        #[arg(long)]
        manifest: PathBuf,
        /// Computer ids, comma-separated, in the order they move.
        #[arg(long, value_delimiter = ',', required = true)]
        computers: Vec<ComputerId>,
        #[arg(long, default_value_t = 1)]
        batch_size: u8,
        #[arg(long, default_value_t = 30)]
        idle_wait_minutes: u32,
        #[arg(long, default_value_t = 10)]
        reconnect_timeout_minutes: u32,
        /// The workflow run asking.
        #[arg(long)]
        created_by: String,
    },
    /// Wait until the upgrade finishes, printing every change.
    Wait {
        #[command(flatten)]
        target: Target,
        #[arg(long)]
        upgrade_id: uuid::Uuid,
        #[arg(long, default_value_t = 180)]
        timeout_minutes: u64,
    },
}

#[derive(clap::Args)]
struct Target {
    #[arg(long, value_enum)]
    environment: Environment,
    /// A file holding the database URL (kept out of the process list).
    #[arg(long)]
    database_url_file: PathBuf,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Manifest {
    image: ImageVersion,
    sources: Vec<ImageSource>,
}

/// How often `wait` reads the upgrade.
const POLL: Duration = Duration::from_secs(15);

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<(), Report> {
    let args = Args::parse();
    match args.command {
        Command::Start {
            target,
            manifest,
            computers,
            batch_size,
            idle_wait_minutes,
            reconnect_timeout_minutes,
            created_by,
        } => {
            let manifest: Manifest = serde_json::from_slice(&std::fs::read(&manifest)?)?;
            let repo = repo(&target).await?;
            let request = NewImageUpgrade {
                image: manifest.image,
                sources: manifest.sources,
                computers,
                batch_size,
                idle_wait: chrono::Duration::minutes(i64::from(idle_wait_minutes)),
                reconnect_timeout: chrono::Duration::minutes(i64::from(reconnect_timeout_minutes)),
                created_by,
            };
            let upgrade = start_image_upgrade(&repo, &request, chrono::Utc::now())
                .await?
                .map_err(|refused| rootcause::report!("the upgrade cannot start: {refused}"))?;
            eprintln!(
                "started image upgrade {} of {} on {} computers",
                upgrade.id,
                upgrade.image,
                request.computers.len()
            );
            println!("{}", upgrade.id);
            Ok(())
        }
        Command::Wait {
            target,
            upgrade_id,
            timeout_minutes,
        } => {
            let repo = repo(&target).await?;
            let deadline = tokio::time::Instant::now() + Duration::from_secs(timeout_minutes * 60);
            let id = UpgradeId::new(upgrade_id);
            let mut seen: HashMap<String, String> = HashMap::new();
            loop {
                let (upgrade, computers) = repo
                    .upgrade(id)
                    .await?
                    .ok_or_else(|| rootcause::report!("no upgrade {upgrade_id}"))?;
                report_changes(&upgrade, &computers, &mut seen);
                if finished(&upgrade, &computers) {
                    summary(&upgrade, &computers);
                    return succeeded(&upgrade, &computers)
                        .then_some(())
                        .ok_or_else(|| rootcause::report!("the upgrade did not succeed"));
                }
                if tokio::time::Instant::now() >= deadline {
                    summary(&upgrade, &computers);
                    return Err(rootcause::report!(
                        "the upgrade is still {} after {timeout_minutes} minutes; the control plane carries on",
                        upgrade.state
                    ));
                }
                tokio::time::sleep(POLL).await;
            }
        }
    }
}

async fn repo(target: &Target) -> Result<PgComputerRepo, Report> {
    let Environment::Dev = target.environment;
    let url = std::fs::read_to_string(&target.database_url_file)?;
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(2)
        .connect(url.trim())
        .await?;
    // Image upgrades read no billing; the repository needs a policy anyway.
    let policy = BillingPolicy::from_days(30, 7)?;
    Ok(PgComputerRepo::new(pool, policy))
}

fn finished(upgrade: &ImageUpgrade, computers: &[ComputerUpgrade]) -> bool {
    hosted_runtimes::domain::image_upgrade::is_finished(upgrade, computers)
}

fn succeeded(upgrade: &ImageUpgrade, computers: &[ComputerUpgrade]) -> bool {
    upgrade.state == UpgradeState::Done
        && computers.iter().all(|computer| {
            matches!(
                computer.state,
                ComputerUpgradeState::Upgraded | ComputerUpgradeState::Skipped
            )
        })
}

fn report_changes(
    upgrade: &ImageUpgrade,
    computers: &[ComputerUpgrade],
    seen: &mut HashMap<String, String>,
) {
    let mut lines = vec![(
        "upgrade".to_owned(),
        format!(
            "upgrade {} {}{}",
            upgrade.image,
            upgrade.state,
            upgrade
                .error
                .as_deref()
                .map(|error| format!(": {error}"))
                .unwrap_or_default()
        ),
    )];
    for computer in computers {
        lines.push((computer.computer_id.to_string(), line(computer)));
    }
    for (key, line) in lines {
        if seen.get(&key) != Some(&line) {
            eprintln!("{} {line}", chrono::Utc::now().format("%H:%M:%SZ"));
            seen.insert(key, line);
        }
    }
}

fn line(computer: &ComputerUpgrade) -> String {
    format!(
        "computer {} {}: {} -> {}{}",
        computer.computer_id,
        computer.state,
        computer
            .old_image
            .as_ref()
            .map_or("?", |image| image.as_str()),
        computer.new_image.as_str(),
        computer
            .error
            .as_deref()
            .map(|error| format!(" ({error})"))
            .unwrap_or_default()
    )
}

fn summary(upgrade: &ImageUpgrade, computers: &[ComputerUpgrade]) {
    println!(
        "upgrade {} of {}: {}",
        upgrade.id, upgrade.image, upgrade.state
    );
    if let Some(error) = &upgrade.error {
        println!("  {error}");
    }
    for computer in computers {
        println!("  {}", line(computer));
    }
}
