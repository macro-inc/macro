//! Runs work in a forked child process that can only leave files in one folder.
//!
//! LibreOffice can crash or hang, so each conversion runs in its own process.
//! A process that is killed cleans up nothing, so everything it writes has to
//! land where the parent removes it: the child's working directory, home, and
//! temporary directory are all its job folder.

use std::{
    ffi::{CStr, CString, OsStr},
    os::unix::ffi::OsStrExt,
    path::Path,
    thread,
    time::Duration,
};

use anyhow::Context;
use nix::{
    errno::Errno,
    libc::{_exit, setenv, unsetenv},
    sys::{
        resource::{Resource, setrlimit},
        signal::{Signal, kill, killpg},
        wait::{WaitPidFlag, WaitStatus, waitpid},
    },
    unistd::{ForkResult, Pid, fork, setpgid},
};

/// How often the parent checks whether its child has finished.
const POLL_INTERVAL: Duration = Duration::from_millis(20);

/// Exit status of a child whose work returned an error.
const WORK_FAILED_STATUS: i32 = 1;

/// Exit status of a child whose work panicked, the status Rust itself exits with.
const WORK_PANICKED_STATUS: i32 = 101;

/// The file in its folder where a child leaves the error its work returned.
const ERROR_FILE: &str = "error";

/// How a child process ended.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum ChildExit {
    Succeeded,
    /// The work returned this error.
    Failed(String),
    /// The child exited with this status and left no error: its work
    /// panicked, or the folder had no room for the error.
    Exited(i32),
    /// The child crashed.
    Signaled(Signal),
    /// The child was still running after its time limit and was killed.
    TimedOut,
}

/// Ends the child if its work unwinds. Without it a panic would unwind into
/// the copy of the parent's stack the child inherited and run the parent's
/// code in the child.
struct ExitOnUnwind;

impl Drop for ExitOnUnwind {
    fn drop(&mut self) {
        unsafe { _exit(WORK_PANICKED_STATUS) }
    }
}

/// Runs `work` in a child process confined to `folder`, killing it and
/// everything it started once `max_wait` has passed.
///
/// `cache` holds caches the child may share with other jobs.
///
/// The child is a copy of one thread of a multi-threaded process. A lock
/// another thread held at the fork is never released in it, so `work` must not
/// log, and sets environment variables with [`set_child_env`]. The parent logs
/// the error `work` returns.
pub(crate) fn run_confined(
    folder: &Path,
    cache: &Path,
    max_wait: Duration,
    work: impl FnOnce() -> anyhow::Result<()>,
) -> anyhow::Result<ChildExit> {
    match unsafe { fork() }.context("fork failed")? {
        ForkResult::Child => {
            let _exit_on_unwind = ExitOnUnwind;

            let status = match confine(folder, cache).and_then(|()| work()) {
                Ok(()) => 0,
                Err(e) => {
                    // The parent reports a missing or empty file as a bare status.
                    let _ = std::fs::write(folder.join(ERROR_FILE), format!("{e:#}"));
                    WORK_FAILED_STATUS
                }
            };

            // `_exit` skips exit handlers: LibreOffice's can hang or crash,
            // and the parent's are not the child's to run.
            unsafe { _exit(status) }
        }
        ForkResult::Parent { child } => {
            tracing::info!(pid=%child, "spawned child process");

            // The child does the same. Whichever runs first, the group exists
            // by the time the parent may need to kill it. This fails only if
            // the child has already exited.
            let _ = setpgid(child, child);

            match supervise(child, max_wait)? {
                ChildExit::Exited(status) => reported_failure(folder, status),
                exit => Ok(exit),
            }
        }
    }
}

