//! The real service binaries, run as child processes with their output in a
//! log file.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use rootcause::prelude::*;
use tokio::process::{Child, Command};

/// The environment variable naming the directory that holds `email_service`
/// and `pubsub_workers`.
const BIN_DIR_ENV: &str = "EMAIL_E2E_BIN_DIR";

/// The environment variable naming a directory for the services' coverage
/// profiles. Set for a run against binaries built with
/// `-C instrument-coverage` (`tooling/email-coverage`), unset otherwise.
const PROFILE_DIR_ENV: &str = "EMAIL_E2E_PROFILE_DIR";
/// The variable an instrumented binary reads its profile's path from.
const PROFILE_FILE_ENV: &str = "LLVM_PROFILE_FILE";

/// How long a service may take to shut down when asked.
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(15);

/// How many of a log's last lines a failure shows.
const LOG_TAIL_LINES: usize = 40;

/// A service binary running as a child process.
pub(crate) struct ServiceProcess {
    name: &'static str,
    child: Child,
    log_path: PathBuf,
}

impl ServiceProcess {
    /// Starts `name` from the binary directory with exactly `env`.
    pub(crate) fn spawn(
        name: &'static str,
        env: &BTreeMap<String, String>,
        log_dir: &Path,
    ) -> Result<Self, Report> {
        // Absolute: the child starts in another directory.
        let binary = binary_dir()?
            .join(name)
            .canonicalize()
            .context("could not resolve the service binary")?;

        let log_path = log_dir.join(format!("{name}.log"));
        // Appended, so a restarted service keeps what it logged before.
        let log = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path)
            .context("could not open the service's log file")?;
        let mut command = Command::new(&binary);
        command.env_clear().envs(env);
        if let Some(profile) = profile_file(name) {
            command.env(PROFILE_FILE_ENV, profile);
        }
        let child = command
            // The services load any `.env` at or above their working directory;
            // the root has none.
            .current_dir("/")
            .stdin(Stdio::null())
            .stdout(log.try_clone()?)
            .stderr(log)
            .kill_on_drop(true)
            .spawn()
            .context("could not start the service binary")?;

        Ok(Self {
            name,
            child,
            log_path,
        })
    }

    /// Where its output goes.
    pub(crate) fn log_path(&self) -> &Path {
        &self.log_path
    }

    /// Fails when the process has exited, which a service never does by itself.
    pub(crate) fn ensure_running(&mut self) -> Result<(), Report> {
        match self.child.try_wait()? {
            None => Ok(()),
            Some(status) => bail!(
                "{} exited with {status}; the end of {}:\n{}",
                self.name,
                self.log_path.display(),
                self.log_tail()
            ),
        }
    }

    /// Everything the process has written so far.
    pub(crate) fn log(&self) -> String {
        std::fs::read(&self.log_path)
            .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
            .unwrap_or_default()
    }

    /// The last lines of its output.
    pub(crate) fn log_tail(&self) -> String {
        let log = self.log();
        let lines: Vec<&str> = log.lines().collect();
        let start = lines.len().saturating_sub(LOG_TAIL_LINES);
        lines[start..].join("\n")
    }

    /// Asks the process to shut down and waits for it; kills it when it
    /// takes longer than a shutdown should.
    pub(crate) async fn stop_gracefully(&mut self) {
        let asked = self
            .child
            .id()
            .and_then(|id| i32::try_from(id).ok())
            .and_then(rustix::process::Pid::from_raw)
            .is_some_and(|pid| {
                rustix::process::kill_process(pid, rustix::process::Signal::TERM).is_ok()
            });
        if asked
            && tokio::time::timeout(SHUTDOWN_TIMEOUT, self.child.wait())
                .await
                .is_ok()
        {
            return;
        }
        self.stop().await;
    }

    /// Kills the process and waits for it to be gone.
    pub(crate) async fn stop(&mut self) {
        if let Err(error) = self.child.kill().await {
            tracing::warn!(error = ?error, service = self.name, "could not stop a service");
        }
    }
}

/// Where the instrumented binary `name` writes its coverage profile, when
/// the run collects coverage.
///
/// Every process of one binary shares a file (`%m`) that the counters are
/// mapped into (`%c`), so a service the scenario kills has still written
/// what it ran, and the profiles of a whole run stay a few files.
fn profile_file(name: &str) -> Option<PathBuf> {
    #[expect(
        clippy::disallowed_methods,
        reason = "test support: the suite's own settings come from the process environment"
    )]
    let dir = std::env::var(PROFILE_DIR_ENV).ok()?;
    Some(PathBuf::from(dir).join(format!("{name}-%m%c.profraw")))
}

/// Fails when one of the service binaries has not been built.
pub(crate) fn ensure_built(names: &[&str]) -> Result<(), Report> {
    let dir = binary_dir()?;
    for name in names {
        let binary = dir.join(name);
        if !binary.is_file() {
            bail!(
                "{} is missing: run the suite with `just email-e2e`, which builds the \
                 services it starts",
                binary.display()
            );
        }
    }
    Ok(())
}

/// The directory holding the service binaries: `EMAIL_E2E_BIN_DIR`, or the
/// directory the test binary's own profile builds into.
pub(crate) fn binary_dir() -> Result<PathBuf, Report> {
    #[expect(
        clippy::disallowed_methods,
        reason = "test support: the suite's own settings come from the process environment"
    )]
    let configured = std::env::var(BIN_DIR_ENV).ok();
    if let Some(dir) = configured {
        return Ok(PathBuf::from(dir));
    }

    // A test binary lives in `target/<profile>/deps/`; the service binaries
    // of the same build live one directory up.
    let test_binary = std::env::current_exe().context("could not find the test binary")?;
    test_binary
        .parent()
        .and_then(Path::parent)
        .map(Path::to_path_buf)
        .ok_or_else(|| report!("could not find the build directory; set {BIN_DIR_ENV}"))
}
