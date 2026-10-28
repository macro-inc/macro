//! Composition root and CLI for our own direct-OAuth feasibility binary.

use clap::{Parser, Subcommand};
use codex_cloud_agents::domain::cloud::{CloudId, Launch};
use codex_cloud_agents::domain::{Probe, unix_now};
use codex_cloud_agents::outbound::openai::OpenAi;
use credentials::JsonStore;
#[path = "credentials.rs"]
mod credentials;
use std::io::Write as _;
use std::path::PathBuf;
use std::process::ExitCode;

#[cfg(test)]
#[path = "main/test.rs"]
mod test;

#[derive(Parser)]
#[command(
    version,
    about = "Direct ChatGPT OAuth and cloud-task probe. Only launch starts cloud work."
)]
struct Args {
    /// Private directory for credentials.json (separate from ~/.codex).
    #[arg(long)]
    state_dir: PathBuf,
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Start our device-code OAuth flow; open the printed link and enter its code.
    Login,
    /// Print safe local connection metadata. Does not validate with OpenAI.
    Status,
    /// Read cloud environment IDs/labels, refreshing credentials if needed.
    Environments,
    /// Submit one cloud task. This executes work using the connected account.
    Launch {
        #[arg(long)]
        environment: String,
        #[arg(long)]
        branch: String,
        /// UTF-8 text file; avoids putting the prompt in shell history/arguments.
        #[arg(long)]
        prompt_file: PathBuf,
        /// Follow changed snapshots as NDJSON after creation (polling, not token streaming).
        #[arg(long)]
        stream: bool,
    },
    /// Resume changed-snapshot output for an existing task without launching work.
    Stream { task: String },
    /// Print one projected snapshot (current turns, not full history).
    Inspect { task: String },
    /// Print timestamped JSON snapshots. Ctrl-C stops watching, not remote work.
    Watch {
        task: String,
        #[arg(long, default_value_t = 120, value_parser = clap::value_parser!(u32).range(1..=720))]
        samples: u32,
        #[arg(long, default_value_t = 5, value_parser = clap::value_parser!(u32).range(1..=3600))]
        interval_seconds: u32,
    },
    /// Delete this probe's credentials. Does not revoke OpenAI access or stop tasks.
    Logout,
}

#[tokio::main]
async fn main() -> ExitCode {
    match run(Args::parse()).await {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("codex-cloud-probe: {error}");
            ExitCode::FAILURE
        }
    }
}

