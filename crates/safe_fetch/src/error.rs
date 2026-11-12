//! Why a fetch was refused or failed.

use std::net::IpAddr;

use reqwest::StatusCode;

use crate::policy::MediaType;
use crate::resolver::RefusedResolution;

/// Building the HTTP client failed. Only happens at startup.
#[derive(Debug, thiserror::Error)]
#[error("could not build the safe fetch HTTP client")]
pub struct BuildError(#[from] reqwest::Error);

/// A fetch that did not produce an acceptable response.
///
/// Variants split into three groups: the URL itself was refused before any
/// network traffic, the upstream misbehaved, or a limit was hit while reading.
/// [`FetchError::is_refused_by_policy`] tells the first group apart.
#[derive(Debug, thiserror::Error)]
pub enum FetchError {
    /// The URL did not parse.
    #[error("invalid URL")]
    InvalidUrl(#[source] url::ParseError),
    /// The URL (or a redirect target) uses a scheme the policy refuses.
    #[error("URL scheme {scheme} is not allowed")]
    SchemeNotAllowed {
        /// The refused scheme.
        scheme: String,
    },
    /// The URL (or a redirect target) names a port the policy refuses.
    #[error("port {port} is not allowed")]
    PortNotAllowed {
        /// The refused port.
        port: u16,
    },
    /// The URL carries a username or password.
    #[error("URLs with credentials are not allowed")]
    CredentialsInUrl,
    /// The URL has no host.
    #[error("URL has no host")]
    MissingHost,
    /// The host, or an address it resolved to, is not a public address.
    #[error("{address} is not a public address")]
    AddressNotAllowed {
        /// The refused address.
        address: IpAddr,
    },
    /// The host did not resolve to any address. The resolver logs the cause.
    #[error("host did not resolve")]
    Resolution,
    /// A redirect had no usable `Location`.
    #[error("redirect has no valid Location")]
    InvalidRedirect,
    /// More redirects than the policy allows.
    #[error("more than {limit} redirects")]
    TooManyRedirects {
        /// The policy's redirect limit.
        limit: u8,
    },
    /// The upstream answered with a non-2xx, non-redirect status.
    #[error("upstream returned {status}")]
    Status {
        /// The upstream status.
        status: StatusCode,
    },
    /// The response declared a media type the policy refuses (or none).
    #[error("content type {media_type:?} is not allowed")]
    MediaTypeNotAllowed {
        /// The declared media type, when there was a parseable one.
        media_type: Option<MediaType>,
    },
    /// The body is larger than the policy allows.
    #[error("body exceeds {limit} bytes")]
    BodyTooLarge {
        /// The policy's byte limit.
        limit: u64,
    },
    /// The upstream stopped sending body bytes for longer than the idle limit.
    #[error("body stalled")]
    BodyStalled,
    /// The whole fetch ran past the total timeout.
    #[error("fetch exceeded its total timeout")]
    TotalTimeout,
    /// The TCP or TLS connection could not be opened.
    #[error("could not connect upstream")]
    Connect(#[source] reqwest::Error),
    /// Any other transport failure from the HTTP client.
    #[error("upstream transport failed")]
    Transport(#[source] reqwest::Error),
}

impl FetchError {
    /// Whether the fetch was refused by policy before (or instead of) talking
    /// to the upstream. Callers usually answer these 4xx and the rest 5xx.
    #[must_use]
    pub const fn is_refused_by_policy(&self) -> bool {
        match self {
            Self::InvalidUrl(_)
            | Self::SchemeNotAllowed { .. }
            | Self::PortNotAllowed { .. }
            | Self::CredentialsInUrl
            | Self::MissingHost
            | Self::AddressNotAllowed { .. } => true,
            Self::Resolution
            | Self::InvalidRedirect
            | Self::TooManyRedirects { .. }
            | Self::Status { .. }
            | Self::MediaTypeNotAllowed { .. }
            | Self::BodyTooLarge { .. }
            | Self::BodyStalled
            | Self::TotalTimeout
            | Self::Connect(_)
            | Self::Transport(_) => false,
        }
    }

    /// A stable, low-cardinality name for span fields and metrics.
    #[must_use]
    pub const fn kind(&self) -> &'static str {
        match self {
            Self::InvalidUrl(_) => "invalid_url",
            Self::SchemeNotAllowed { .. } => "scheme_not_allowed",
            Self::PortNotAllowed { .. } => "port_not_allowed",
            Self::CredentialsInUrl => "credentials_in_url",
            Self::MissingHost => "missing_host",
            Self::AddressNotAllowed { .. } => "address_not_allowed",
            Self::Resolution => "resolution",
            Self::InvalidRedirect => "invalid_redirect",
            Self::TooManyRedirects { .. } => "too_many_redirects",
            Self::Status { .. } => "status",
            Self::MediaTypeNotAllowed { .. } => "media_type_not_allowed",
            Self::BodyTooLarge { .. } => "body_too_large",
            Self::BodyStalled => "body_stalled",
            Self::TotalTimeout => "total_timeout",
            Self::Connect(_) => "connect",
            Self::Transport(_) => "transport",
        }
    }

    /// Classify a reqwest error, recovering the resolver's refusal when DNS
    /// answered with a non-public address. reqwest wraps the resolver's error
    /// a few layers deep, so walk the source chain to find it.
    pub(crate) fn from_reqwest(error: reqwest::Error) -> Self {
        let mut source: Option<&(dyn std::error::Error + 'static)> = Some(&error);
        while let Some(cause) = source {
            if let Some(refusal) = cause.downcast_ref::<RefusedResolution>() {
                return match refusal {
                    RefusedResolution::AddressNotAllowed { address } => {
                        Self::AddressNotAllowed { address: *address }
                    }
                    RefusedResolution::Unresolved => Self::Resolution,
                };
            }
            source = cause.source();
        }

        if error.is_connect() {
            Self::Connect(error)
        } else {
            Self::Transport(error)
        }
    }
}
