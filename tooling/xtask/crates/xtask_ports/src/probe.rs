//! Asking the host about one port.

use std::net::{TcpListener, TcpStream};
use std::time::Duration;

#[cfg(test)]
mod test;

/// Whether `port` can be bound on every interface right now, as a container
/// publishing it would need.
pub fn bindable(port: u16) -> bool {
    TcpListener::bind(("0.0.0.0", port)).is_ok()
}

/// Whether something accepts connections on `localhost:port` within `timeout`.
/// Use this, not [`bindable`], to find a stale server squatting a port: std's
/// listener sets `SO_REUSEADDR`, and on macOS that lets a wildcard bind
/// succeed beside a server bound to loopback (Linux refuses it).
pub fn accepting(port: u16, timeout: Duration) -> bool {
    TcpStream::connect_timeout(&([127, 0, 0, 1], port).into(), timeout).is_ok()
}
