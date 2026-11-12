//! HTTP clients for reaching MCP servers, which users choose by URL.
//!
//! Outside local development a server, and every OAuth endpoint its metadata
//! names, must be on the public internet. The check runs on the addresses
//! reqwest actually connects to (its DNS resolver), so a name cannot answer
//! public once and private the next time. IP-literal hosts never reach a
//! resolver and are checked by [`check_url`]. System proxies are ignored,
//! since a proxy would resolve the name instead of us.

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::sync::Arc;
use std::time::Duration;

use futures::StreamExt;
use macro_env::Environment;
use oauth2::{HttpRequest, HttpResponse};
use reqwest::dns::{Addrs, Name, Resolve, Resolving};
use rmcp::transport::auth::{
    AuthError, AuthorizationManager, OAuthHttpClient, OAuthHttpClientError, OAuthHttpClientFuture,
    OAuthHttpRequest,
};
use url::{Host, Url};

#[cfg(test)]
mod test;

/// Which addresses MCP traffic may connect to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AddressPolicy {
    /// Only public unicast addresses.
    PublicOnly,
    /// Any address, for local development against servers on this machine
    /// or the Docker network.
    AnyAddress,
}

impl AddressPolicy {
    /// Local development reaches local servers; every deployed environment
    /// is public-only.
    pub fn for_environment(environment: Environment) -> Self {
        match environment {
            Environment::Local => Self::AnyAddress,
            Environment::Develop | Environment::Production => Self::PublicOnly,
        }
    }

    fn allows(self, address: IpAddr) -> bool {
        match self {
            Self::AnyAddress => true,
            Self::PublicOnly => is_public(address),
        }
    }
}

/// The URL names a host the policy refuses.
#[derive(Debug, thiserror::Error)]
#[error("refusing to connect to `{host}`: not a public address")]
pub struct RefusedAddress {
    host: String,
}

/// The OAuth server answered with more than [`MAX_OAUTH_RESPONSE_BYTES`].
#[derive(Debug, thiserror::Error)]
#[error("OAuth response body is larger than {MAX_OAUTH_RESPONSE_BYTES} bytes")]
struct OAuthResponseTooLarge;

/// The guarded clients every connection to a user's MCP server goes
/// through, built once at startup.
#[derive(Clone)]
pub struct McpHttp {
    policy: AddressPolicy,
    transport: reqwest::Client,
    oauth: Arc<GuardedOAuthHttpClient>,
}

impl McpHttp {
    /// Build the clients for `policy`.
    pub fn new(policy: AddressPolicy) -> reqwest::Result<Self> {
        Ok(Self {
            policy,
            transport: transport_client(policy)?,
            oauth: GuardedOAuthHttpClient::new(policy)?,
        })
    }

    /// Refuse `url` if its host is an IP literal the policy does not allow.
    pub fn check_url(&self, url: &Url) -> Result<(), RefusedAddress> {
        check_url(self.policy, url)
    }

    /// The client for the MCP transport: same-origin 307/308 redirects only,
    /// no overall timeout.
    pub fn transport(&self) -> reqwest::Client {
        self.transport.clone()
    }

    /// An rmcp authorization manager for `server_url` whose OAuth requests
    /// all go through the guarded OAuth client.
    pub async fn authorization_manager(
        &self,
        server_url: &str,
    ) -> Result<AuthorizationManager, AuthError> {
        let url =
            Url::parse(server_url).map_err(|error| AuthError::InternalError(error.to_string()))?;
        self.check_url(&url)
            .map_err(|error| AuthError::InternalError(error.to_string()))?;
        AuthorizationManager::new_with_oauth_http_client(url, self.oauth.clone()).await
    }
}

/// Refuse a URL whose host is an IP literal the policy does not allow.
/// Named hosts are checked when they resolve.
pub fn check_url(policy: AddressPolicy, url: &Url) -> Result<(), RefusedAddress> {
    let address = match url.host() {
        Some(Host::Ipv4(address)) => IpAddr::V4(address),
        Some(Host::Ipv6(address)) => IpAddr::V6(address),
        Some(Host::Domain(_)) | None => return Ok(()),
    };
    if policy.allows(address) {
        Ok(())
    } else {
        Err(RefusedAddress {
            host: address.to_string(),
        })
    }
}

/// A client builder with the guarded resolver, no system proxy, and no
/// redirects. Callers add their own redirect policy and timeouts.
pub fn client_builder(policy: AddressPolicy) -> reqwest::ClientBuilder {
    reqwest::Client::builder()
        .dns_resolver(Arc::new(GuardedResolver { policy }))
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
}

/// The client for the MCP transport itself.
///
/// Follows only same-origin 307 and 308 redirects, as rmcp's default does
/// (servers commonly redirect to add a trailing slash); the hop resolves
/// through the same guarded resolver. No overall timeout: event streams stay
/// open for as long as a tool call runs. Idle pooling is off for the reason
/// rmcp gives (stalls reusing a connection whose body was not drained).
fn transport_client(policy: AddressPolicy) -> reqwest::Result<reqwest::Client> {
    const MAX_REDIRECTS: usize = 10;
    client_builder(policy)
        .pool_max_idle_per_host(0)
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            let preserves_body = matches!(
                attempt.status(),
                reqwest::StatusCode::TEMPORARY_REDIRECT | reqwest::StatusCode::PERMANENT_REDIRECT
            );
            let same_origin = attempt
                .previous()
                .first()
                .is_some_and(|original| original.origin() == attempt.url().origin());
            if preserves_body && same_origin && attempt.previous().len() <= MAX_REDIRECTS {
                attempt.follow()
            } else {
                attempt.stop()
            }
        }))
        .build()
}

