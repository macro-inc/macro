//! `macrod enroll`: join a Macro computer (hosted VM) to Macro at first boot.
//!
//! The control plane hands the computer one
//! [`Enrollment`](hosted_runtimes::domain::enrollment::Enrollment) in a file.
//! Enrolling writes `macrod.toml` for the deployment it names and claims the
//! pre-approved harness pairing. Every step is safe to re-run until the
//! enrolled marker exists.
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

use hosted_runtimes::domain::enrollment::{Enrollment, EnrollmentGeneration};
use rootcause::prelude::ResultExt as _;

use crate::computer::ENROLLED_MARKER;
use crate::config::{Config, HarnessCredentials};
use crate::outbound::pairing::{ClaimStatus, PairingClient};
use crate::retry_delay::RetryDelays;
use crate::service::ServiceOptions;
use crate::tui::config_form::ConfigForm;

#[cfg(test)]
mod test;

/// How long the claim keeps retrying a network that is not up yet.
const CLAIM_DEADLINE: Duration = Duration::from_secs(300);
/// The pairing is pre-approved, so a claim only waits for the network or
/// service to come up: retry quickly.
const CLAIM_RETRY: Duration = Duration::from_millis(250);

/// The claim's retry delays: every [`CLAIM_RETRY`], jittered.
fn claim_retry_delays() -> RetryDelays {
    RetryDelays::every(CLAIM_RETRY)
}
/// MMDS answers from the VMM itself; anything slower is not coming.
const MMDS_TIMEOUT: Duration = Duration::from_secs(2);
/// How long the MMDS session token lives; one enrollment read needs seconds.
const MMDS_TOKEN_TTL_SECONDS: &str = "60";

/// Where the enrollment JSON comes from. Firecracker computers add their
/// metadata service as a second source.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EnrollmentSource {
    /// A file holding the JSON, for Docker computers.
    File(PathBuf),
    /// The `macro.enrollment` object of a Firecracker microVM's MMDS
    /// document, through MMDS v2 (session token).
    Mmds,
}

/// An `--from` value that names no enrollment source.
#[derive(Debug, PartialEq, Eq, thiserror::Error)]
#[error("expected `mmds` or `file:<path>`, not `{0}`")]
pub struct UnknownEnrollmentSource(String);

