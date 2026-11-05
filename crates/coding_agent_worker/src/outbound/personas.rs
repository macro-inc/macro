//! Systemd and loopback-health adapters for enrolled brain personas.

use std::io::Read as _;
use std::num::NonZeroU16;
use std::path::Path;
use std::process::{Output, Stdio};
use std::time::Duration;

use chrono::{DateTime, Utc};
use harnesses::domain::models::PersonaHealth;
use nom::{
    Parser as _, bytes::complete::take_till1, character::complete::char, combinator::rest,
    sequence::separated_pair,
};
use serde::Deserialize;
use tokio::io::AsyncReadExt as _;
use tokio::process::Command;

use crate::domain::personas::{
    HealthProbe, Personas, UnitAction, UnitController, UnitState, valid_os_user,
};

#[cfg(test)]
mod test;

const PERSONA_DIRECTORY: &str = "/etc/macro/personas";
const COMMAND_TIMEOUT: Duration = Duration::from_secs(5);
const HEALTH_TIMEOUT: Duration = Duration::from_secs(2);
const MAX_HEALTH_BYTES: usize = 32 * 1024;
const MAX_ERROR_CHARS: usize = 512;
const MAX_CONFIG_BYTES: usize = 64 * 1024;

#[derive(Debug, thiserror::Error)]
pub(crate) enum PersonaError {
    #[error("persona process or filesystem operation failed")]
    Io(#[from] std::io::Error),
    #[error("persona command timed out")]
    Timeout,
    #[error("persona command failed")]
    Command,
    #[error("invalid persona discovery response")]
    Discovery,
    #[error("invalid brain unit state")]
    UnitState,
    #[error("invalid persona OS username")]
    OsUser,
}

/// Uses the image's existing passwordless sudo for `macro`, never an
/// interactive privilege prompt or a root agent process.
#[derive(Clone, Copy)]
pub(crate) struct Systemd;

impl UnitController for Systemd {
    type Err = PersonaError;

    #[tracing::instrument(name = "macrod.personas.unit_state", skip_all, err)]
    async fn state(&self, os_user: &str) -> Result<UnitState, Self::Err> {
        let unit = unit_name(os_user)?;
        let output = privileged(
            Path::new("/usr/bin/systemctl"),
            &[
                "show",
                "--property=LoadState",
                "--property=ActiveState",
                "--",
                &unit,
            ],
        )
        .await?;
        parse_unit_state(&String::from_utf8_lossy(&output.stdout))
    }

