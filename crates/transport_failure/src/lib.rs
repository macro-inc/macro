#![deny(missing_docs)]
//! Why an HTTP request produced no complete response, read from its error
//! chain, so a client can tell a connection lost in transit (safe to send
//! again on a new connection) from a timeout or a failure of its own.

#[cfg(test)]
mod test;

/// Why a request produced no response.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    serde::Serialize,
    strum::Display,
    strum::AsRefStr,
    strum::IntoStaticStr,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum TransportFailure {
    /// The request or connection attempt exceeded its deadline.
    Timeout,
    /// No connection could be established (refused, DNS, unreachable).
    Connect,
    /// The connection was closed or reset before the response completed.
    ConnectionClosed,
    /// Any other transport failure; `details` carries the cause.
    Other,
}

impl TransportFailure {
    /// Classify by the first cause in the chain that names a known failure.
    pub fn classify(error: &(dyn std::error::Error + 'static)) -> Self {
        let mut source: Option<&(dyn std::error::Error + 'static)> = Some(error);
        while let Some(cause) = source {
            if let Some(failure) = Self::from_cause(cause) {
                return failure;
            }
            source = cause.source();
        }
        Self::Other
    }

    /// The connection closed or refused before a complete response, so the
    /// same request can be sent again on a new connection. Whether that is
    /// safe depends on the request: the server may have acted on it.
    pub fn lost_connection(self) -> bool {
        matches!(self, Self::ConnectionClosed | Self::Connect)
    }

    fn from_cause(cause: &(dyn std::error::Error + 'static)) -> Option<Self> {
        if let Some(error) = cause.downcast_ref::<reqwest::Error>() {
            if error.is_timeout() {
                return Some(Self::Timeout);
            }
            if error.is_connect() {
                return Some(Self::Connect);
            }
        }
        if let Some(error) = cause.downcast_ref::<hyper::Error>() {
            if error.is_timeout() {
                return Some(Self::Timeout);
            }
            if error.is_incomplete_message() || error.is_closed() || error.is_canceled() {
                return Some(Self::ConnectionClosed);
            }
        }
        // Over HTTP/2 a recycled connection arrives as GOAWAY or RST_STREAM, and
        // `h2::Error` exposes no source for the I/O failure it wraps.
        if let Some(error) = cause.downcast_ref::<h2::Error>()
            && (error.is_go_away() || error.is_reset() || error.is_io())
        {
            return Some(Self::ConnectionClosed);
        }
        if let Some(error) = cause.downcast_ref::<std::io::Error>() {
            use std::io::ErrorKind;
            return match error.kind() {
                ErrorKind::TimedOut => Some(Self::Timeout),
                ErrorKind::ConnectionRefused
                | ErrorKind::HostUnreachable
                | ErrorKind::NetworkUnreachable
                | ErrorKind::AddrNotAvailable => Some(Self::Connect),
                ErrorKind::ConnectionReset
                | ErrorKind::ConnectionAborted
                | ErrorKind::BrokenPipe
                | ErrorKind::UnexpectedEof => Some(Self::ConnectionClosed),
                _ => None,
            };
        }
        None
    }
}
