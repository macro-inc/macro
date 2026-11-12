//! What a fetch is allowed to do: schemes, ports, redirects, time, size, and
//! media types.

use std::time::Duration;

use url::Url;

use crate::address::AddressPolicy;

/// Everything a [`crate::SafeFetcher`] enforces. There are no defaults: each
/// caller states its limits, so reading the constructor tells you the policy.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FetchPolicy {
    /// Which URL schemes may be fetched, on the first hop and every redirect.
    pub schemes: AllowedSchemes,
    /// Which ports may be fetched.
    pub ports: AllowedPorts,
    /// Which resolved addresses may be connected to.
    pub addresses: AddressPolicy,
    /// Redirects followed before the fetch fails. Zero refuses every redirect.
    pub max_redirects: u8,
    /// Time allowed to open one TCP connection (and finish TLS).
    pub connect_timeout: Duration,
    /// Time allowed for the whole fetch: every hop and the full body.
    pub total_timeout: Duration,
    /// Longest gap between two body chunks before the read is abandoned. This
    /// stops a server that trickles bytes from holding a worker open.
    pub body_idle_timeout: Duration,
    /// Largest body accepted, by `Content-Length` and while streaming.
    pub max_body_bytes: u64,
    /// Media types a successful response may declare.
    pub media_types: AcceptedMediaTypes,
}

/// A URL scheme a fetch may use.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Scheme {
    /// Plain HTTP.
    Http,
    /// HTTP over TLS.
    Https,
}

impl Scheme {
    /// Parse a URL's scheme; anything other than `http` or `https` is `None`.
    #[must_use]
    pub fn of(url: &Url) -> Option<Self> {
        match url.scheme() {
            "http" => Some(Self::Http),
            "https" => Some(Self::Https),
            _ => None,
        }
    }

    /// The port a URL of this scheme uses when it names none.
    #[must_use]
    pub const fn default_port(self) -> u16 {
        match self {
            Self::Http => 80,
            Self::Https => 443,
        }
    }
}

/// The schemes a policy accepts.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AllowedSchemes {
    /// `http` and `https`; for content a browser would also load over either.
    HttpAndHttps,
    /// `https` only; for anything carrying credentials or signed payloads.
    HttpsOnly,
}

impl AllowedSchemes {
    /// Whether `scheme` is accepted.
    #[must_use]
    pub const fn allows(self, scheme: Scheme) -> bool {
        match self {
            Self::HttpAndHttps => true,
            Self::HttpsOnly => matches!(scheme, Scheme::Https),
        }
    }
}

/// The ports a policy accepts.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AllowedPorts {
    /// Only the scheme's own port: 80 for `http`, 443 for `https`.
    SchemeDefault,
    /// Any port. Address filtering still applies, so this only reaches public
    /// hosts; use it where existing behaviour already allowed any port.
    Any,
}

impl AllowedPorts {
    /// Whether `port` is accepted for `scheme`.
    #[must_use]
    pub const fn allows(self, scheme: Scheme, port: u16) -> bool {
        if port == scheme.default_port() {
            return true;
        }

        match self {
            Self::SchemeDefault => false,
            Self::Any => true,
        }
    }
}

/// A lowercased `type/subtype`, without parameters.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct MediaType(String);

impl MediaType {
    /// The essence of a `Content-Type` value: `Image/PNG; q=1` is `image/png`.
    /// `None` when the value has no `type/subtype` shape.
    #[must_use]
    pub fn from_content_type(value: &str) -> Option<Self> {
        let essence = value
            .split(';')
            .next()
            .map(str::trim)
            .map(str::to_ascii_lowercase)?;

        let (kind, subtype) = essence.split_once('/')?;
        if kind.is_empty() || subtype.is_empty() {
            return None;
        }

        Some(Self(essence))
    }

    /// `application/octet-stream`, which many image hosts send for images.
    #[must_use]
    pub fn octet_stream() -> Self {
        Self("application/octet-stream".to_owned())
    }

    /// The `type/subtype` string.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Display for MediaType {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

/// The `Content-Type`s a successful response may carry.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AcceptedMediaTypes {
    any_image_except_svg: bool,
    also: Vec<MediaType>,
}

impl AcceptedMediaTypes {
    /// Every `image/*` type except SVG. SVG is a document that can carry
    /// script and, opened directly from a proxy's origin, runs as that origin.
    #[must_use]
    pub fn images_except_svg() -> Self {
        Self {
            any_image_except_svg: true,
            also: Vec::new(),
        }
    }

    /// Add one more media type, e.g. `application/octet-stream` for an image
    /// proxy whose upstreams mislabel images (or send no `Content-Type`,
    /// which HTTP defines as octet-stream).
    #[must_use]
    pub fn and(mut self, media_type: MediaType) -> Self {
        self.also.push(media_type);
        self
    }

    /// Whether a response declaring `media_type` is accepted.
    #[must_use]
    pub fn accepts(&self, media_type: &MediaType) -> bool {
        let is_image = media_type.as_str().starts_with("image/");
        let is_svg = media_type.as_str().starts_with("image/svg");
        if self.any_image_except_svg && is_image && !is_svg {
            return true;
        }

        self.also.contains(media_type)
    }
}