async fn run(args: Args) -> Result<(), rootcause::Report> {
    let store = JsonStore::open(&args.state_dir)?;
    let probe = Probe::new(OpenAi::new()?, store);
    match args.command {
        Command::Login => {
            let login = probe.begin_login().await?;
            println!(
                "Open {}\nEnter code: {}",
                login.verification_url, login.user_code
            );
            println!(
                "Waiting for OpenAI verification (up to {} seconds). Ctrl-C cancels local login.",
                login.timeout.as_secs()
            );
            tokio::select! {
                result = probe.finish_login(&login) => result?,
                signal = tokio::signal::ctrl_c() => {
                    signal?;
                    return Err(rootcause::report!("login cancelled; no credentials saved"));
                }
            }
            println!(
                "Connected. Credentials saved in {}",
                args.state_dir.join("credentials.json").display()
            );
            println!("No cloud task was launched. Run status or environments next.");
        }
        Command::Status => {
            let output = match probe.status()? {
                None => serde_json::json!({"connected": false}),
                Some(credentials) => serde_json::json!({
                    "connected": true,
                    "account_id": credentials.account_id,
                    "expires_at": credentials.expires_at,
                    "access_token_expired": credentials.expires_at <= unix_now()?,
                    "verification": "local metadata only; use environments for an authenticated cloud read",
                }),
            };
            println!("{}", serde_json::to_string_pretty(&output)?);
        }
        Command::Environments => {
            let environments = probe.environments(unix_now()?).await?;
            println!("{}", serde_json::to_string_pretty(&environments)?);
        }
        Command::Launch {
            environment,
            branch,
            prompt_file,
            stream,
        } => {
            use std::io::Read as _;
            let mut prompt = String::new();
            std::fs::File::open(prompt_file)?
                .take(64 * 1024 + 1)
                .read_to_string(&mut prompt)?;
            let request = Launch {
                environment: CloudId::new(environment)?,
                branch,
                prompt,
            };
            let created = probe.launch(&request, unix_now()?).await?;
            if stream {
                // Flush the receipt before the first read so observation errors cannot hide it.
                println!("{}", serde_json::json!({"event":"created", "task":created}));
                std::io::stdout().flush()?;
                stream_task(&probe, &created.task_id).await?;
            } else {
                println!("{}", serde_json::to_string_pretty(&created)?);
            }
        }
        Command::Stream { task } => {
            stream_task(&probe, &CloudId::new(task)?).await?;
        }
        Command::Inspect { task } => {
            let task = CloudId::new(task)?;
            println!(
                "{}",
                serde_json::to_string_pretty(&probe.snapshot(&task, unix_now()?).await?)?
            );
        }
        Command::Watch {
            task,
            samples,
            interval_seconds,
        } => {
            let task = CloudId::new(task)?;
            let watch = async {
                for index in 0..samples {
                    let snapshot = probe.snapshot(&task, unix_now()?).await?;
                    println!(
                        "{}",
                        serde_json::to_string(
                            &serde_json::json!({"observed_at": unix_now()?, "snapshot": snapshot})
                        )?
                    );
                    if snapshot.terminal() {
                        return Ok::<(), rootcause::Report>(());
                    }
                    if index + 1 < samples {
                        tokio::time::sleep(std::time::Duration::from_secs(u64::from(
                            interval_seconds,
                        )))
                        .await;
                    }
                }
                eprintln!("Sample limit reached. Remote work may still be running.");
                Ok(())
            };
            tokio::select! {
                result = watch => result?,
                signal = tokio::signal::ctrl_c() => {
                    signal?;
                    eprintln!("Stopped watching. Remote work was not cancelled.");
                }
            }
        }
        Command::Logout => {
            probe.logout()?;
            println!(
                "Local credentials removed. OpenAI access was not revoked; remote tasks were not stopped."
            );
        }
    }
    Ok(())
}

/// Remember only the last observation, including text replacements and status-only changes.
#[derive(Default)]
struct Changes {
    previous: Option<serde_json::Value>,
}

impl Changes {
    fn observe(&mut self, snapshot: serde_json::Value) -> Option<serde_json::Value> {
        if self.previous.as_ref() == Some(&snapshot) {
            return None;
        }
        self.previous = Some(snapshot.clone());
        Some(snapshot)
    }
}

async fn stream_task(
    probe: &Probe<OpenAi, JsonStore>,
    task: &CloudId,
) -> Result<(), rootcause::Report> {
    eprintln!(
        "Polling every 1 second. Text appears when exposed by the cloud API. Ctrl-C stops observation only."
    );
    let follow = async {
        let mut changes = Changes::default();
        loop {
            let snapshot = probe.snapshot(task, unix_now()?).await?;
            let terminal = snapshot.terminal();
            let failed = matches!(
                snapshot.assistant_status.as_deref(),
                Some("failed" | "cancelled")
            );
            if let Some(snapshot) = changes.observe(serde_json::to_value(&snapshot)?) {
                println!(
                    "{}",
                    serde_json::json!({"event":"snapshot", "observed_at":unix_now()?, "snapshot":snapshot})
                );
                std::io::stdout().flush()?;
            }
            if terminal {
                if failed {
                    return Err(rootcause::report!(
                        "cloud task failed or was cancelled; see the last snapshot and Codex web"
                    ));
                }
                return Ok::<(), rootcause::Report>(());
            }
            tokio::time::sleep(std::time::Duration::from_secs(5)).await;
        }
    };
    tokio::select! {
        result = follow => result,
        signal = tokio::signal::ctrl_c() => {
            signal?;
            eprintln!("Stopped streaming. Remote work was not cancelled. Resume with: stream {}", task.as_str());
            Ok(())
        }
    }
}
