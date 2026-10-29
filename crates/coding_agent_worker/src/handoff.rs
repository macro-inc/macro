//! Handing the running ACP agent from one macrod process image to the next.
//!
//! A self-update on Unix replaces macrod with `execve`. Children survive an
//! `execve`, and so do file descriptors without `FD_CLOEXEC`, so the agent
//! keeps running and the new image picks up its pipes where the old one
//! stopped: at a line boundary, with any bytes read past it carried over.
//!
//! The state travels in an unlinked temporary file whose descriptor number
//! is in [`HANDOFF_ENV`]. It is versioned: an image that cannot read it kills
//! the agent's process group and starts a fresh agent, which resumes its
//! sessions the way a reconnect always has.

use std::io::{Read as _, Seek as _, Write as _};
use std::os::fd::{AsFd as _, AsRawFd as _, FromRawFd as _, OwnedFd, RawFd};

use rustix::io::FdFlags;
use rustix::process::Pid;

#[cfg(test)]
mod test;

/// Names the inherited descriptor holding the handoff state.
pub const HANDOFF_ENV: &str = "MACROD_HANDOFF_FD";

mod environment {
    macro_env_var::maybe_env_var! {
        /// Set only by macrod when it `execve`s into an update.
        pub struct MacrodHandoffFd;
    }
}

/// Bumped whenever [`HandoffState`] changes shape.
const FORMAT_VERSION: u32 = 1;

/// A running agent, its pipes, and what the relay knew about it.
pub struct HandedOffAgent {
    parts: Option<HandedOffParts>,
}

/// The pieces of a [`HandedOffAgent`], taken by whoever relays it next.
pub struct HandedOffParts {
    pub pid: Pid,
    pub stdin: OwnedFd,
    pub stdout: OwnedFd,
    pub stderr: OwnedFd,
    /// Output read past the last relayed line; the start of the next one.
    pub pending_output: Vec<u8>,
    /// `session/prompt` request ids the agent has not answered yet.
    pub active_prompts: Vec<String>,
}

/// The serialized form. Descriptor numbers are only meaningful in the image
/// the state is handed to.
#[derive(Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
struct HandoffState {
    version: u32,
    agent: AgentRecord,
}

#[derive(Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
struct AgentRecord {
    pid: i32,
    stdin: RawFd,
    stdout: RawFd,
    stderr: RawFd,
    /// Hex, so the state stays text whatever the agent wrote.
    pending_output: String,
    active_prompts: Vec<String>,
}

