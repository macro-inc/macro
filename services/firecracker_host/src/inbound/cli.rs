//! `firecracker-host client ...`: drive an agent from a shell (operators,
//! the end-to-end harness), through `firecracker_host_api::client`.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::time::Duration;

use clap::Subcommand;
use firecracker_host_api::client::{HostClient, HostEndpoint};
use firecracker_host_api::exec::{ExecRequest, Frame};
use firecracker_host_api::moves::{
    AdoptComputer, ExpectMove, MoveTicket, Replicate, ReplicationState,
};
use firecracker_host_api::{
    Action, ComputerId, ComputerResources, ComputerRole, ControlPlaneId, CreateComputer,
    EnrollmentDocument, EnrollmentGeneration, GoldenKey, GuestImage, PairingId, SetEnrollment,
};
use rootcause::Report;
use serde::Deserialize;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

/// The guest's `macro` user and its environment, as `hosted_runtimes`'
/// `GUEST_USER`.
const GUEST_UID: u32 = 1000;
const GUEST_HOME: &str = "/home/macro";
const GUEST_PATH: &str = "/run/wrappers/bin:/run/current-system/sw/bin";
/// How often `replicate` asks whether its round ended (a CLI waiting on a
/// remote job; the agent has no push channel to the CLI).
const REPLICATION_POLL: Duration = Duration::from_millis(250);

/// The endpoint file: where the agent is and the PEM files to reach it.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct EndpointFile {
    url: String,
    client_certificate: PathBuf,
    client_key: PathBuf,
    server_certificate: PathBuf,
}

/// `--role`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, clap::ValueEnum)]
pub enum Role {
    /// A person's computer.
    Person,
    /// An agent teammate's computer.
    Agent,
}

/// One client request.
#[derive(Debug, Subcommand)]
pub enum ClientCommand {
    /// Host capacity, memory, goldens.
    Host,
    /// Every golden.
    Goldens,
    /// Build a golden unless it exists.
    BuildGolden {
        #[arg(long)]
        image: String,
        #[arg(long)]
        vcpus: u8,
        #[arg(long)]
        memory_mib: u32,
    },
    /// Every computer.
    List,
    /// One computer.
    Get { computer_id: ComputerId },
    /// Create a computer unless it exists.
    Create {
        computer_id: ComputerId,
        #[arg(long)]
        image: String,
        #[arg(long, default_value_t = 2)]
        vcpus: u8,
        #[arg(long, default_value_t = 2048)]
        memory_mib: u32,
        #[arg(long, default_value_t = 20)]
        root_disk_gib: u32,
        #[arg(long, default_value_t = 10)]
        home_disk_gib: u32,
        /// A JSON enrollment document; `{}` when absent.
        #[arg(long)]
        enrollment_file: Option<PathBuf>,
        #[arg(long, default_value_t = 1)]
        generation: u32,
        #[arg(long)]
        pairing_id: Option<PairingId>,
        #[arg(long, default_value = "cli")]
        control_plane_id: String,
        /// Leave it stopped.
        #[arg(long)]
        stopped: bool,
        /// Whom the computer is for.
        #[arg(long, value_enum, default_value_t = Role::Person)]
        role: Role,
        /// Answer once the guest agent answers, before macro-restore ends.
        #[arg(long)]
        return_when_resumed: bool,
    },
    /// Replace the enrollment.
    SetEnrollment {
        computer_id: ComputerId,
        #[arg(long)]
        enrollment_file: PathBuf,
        #[arg(long)]
        generation: u32,
        #[arg(long)]
        pairing_id: PairingId,
    },
    /// Remove the enrollment.
    ClearEnrollment { computer_id: ComputerId },
    /// Start (cold boot, wake or resume).
    Start { computer_id: ComputerId },
    /// Clean shutdown.
    Stop { computer_id: ComputerId },
    /// Stop, then start.
    Restart { computer_id: ComputerId },
    /// Pause in RAM.
    Freeze { computer_id: ComputerId },
    /// Resume from a freeze.
    Unfreeze { computer_id: ComputerId },
    /// Snapshot to disk and end the process.
    Hibernate { computer_id: ComputerId },
    /// Destroy the computer and its disks.
    Destroy { computer_id: ComputerId },
    /// On the target: accept the computer from a source holding `ticket`
    /// (e.g. `openssl rand -hex 32`).
    ExpectMove {
        computer_id: ComputerId,
        #[arg(long)]
        ticket: String,
        #[arg(long, default_value_t = 24 * 60)]
        expires_in_minutes: i64,
    },
    /// On the source: one replication round to the target's move
    /// listener (`address:port` on the host mesh); waits for it to end.
    Replicate {
        computer_id: ComputerId,
        #[arg(long)]
        target: String,
        #[arg(long)]
        ticket: String,
    },
    /// On the source: the last replication round.
    Replication { computer_id: ComputerId },
    /// On the source: shut the guest down and stage it (the next round is
    /// the final one).
    Release { computer_id: ComputerId },
    /// On the target: serve the staged computer (stopped).
    Adopt {
        computer_id: ComputerId,
        #[arg(long)]
        control_plane_id: String,
        #[arg(long)]
        generation: u32,
    },
    /// What this host holds of a moving computer.
    MoveHolding { computer_id: ComputerId },
    /// Drop the staged copy (never the live computer).
    DropStaged { computer_id: ComputerId },
    /// Run a program in the guest; stdin, stdout and stderr pass through and
    /// the exit code is ours.
    Exec {
        computer_id: ComputerId,
        /// As root instead of the guest's `macro` user.
        #[arg(long)]
        root: bool,
        #[arg(trailing_var_arg = true, required = true)]
        argv: Vec<String>,
    },
}