impl FromStr for EnrollmentSource {
    type Err = UnknownEnrollmentSource;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value.strip_prefix("file:") {
            Some(path) if !path.is_empty() => Ok(Self::File(PathBuf::from(path))),
            None if value == "mmds" => Ok(Self::Mmds),
            _ => Err(UnknownEnrollmentSource(value.to_owned())),
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
    /// Prefix for every system path (`/etc`, `/var/lib`).
    pub root: PathBuf,
}

/// System paths, under a root prefix, and the MMDS address, so tests can
/// redirect them.
struct SystemPaths {
    root: PathBuf,
    mmds: String,
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
    run_enroll_with_host(options, &SystemHost, crate::telemetry::install).await
}

/// Enroll on `host`, starting telemetry with `start_telemetry` once the
/// enrollment is read, since it names where spans go.
async fn run_enroll_with_host<Guard>(
    options: EnrollOptions,
    host: &impl Host,
    start_telemetry: impl FnOnce(Option<crate::telemetry::Exporter>) -> Guard,
) -> rootcause::Result<()> {
    use tracing::Instrument as _;
    let paths = SystemPaths {
        root: options.root.clone(),
        mmds: firecracker_host_api::mmds::ADDRESS.to_owned(),
    };
    let marker = paths.at(ENROLLED_MARKER);
    let telemetry_env = paths.at(crate::telemetry::TELEMETRY_ENV);
    let enrolled = read_marker(&marker)?;
    let read = read_enrollment(&options.from, &paths).await?;
    let exporter = read.as_ref().and_then(telemetry_exporter);
    let _telemetry = start_telemetry(exporter.clone());
    let enrollment = match (read, enrolled) {
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
                EnrollmentSource::File(path) =>
                    format!("write the Enrollment JSON to {}", path.display()),
                EnrollmentSource::Mmds => format!(
                    "put the Enrollment JSON at {} in MMDS",
                    firecracker_host_api::mmds::ENROLLMENT_POINTER
                ),
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
    async {
        // Before the marker: once it is written a retry stops at "already
        // enrolled", so failed settings would never be written.
        write_telemetry_env(&telemetry_env, exporter.as_ref())?;
        enroll(&options, host, &marker, &enrollment).await
    }
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

/// The enrollment's telemetry intake, which takes OTLP/HTTP, named this
/// computer.
fn telemetry_exporter(enrollment: &Enrollment) -> Option<crate::telemetry::Exporter> {
    enrollment
        .deployment
        .telemetry_url
        .as_ref()
        .map(|url| crate::telemetry::Exporter::Http {
            endpoint: url.as_str().trim_end_matches('/').to_owned(),
            computer: Some(enrollment.computer_id),
        })
}

/// Record the enrollment's telemetry settings for `macrod.service`, or
/// remove them when this enrollment names no intake. Not a secret.
fn write_telemetry_env(
    path: &Path,
    exporter: Option<&crate::telemetry::Exporter>,
) -> rootcause::Result<()> {
    match exporter {
        Some(exporter) => {
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent)
                    .context(format!("could not create {}", parent.display()))?;
            }
            std::fs::write(path, exporter.environment_file())
                .context(format!("could not write {}", path.display()))?;
        }
        None => match std::fs::remove_file(path) {
            Err(error) if error.kind() != std::io::ErrorKind::NotFound => {
                return Err(rootcause::report!(
                    "could not remove {}: {error}",
                    path.display()
                ));
            }
            _ => {}
        },
    }
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
        EnrollmentSource::Mmds => match read_mmds_enrollment(&paths.mmds).await? {
            Some(raw) => raw,
            None => return Ok(None),
        },
    };
    Ok(Some(
        serde_json::from_str(&raw).context("the enrollment is not valid Enrollment JSON")?,
    ))
}

/// MMDS v2: a session token, then the object at the enrollment pointer as
/// JSON (MMDS answers IMDS text without `Accept`), or `None` for a 404 (the
/// control plane removed it once macrod connected). Never through a proxy:
/// MMDS is only reachable from the microVM itself. The body is the
/// enrollment, so it is never recorded.
#[tracing::instrument(name = "macrod.enroll.read_mmds", skip_all, fields(found = tracing::field::Empty), err)]
async fn read_mmds_enrollment(
    address: &str,
) -> rootcause::Result<Option<zeroize::Zeroizing<String>>> {
    use firecracker_host_api::mmds;

    let http = reqwest::Client::builder()
        .no_proxy()
        .timeout(MMDS_TIMEOUT)
        .build()
        .context("could not build the MMDS client")?;
    let token = http
        .put(format!("{address}{}", mmds::TOKEN_PATH))
        .header(mmds::TOKEN_TTL_HEADER, MMDS_TOKEN_TTL_SECONDS)
        .send()
        .await
        .context(format!("could not reach MMDS at {address}"))?
        .error_for_status()
        .context("MMDS refused a session token")?
        .text()
        .await
        .context("could not read the MMDS session token")?;
    let token = zeroize::Zeroizing::new(token);

    let response = http
        .get(format!("{address}{}", mmds::ENROLLMENT_POINTER))
        .header(mmds::TOKEN_HEADER, token.as_str())
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .await
        .context(format!("could not reach MMDS at {address}"))?;
    let status = response.status();
    if status == reqwest::StatusCode::NOT_FOUND {
        tracing::Span::current().record("found", false);
        return Ok(None);
    }
    let body = zeroize::Zeroizing::new(
        response
            .text()
            .await
            .context("could not read the MMDS answer")?,
    );
    if !status.is_success() {
        rootcause::bail!("MMDS answered {status} for {}", mmds::ENROLLMENT_POINTER);
    }
    tracing::Span::current().record("found", true);
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
        let trim = |url: &macro_service_urls::Url| url.as_str().trim_end_matches('/').to_owned();
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
            profile: None,
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
    let mut delays = claim_retry_delays();
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
        tokio::time::sleep(delays.next_delay()).await;
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
