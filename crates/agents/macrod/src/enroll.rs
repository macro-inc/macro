//! `macrod enroll`: join a Macro computer (hosted VM) to Macro at first boot.
//!
//! The control plane hands the computer one
//! [`Enrollment`](hosted_runtimes::domain::enrollment::Enrollment): through the
//! Incus guest API on VMs, or a file in Docker. Enrolling writes `macrod.toml`
//! for the deployment it names and claims the pre-approved harness pairing.
//! Every step is safe to re-run until the enrolled marker exists.
//!
//! The marker records the computer and its enrollment generation, and lives
//! on the data disk. A guest recreated on that disk is handed a newer
//! generation, so enrollment runs again: it claims the new pairing and
//! rewrites the config's deployment and credential, leaving the rest of the
//! disk alone. A marker at least as new as the enrollment, or no enrollment
//! (the control plane removes it once macrod connects), means enrolled.

use std::os::unix::fs::MetadataExt as _;
use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::time::{Duration, Instant};

use hosted_runtimes::domain::enrollment::{Enrollment, EnrollmentGeneration, INCUS_ENROLLMENT_KEY};
use rootcause::prelude::ResultExt as _;

use crate::computer::ENROLLED_MARKER;
use crate::config::{Config, HarnessCredentials};
use crate::outbound::pairing::{ClaimStatus, PairingClient};
use crate::service::ServiceOptions;
use crate::tui::config_form::ConfigForm;

#[cfg(test)]
mod test;

/// The Incus guest API socket inside a VM.
const INCUS_SOCKET: &str = "/dev/incus/sock";
/// How long the claim keeps retrying a network that is not up yet.
const CLAIM_DEADLINE: Duration = Duration::from_secs(300);
/// The pairing is pre-approved, so a claim only waits for the network or
/// service to come up: retry quickly.
const CLAIM_RETRY: Duration = Duration::from_millis(250);
const INCUS_TIMEOUT: Duration = Duration::from_secs(10);

/// Where the enrollment JSON comes from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EnrollmentSource {
    /// The `user.macro.enrollment` instance config key, via `/dev/incus/sock`.
    Incus,
    /// A file holding the JSON, for Docker computers.
    File(PathBuf),
}

/// An `--from` value that names no enrollment source.
#[derive(Debug, PartialEq, Eq, thiserror::Error)]
#[error("expected `incus` or `file:<path>`, not `{0}`")]
pub struct UnknownEnrollmentSource(String);

impl FromStr for EnrollmentSource {
    type Err = UnknownEnrollmentSource;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "incus" => Ok(Self::Incus),
            other => match other.strip_prefix("file:") {
                Some(path) if !path.is_empty() => Ok(Self::File(PathBuf::from(path))),
                _ => Err(UnknownEnrollmentSource(other.to_owned())),
            },
        }
    }
}

/// Everything `macrod enroll` accepts.
pub struct EnrollOptions {
    /// Where the enrollment JSON comes from.
    pub from: EnrollmentSource,
    /// The `macrod.toml` macrod serves from. Takes its directory's owner.
    pub config: PathBuf,
    /// Workspace for a newly created config.
    pub workspace: PathBuf,
    /// Agent preset id for a newly created config.
    pub agent: String,
    /// Prefix for every system path (`/dev/incus`, `/etc`, `/var/lib`).
    pub root: PathBuf,
}

/// System paths, under a root prefix so tests can redirect them.
struct SystemPaths {
    root: PathBuf,
}

impl SystemPaths {
    fn at(&self, absolute: &str) -> PathBuf {
        self.root.join(absolute.trim_start_matches('/'))
    }
}

/// A Unix user and group id.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Ownership {
    pub uid: u32,
    pub gid: u32,
}

/// The privileged side effects enrolling has on the machine.
pub trait Host {
    /// Change a path's owner.
    fn chown(&self, path: &Path, owner: Ownership) -> rootcause::Result<()>;
}

/// The real machine: `chown(2)`.
pub struct SystemHost;

impl Host for SystemHost {
    fn chown(&self, path: &Path, owner: Ownership) -> rootcause::Result<()> {
        std::os::unix::fs::chown(path, Some(owner.uid), Some(owner.gid))
            .context(format!("could not chown {}", path.display()))?;
        Ok(())
    }
}

/// Enroll this computer, or enroll it again for a newer enrollment
/// generation; an enrolled one is left as it is.
pub async fn run_enroll(options: EnrollOptions) -> rootcause::Result<()> {
    run_enroll_with_host(options, &SystemHost).await
}