/// Why a client command failed: the agent's answer, shown by its Display
/// (`goldenNotReady: ...`) so scripts can match the wire code, or anything
/// local.
#[derive(Debug, thiserror::Error)]
enum CommandError {
    #[error("{0}")]
    Client(#[from] firecracker_host_api::client::ClientError),
    #[error("{0}")]
    Local(Report),
}

impl From<Report> for CommandError {
    fn from(report: Report) -> Self {
        Self::Local(report)
    }
}

impl From<std::io::Error> for CommandError {
    fn from(error: std::io::Error) -> Self {
        Self::Local(Report::new(error).into_dynamic())
    }
}

impl From<toml::de::Error> for CommandError {
    fn from(error: toml::de::Error) -> Self {
        Self::Local(Report::new(error).into_dynamic())
    }
}

impl From<serde_json::Error> for CommandError {
    fn from(error: serde_json::Error) -> Self {
        Self::Local(Report::new(error).into_dynamic())
    }
}

/// Run `command` against the agent in `endpoint`; returns the exit code.
pub async fn run(endpoint: PathBuf, command: ClientCommand) -> Result<i32, Report> {
    match run_command(endpoint, command).await {
        Ok(code) => Ok(code),
        Err(CommandError::Client(error)) => Err(rootcause::report!("{error}")),
        Err(CommandError::Local(report)) => Err(report),
    }
}

async fn run_command(endpoint: PathBuf, command: ClientCommand) -> Result<i32, CommandError> {
    let text = std::fs::read_to_string(&endpoint)?;
    let file: EndpointFile = toml::from_str(&text)?;
    let client = HostClient::new(&HostEndpoint {
        url: file.url,
        client_certificate_pem: std::fs::read_to_string(&file.client_certificate)?,
        client_key_pem: std::fs::read_to_string(&file.client_key)?.into(),
        server_certificate_pem: std::fs::read_to_string(&file.server_certificate)?,
        connect_timeout: Duration::from_secs(10),
        request_timeout: Duration::from_secs(600),
    })?;

    let printed = match command {
        ClientCommand::Host => json(&client.host().await?)?,
        ClientCommand::Goldens => json(&client.goldens().await?)?,
        ClientCommand::BuildGolden {
            image,
            vcpus,
            memory_mib,
        } => json(
            &client
                .build_golden(&GoldenKey {
                    image: image_name(&image)?,
                    vcpus,
                    memory_mib,
                })
                .await?,
        )?,
        ClientCommand::List => json(&client.computers().await?)?,
        ClientCommand::Get { computer_id } => json(&client.computer(computer_id).await?)?,
        ClientCommand::Create {
            computer_id,
            image,
            vcpus,
            memory_mib,
            root_disk_gib,
            home_disk_gib,
            enrollment_file,
            generation,
            pairing_id,
            control_plane_id,
            stopped,
            role,
            return_when_resumed,
        } => {
            let enrollment = match enrollment_file {
                Some(path) => serde_json::from_slice(&std::fs::read(path)?)?,
                None => serde_json::json!({}),
            };
            let request = CreateComputer {
                control_plane_id: ControlPlaneId::try_new(&control_plane_id)
                    .map_err(|error| rootcause::report!("{error}"))?,
                generation: EnrollmentGeneration::new(generation),
                pairing_id: pairing_id
                    .unwrap_or_else(|| PairingId::new_from_uuid(uuid::Uuid::now_v7())),
                image: image_name(&image)?,
                role: match role {
                    Role::Person => ComputerRole::Person,
                    Role::Agent => ComputerRole::Agent,
                },
                resources: ComputerResources {
                    vcpus,
                    memory_mib,
                    root_disk_gib,
                    home_disk_gib,
                },
                enrollment: EnrollmentDocument(enrollment),
                start: !stopped,
                return_when_resumed,
            };
            json(&client.create(computer_id, &request).await?)?
        }
        ClientCommand::SetEnrollment {
            computer_id,
            enrollment_file,
            generation,
            pairing_id,
        } => {
            let request = SetEnrollment {
                generation: EnrollmentGeneration::new(generation),
                pairing_id,
                enrollment: EnrollmentDocument(serde_json::from_slice(&std::fs::read(
                    enrollment_file,
                )?)?),
            };
            json(&client.set_enrollment(computer_id, &request).await?)?
        }
        ClientCommand::ClearEnrollment { computer_id } => {
            client.clear_enrollment(computer_id).await?;
            String::new()
        }
        ClientCommand::Start { computer_id } => power(&client, computer_id, Action::Start).await?,
        ClientCommand::Stop { computer_id } => power(&client, computer_id, Action::Stop).await?,
        ClientCommand::Restart { computer_id } => {
            power(&client, computer_id, Action::Restart).await?
        }
        ClientCommand::Freeze { computer_id } => {
            power(&client, computer_id, Action::Freeze).await?
        }
        ClientCommand::Unfreeze { computer_id } => {
            power(&client, computer_id, Action::Unfreeze).await?
        }
        ClientCommand::Hibernate { computer_id } => {
            power(&client, computer_id, Action::Hibernate).await?
        }
        ClientCommand::Destroy { computer_id } => {
            client.destroy(computer_id).await?;
            String::new()
        }
        ClientCommand::ExpectMove {
            computer_id,
            ticket,
            expires_in_minutes,
        } => json(
            &client
                .expect_move(
                    computer_id,
                    &ExpectMove {
                        ticket: MoveTicket::new(ticket),
                        expires_at: chrono::Utc::now()
                            + chrono::Duration::minutes(expires_in_minutes),
                    },
                )
                .await?,
        )?,
        ClientCommand::Replicate {
            computer_id,
            target,
            ticket,
        } => {
            let mut replication = client
                .replicate(
                    computer_id,
                    &Replicate {
                        target,
                        ticket: MoveTicket::new(ticket),
                    },
                )
                .await?;
            while replication.state == ReplicationState::Running {
                tokio::time::sleep(REPLICATION_POLL).await;
                replication = client.replication(computer_id).await?;
            }
            let failed = matches!(replication.state, ReplicationState::Failed { .. });
            println!("{}", json(&replication)?);
            return Ok(i32::from(failed));
        }
        ClientCommand::Replication { computer_id } => {
            json(&client.replication(computer_id).await?)?
        }
        ClientCommand::Release { computer_id } => json(&client.release(computer_id).await?)?,
        ClientCommand::Adopt {
            computer_id,
            control_plane_id,
            generation,
        } => json(
            &client
                .adopt(
                    computer_id,
                    &AdoptComputer {
                        control_plane_id: ControlPlaneId::try_new(&control_plane_id)
                            .map_err(|error| rootcause::report!("{error}"))?,
                        generation: EnrollmentGeneration::new(generation),
                    },
                )
                .await?,
        )?,
        ClientCommand::MoveHolding { computer_id } => {
            json(&client.move_holding(computer_id).await?)?
        }
        ClientCommand::DropStaged { computer_id } => {
            client.drop_staged(computer_id).await?;
            String::new()
        }
        ClientCommand::Exec {
            computer_id,
            root,
            argv,
        } => return exec(&client, computer_id, root, argv).await,
    };
    if !printed.is_empty() {
        println!("{printed}");
    }
    Ok(0)
}

fn image_name(image: &str) -> Result<GuestImage, CommandError> {
    GuestImage::try_new(image).map_err(|error| rootcause::report!("{error}").into())
}

fn json(value: &impl serde::Serialize) -> Result<String, CommandError> {
    Ok(serde_json::to_string_pretty(value)?)
}

async fn power(
    client: &HostClient,
    computer_id: ComputerId,
    action: Action,
) -> Result<String, CommandError> {
    json(&client.power(computer_id, action).await?)
}

async fn exec(
    client: &HostClient,
    computer_id: ComputerId,
    root: bool,
    argv: Vec<String>,
) -> Result<i32, CommandError> {
    let (uid, home) = if root {
        (0, "/root")
    } else {
        (GUEST_UID, GUEST_HOME)
    };
    let request = ExecRequest {
        argv,
        uid,
        gid: uid,
        env: BTreeMap::from([
            ("HOME".to_owned(), home.to_owned()),
            ("PATH".to_owned(), GUEST_PATH.to_owned()),
        ]),
        cwd: home.to_owned(),
        trace_id: None,
    };
    let (mut input, mut output) = client.exec(computer_id, request).await?.split();

    let feed = async move {
        let mut stdin = tokio::io::stdin();
        let mut buffer = vec![0u8; 64 * 1024];
        loop {
            match stdin.read(&mut buffer).await {
                Ok(0) | Err(_) => break,
                Ok(read) => {
                    if input.write_stdin(buffer[..read].to_vec()).await.is_err() {
                        return;
                    }
                }
            }
        }
        let _ = input.close_stdin().await;
        // Keep the session open: closing it would kill the program.
        std::future::pending::<()>().await;
    };
    let relay = async {
        let mut stdout = tokio::io::stdout();
        let mut stderr = tokio::io::stderr();
        loop {
            match output.next().await? {
                Some(Frame::Stdout(bytes)) => {
                    stdout.write_all(&bytes).await?;
                    stdout.flush().await?;
                }
                Some(Frame::Stderr(bytes)) => {
                    stderr.write_all(&bytes).await?;
                    stderr.flush().await?;
                }
                Some(Frame::Exited(code)) => return Ok::<_, CommandError>(code),
                Some(Frame::Failed(message)) => {
                    return Err(rootcause::report!("exec failed: {message}").into());
                }
                Some(_) => {}
                None => return Err(rootcause::report!("the agent closed the exec").into()),
            }
        }
    };
    tokio::select! {
        () = feed => Err(rootcause::report!("stdin relay ended").into()),
        code = relay => code,
    }
}
