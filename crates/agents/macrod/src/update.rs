//! Self-update for a released `macrod`.
//!
//! A release build polls the repository's latest GitHub release (or the
//! `MACROD_UPDATE_SOURCE` mirror). When it is newer, the platform archive is
//! downloaded, checked against its published SHA-256, and its binary staged
//! and smoke-tested.
//!
//! On Unix the control panel then swaps the binary in and `execve`s into it
//! once no agent turn is running, handing the running agent process over
//! ([`crate::handoff`]) so it never restarts. On Windows the new version is
//! installed beside the running one and the launcher starts it from the next
//! launch ([`versions`]); the panel says so.
//!
//! Every failure is logged and leaves the running process alone; the next
//! poll tries again. Only the terminal control panel updates itself.
//! `macrod service` is driven by an embedding app (the desktop app ships and
//! updates its own copy), builds without a release tag (local and branch
//! builds) never update, and `[update] auto = false` or `MACROD_NO_UPDATE=1`
//! turns updating off.

use std::path::PathBuf;
use std::time::Duration;

use tokio::sync::oneshot;
use tokio_util::task::AbortOnDropHandle;
use tracing::Instrument as _;

mod install;
pub mod log;
mod release;
#[cfg(any(windows, test))]
pub mod versions;

use install::{Installation, StageError};
use log::{CheckOutcome, UpdateEvent};
use release::{ReleaseClient, ReleaseSource, ReleaseVersion};

#[cfg(test)]
mod test;

mod environment {
    macro_env_var::maybe_env_var! {
        /// `1` (or any value but `0`/`false`) turns self-update off.
        pub struct MacrodNoUpdate;
    }
    macro_env_var::maybe_env_var! {
        /// A mirror to update from instead of GitHub releases.
        pub struct MacrodUpdateSource;
    }
    macro_env_var::maybe_env_var! {
        /// Seconds between checks, for testing against a mirror.
        pub struct MacrodUpdateCheckSeconds;
    }
}

/// The release tag this binary was built from, set by the release workflow.
const RELEASE_TAG: Option<&str> = option_env!("MACROD_RELEASE_TAG");

/// What `macrod --version` prints: the release tag, or the crate version for
/// a build without one.
pub const VERSION: &str = match RELEASE_TAG {
    Some(tag) => tag,
    None => env!("CARGO_PKG_VERSION"),
};

/// How often the latest release is checked. GitHub allows an unauthenticated
/// client 60 API requests an hour, so this stays well inside it.
const CHECK_EVERY: Duration = Duration::from_secs(60 * 60);

/// How long the staged binary gets to print its version.
const SMOKE_TEST_TIMEOUT: Duration = Duration::from_secs(10);

