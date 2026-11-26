//! [`Replicas`] with the `zfs` command, and [`Peers`] as TCP connections
//! over the WireGuard mesh between hosts.
//!
//! Datasets under the agent's parent (`storage.disks.dataset`):
//! `computers/<id>` (live), `staging/<id>` (moving), `bases/<guid>` (golden
//! snapshots received from other hosts, which staged computers are clones
//! of). Children inherit their parent's mountpoint, so each one's files are
//! where `outbound::layout` says.

use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};

use firecracker_host_api::ComputerId;
use firecracker_host_api::moves::PeerSnapshot;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

use crate::domain::moves::{Origin, Peers, Place, Replicas, SNAPSHOT_PREFIX, SendFrom};
use crate::outbound::zfs::COMPUTER_RECORDSIZE;

/// A `zfs` command or a stream failed.
#[derive(Debug, thiserror::Error)]
pub enum ReplicationError {
    /// The command failed.
    #[error("{command} failed: {message}")]
    Command {
        /// The command line.
        command: String,
        /// Its stderr, or why it did not run.
        message: String,
    },
    /// Copying the stream.
    #[error("{action}: {source}")]
    Stream {
        /// What.
        action: &'static str,
        /// Why.
        source: std::io::Error,
    },
    /// Output that does not parse.
    #[error("unexpected output of {command}: {output}")]
    Output {
        /// The command line.
        command: String,
        /// What it printed.
        output: String,
    },
}

const STREAM_BUFFER_BYTES: usize = 1024 * 1024;

/// The agent's datasets.
#[derive(Debug, Clone)]
pub struct ZfsReplicas {
    parent: String,
}

impl ZfsReplicas {
    /// Datasets under `parent`.
    pub fn new(parent: &str) -> Self {
        Self {
            parent: parent.to_owned(),
        }
    }

    fn dataset(&self, place: Place, computer_id: ComputerId) -> String {
        match place {
            Place::Live => format!("{}/computers/{computer_id}", self.parent),
            Place::Staged => format!("{}/staging/{computer_id}", self.parent),
        }
    }

    fn bases_dataset(&self) -> String {
        format!("{}/bases", self.parent)
    }

    async fn exists(&self, dataset: &str) -> Result<bool, ReplicationError> {
        let output = run("zfs", &["list", "-H", "-o", "name", dataset]).await;
        match output {
            Ok(_) => Ok(true),
            Err(ReplicationError::Command { message, .. })
                if message.contains("does not exist") =>
            {
                Ok(false)
            }
            Err(error) => Err(error),
        }
    }

    async fn ensure_parent(&self, child: &str) -> Result<(), ReplicationError> {
        let dataset = format!("{}/{child}", self.parent);
        if !self.exists(&dataset).await? {
            run("zfs", &["create", "-p", &dataset]).await?;
        }
        Ok(())
    }

    async fn base_snapshot(&self, guid: u64) -> Result<Option<String>, ReplicationError> {
        let bases = self.bases_dataset();
        if !self.exists(&bases).await? {
            return Ok(None);
        }
        let listing = run(
            "zfs",
            &[
                "list",
                "-H",
                "-p",
                "-t",
                "snapshot",
                "-o",
                "name,guid",
                "-r",
                &bases,
            ],
        )
        .await?;
        Ok(parse_snapshots(&listing)
            .into_iter()
            .find(|(_, snapshot_guid)| *snapshot_guid == guid)
            .map(|(name, _)| name))
    }
}

impl Replicas for ZfsReplicas {
    type Err = ReplicationError;

    async fn snapshots(
        &self,
        place: Place,
        computer_id: ComputerId,
    ) -> Result<Vec<PeerSnapshot>, ReplicationError> {
        let dataset = self.dataset(place, computer_id);
        if !self.exists(&dataset).await? {
            return Ok(Vec::new());
        }
        let listing = run(
            "zfs",
            &[
                "list",
                "-H",
                "-p",
                "-t",
                "snapshot",
                "-o",
                "name,guid",
                "-s",
                "createtxg",
                "-d",
                "1",
                &dataset,
            ],
        )
        .await?;
        Ok(parse_snapshots(&listing)
            .into_iter()
            .filter_map(|(name, guid)| {
                name.split_once('@').map(|(_, name)| PeerSnapshot {
                    name: name.to_owned(),
                    guid,
                })
            })
            .collect())
    }

