//! What a stack takes from the machine: open files and local ports.
//!
//! A stack binds a port for each emulator, stand-in and service, and holds
//! hundreds of connections. The browser suite keeps a dozen stacks at once,
//! and the connections of the stacks it ended keep their local ports for
//! another minute (TIME_WAIT). Ports are therefore looked for again, after a
//! growing wait, when every port was held. A service's port is held until the
//! service starts ([`ReservedPort`]), so the harness's own listeners cannot
//! take it. When a stack cannot start, [`resources`] says what was left of
//! both.

use std::io;
use std::net::{Ipv4Addr, SocketAddr};
use std::time::Duration;

use rootcause::prelude::*;
use rustix::process::{Resource, Rlimit, getrlimit, setrlimit};
use tokio::net::{TcpListener, TcpSocket};

#[cfg(test)]
mod test;

/// The open files the stack server asks for: a dozen stacks with their
/// connections, with room to spare.
const OPEN_FILES: u64 = 65_536;
/// This process's open files.
const OPEN_FILE_DIR: &str = "/proc/self/fd";
/// The kernel's socket counts, IPv4 then IPv6.
const SOCKET_COUNTS: [&str; 2] = ["/proc/net/sockstat", "/proc/net/sockstat6"];
/// The range of local ports the kernel hands out to a socket bound to port 0
/// or connecting out.
const PORT_RANGE: &str = "/proc/sys/net/ipv4/ip_local_port_range";
/// How often a port is looked for, or a service started again on another
/// port, when the one picked was taken.
pub(crate) const PORT_ATTEMPTS: u8 = 5;
/// The wait after the first try that found its port taken; it doubles with
/// every try after, so the last of [`PORT_ATTEMPTS`] tries comes 7.5 s after
/// the first.
const PORT_BACKOFF: Duration = Duration::from_millis(500);
/// The connections a listener queues before it accepts them: more than the
/// 128 `TcpListener::bind` gives, for the bursts a dozen stacks' services
/// open at once.
const LISTEN_BACKLOG: u32 = 1024;
/// How the open-file limit reads when there is none.
const UNLIMITED: &str = "unlimited";

/// Raises this process's limit of open files to [`OPEN_FILES`], for the
/// stacks it starts and the services they run, which inherit it. Answers the
/// limit it replaced, or nothing when the limit was already as high. Fails,
/// saying what to raise, when the system allows no more.
pub fn raise_open_file_limit() -> Result<Option<u64>, Report> {
    let limit = getrlimit(Resource::Nofile);
    // No current limit is no limit.
    let Some(current) = limit.current.filter(|current| *current < OPEN_FILES) else {
        return Ok(None);
    };

    let raised = setrlimit(
        Resource::Nofile,
        Rlimit {
            current: Some(OPEN_FILES),
            maximum: limit.maximum,
        },
    );
    if let Err(error) = raised {
        let cause = match limit.maximum {
            Some(hard) if hard < OPEN_FILES => {
                format!("the hard limit is {hard}; raise it, e.g. `ulimit -Hn {OPEN_FILES}`")
            }
            // macOS reports no hard limit and refuses more than
            // `kern.maxfilesperproc`.
            _ => format!(
                "the system allows a process fewer (on macOS, raise `kern.maxfilesperproc` to \
                 {OPEN_FILES})"
            ),
        };
        bail!(
            "could not raise the open-file limit from {current} to {OPEN_FILES}: {cause} \
             ({error})"
        );
    }
    Ok(Some(current))
}

/// What this process and the machine had left when a stack could not start:
/// this process's open files against its limit, the kernel's TCP socket
/// counts (`tw` are those waiting out a closed connection, each keeping its
/// local port), and the range of local ports.
pub(crate) fn resources() -> String {
    let open_files = std::fs::read_dir(OPEN_FILE_DIR)
        .map(|files| files.count().to_string())
        .unwrap_or_else(|error| format!("unknown ({error})"));
    let limit = getrlimit(Resource::Nofile)
        .current
        .map_or_else(|| UNLIMITED.to_owned(), |current| current.to_string());

    let sockets: Vec<String> = SOCKET_COUNTS
        .iter()
        .map(|path| match std::fs::read_to_string(path) {
            Ok(counts) => counts
                .lines()
                .filter(|line| line.starts_with("TCP"))
                .collect::<Vec<_>>()
                .join("; "),
            Err(error) => format!("{path}: {error}"),
        })
        .collect();

    let ports = std::fs::read_to_string(PORT_RANGE).map_or_else(
        |error| format!("unknown ({error})"),
        |range| range.split_whitespace().collect::<Vec<_>>().join("-"),
    );

    format!(
        "what the machine had left: open files of the stack's process: {open_files} of \
         {limit}; {}; local ports {ports}",
        sockets.join("; ")
    )
}

/// A listener on a port of 127.0.0.1 the kernel picks.
pub(crate) async fn local_listener() -> io::Result<TcpListener> {
    with_a_free_port(|| {
        let socket = port_zero_socket()?;
        socket.bind(SocketAddr::from((Ipv4Addr::LOCALHOST, 0)))?;
        socket.listen(LISTEN_BACKLOG)
    })
    .await
}

/// A port for a service, which listens on every address, held until the
/// service is about to start.
///
/// Held, it is listened on, so no other socket can bind it: not the
/// listeners the harness puts in front of the service before starting it.
/// One that took the port it sends to would send every request back to
/// itself, opening a connection per turn until the machine runs out of
/// ports and files.
pub(crate) struct ReservedPort {
    port: u16,
    listener: TcpListener,
}

impl ReservedPort {
    /// The port held.
    pub(crate) fn port(&self) -> u16 {
        self.port
    }

    /// Lets the port go, for the service to listen on it. Another process
    /// can take it in between; a service that finds it taken is started
    /// again on another ([`PORT_ATTEMPTS`]).
    pub(crate) fn release(self) -> u16 {
        drop(self.listener);
        self.port
    }
}

/// Holds a port no socket holds on any address, for a service.
pub(crate) async fn free_port() -> io::Result<ReservedPort> {
    with_a_free_port(|| {
        let socket = port_zero_socket()?;
        socket.bind(SocketAddr::from((Ipv4Addr::UNSPECIFIED, 0)))?;
        let listener = socket.listen(1)?;
        Ok(ReservedPort {
            port: listener.local_addr()?.port(),
            listener,
        })
    })
    .await
}

/// The wait before the try after `attempt` when `attempt` found its port
/// taken.
pub(crate) fn port_backoff(attempt: u8) -> Duration {
    PORT_BACKOFF.saturating_mul(2u32.saturating_pow(u32::from(attempt.saturating_sub(1))))
}

/// A socket for binding port 0. Without `SO_REUSEADDR`: on Linux it changes
/// nothing for port 0, and on macOS it would let the kernel pick a port held
/// on another address, a [`ReservedPort`] included.
fn port_zero_socket() -> io::Result<TcpSocket> {
    TcpSocket::new_v4()
}

/// Runs `bind`, which binds port 0, again after a growing wait while the
/// kernel finds every local port held, at most [`PORT_ATTEMPTS`] times.
async fn with_a_free_port<T>(mut bind: impl FnMut() -> io::Result<T>) -> io::Result<T> {
    let mut attempt = 0;
    loop {
        attempt += 1;
        match bind() {
            Err(error) if attempt < PORT_ATTEMPTS && error.kind() == io::ErrorKind::AddrInUse => {
                tracing::warn!(attempt, "every local port was held; waiting for one");
                tokio::time::sleep(port_backoff(attempt)).await;
            }
            bound => return bound,
        }
    }
}