    #[tracing::instrument(name = "macrod.personas.unit_control", skip_all, fields(action = ?action), err)]
    async fn apply(&self, os_user: &str, action: UnitAction) -> Result<(), Self::Err> {
        let unit = unit_name(os_user)?;
        let command = match action {
            UnitAction::Start => "start",
            UnitAction::Restart => {
                // Recover even when systemd's own Restart hit its start limit.
                privileged(
                    Path::new("/usr/bin/systemctl"),
                    &["reset-failed", "--", &unit],
                )
                .await?;
                "restart"
            }
        };
        privileged(
            Path::new("/usr/bin/systemctl"),
            &[command, "--no-block", "--", &unit],
        )
        .await?;
        Ok(())
    }
}

fn unit_name(os_user: &str) -> Result<String, PersonaError> {
    if !valid_os_user(os_user) {
        return Err(PersonaError::OsUser);
    }
    Ok(format!("brain@{os_user}.service"))
}

async fn privileged(program: &Path, args: &[&str]) -> Result<Output, PersonaError> {
    let mut command = if rustix::process::geteuid().is_root() {
        Command::new(crate::executable::launchable(program))
    } else {
        let mut command = Command::new(crate::executable::launchable(Path::new("sudo")));
        command.args(["--non-interactive", "--"]).arg(program);
        command
    };
    command.args(args);
    bounded_command(command, COMMAND_TIMEOUT).await
}

async fn bounded_command(mut command: Command, timeout: Duration) -> Result<Output, PersonaError> {
    command
        .kill_on_drop(true)
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    let mut child = command.spawn()?;
    let mut stdout = child.stdout.take().ok_or(PersonaError::Command)?;
    let output = tokio::time::timeout(timeout, async {
        let mut bytes = Vec::new();
        (&mut stdout)
            .take((MAX_CONFIG_BYTES + 1) as u64)
            .read_to_end(&mut bytes)
            .await?;
        if bytes.len() > MAX_CONFIG_BYTES {
            return Err(PersonaError::Discovery);
        }
        let status = child.wait().await?;
        Ok(Output {
            status,
            stdout: bytes,
            stderr: Vec::new(),
        })
    })
    .await
    .map_err(|_| PersonaError::Timeout)??;
    if !output.status.success() {
        // Stderr may contain environment values; never forward it to the server.
        return Err(PersonaError::Command);
    }
    Ok(output)
}

fn assignment(input: &str) -> nom::IResult<&str, (&str, &str)> {
    separated_pair(take_till1(|c| c == '='), char('='), rest).parse(input)
}

fn parse_unit_state(output: &str) -> Result<UnitState, PersonaError> {
    let mut load = None;
    let mut active = None;
    for line in output.lines() {
        let (_, (key, value)) = assignment(line).map_err(|_| PersonaError::UnitState)?;
        match key {
            "LoadState" => load = Some(value),
            "ActiveState" => active = Some(value),
            _ => {}
        }
    }
    match (load, active) {
        (Some("not-found"), _) => Ok(UnitState::Missing),
        (Some("loaded"), Some("active")) => Ok(UnitState::Active),
        (Some("loaded"), Some("inactive")) => Ok(UnitState::Stopped),
        (Some("loaded"), Some("failed")) => Ok(UnitState::Failed),
        (Some("loaded"), Some("activating" | "deactivating" | "reloading")) => {
            Ok(UnitState::Transitioning)
        }
        _ => Err(PersonaError::UnitState),
    }
}

/// Called by the unprivileged daemon. Only names and health ports return.
#[tracing::instrument(name = "macrod.personas.discover", skip_all, err)]
pub(crate) async fn discover() -> Result<Personas, PersonaError> {
    if rustix::process::geteuid().is_root() {
        return read_personas(Path::new(PERSONA_DIRECTORY));
    }
    let program = std::env::current_exe()?;
    let output = privileged(&program, &["persona-config"]).await?;
    serde_json::from_slice(&output.stdout).map_err(|_| PersonaError::Discovery)
}

/// The hidden root-only command reads private environment files without
/// handing their secrets to the unprivileged daemon or its logs.
pub(crate) fn discovery_json() -> Result<String, PersonaError> {
    if !rustix::process::geteuid().is_root() {
        return Err(PersonaError::Discovery);
    }
    serde_json::to_string(&read_personas(Path::new(PERSONA_DIRECTORY))?)
        .map_err(|_| PersonaError::Discovery)
}

fn read_personas(directory: &Path) -> Result<Personas, PersonaError> {
    let entries = match std::fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Personas::new()),
        Err(error) => return Err(error.into()),
    };
    let mut personas = Personas::new();
    for entry in entries {
        let entry = entry?;
        let path = entry.path();
        if path.extension().is_none_or(|extension| extension != "env") {
            continue;
        }
        let Some(os_user) = path.file_stem().and_then(|stem| stem.to_str()) else {
            continue;
        };
        let port = read_health_port(&path);
        personas.insert(os_user.to_owned(), port);
    }
    Ok(personas)
}

fn read_health_port(path: &Path) -> Option<NonZeroU16> {
    let mut file = std::fs::File::open(path)
        .ok()?
        .take((MAX_CONFIG_BYTES + 1) as u64);
    let mut text = String::new();
    file.read_to_string(&mut text).ok()?;
    (text.len() <= MAX_CONFIG_BYTES)
        .then(|| health_port(&text))
        .flatten()
}