/// Reads the error a child that exited with `status` left in `folder`.
fn reported_failure(folder: &Path, status: i32) -> anyhow::Result<ChildExit> {
    match std::fs::read(folder.join(ERROR_FILE)) {
        // A full disk leaves the file empty, or cut short inside a character.
        Ok(error) if error.is_empty() => Ok(ChildExit::Exited(status)),
        Ok(error) => Ok(ChildExit::Failed(
            String::from_utf8_lossy(&error).into_owned(),
        )),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(ChildExit::Exited(status)),
        Err(e) => Err(e).with_context(|| {
            format!("unable to read the error of a child that exited with status {status}")
        }),
    }
}

/// Keeps everything the child writes inside `folder`.
fn confine(folder: &Path, cache: &Path) -> anyhow::Result<()> {
    // Its own process group, so the parent can kill it together with any
    // process it starts.
    setpgid(Pid::from_raw(0), Pid::from_raw(0)).context("unable to start a process group")?;

    // A crashing LibreOffice would otherwise dump its memory to disk.
    setrlimit(Resource::RLIMIT_CORE, 0, 0).context("unable to disable core dumps")?;

    std::env::set_current_dir(folder).context("unable to enter the job folder")?;

    // LibreOffice keeps its scratch files in TMPDIR and its user profile
    // under HOME, and removes neither when it is killed. The XDG variables
    // would move the profile back out of HOME.
    set_child_env(c"TMPDIR", folder.as_os_str())?;
    set_child_env(c"HOME", folder.as_os_str())?;
    set_child_env(c"XDG_CACHE_HOME", cache.as_os_str())?;
    remove_child_env(c"XDG_CONFIG_HOME")?;
    remove_child_env(c"XDG_DATA_HOME")?;
    remove_child_env(c"XDG_STATE_HOME")?;

    Ok(())
}

/// Sets an environment variable of the child process `run_confined` forked.
///
/// `std::env::set_var` waits for a lock that another thread of the parent may
/// have held at the fork. That thread does not exist in the child, so the
/// child would wait until its time limit.
pub(crate) fn set_child_env(name: &CStr, value: &OsStr) -> anyhow::Result<()> {
    let value = CString::new(value.as_bytes())
        .with_context(|| format!("value of {name:?} contains a NUL byte"))?;

    // SAFETY: the forked child has one thread, so nothing else reads or
    // writes the environment.
    let result = unsafe { setenv(name.as_ptr(), value.as_ptr(), 1) };
    Errno::result(result).with_context(|| format!("unable to set {name:?}"))?;

    Ok(())
}

/// Removes an environment variable of the child process; see [`set_child_env`].
fn remove_child_env(name: &CStr) -> anyhow::Result<()> {
    // SAFETY: as in `set_child_env`.
    let result = unsafe { unsetenv(name.as_ptr()) };
    Errno::result(result).with_context(|| format!("unable to remove {name:?}"))?;

    Ok(())
}

/// Waits for `child` to end, killing its process group at `max_wait`.
fn supervise(child: Pid, max_wait: Duration) -> anyhow::Result<ChildExit> {
    let started = std::time::Instant::now();

    loop {
        let status =
            waitpid(child, Some(WaitPidFlag::WNOHANG)).context("unable to wait for child")?;

        match status {
            WaitStatus::Exited(_, 0) => return Ok(ChildExit::Succeeded),
            WaitStatus::Exited(_, status) => return Ok(ChildExit::Exited(status)),
            WaitStatus::Signaled(_, signal, _) => return Ok(ChildExit::Signaled(signal)),
            _ => {}
        }

        if started.elapsed() >= max_wait {
            break;
        }

        thread::sleep(POLL_INTERVAL);
    }

    // The child has not been reaped, so its process group id still names it.
    // The wait below never returns for a child left alive, so if the group
    // cannot be killed the child alone still is.
    let killed = killpg(child, Signal::SIGKILL).or_else(|_| kill(child, Signal::SIGKILL));
    waitpid(child, None).context("unable to reap killed child")?;
    killed.context("unable to kill child process")?;

    Ok(ChildExit::TimedOut)
}