    async fn origin(
        &self,
        place: Place,
        computer_id: ComputerId,
    ) -> Result<Option<Origin>, ReplicationError> {
        let dataset = self.dataset(place, computer_id);
        let origin = run(
            "zfs",
            &["get", "-H", "-p", "-o", "value", "origin", &dataset],
        )
        .await?;
        let origin = origin.trim();
        if origin.is_empty() || origin == "-" {
            return Ok(None);
        }
        Ok(Some(Origin {
            full_name: origin.to_owned(),
            guid: guid(origin).await?,
        }))
    }

    async fn snapshot(
        &self,
        place: Place,
        computer_id: ComputerId,
        name: &str,
    ) -> Result<u64, ReplicationError> {
        let snapshot = format!("{}@{name}", self.dataset(place, computer_id));
        run("zfs", &["snapshot", &snapshot]).await?;
        guid(&snapshot).await
    }

    async fn send(
        &self,
        place: Place,
        computer_id: ComputerId,
        from: &SendFrom,
        snapshot: &str,
        sink: &mut (impl AsyncWrite + Unpin + Send),
        progress: &AtomicU64,
    ) -> Result<(), ReplicationError> {
        let target = format!("{}@{snapshot}", self.dataset(place, computer_id));
        let arguments: Vec<String> = match from {
            SendFrom::Nothing => vec!["send".into(), "-c".into(), target],
            SendFrom::Snapshot(name) => {
                vec![
                    "send".into(),
                    "-c".into(),
                    "-i".into(),
                    format!("@{name}"),
                    target,
                ]
            }
            SendFrom::Origin(full_name) => {
                vec![
                    "send".into(),
                    "-c".into(),
                    "-i".into(),
                    full_name.clone(),
                    target,
                ]
            }
            SendFrom::Resume(token) => vec!["send".into(), "-t".into(), token.clone()],
        };
        stream_out(&arguments, sink, progress).await
    }

    async fn send_base(
        &self,
        origin: &Origin,
        sink: &mut (impl AsyncWrite + Unpin + Send),
        progress: &AtomicU64,
    ) -> Result<(), ReplicationError> {
        let arguments = vec!["send".into(), "-c".into(), origin.full_name.clone()];
        stream_out(&arguments, sink, progress).await
    }

    async fn receive(
        &self,
        computer_id: ComputerId,
        origin_guid: Option<u64>,
        source: &mut (impl AsyncRead + Unpin + Send),
    ) -> Result<(), ReplicationError> {
        self.ensure_parent("staging").await?;
        let dataset = self.dataset(Place::Staged, computer_id);
        let recordsize = format!("recordsize={COMPUTER_RECORDSIZE}");
        let mut arguments: Vec<String> = vec![
            "receive".into(),
            "-s".into(),
            "-u".into(),
            "-o".into(),
            recordsize,
        ];
        match origin_guid {
            Some(guid) => {
                let base =
                    self.base_snapshot(guid)
                        .await?
                        .ok_or_else(|| ReplicationError::Command {
                            command: "zfs receive".to_owned(),
                            message: format!("no base with guid {guid} on this host"),
                        })?;
                arguments.extend(["-o".into(), format!("origin={base}")]);
            }
            // Later rounds roll back anything written since the last one
            // (nothing should be: a staged copy is never served).
            None => arguments.push("-F".into()),
        }
        arguments.push(dataset);
        stream_in(&arguments, source).await
    }

    async fn receive_base(
        &self,
        guid: u64,
        source: &mut (impl AsyncRead + Unpin + Send),
    ) -> Result<(), ReplicationError> {
        self.ensure_parent("bases").await?;
        let dataset = format!("{}/{guid}", self.bases_dataset());
        let arguments = vec!["receive".into(), "-u".into(), dataset];
        stream_in(&arguments, source).await
    }

    async fn bases(&self) -> Result<Vec<u64>, ReplicationError> {
        let bases = self.bases_dataset();
        if !self.exists(&bases).await? {
            return Ok(Vec::new());
        }
        let listing = run(
            "zfs",
            &[
                "list",
                "-H",
                "-p",
                "-t",
                "snapshot",
                "-o",
                "name,guid",
                "-r",
                &bases,
            ],
        )
        .await?;
        Ok(parse_snapshots(&listing)
            .into_iter()
            .map(|(_, guid)| guid)
            .collect())
    }

