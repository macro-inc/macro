//! A thin wrapper over the `docker` CLI.
//!
//! The CLI rather than the daemon's HTTP API on purpose: this provider exists
//! for local development, where `docker` is already on PATH and already
//! authenticated, and the verbs below are the whole of what a sandbox needs.
//! Reaching for an API client would add a dependency to buy nothing.
//!
//! Every verb builds its argument list in a pure function so the wiring can be
//! asserted without a daemon — the part that is easy to get wrong is the
//! argument order, not the process spawn.

use std::process::Stdio;
use std::time::Duration;

use super::errors::LocalError;

#[cfg(test)]
mod test;

/// How a container's ports are named to whoever has to dial them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Reachability {
    /// The container joins a Docker network and is dialed by container name.
    ///
    /// The case when the harness itself runs in Compose: a published host port
    /// would be on the host's loopback, which is not this container's, so the
    /// only address that works is one on a network both share.
    Network(String),
    /// The container publishes the sidecar on an ephemeral host port.
    ///
    /// The case when the harness runs natively: there is no shared network, and
    /// the host's loopback is the harness's own.
    PublishedPort,
}

/// One container's identity, as both docker and a dialer need it.
#[derive(Debug, Clone)]
pub struct ContainerRef {
    /// The name docker knows it by, which is also its DNS name on a network.
    pub name: String,
}

/// What a container should be created with.
#[derive(Debug, Clone)]
pub struct RunSpec {
    /// Image to run.
    pub image: String,
    /// Container name, deterministic per session.
    pub name: String,
    /// Labels, including the session label providers look containers up by.
    pub labels: Vec<(String, String)>,
    /// Environment handed to the sandbox.
    pub env: Vec<(String, String)>,
    /// Port the sidecar listens on inside the container.
    pub sidecar_port: u16,
    /// How the sidecar will be reached.
    pub reachability: Reachability,
}

/// Drives the local Docker daemon.
#[derive(Debug, Clone)]
pub struct Docker {
    binary: String,
}

impl Docker {
    /// Wrap a `docker`-compatible binary (`docker`, `podman`, a wrapper).
    #[must_use]
    pub fn new(binary: impl Into<String>) -> Self {
        Self {
            binary: binary.into(),
        }
    }

    /// Whether `image` is present on the daemon.
    pub async fn has_image(&self, image: &str) -> Result<bool, LocalError> {
        let output = self.output(&image_inspect_args(image)).await?;
        Ok(output.status.success())
    }

    /// Create and start a container, returning what to call it.
    pub async fn run(&self, spec: &RunSpec) -> Result<ContainerRef, LocalError> {
        self.run_checked("run", &run_args(spec)).await?;
        Ok(ContainerRef {
            name: spec.name.clone(),
        })
    }

    /// Run one command inside a container, returning its combined output.
    ///
    /// A non-zero exit is returned as output plus status rather than an error:
    /// the readiness recipe's failure is the caller's to report, together with
    /// what the recipe said, and only the caller knows which of its own steps
    /// is allowed to fail.
    pub async fn exec(
        &self,
        container: &ContainerRef,
        command: &str,
        timeout: Duration,
    ) -> Result<(i32, String), LocalError> {
        let args = exec_args(&container.name, command);
        let output = tokio::time::timeout(timeout, self.output(&args))
            .await
            .map_err(|_| LocalError::ExecTimeout {
                container: container.name.clone(),
                seconds: timeout.as_secs(),
            })??;

        let mut combined = String::from_utf8_lossy(&output.stdout).into_owned();
        combined.push_str(&String::from_utf8_lossy(&output.stderr));
        Ok((output.status.code().unwrap_or(-1), combined))
    }

    /// The host port a container publishes `port` on.
    pub async fn published_port(
        &self,
        container: &ContainerRef,
        port: u16,
    ) -> Result<u16, LocalError> {
        let args = port_args(&container.name, port);
        let output = self.run_checked("port", &args).await?;
        let line = output
            .lines()
            .next()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .ok_or_else(|| LocalError::NoPublishedPort {
                container: container.name.clone(),
                port,
            })?;

        parse_published_port(line)
    }

    /// The container carrying `value` for `label`, if one exists.
    pub async fn find_by_label(
        &self,
        label: &str,
        value: &str,
    ) -> Result<Option<ContainerRef>, LocalError> {
        let args = find_by_label_args(label, value);
        let output = self.run_checked("ps", &args).await?;
        Ok(output
            .lines()
            .map(str::trim)
            .find(|line| !line.is_empty())
            .map(|name| ContainerRef {
                name: name.to_owned(),
            }))
    }

