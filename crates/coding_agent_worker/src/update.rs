//! Self-update for a released `macrod`.
//!
//! A release build polls the repository's latest GitHub release. When it is
//! newer, the platform archive is downloaded, checked against its published
//! SHA-256, and its binary staged next to the running executable and
//! smoke-tested. The control panel then swaps it in and re-executes once no
//! agent turn is running. Every failure is logged and leaves the running
//! process alone; the next poll tries again.
//!
//! Only the terminal control panel updates itself. `macrod service` is driven
//! by an embedding app (the desktop app ships and updates its own copy), and
//! builds without a release tag (local and branch builds) never update.

use std::path::PathBuf;
use std::time::Duration;

use tokio::sync::oneshot;
use tokio_util::task::AbortOnDropHandle;
use tracing::Instrument as _;

mod install;
mod release;

use install::{Installation, StageError};
use release::{ReleaseClient, ReleaseVersion};

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
    #[error("could not reach GitHub releases")]
    Http(#[from] reqwest::Error),
    #[error("could not stage the new binary")]
    Stage(#[from] StageError),
    #[error("the staged binary failed its smoke test: {0}")]
    SmokeTest(String),
}

/// A newer binary, verified and staged next to the running one.
pub struct StagedUpdate {
    tag: String,
    staged: PathBuf,
    installation: Installation,
}

impl StagedUpdate {
    /// The release tag being installed.
    pub fn tag(&self) -> &str {
        &self.tag
    }

    /// Move the staged binary over the running one. The running process is
    /// unaffected until [`Installed::relaunch`].
    pub fn swap(self) -> std::io::Result<Installed> {
        let span = tracing::info_span!("macrod.update.apply", tag = %self.tag);
        let _entered = span.enter();
        self.installation.swap(&self.staged).inspect_err(
            |error| tracing::warn!(error = ?error, "could not install the new macrod binary"),
        )?;
        tracing::info!("installed the new macrod binary; restarting");
        Ok(Installed {
            executable: self.installation.executable().to_owned(),
        })
    }
}

/// A new binary in place of the running one, not yet running.
pub struct Installed {
    executable: PathBuf,
}

impl Installed {
    /// Re-execute as the new binary with the same arguments and environment.
    /// Returns only on failure.
    pub fn relaunch(self) -> std::io::Error {
        install::relaunch(&self.executable)
    }
}

/// The background update check, alive until dropped.
pub struct UpdatePoller {
    /// Resolves once, with the first newer release staged.
    pub staged: oneshot::Receiver<StagedUpdate>,
    _task: AbortOnDropHandle<()>,
}

/// Start polling for releases, or `None` when this build cannot update
/// itself.
pub fn start_poller() -> Option<UpdatePoller> {
    let Some(current) = RELEASE_TAG.and_then(ReleaseVersion::parse) else {
        tracing::debug!("not a release build; self-update is off");
        return None;
    };
    let installation = match Installation::current() {
        Ok(installation) => installation,
        Err(error) => {
            tracing::warn!(error = ?error, "could not locate the running executable; self-update is off");
            return None;
        }
    };
    installation.remove_leftovers();
    let client = match ReleaseClient::new() {
        Ok(client) => client,
        Err(error) => {
            tracing::warn!(error = ?error, "could not build the release client; self-update is off");
            return None;
        }
    };
    let (staged_tx, staged) = oneshot::channel();
    let task = tokio::spawn(poll(client, current, installation, staged_tx));
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
        tokio::time::sleep(CHECK_EVERY).await;
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
    let latest = client.latest().instrument(check.clone()).await?;
    check.record("latest", latest.tag.as_str());
    let Some(version) = ReleaseVersion::parse(&latest.tag) else {
        check.record("outcome", "unrecognized_tag");
        return Ok(None);
    };
    if version <= current {
        check.record("outcome", "up_to_date");
        return Ok(None);
    }
    let Some(asset) = latest.platform_asset() else {
        // The release job uploads every platform at once; a missing one is a
        // build that failed or a platform that is not published.
        check.record("outcome", "no_asset");
        tracing::info!(parent: &check, tag = %latest.tag, "newer macrod has no build for this platform");
        return Ok(None);
    };
    check.record("outcome", "newer");

    let download = tracing::info_span!(
        parent: &check,
        "macrod.update.download",
        tag = %latest.tag,
        asset = %asset.archive_name,
        bytes = tracing::field::Empty,
    );
    let staged = async {
        let downloaded = client.download(&asset).await?;
        tracing::Span::current().record("bytes", downloaded.archive.len());
        let installation = installation.clone();
        let staged = tokio::task::spawn_blocking(move || {
            installation.stage(&downloaded.archive, &downloaded.checksum)
        })
        .await
        .map_err(|error| StageError::Io(std::io::Error::other(error)))??;
        smoke_test(&staged).await.inspect_err(|_| {
            let _ = std::fs::remove_file(&staged);
        })?;
        Ok::<_, UpdateError>(staged)
    }
    .instrument(download)
    .await?;

    tracing::info!(tag = %latest.tag, "downloaded a newer macrod; restarting once no turn is running");
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
