//! `macrod enroll`: join a Macro computer (hosted VM) to Macro at first boot.
//!
//! The control plane hands the computer one
//! [`Enrollment`](hosted_runtimes::domain::enrollment::Enrollment): through the
//! Incus guest API on VMs, or a file in Docker. Enrolling writes `macrod.toml`
//! for the deployment it names and claims the pre-approved harness pairing.
//! Every step is safe to re-run until the enrolled marker exists.

use std::collections::BTreeMap;
use std::os::unix::fs::{MetadataExt as _, OpenOptionsExt as _, PermissionsExt as _};
use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::time::{Duration, Instant};

use hosted_runtimes::domain::enrollment::{Enrollment, INCUS_ENROLLMENT_KEY};
use macro_service_urls::{
    AgentHarnessEgressUrl, AgentHarnessServiceUrl, AppServiceUrl, DocumentStorageServiceUrl,
};
use rootcause::option_ext::OptionExt as _;
use rootcause::prelude::ResultExt as _;

use crate::capabilities::ENROLLED_MARKER;
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
const CLAIM_RETRY: Duration = Duration::from_secs(5);
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
    /// Run `systemctl` with these arguments.
    fn systemctl(&self, args: &[&str]) -> rootcause::Result<()>;
}

/// The real machine: `chown(2)`, `systemctl`.
pub struct SystemHost;

impl Host for SystemHost {
    fn chown(&self, path: &Path, owner: Ownership) -> rootcause::Result<()> {
        std::os::unix::fs::chown(path, Some(owner.uid), Some(owner.gid))
            .context(format!("could not chown {}", path.display()))?;
        Ok(())
    }

    fn systemctl(&self, args: &[&str]) -> rootcause::Result<()> {
        run("systemctl", args)
    }
}

