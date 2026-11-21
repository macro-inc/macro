//! Child processes with a deadline, bounded output, and their whole
//! process group killed when they are done or abandoned.

use std::process::Stdio;
use std::time::Duration;

use tokio::io::{AsyncRead, AsyncReadExt as _};

/// The most stderr kept for an error message.
const STDERR_KEPT: usize = 4096;

/// How long and how much a command may take.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Limits {
    /// The deadline from spawn to exit.
    pub deadline: Duration,
    /// The most stdout accepted.
    pub max_output: usize,
}

/// A command that didn't succeed.
#[derive(Debug, thiserror::Error)]
pub enum ProcessError {
    /// It couldn't be started.
    #[error("could not start it: {0}")]
    Spawn(std::io::Error),
    /// Reading or waiting failed.
    #[error("could not wait for it: {0}")]
    Wait(std::io::Error),
    /// It ran past its deadline and was killed.
    #[error("it took longer than {0:?}")]
    TimedOut(Duration),
    /// It printed more than its limit.
    #[error("its output was longer than {0} bytes")]
    OutputTooLarge(usize),
    /// It exited unsuccessfully.
    #[error("it exited with {code:?}: {stderr}")]
    Failed {
        /// Its exit code, `None` for a signal.
        code: Option<i32>,
        /// The start of its stderr.
        stderr: String,
    },
}

/// Kills the child's process group when dropped: on success, on error and
/// when the boot is abandoned (a stop's signal), so nothing it started
/// outlives it.
struct GroupGuard(Option<rustix::process::Pid>);

impl Drop for GroupGuard {
    fn drop(&mut self) {
        if let Some(group) = self.0 {
            // ESRCH: the group is gone already.
            let _ = rustix::process::kill_process_group(group, rustix::process::Signal::KILL);
        }
    }
}

/// Run `command` in its own process group, stdin closed, and return its
/// stdout.
pub async fn run(
    mut command: tokio::process::Command,
    limits: Limits,
) -> Result<Vec<u8>, ProcessError> {
    command
        .process_group(0)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let mut child = command.spawn().map_err(ProcessError::Spawn)?;
    let _guard = GroupGuard(
        child
            .id()
            .and_then(|id| rustix::process::Pid::from_raw(id.cast_signed())),
    );
    let (Some(stdout), Some(stderr)) = (child.stdout.take(), child.stderr.take()) else {
        return Err(ProcessError::Wait(std::io::Error::other(
            "the child's output wasn't piped",
        )));
    };

    let finished = async {
        let (stdout, stderr, status) = tokio::try_join!(
            read_capped(stdout, limits.max_output),
            read_capped(stderr, STDERR_KEPT),
            child.wait(),
        )
        .map_err(ProcessError::Wait)?;
        Ok::<_, ProcessError>((stdout, stderr, status))
    };
    let (stdout, stderr, status) = tokio::time::timeout(limits.deadline, finished)
        .await
        .map_err(|_| ProcessError::TimedOut(limits.deadline))??;

    if !status.success() {
        return Err(ProcessError::Failed {
            code: status.code(),
            stderr: String::from_utf8_lossy(&stderr.bytes).trim().to_owned(),
        });
    }
    if stdout.overflowed {
        return Err(ProcessError::OutputTooLarge(limits.max_output));
    }
    Ok(stdout.bytes)
}

struct Captured {
    bytes: Vec<u8>,
    overflowed: bool,
}

/// Read to the end, keeping the first `cap` bytes, so a chatty child never
/// blocks on a full pipe.
async fn read_capped(mut reader: impl AsyncRead + Unpin, cap: usize) -> std::io::Result<Captured> {
    let mut bytes = Vec::new();
    let mut overflowed = false;
    let mut chunk = [0u8; 8192];
    loop {
        let read = reader.read(&mut chunk).await?;
        if read == 0 {
            return Ok(Captured { bytes, overflowed });
        }
        let room = cap.saturating_sub(bytes.len());
        if read > room {
            overflowed = true;
        }
        bytes.extend_from_slice(chunk.get(..read.min(room)).unwrap_or_default());
    }
}
