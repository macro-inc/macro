#[allow(clippy::module_inception, reason = "Socket type lives in socket.rs within the socket module")]
mod socket;
pub(crate) mod protocol;

pub(crate) use socket::Socket;