fn run(program: &str, args: &[&str]) -> rootcause::Result<()> {
    let output = std::process::Command::new(program)
        .args(args)
        .output()
        .context(format!("could not run {program}"))?;
    if !output.status.success() {
        rootcause::bail!(
            "{program} {} failed ({}): {}",
            args.join(" "),
            output.status,
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    Ok(())
}

/// Enroll this computer, or refresh its token helper when already enrolled.
pub async fn run_enroll(options: EnrollOptions) -> rootcause::Result<()> {
    run_enroll_with_host(options, &SystemHost).await
}

async fn run_enroll_with_host(options: EnrollOptions, host: &impl Host) -> rootcause::Result<()> {
    use tracing::Instrument as _;
    let paths = SystemPaths {
        root: options.root.clone(),
    };
    let marker = paths.at(ENROLLED_MARKER);
    if marker.exists() {
        install_token_store(&options.config, &paths, host)?;
        tracing::info!(marker = %marker.display(), "already enrolled");
        return Ok(());
    }

    let enrollment = read_enrollment(&options.from, &paths).await?;
    // Parent before entering so enrollment joins the setup trace.
    let span = tracing::info_span!(
        "run_enroll",
        computer_id = %enrollment.computer_id,
        generation = i64::from(enrollment.generation.get()),
        otel.status_code = tracing::field::Empty
    );
    hosted_runtimes::domain::telemetry::attach(&span, enrollment.traceparent.as_deref());
    enroll(&options, host, &paths, &marker, &enrollment)
        .instrument(span.clone())
        .await
        .inspect_err(|_| {
            span.record("otel.status_code", "ERROR");
        })
}

async fn enroll(
    options: &EnrollOptions,
    host: &impl Host,
    paths: &SystemPaths,
    marker: &Path,
    enrollment: &Enrollment,
) -> rootcause::Result<()> {
    // Validate everything before the first side effect.
    let urls = DeploymentUrls::from_overrides(&enrollment.service_url_overrides)?;

    let agent = if options.config.exists() {
        None
    } else {
        Some(crate::service::installed_agent(&options.agent)?)
    };
    write_config(options, agent, urls.as_ref())?;
    ensure_credentials(&options.config, enrollment).await?;
    own_like_parent(&options.config, host)?;

    if let Some(parent) = marker.parent() {
        std::fs::create_dir_all(parent)
            .context(format!("could not create {}", parent.display()))?;
    }
    install_token_store(&options.config, paths, host)?;
    if let Some(parent) = &enrollment.traceparent {
        write_file(
            &paths.at(crate::telemetry::PROVISION_PARENT_PATH),
            parent,
            0o644,
        )?;
    }
    std::fs::write(marker, enrollment.computer_id.to_string())
        .context(format!("could not write {}", marker.display()))?;
    tracing::info!("enrolled");
    Ok(())
}

/// Keep only the persistence helper privileged; Claude runs as the config owner.
fn install_token_store(
    config: &Path,
    paths: &SystemPaths,
    host: &impl Host,
) -> rootcause::Result<()> {
    let owner = std::fs::metadata(config)
        .context("could not identify the daemon user")?
        .uid();
    let unit = include_str!("computer/token_store.service").replace("{owner}", &owner.to_string());
    write_file(
        &paths.at("/etc/systemd/system/macrod-token-store.service"),
        &unit,
        0o644,
    )?;
    host.systemctl(&["daemon-reload"])?;
    host.systemctl(&["enable", "--now", "macrod-token-store.service"])?;
    Ok(())
}

async fn read_enrollment(
    source: &EnrollmentSource,
    paths: &SystemPaths,
) -> rootcause::Result<Enrollment> {
    let raw = match source {
        EnrollmentSource::File(path) => {
            zeroize::Zeroizing::new(std::fs::read_to_string(path).context(format!(
                "could not read the enrollment at {}",
                path.display()
            ))?)
        }
        EnrollmentSource::Incus => read_incus_enrollment(&paths.at(INCUS_SOCKET)).await?,
    };
    Ok(serde_json::from_str(&raw).context("the enrollment is not valid Enrollment JSON")?)
}

/// `GET /1.0/config/<key>` on the guest API answers the raw value.
async fn read_incus_enrollment(socket: &Path) -> rootcause::Result<zeroize::Zeroizing<String>> {
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
    let body = zeroize::Zeroizing::new(
        response
            .text()
            .await
            .context("could not read the Incus guest API answer")?,
    );
    if !status.is_success() {
        rootcause::bail!("the Incus guest API answered {status} for {INCUS_ENROLLMENT_KEY}");
    }
    Ok(body)
}

/// The deployment URLs `macrod.toml` stores, resolved from the enrollment's
/// `macro_service_urls` overrides.
#[derive(Debug, Clone, PartialEq, Eq)]
struct DeploymentUrls {
    egress_url: Option<String>,
    api_url: String,
    storage_url: String,
    web_url: String,
}

impl DeploymentUrls {
    /// `None` when the enrollment overrides none of the services macrod
    /// calls, which keeps the config template's deployment. Overriding some
    /// but not all would mix deployments, so that is an error.
    fn from_overrides(overrides: &BTreeMap<String, String>) -> rootcause::Result<Option<Self>> {
        for (name, value) in overrides {
            if !lazy_regex::regex_is_match!(r"^OVERRIDE_[A-Z0-9_]+$", name) {
                rootcause::bail!("`{name}` is not an OVERRIDE_* service URL variable");
            }
            let parsed = macro_service_urls::ServiceUrl::owned(value.clone()).parse_url();
            if parsed.is_err() {
                rootcause::bail!("{name} is not a URL: `{value}`");
            }
        }
        let api = overrides.get(AgentHarnessServiceUrl::OVERRIDE_ENV_VAR_NAME);
        let storage = overrides.get(DocumentStorageServiceUrl::OVERRIDE_ENV_VAR_NAME);
        let app = overrides.get(AppServiceUrl::OVERRIDE_ENV_VAR_NAME);
        match (api, storage, app) {
            (None, None, None) => Ok(None),
            (Some(api), Some(storage), Some(app)) => Ok(Some(Self {
                egress_url: overrides
                    .get(AgentHarnessEgressUrl::OVERRIDE_ENV_VAR_NAME)
                    .cloned(),
                api_url: api.trim_end_matches('/').to_owned(),
                storage_url: storage.trim_end_matches('/').to_owned(),
                // macrod links into the web app's routes, below `/app`.
                web_url: format!("{}/app", app.trim_end_matches('/')),
            })),
            _ => rootcause::bail!(
                "overriding macrod's deployment needs {}, {} and {} together",
                AgentHarnessServiceUrl::OVERRIDE_ENV_VAR_NAME,
                DocumentStorageServiceUrl::OVERRIDE_ENV_VAR_NAME,
                AppServiceUrl::OVERRIDE_ENV_VAR_NAME,
            ),
        }
    }
}

fn write_config(
    options: &EnrollOptions,
    agent: Option<crate::tui::agent_catalog::DetectedAgent>,
    urls: Option<&DeploymentUrls>,
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
    if let Some(urls) = urls {
        let mut form = ConfigForm::load(&options.config)?;
        form.set_deployment_urls(&urls.api_url, &urls.storage_url, &urls.web_url);
        if let Some(egress) = &urls.egress_url {
            form.set_egress_url(egress);
        }
        form.save()?;
    }
    Ok(())
}

/// Claim the pre-approved pairing unless a credential is already stored,
/// which is what a retried enrollment finds.
#[tracing::instrument(name = "macrod.enroll.claim", skip_all, fields(attempts = tracing::field::Empty), err)]
async fn ensure_credentials(path: &Path, enrollment: &Enrollment) -> rootcause::Result<()> {
    let config = Config::load(path)?;
    if config
        .credentials
        .as_ref()
        .is_some_and(HarnessCredentials::is_valid)
    {
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

/// Write a file only its owner can read.
pub(crate) fn write_private(path: &Path, contents: &str) -> rootcause::Result<()> {
    use std::io::Write as _;

    let parent = path
        .parent()
        .context("a private file needs a parent directory")?;
    std::fs::create_dir_all(parent).context("could not create the private directory")?;
    let temporary = parent.join(format!(".claude-token.{}", uuid::Uuid::now_v7()));
    let result = (|| -> rootcause::Result<()> {
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&temporary)
            .context("could not create the private token file")?;
        file.write_all(contents.as_bytes())
            .context("could not write the token")?;
        file.sync_all().context("could not sync the token")?;
        std::fs::rename(&temporary, path).context("could not install the token")?;
        Ok(())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(temporary);
    }
    result
}

fn write_file(path: &Path, contents: &str, mode: u32) -> rootcause::Result<()> {
    use std::io::Write as _;

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .context(format!("could not create {}", parent.display()))?;
    }
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(mode)
        .open(path)
        .context(format!("could not open {}", path.display()))?;
    // `mode` applies only to new files; a retry tightens an existing one.
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(mode))
        .context(format!("could not set the mode of {}", path.display()))?;
    file.write_all(contents.as_bytes())
        .context(format!("could not write {}", path.display()))?;
    Ok(())
}