async fn run_enroll_with_host(options: EnrollOptions, host: &impl Host) -> rootcause::Result<()> {
    use tracing::Instrument as _;
    let paths = SystemPaths {
        root: options.root.clone(),
    };
    let marker = paths.at(ENROLLED_MARKER);
    let enrolled = read_marker(&marker)?;
    let enrollment = match (read_enrollment(&options.from, &paths).await?, enrolled) {
        (None, Some(_)) => {
            tracing::info!(marker = %marker.display(), "already enrolled");
            return Ok(());
        }
        (Some(enrollment), Some(generation)) if generation >= enrollment.generation => {
            tracing::info!(marker = %marker.display(), "already enrolled");
            return Ok(());
        }
        (Some(enrollment), _) => enrollment,
        (None, None) => rootcause::bail!(
            "missing enrollment: {}",
            match &options.from {
                EnrollmentSource::Incus =>
                    format!("set the {INCUS_ENROLLMENT_KEY} Incus instance config key"),
                EnrollmentSource::File(path) =>
                    format!("write the Enrollment JSON to {}", path.display()),
            }
        ),
    };
    // Parent before entering so enrollment joins the setup trace.
    let span = tracing::info_span!(
        "run_enroll",
        computer_id = %enrollment.computer_id,
        generation = i64::from(enrollment.generation.get()),
        otel.status_code = tracing::field::Empty
    );
    hosted_runtimes::domain::telemetry::attach(&span, enrollment.traceparent.as_deref());
    enroll(&options, host, &marker, &enrollment)
        .instrument(span.clone())
        .await
        .inspect_err(|_| {
            span.record("otel.status_code", "ERROR");
        })
}

async fn enroll(
    options: &EnrollOptions,
    host: &impl Host,
    marker: &Path,
    enrollment: &Enrollment,
) -> rootcause::Result<()> {
    // Validate everything before the first side effect.
    let urls = DeploymentUrls::from_deployment(&enrollment.deployment);

    let agent = if options.config.exists() {
        None
    } else {
        Some(crate::service::installed_agent(&options.agent)?)
    };
    write_config(options, agent, &urls)?;
    ensure_credentials(&options.config, enrollment).await?;
    own_like_parent(&options.config, host)?;

    if let Some(parent) = marker.parent() {
        std::fs::create_dir_all(parent)
            .context(format!("could not create {}", parent.display()))?;
    }
    std::fs::write(
        marker,
        format!(
            "{}\n{}\n",
            enrollment.computer_id,
            enrollment.generation.get()
        ),
    )
    .context(format!("could not write {}", marker.display()))?;
    tracing::info!("enrolled");
    Ok(())
}

/// The generation the marker records; `None` when not enrolled. A marker
/// without one is from before generations were recorded and counts as older
/// than any enrollment.
fn read_marker(marker: &Path) -> rootcause::Result<Option<EnrollmentGeneration>> {
    let contents = match std::fs::read_to_string(marker) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        contents => contents.context(format!("could not read {}", marker.display()))?,
    };
    Ok(Some(EnrollmentGeneration::new(
        contents
            .lines()
            .nth(1)
            .and_then(|line| line.trim().parse().ok())
            .unwrap_or(0),
    )))
}

/// The enrollment, or `None` when its source holds none.
async fn read_enrollment(
    source: &EnrollmentSource,
    paths: &SystemPaths,
) -> rootcause::Result<Option<Enrollment>> {
    let raw = match source {
        EnrollmentSource::File(path) => match std::fs::read_to_string(path) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Ok(raw) if raw.trim().is_empty() => return Ok(None),
            raw => zeroize::Zeroizing::new(raw.context(format!(
                "could not read the enrollment at {}",
                path.display()
            ))?),
        },
        EnrollmentSource::Incus => match read_incus_enrollment(&paths.at(INCUS_SOCKET)).await? {
            Some(raw) => raw,
            None => return Ok(None),
        },
    };
    Ok(Some(
        serde_json::from_str(&raw).context("the enrollment is not valid Enrollment JSON")?,
    ))
}

/// `GET /1.0/config/<key>` on the guest API answers the raw value, or 404
/// once the control plane has removed it.
async fn read_incus_enrollment(
    socket: &Path,
) -> rootcause::Result<Option<zeroize::Zeroizing<String>>> {
    let http = reqwest::Client::builder()
        .unix_socket(socket)
        .timeout(INCUS_TIMEOUT)
        .build()
        .context("could not build the Incus guest API client")?;
    let response = http
        .get(format!(
            "http://custom.socket/1.0/config/{INCUS_ENROLLMENT_KEY}"
        ))
        .send()
        .await
        .context(format!(
            "could not reach the Incus guest API at {}",
            socket.display()
        ))?;
    let status = response.status();
    if status == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    let body = zeroize::Zeroizing::new(
        response
            .text()
            .await
            .context("could not read the Incus guest API answer")?,
    );
    if !status.is_success() {
        rootcause::bail!("the Incus guest API answered {status} for {INCUS_ENROLLMENT_KEY}");
    }
    Ok(Some(body))
}