    async fn resume_token(
        &self,
        computer_id: ComputerId,
    ) -> Result<Option<String>, ReplicationError> {
        let dataset = self.dataset(Place::Staged, computer_id);
        if !self.exists(&dataset).await? {
            return Ok(None);
        }
        let token = run(
            "zfs",
            &[
                "get",
                "-H",
                "-p",
                "-o",
                "value",
                "receive_resume_token",
                &dataset,
            ],
        )
        .await?;
        let token = token.trim();
        Ok((!token.is_empty() && token != "-").then(|| token.to_owned()))
    }

    async fn stage(&self, computer_id: ComputerId) -> Result<(), ReplicationError> {
        self.ensure_parent("staging").await?;
        let live = self.dataset(Place::Live, computer_id);
        let staged = self.dataset(Place::Staged, computer_id);
        if self.exists(&staged).await? && !self.exists(&live).await? {
            return Ok(());
        }
        run("zfs", &["rename", &live, &staged]).await.map(drop)
    }

    async fn unstage(
        &self,
        computer_id: ComputerId,
        refquota_bytes: u64,
    ) -> Result<(), ReplicationError> {
        let live = self.dataset(Place::Live, computer_id);
        let staged = self.dataset(Place::Staged, computer_id);
        if !self.exists(&live).await? {
            run("zfs", &["rename", &staged, &live]).await?;
        }
        let refquota = format!("refquota={refquota_bytes}");
        run("zfs", &["set", &refquota, &live]).await?;
        let mounted = run("zfs", &["get", "-H", "-o", "value", "mounted", &live]).await?;
        if mounted.trim() != "yes" {
            run("zfs", &["mount", &live]).await?;
        }
        Ok(())
    }

    async fn mount_staged(&self, computer_id: ComputerId) -> Result<(), ReplicationError> {
        let staged = self.dataset(Place::Staged, computer_id);
        let mounted = run("zfs", &["get", "-H", "-o", "value", "mounted", &staged]).await?;
        if mounted.trim() != "yes" {
            run("zfs", &["mount", &staged]).await?;
        }
        Ok(())
    }

    async fn staged(&self) -> Result<Vec<ComputerId>, ReplicationError> {
        let staging = format!("{}/staging", self.parent);
        if !self.exists(&staging).await? {
            return Ok(Vec::new());
        }
        let listing = run("zfs", &["list", "-H", "-o", "name", "-d", "1", &staging]).await?;
        Ok(listing
            .lines()
            .filter_map(|name| name.rsplit_once('/'))
            .filter_map(|(_, id)| id.parse().ok())
            .collect())
    }

    async fn drop_staged(&self, computer_id: ComputerId) -> Result<(), ReplicationError> {
        let staged = self.dataset(Place::Staged, computer_id);
        if !self.exists(&staged).await? {
            return Ok(());
        }
        run("zfs", &["destroy", "-r", &staged]).await.map(drop)
    }

    async fn prune(
        &self,
        place: Place,
        computer_id: ComputerId,
        keep: &str,
    ) -> Result<(), ReplicationError> {
        let dataset = self.dataset(place, computer_id);
        for snapshot in self.snapshots(place, computer_id).await? {
            if snapshot.name == keep {
                break;
            }
            if snapshot.name.starts_with(SNAPSHOT_PREFIX) {
                let full = format!("{dataset}@{}", snapshot.name);
                run("zfs", &["destroy", &full]).await?;
            }
        }
        Ok(())
    }
}

/// `name\tguid` lines.
fn parse_snapshots(listing: &str) -> Vec<(String, u64)> {
    listing
        .lines()
        .filter_map(|line| line.split_once('\t'))
        .filter_map(|(name, guid)| Some((name.to_owned(), guid.trim().parse().ok()?)))
        .collect()
}

async fn guid(snapshot: &str) -> Result<u64, ReplicationError> {
    let value = run("zfs", &["get", "-H", "-p", "-o", "value", "guid", snapshot]).await?;
    value.trim().parse().map_err(|_| ReplicationError::Output {
        command: format!("zfs get guid {snapshot}"),
        output: value,
    })
}