/// OAuth discovery, registration, and token requests.
///
/// rmcp's own clients judge private addresses relative to the server URL and
/// honour system proxies, and a prebuilt client given to rmcp would skip its
/// per-request check of IP-literal endpoints (the token and registration
/// endpoints come from server-supplied metadata). This one checks every
/// request URL and never follows a redirect.
struct GuardedOAuthHttpClient {
    policy: AddressPolicy,
    client: reqwest::Client,
}

/// Same bound rmcp puts on OAuth response bodies.
const MAX_OAUTH_RESPONSE_BYTES: usize = 1024 * 1024;

impl GuardedOAuthHttpClient {
    fn new(policy: AddressPolicy) -> reqwest::Result<Arc<Self>> {
        let client = client_builder(policy)
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(30))
            .build()?;
        Ok(Arc::new(Self { policy, client }))
    }

    async fn send(&self, request: HttpRequest) -> Result<HttpResponse, OAuthHttpClientError> {
        let request = reqwest::Request::try_from(request)?;
        check_url(self.policy, request.url())?;
        let response = self.client.execute(request).await?;

        let mut builder = oauth2::http::Response::builder()
            .status(response.status())
            .version(response.version());
        for (name, value) in response.headers() {
            builder = builder.header(name, value);
        }
        let mut body = Vec::new();
        let mut chunks = response.bytes_stream();
        while let Some(chunk) = chunks.next().await {
            let chunk = chunk?;
            if body.len() + chunk.len() > MAX_OAUTH_RESPONSE_BYTES {
                return Err(Box::new(OAuthResponseTooLarge));
            }
            body.extend_from_slice(&chunk);
        }
        Ok(builder.body(body)?)
    }
}

impl OAuthHttpClient for GuardedOAuthHttpClient {
    // Redirects are never followed, whatever the request's policy asks.
    fn execute(&self, request: OAuthHttpRequest) -> OAuthHttpClientFuture<'_> {
        Box::pin(self.send(request.request))
    }
}

/// The resolver: an answer containing any refused address is refused whole.
struct GuardedResolver {
    policy: AddressPolicy,
}

impl Resolve for GuardedResolver {
    fn resolve(&self, name: Name) -> Resolving {
        let policy = self.policy;
        Box::pin(async move {
            // reqwest replaces the port with the URL's before connecting.
            let addresses = tokio::net::lookup_host((name.as_str(), 0)).await?;
            let addresses = screen(policy, name.as_str(), addresses.collect())?;
            Ok(Box::new(addresses.into_iter()) as Addrs)
        })
    }
}

/// Pass `addresses` only if the policy allows every one of them.
fn screen(
    policy: AddressPolicy,
    host: &str,
    addresses: Vec<SocketAddr>,
) -> Result<Vec<SocketAddr>, RefusedAddress> {
    match addresses
        .iter()
        .find(|address| !policy.allows(address.ip()))
    {
        Some(refused) => {
            tracing::warn!(
                host,
                address = %refused.ip(),
                "refusing MCP connection to a non-public address"
            );
            Err(RefusedAddress {
                host: host.to_owned(),
            })
        }
        None => Ok(addresses),
    }
}

/// Whether `address` is public unicast. IPv6 that wraps an IPv4 address
/// (mapped, compatible, NAT64) is judged as that IPv4 address.
pub(crate) fn is_public(address: IpAddr) -> bool {
    match address {
        IpAddr::V4(v4) => is_public_v4(v4),
        IpAddr::V6(v6) => match embedded_v4(v6) {
            Some(v4) => is_public_v4(v4),
            None => is_public_v6(v6),
        },
    }
}

fn is_public_v4(address: Ipv4Addr) -> bool {
    let [a, b, c, _] = address.octets();
    !(a == 0 // "this network"
        || address.is_private()
        || address.is_loopback()
        || address.is_link_local() // includes instance metadata
        || (a == 100 && (64..=127).contains(&b)) // CGNAT
        || (a == 192 && b == 0 && c == 0) // IETF protocol assignments
        || address.is_documentation()
        || (a == 198 && (b == 18 || b == 19)) // benchmarking
        || address.is_multicast()
        || a >= 240) // reserved and broadcast
}

fn embedded_v4(address: Ipv6Addr) -> Option<Ipv4Addr> {
    let [a, b, c, d, e, f, g, h] = address.segments();
    let low = Ipv4Addr::from((u32::from(g) << 16) | u32::from(h));
    match [a, b, c, d, e, f] {
        // Mapped, NAT64 well-known prefix, and the deprecated compatible form.
        [0, 0, 0, 0, 0, 0xffff] | [0x64, 0xff9b, 0, 0, 0, 0] | [0, 0, 0, 0, 0, 0] => Some(low),
        _ => None,
    }
}

fn is_public_v6(address: Ipv6Addr) -> bool {
    let [a, b, ..] = address.segments();
    // Global unicast only, minus the special ranges inside it.
    (a & 0xe000) == 0x2000
        && !(a == 0x2001 && b < 0x0200) // IETF assignments: Teredo, benchmarking, ORCHID
        && !(a == 0x2001 && b == 0x0db8) // documentation
        && !(a == 0x3fff && b < 0x1000) // documentation, 3fff::/20
        && a != 0x2002 // 6to4 wraps an arbitrary IPv4 address
}