    /// Every container carrying `label`, running or not.
    pub async fn find_all_by_label_key(
        &self,
        label: &str,
    ) -> Result<Vec<ContainerRef>, LocalError> {
        let args = find_all_by_label_key_args(label);
        let output = self.run_checked("ps", &args).await?;
        Ok(output
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .map(|name| ContainerRef {
                name: name.to_owned(),
            })
            .collect())
    }

    /// Start a container that exists but is stopped.
    pub async fn start(&self, container: &ContainerRef) -> Result<(), LocalError> {
        self.run_checked("start", &["start".to_owned(), container.name.clone()])
            .await?;
        Ok(())
    }

    /// Remove a container for good, running or not.
    pub async fn remove(&self, container: &ContainerRef) -> Result<(), LocalError> {
        self.run_checked(
            "rm",
            &["rm".to_owned(), "-f".to_owned(), container.name.clone()],
        )
        .await?;
        Ok(())
    }

    /// Run a docker subcommand and fail on any non-zero exit.
    async fn run_checked(&self, command: &str, args: &[String]) -> Result<String, LocalError> {
        let output = self.output(args).await?;
        if !output.status.success() {
            return Err(LocalError::Command {
                command: command.to_owned(),
                status: output.status.code().unwrap_or(-1),
                stderr: String::from_utf8_lossy(&output.stderr).trim().to_owned(),
            });
        }
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    }

    async fn output(&self, args: &[String]) -> Result<std::process::Output, LocalError> {
        tokio::process::Command::new(&self.binary)
            .args(args)
            .stdin(Stdio::null())
            .output()
            .await
            .map_err(|source| LocalError::Spawn {
                binary: self.binary.clone(),
                source,
            })
    }
}

/// `docker run` for one sandbox.
///
/// `sleep infinity` replaces the image's own `CMD`: the image's command is an
/// interactive `bash`, which exits at once without a TTY, and the container has
/// to outlive its own entrypoint for `docker exec` to have anything to enter.
fn run_args(spec: &RunSpec) -> Vec<String> {
    let mut args = vec![
        "run".to_owned(),
        "--detach".to_owned(),
        "--name".to_owned(),
        spec.name.clone(),
    ];

    for (key, value) in &spec.labels {
        args.push("--label".to_owned());
        args.push(format!("{key}={value}"));
    }
    for (key, value) in &spec.env {
        args.push("--env".to_owned());
        args.push(format!("{key}={value}"));
    }

    match &spec.reachability {
        Reachability::Network(network) => {
            args.push("--network".to_owned());
            args.push(network.clone());
        }
        Reachability::PublishedPort => {
            args.push("--publish".to_owned());
            // Host port 0 asks the daemon for an unused one, so parallel
            // sessions never collide; loopback-only, because nothing outside
            // this machine has any business reaching a sandbox.
            args.push(format!("127.0.0.1::{}", spec.sidecar_port));
        }
    }

    args.push(spec.image.clone());
    args.push("sleep".to_owned());
    args.push("infinity".to_owned());
    args
}

/// `docker exec` running one shell command.
///
/// A login shell, matching the Daytona provider: the image puts its baked nix
/// dev shell on `PATH` through `BASH_ENV`, which a non-login shell would skip.
fn exec_args(name: &str, command: &str) -> Vec<String> {
    vec![
        "exec".to_owned(),
        name.to_owned(),
        "bash".to_owned(),
        "-lc".to_owned(),
        command.to_owned(),
    ]
}

fn port_args(name: &str, port: u16) -> Vec<String> {
    vec!["port".to_owned(), name.to_owned(), format!("{port}/tcp")]
}

fn find_by_label_args(label: &str, value: &str) -> Vec<String> {
    vec![
        "ps".to_owned(),
        // Stopped containers count: a resume is precisely the case where the
        // container exists and is not running.
        "--all".to_owned(),
        "--filter".to_owned(),
        format!("label={label}={value}"),
        "--format".to_owned(),
        "{{.Names}}".to_owned(),
    ]
}

fn find_all_by_label_key_args(label: &str) -> Vec<String> {
    vec![
        "ps".to_owned(),
        "--all".to_owned(),
        "--filter".to_owned(),
        format!("label={label}"),
        "--format".to_owned(),
        "{{.Names}}".to_owned(),
    ]
}

fn image_inspect_args(image: &str) -> Vec<String> {
    vec!["image".to_owned(), "inspect".to_owned(), image.to_owned()]
}

/// Read the host port out of one `docker port` line.
///
/// Docker prints `0.0.0.0:32768` or `[::1]:32768`, so the port is what follows
/// the *last* colon — splitting on the first would take an IPv6 address apart.
fn parse_published_port(line: &str) -> Result<u16, LocalError> {
    line.rsplit_once(':')
        .and_then(|(_host, port)| port.trim().parse().ok())
        .ok_or_else(|| LocalError::UnreadablePort {
            output: line.to_owned(),
        })
}