async fn run(program: &str, arguments: &[&str]) -> Result<String, ReplicationError> {
    let command = format!("{program} {}", arguments.join(" "));
    let output = tokio::process::Command::new(program)
        .args(arguments)
        .output()
        .await
        .map_err(|error| ReplicationError::Command {
            command: command.clone(),
            message: error.to_string(),
        })?;
    if !output.status.success() {
        return Err(ReplicationError::Command {
            command,
            message: String::from_utf8_lossy(&output.stderr).trim().to_owned(),
        });
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

/// Run `zfs <arguments>` and copy its stdout into `sink`.
async fn stream_out(
    arguments: &[String],
    sink: &mut (impl AsyncWrite + Unpin + Send),
    progress: &AtomicU64,
) -> Result<(), ReplicationError> {
    let command = format!("zfs {}", arguments.join(" "));
    let mut child = tokio::process::Command::new("zfs")
        .args(arguments)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|error| ReplicationError::Command {
            command: command.clone(),
            message: error.to_string(),
        })?;
    let Some(mut stdout) = child.stdout.take() else {
        return Err(ReplicationError::Command {
            command,
            message: "no stdout".to_owned(),
        });
    };
    let mut buffer = vec![0_u8; STREAM_BUFFER_BYTES];
    let copied = async {
        loop {
            let read = stdout.read(&mut buffer).await?;
            if read == 0 {
                break;
            }
            sink.write_all(&buffer[..read]).await?;
            progress.fetch_add(read as u64, Ordering::Relaxed);
        }
        sink.flush().await
    }
    .await;
    let output = child
        .wait_with_output()
        .await
        .map_err(|error| ReplicationError::Command {
            command: command.clone(),
            message: error.to_string(),
        })?;
    if !output.status.success() {
        return Err(ReplicationError::Command {
            command,
            message: String::from_utf8_lossy(&output.stderr).trim().to_owned(),
        });
    }
    copied.map_err(|source| ReplicationError::Stream {
        action: "sending the stream",
        source,
    })
}

/// Run `zfs <arguments>` with `source` on its stdin.
async fn stream_in(
    arguments: &[String],
    source: &mut (impl AsyncRead + Unpin + Send),
) -> Result<(), ReplicationError> {
    let command = format!("zfs {}", arguments.join(" "));
    let mut child = tokio::process::Command::new("zfs")
        .args(arguments)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|error| ReplicationError::Command {
            command: command.clone(),
            message: error.to_string(),
        })?;
    let Some(mut stdin) = child.stdin.take() else {
        return Err(ReplicationError::Command {
            command,
            message: "no stdin".to_owned(),
        });
    };
    let copied = async {
        tokio::io::copy(source, &mut stdin).await?;
        stdin.shutdown().await
    }
    .await;
    drop(stdin);
    let output = child
        .wait_with_output()
        .await
        .map_err(|error| ReplicationError::Command {
            command: command.clone(),
            message: error.to_string(),
        })?;
    if !output.status.success() {
        return Err(ReplicationError::Command {
            command,
            message: String::from_utf8_lossy(&output.stderr).trim().to_owned(),
        });
    }
    copied.map_err(|source| ReplicationError::Stream {
        action: "receiving the stream",
        source,
    })
}

/// Connections to move listeners over the WireGuard mesh.
#[derive(Debug, Clone)]
pub struct TcpPeers {
    connect_timeout: std::time::Duration,
}

impl TcpPeers {
    /// Connections that give up connecting after `connect_timeout`.
    pub fn new(connect_timeout: std::time::Duration) -> Self {
        Self { connect_timeout }
    }
}

impl Peers for TcpPeers {
    type Err = ReplicationError;
    type Connection = tokio::net::TcpStream;

    async fn connect(&self, target: &str) -> Result<tokio::net::TcpStream, ReplicationError> {
        let connecting = tokio::net::TcpStream::connect(target);
        let stream = tokio::time::timeout(self.connect_timeout, connecting)
            .await
            .map_err(|_| ReplicationError::Stream {
                action: "connecting to the target",
                source: std::io::Error::from(std::io::ErrorKind::TimedOut),
            })?
            .map_err(|source| ReplicationError::Stream {
                action: "connecting to the target",
                source,
            })?;
        stream
            .set_nodelay(true)
            .map_err(|source| ReplicationError::Stream {
                action: "configuring the connection",
                source,
            })?;
        Ok(stream)
    }
}