fn health_port(environment: &str) -> Option<NonZeroU16> {
    // Enrollment emits one-line, shell-quoted assignments. shell_words parses
    // quoting only: it never executes a shell or expands the secrets.
    let values = shell_words::split(environment).ok()?;
    let mut port = None;
    for value in &values {
        let (_, (key, value)) = assignment(value).ok()?;
        if key == "BRAIN_HEALTH_PORT" {
            port = value.parse().ok();
        }
    }
    port
}

pub(crate) struct HttpHealth {
    http: reqwest::Client,
}

impl HttpHealth {
    pub(crate) fn new() -> Result<Self, reqwest::Error> {
        Ok(Self {
            http: reqwest::Client::builder()
                .no_proxy()
                .redirect(reqwest::redirect::Policy::none())
                .timeout(HEALTH_TIMEOUT)
                .build()?,
        })
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HealthResponse {
    status: BrainStatus,
    last_turn_at: Option<DateTime<Utc>>,
    #[serde(default)]
    problems: Vec<BrainProblem>,
}

#[derive(Deserialize)]
enum BrainProblem {
    #[serde(rename = "budget")]
    Budget,
    #[serde(rename = "event stream disconnected")]
    Disconnected,
}

impl BrainProblem {
    fn message(&self) -> &'static str {
        match self {
            Self::Budget => "budget",
            Self::Disconnected => "event stream disconnected",
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
enum BrainStatus {
    Ok,
    Degraded,
}

impl HealthProbe for HttpHealth {
    #[tracing::instrument(name = "macrod.personas.health", skip_all)]
    async fn probe(&self, port: NonZeroU16, checked_at: DateTime<Utc>) -> PersonaHealth {
        let mut headers = reqwest::header::HeaderMap::new();
        macro_tower_layers::inject_trace_headers(&mut headers);
        let response = self
            .http
            .get(format!("http://127.0.0.1:{port}/health"))
            .headers(headers)
            .send()
            .await;
        let mut response = match response {
            Ok(response) => response,
            Err(_) => {
                return PersonaHealth::Missing {
                    checked_at,
                    last_error: "brain health endpoint is unavailable".to_owned(),
                    last_turn_at: None,
                };
            }
        };
        let status = response.status();
        let mut bytes = Vec::new();
        loop {
            match response.chunk().await {
                Ok(Some(chunk)) if bytes.len() + chunk.len() <= MAX_HEALTH_BYTES => {
                    bytes.extend_from_slice(&chunk)
                }
                Ok(None) => break,
                _ => {
                    return invalid_health(
                        checked_at,
                        "brain health response is too large or incomplete",
                    );
                }
            }
        }
        let health: HealthResponse = match serde_json::from_slice(&bytes) {
            Ok(health) => health,
            Err(_) => return invalid_health(checked_at, "invalid brain health response"),
        };
        if status.is_success()
            && matches!(health.status, BrainStatus::Ok)
            && health.problems.is_empty()
        {
            PersonaHealth::Healthy {
                checked_at,
                last_turn_at: health.last_turn_at,
            }
        } else {
            let message = if health.problems.is_empty() {
                format!("brain reports degraded health (HTTP {status})")
            } else {
                health
                    .problems
                    .iter()
                    .map(BrainProblem::message)
                    .collect::<Vec<_>>()
                    .join("; ")
                    .chars()
                    .take(MAX_ERROR_CHARS)
                    .collect()
            };
            PersonaHealth::Unhealthy {
                checked_at,
                last_error: message,
                last_turn_at: health.last_turn_at,
            }
        }
    }
}

fn invalid_health(checked_at: DateTime<Utc>, error: &str) -> PersonaHealth {
    PersonaHealth::Unhealthy {
        checked_at,
        last_error: error.to_owned(),
        last_turn_at: None,
    }
}