/// Why handed-off state could not be used.
#[derive(Debug, thiserror::Error)]
pub enum HandoffError {
    #[error("handoff state version {found} is not {FORMAT_VERSION}")]
    Version { found: u32 },
    #[error("malformed handoff state")]
    Malformed(#[from] serde_json::Error),
    #[error("malformed pending output")]
    PendingOutput(#[from] hex::FromHexError),
    #[error("pid {0} is not a running child of this process")]
    NotAChild(i32),
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

impl HandedOffAgent {
    pub fn new(
        pid: Pid,
        stdin: OwnedFd,
        stdout: OwnedFd,
        stderr: OwnedFd,
        pending_output: Vec<u8>,
        active_prompts: Vec<String>,
    ) -> Self {
        Self {
            parts: Some(HandedOffParts {
                pid,
                stdin,
                stdout,
                stderr,
                pending_output,
                active_prompts,
            }),
        }
    }

    /// Take the agent; it is no longer killed when this value drops.
    pub fn into_parts(mut self) -> HandedOffParts {
        self.parts.take().expect("parts are present until taken")
    }

    /// The agent's pid, which is also its process group.
    pub fn pid(&self) -> Pid {
        self.parts().pid
    }

    /// How many prompts were running when the agent was handed over.
    pub fn active_prompt_count(&self) -> usize {
        self.parts().active_prompts.len()
    }

    fn parts(&self) -> &HandedOffParts {
        self.parts.as_ref().expect("parts are present until taken")
    }

    fn state(&self) -> HandoffState {
        let parts = self.parts();
        HandoffState {
            version: FORMAT_VERSION,
            agent: AgentRecord {
                pid: parts.pid.as_raw_nonzero().get(),
                stdin: parts.stdin.as_raw_fd(),
                stdout: parts.stdout.as_raw_fd(),
                stderr: parts.stderr.as_raw_fd(),
                pending_output: hex::encode(&parts.pending_output),
                active_prompts: parts.active_prompts.clone(),
            },
        }
    }

    /// Make the agent's pipes and its state survive `execve`. Returns the
    /// value for [`HANDOFF_ENV`]; the state file must stay open until then.
    pub fn prepare_exec(&self) -> std::io::Result<(OwnedFd, String)> {
        let parts = self.parts();
        for fd in [&parts.stdin, &parts.stdout, &parts.stderr] {
            rustix::io::fcntl_setfd(fd.as_fd(), FdFlags::empty())?;
        }
        let state = serde_json::to_vec(&self.state()).map_err(std::io::Error::other)?;
        let file = state_file(&state)?;
        let fd = OwnedFd::from(file);
        rustix::io::fcntl_setfd(fd.as_fd(), FdFlags::empty())?;
        let number = fd.as_raw_fd().to_string();
        Ok((fd, number))
    }
}

impl HandedOffAgent {
    /// Kill the agent, as any agent whose relay ended. Joining the returned
    /// reaper gives its exit status.
    fn stop(&mut self) -> Option<Reaper> {
        self.parts.take().map(|parts| kill_and_reap(parts.pid))
    }
}

/// Without a taker, the agent is killed like any agent whose relay ended.
impl Drop for HandedOffAgent {
    fn drop(&mut self) {
        let _ = self.stop();
    }
}

/// The agent the previous process image handed over, if it handed one.
///
/// Read once, at startup: the descriptor number names nothing afterwards.
/// State this image cannot use falls back to killing the agent, so the
/// daemon starts a fresh one.
pub fn take_inherited() -> Option<HandedOffAgent> {
    let number = environment::MacrodHandoffFd::new()?.value()?.to_owned();
    let Ok(fd) = number.parse::<RawFd>() else {
        tracing::warn!(value = %number, "ignoring a malformed {HANDOFF_ENV}");
        return None;
    };
    // SAFETY: only probed, not used, until it is known to be open.
    if rustix::io::fcntl_getfd(unsafe { rustix::fd::BorrowedFd::borrow_raw(fd) }).is_err() {
        tracing::warn!(fd, "the handed-off state descriptor is not open");
        return None;
    }
    // SAFETY: the previous image opened this descriptor for us and passed
    // its number in HANDOFF_ENV; it was checked open above and nothing else
    // in this image has claimed it this early in startup.
    let file = std::fs::File::from(unsafe { OwnedFd::from_raw_fd(fd) });
    match read_state(file).and_then(adopt) {
        Ok(agent) => {
            tracing::info!(
                pid = agent.pid().as_raw_nonzero().get(),
                "picked up the running agent from the previous macrod"
            );
            Some(agent)
        }
        Err((error, fallback)) => {
            tracing::warn!(error = %error, "could not pick up the running agent; starting a new one");
            let _ = fallback.kill();
            crate::update::log::record(crate::update::log::UpdateEvent::Apply {
                from: None,
                to: crate::update::VERSION.to_owned(),
                method: crate::update::log::ApplyMethod::FreshAgentFallback,
                active_prompts: 0,
                result: format!("could not pick up the running agent: {error}"),
            });
            None
        }
    }
}

/// What to clean up when the state cannot be used.
#[derive(Default)]
struct Fallback {
    pid: Option<i32>,
    fds: Vec<RawFd>,
}

impl Fallback {
    /// Read only the fields every format version has, so a version this
    /// image does not know still has its agent stopped.
    fn from_raw(raw: &[u8]) -> Self {
        let Ok(value) = serde_json::from_slice::<serde_json::Value>(raw) else {
            return Self::default();
        };
        let agent = &value["agent"];
        let number = |field: &str| agent[field].as_i64().and_then(|n| i32::try_from(n).ok());
        Self {
            pid: number("pid"),
            fds: ["stdin", "stdout", "stderr"]
                .into_iter()
                .filter_map(number)
                .collect(),
        }
    }

    /// Kill the named agent and close its pipes. Joining the returned
    /// reaper gives the agent's exit status.
    fn kill(self) -> Option<Reaper> {
        let reaper = self.pid.and_then(Pid::from_raw).map(kill_and_reap);
        for fd in self.fds {
            // SAFETY: these descriptors were inherited for the handoff and
            // nothing in this image uses them; closing them is the cleanup.
            if rustix::io::fcntl_getfd(unsafe { rustix::fd::BorrowedFd::borrow_raw(fd) }).is_ok() {
                drop(unsafe { OwnedFd::from_raw_fd(fd) });
            }
        }
        reaper
    }
}

fn read_state(
    mut file: std::fs::File,
) -> Result<(HandoffState, Vec<u8>), (HandoffError, Fallback)> {
    let mut raw = Vec::new();
    file.read_to_end(&mut raw)
        .map_err(|error| (error.into(), Fallback::default()))?;
    match parse_state(&raw) {
        Ok(state) => Ok((state, raw)),
        Err(error) => Err((error, Fallback::from_raw(&raw))),
    }
}

fn parse_state(raw: &[u8]) -> Result<HandoffState, HandoffError> {
    #[derive(serde::Deserialize)]
    struct Versioned {
        version: u32,
    }
    let Versioned { version } = serde_json::from_slice(raw)?;
    if version != FORMAT_VERSION {
        return Err(HandoffError::Version { found: version });
    }
    Ok(serde_json::from_slice(raw)?)
}

fn adopt(
    (state, raw): (HandoffState, Vec<u8>),
) -> Result<HandedOffAgent, (HandoffError, Fallback)> {
    let fallback = || Fallback::from_raw(&raw);
    let record = state.agent;
    let pid = Pid::from_raw(record.pid)
        .ok_or_else(|| (HandoffError::NotAChild(record.pid), fallback()))?;
    // A child that is still running reports no status yet; anything else
    // (exited, or not ours) cannot be relayed.
    match rustix::process::waitpid(Some(pid), rustix::process::WaitOptions::NOHANG) {
        Ok(None) => {}
        _ => return Err((HandoffError::NotAChild(record.pid), fallback())),
    }
    let pending_output =
        hex::decode(&record.pending_output).map_err(|error| (error.into(), fallback()))?;
    let mut fds = Vec::new();
    for fd in [record.stdin, record.stdout, record.stderr] {
        // SAFETY: as for the state descriptor: inherited for this purpose.
        let borrowed = unsafe { rustix::fd::BorrowedFd::borrow_raw(fd) };
        if let Err(error) = rustix::io::fcntl_setfd(borrowed, FdFlags::CLOEXEC) {
            return Err((std::io::Error::from(error).into(), fallback()));
        }
        // SAFETY: open (fcntl succeeded) and owned by nothing else here.
        fds.push(unsafe { OwnedFd::from_raw_fd(fd) });
    }
    let [stdin, stdout, stderr] = <[OwnedFd; 3]>::try_from(fds).expect("three descriptors");
    Ok(HandedOffAgent::new(
        pid,
        stdin,
        stdout,
        stderr,
        pending_output,
        record.active_prompts,
    ))
}

/// The state in an unlinked file: nothing is left on disk whatever happens.
fn state_file(state: &[u8]) -> std::io::Result<std::fs::File> {
    let path = std::env::temp_dir().join(format!(".macrod-handoff-{}", uuid::Uuid::new_v4()));
    let mut file = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create_new(true)
        .open(&path)?;
    let _ = std::fs::remove_file(&path);
    file.write_all(state)?;
    file.rewind()?;
    Ok(file)
}

/// The thread reaping a killed agent; it yields the agent's exit status.
type Reaper = std::thread::JoinHandle<Option<rustix::process::WaitStatus>>;

fn kill_and_reap(pid: Pid) -> Reaper {
    let _ = rustix::process::kill_process_group(pid, rustix::process::Signal::KILL);
    // Reap it off-thread; a SIGKILLed child exits promptly.
    std::thread::spawn(move || {
        rustix::process::waitpid(Some(pid), rustix::process::WaitOptions::empty())
            .ok()
            .flatten()
            .map(|(_, status)| status)
    })
}
