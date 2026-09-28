pub(crate) mod framing;
pub(crate) mod protocol;
#[allow(
    clippy::module_inception,
    reason = "Socket type lives in socket.rs within the socket module"
)]
mod socket;

pub(crate) use socket::{InboundBuffers, Socket};