/// Why one update attempt failed.
#[derive(Debug, thiserror::Error)]
enum UpdateError {
    #[error("could not read the release source")]
    Fetch(#[from] release::FetchError),
    #[error("could not stage the new binary")]
    Stage(#[from] StageError),
    #[error("the staged binary failed its smoke test: {0}")]
    SmokeTest(String),
}

/// A newer binary, verified, smoke-tested, and ready.
pub struct StagedUpdate {
    tag: String,
    #[cfg_attr(windows, expect(dead_code, reason = "Windows installs while staging"))]
    staged: PathBuf,
    #[cfg_attr(windows, expect(dead_code, reason = "Windows installs while staging"))]
    installation: Installation,
}

impl StagedUpdate {
    /// The release tag being installed.
    pub fn tag(&self) -> &str {
        &self.tag
    }

    /// Move the staged binary over the running one. The running process is
    /// unaffected until [`Installed::relaunch`].
    #[cfg(unix)]
    pub fn swap(self) -> std::io::Result<Installed> {
        let span = tracing::info_span!("macrod.update.apply", tag = %self.tag);
        let _entered = span.enter();
        self.installation.swap(&self.staged).inspect_err(
            |error| tracing::warn!(error = ?error, "could not install the new macrod binary"),
        )?;
        tracing::info!("installed the new macrod binary; restarting");
        Ok(Installed {
            executable: self.installation.executable().to_owned(),
            tag: self.tag,
        })
    }
}

/// A new binary in place of the running one, not yet running.
#[cfg(unix)]
pub struct Installed {
    executable: PathBuf,
    tag: String,
}

#[cfg(unix)]
impl Installed {
    /// Re-execute as the new binary with the same arguments and environment,
    /// handing it the running agent. Returns only on failure.
    pub fn relaunch(self, agent: Option<crate::handoff::HandedOffAgent>) -> std::io::Error {
        install::relaunch(&self.executable, &self.tag, agent)
    }
}

/// Whether this process may update itself: a release build, with updating
/// left on in the config (`auto`) and not turned off by `MACROD_NO_UPDATE`.
fn updates_enabled(release_tag: Option<&str>, auto: bool, no_update: Option<&str>) -> bool {
    let turned_off = no_update.map(str::trim).is_some_and(|value| {
        !value.is_empty() && value != "0" && !value.eq_ignore_ascii_case("false")
    });
    release_tag.and_then(ReleaseVersion::parse).is_some() && auto && !turned_off
}

/// The background update check, alive until dropped.
pub struct UpdatePoller {
    /// Resolves once, with the first newer release staged.
    pub staged: oneshot::Receiver<StagedUpdate>,
    _task: AbortOnDropHandle<()>,
}

/// Start polling for releases, or `None` when this build cannot update
/// itself or updating is turned off (`auto` is `[update] auto`).
pub fn start_poller(auto: bool) -> Option<UpdatePoller> {
    let no_update =
        environment::MacrodNoUpdate::new().and_then(|value| value.value().map(str::to_owned));
    if !updates_enabled(RELEASE_TAG, auto, no_update.as_deref()) {
        tracing::info!(version = VERSION, "self-update is off");
        return None;
    }
    let current = RELEASE_TAG.and_then(ReleaseVersion::parse)?;
    let installation = match Installation::current() {
        Ok(installation) => installation,
        Err(error) => {
            tracing::warn!(error = ?error, "could not locate the running executable; self-update is off");
            return None;
        }
    };
    installation.remove_leftovers();
    let source =
        environment::MacrodUpdateSource::new().and_then(|value| value.value().map(str::to_owned));
    let source = ReleaseSource::new(source.as_deref());
    tracing::info!(version = VERSION, source = ?source, "checking for macrod updates hourly");
    let client = match ReleaseClient::new(source) {
        Ok(client) => client,
        Err(error) => {
            tracing::warn!(error = ?error, "could not build the release client; self-update is off");
            return None;
        }
    };
    let every = environment::MacrodUpdateCheckSeconds::new()
        .and_then(|value| value.value()?.parse().ok())
        .map_or(CHECK_EVERY, Duration::from_secs);
    let (staged_tx, staged) = oneshot::channel();
    let task = tokio::spawn(poll(client, current, installation, staged_tx, every));
    Some(UpdatePoller {
        staged,
        _task: AbortOnDropHandle::new(task),
    })
}

async fn poll(
    client: ReleaseClient,
    current: ReleaseVersion,
    installation: Installation,
    staged_tx: oneshot::Sender<StagedUpdate>,
    every: Duration,
) {
    loop {
        match check_and_stage(&client, current, &installation).await {
            Ok(Some(update)) => {
                let _ = staged_tx.send(update);
                return;
            }
            Ok(None) => {}
            Err(error) => {
                tracing::warn!(error = ?error, "macrod self-update failed; retrying at the next check");
            }
        }
        tokio::time::sleep(every).await;
    }
}

async fn check_and_stage(
    client: &ReleaseClient,
    current: ReleaseVersion,
    installation: &Installation,
) -> Result<Option<StagedUpdate>, UpdateError> {
    let check = tracing::info_span!(
        "macrod.update.check",
        current = %current,
        latest = tracing::field::Empty,
        outcome = tracing::field::Empty,
    );
    let checked = |latest: Option<&str>, outcome: CheckOutcome| {
        log::record(UpdateEvent::Check {
            current: current.to_string(),
            latest: latest.map(str::to_owned),
            outcome,
        });
    };
    let latest = client
        .latest()
        .instrument(check.clone())
        .await
        .inspect_err(|_| checked(None, CheckOutcome::Failed))?;
    check.record("latest", latest.tag.as_str());
    let Some(version) = ReleaseVersion::parse(&latest.tag) else {
        check.record("outcome", "unrecognized_tag");
        checked(Some(&latest.tag), CheckOutcome::UnrecognizedTag);
        return Ok(None);
    };
    if version <= current {
        check.record("outcome", "up_to_date");
        checked(Some(&latest.tag), CheckOutcome::UpToDate);
        return Ok(None);
    }
    let Some(asset) = latest.platform_asset(client.source()) else {
        // The release job uploads every platform at once; a missing one is a
        // build that failed or a platform that is not published.
        check.record("outcome", "no_asset");
        checked(Some(&latest.tag), CheckOutcome::NoAsset);
        tracing::info!(parent: &check, tag = %latest.tag, "newer macrod has no build for this platform");
        return Ok(None);
    };
    check.record("outcome", "newer");
    checked(Some(&latest.tag), CheckOutcome::Newer);

    let download = tracing::info_span!(
        parent: &check,
        "macrod.update.download",
        tag = %latest.tag,
        asset = %asset.archive_name,
        bytes = tracing::field::Empty,
    );
    let mut bytes = 0;
    let staged = async {
        let downloaded = client.download(&asset).await?;
        bytes = downloaded.archive.len() as u64;
        tracing::Span::current().record("bytes", bytes);
        let staging = installation.clone();
        let tag = latest.tag.clone();
        let staged = tokio::task::spawn_blocking(move || {
            staging.stage(&downloaded.archive, &downloaded.checksum, &tag)
        })
        .await
        .map_err(|error| StageError::Io(std::io::Error::other(error)))??;
        smoke_test(&staged).await.inspect_err(|_| {
            let _ = std::fs::remove_file(&staged);
        })?;
        Ok::<_, UpdateError>(staged)
    }
    .instrument(download)
    .await;
    let checksum_ok = !matches!(
        staged,
        Err(UpdateError::Stage(
            StageError::ChecksumMismatch { .. } | StageError::MalformedChecksum
        )) | Err(UpdateError::Fetch(_))
    );
    log::record(UpdateEvent::Download {
        version: latest.tag.clone(),
        bytes,
        checksum_ok,
        result: match &staged {
            Ok(_) => "staged".to_owned(),
            Err(error) => error.to_string(),
        },
    });
    let staged = staged?;
    // Windows launches it from the next start; nothing to swap later.
    #[cfg(windows)]
    let staged = {
        let committed = installation.commit(&latest.tag);
        log::record(UpdateEvent::Apply {
            from: Some(VERSION.to_owned()),
            to: latest.tag.clone(),
            method: log::ApplyMethod::NextLaunch,
            active_prompts: 0,
            result: match &committed {
                Ok(_) => "installed for the next launch".to_owned(),
                Err(error) => format!("could not install: {error}"),
            },
        });
        committed.map_err(StageError::Io)?
    };

    tracing::info!(tag = %latest.tag, "downloaded a newer macrod");
    Ok(Some(StagedUpdate {
        tag: latest.tag,
        staged,
        installation: installation.clone(),
    }))
}

/// The staged binary must run on this machine before it replaces the one
/// that does.
async fn smoke_test(staged: &std::path::Path) -> Result<(), UpdateError> {
    let output = tokio::time::timeout(
        SMOKE_TEST_TIMEOUT,
        tokio::process::Command::new(staged)
            .arg("--version")
            .kill_on_drop(true)
            .output(),
    )
    .await
    .map_err(|_| UpdateError::SmokeTest("timed out".to_owned()))?
    .map_err(|error| UpdateError::SmokeTest(error.to_string()))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(UpdateError::SmokeTest(format!(
            "exited with {}",
            output.status
        )))
    }
}