/// The deployment URLs `macrod.toml` stores, from the enrollment's typed
/// deployment.
#[derive(Debug, Clone, PartialEq, Eq)]
struct DeploymentUrls {
    egress_url: String,
    api_url: String,
    storage_url: String,
    web_url: String,
}

impl DeploymentUrls {
    fn from_deployment(deployment: &hosted_runtimes::domain::enrollment::Deployment) -> Self {
        let trim = |url: &service_url::Url| url.as_str().trim_end_matches('/').to_owned();
        Self {
            egress_url: trim(&deployment.egress_url),
            api_url: trim(&deployment.agent_harness_url),
            storage_url: trim(&deployment.document_storage_url),
            // macrod links into the web app's routes, below `/app`.
            web_url: format!("{}/app", trim(&deployment.app_url)),
        }
    }
}

fn write_config(
    options: &EnrollOptions,
    agent: Option<crate::tui::agent_catalog::DetectedAgent>,
    urls: &DeploymentUrls,
) -> rootcause::Result<()> {
    crate::service::configure(
        &options.config,
        &ServiceOptions {
            ignore_stdin_eof: false,
            config: Some(options.config.clone()),
            agent: None,
            workspace: Some(options.workspace.clone()),
        },
        agent,
    )?;
    let mut form = ConfigForm::load(&options.config)?;
    form.set_deployment_urls(&urls.api_url, &urls.storage_url, &urls.web_url);
    form.set_egress_url(&urls.egress_url);
    form.save()?;
    Ok(())
}

/// Claim the pre-approved pairing unless the stored credential was claimed
/// from it, which is what a retried enrollment finds. A credential from an
/// earlier enrollment's pairing is replaced.
#[tracing::instrument(name = "macrod.enroll.claim", skip_all, fields(attempts = tracing::field::Empty), err)]
async fn ensure_credentials(path: &Path, enrollment: &Enrollment) -> rootcause::Result<()> {
    let config = Config::load(path)?;
    if config.credentials.as_ref().is_some_and(|credentials| {
        credentials.is_valid() && credentials.pairing_id == Some(enrollment.pairing_id)
    }) {
        tracing::info!("credential already stored; skipping the claim");
        return Ok(());
    }
    let client = PairingClient::new(&config).with_trace_parent(enrollment.traceparent.clone());
    let started = Instant::now();
    let mut attempts: i64 = 0;
    loop {
        attempts += 1;
        tracing::Span::current().record("attempts", attempts);
        match client
            .claim(enrollment.pairing_id, enrollment.device_secret.expose())
            .await
        {
            Ok(ClaimStatus::Claimed(credentials)) => {
                let credentials = HarnessCredentials {
                    pairing_id: Some(enrollment.pairing_id),
                    ..credentials
                };
                ConfigForm::load(path)?.persist_credentials(&credentials)?;
                tracing::info!(harness_id = %credentials.harness_id, "pairing claimed");
                return Ok(());
            }
            Ok(ClaimStatus::Gone(reason)) => {
                rootcause::bail!("the enrollment's pairing cannot be claimed: {reason}")
            }
            // Pre-approved pairings never wait; this only covers a network
            // or service that is still coming up.
            Ok(ClaimStatus::Pending) => tracing::warn!("pairing not approved yet; retrying"),
            Err(error) if started.elapsed() < CLAIM_DEADLINE => {
                tracing::warn!(error = %error, "claim failed; retrying");
            }
            Err(error) => return Err(error),
        }
        if started.elapsed() >= CLAIM_DEADLINE {
            rootcause::bail!("the enrollment's pairing was not claimable in time");
        }
        tokio::time::sleep(CLAIM_RETRY).await;
    }
}

/// Give a file its directory's owner: enrollment runs as root, macrod as the
/// user whose home holds its config.
fn own_like_parent(path: &Path, host: &impl Host) -> rootcause::Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| rootcause::report!("{} has no directory", path.display()))?;
    let metadata =
        std::fs::metadata(parent).context(format!("could not stat {}", parent.display()))?;
    host.chown(
        path,
        Ownership {
            uid: metadata.uid(),
            gid: metadata.gid(),
        },
    )
}
