//! HTTP adapter for agents that execute outside Macro.
//!
//! The endpoint URL is user-supplied, so this adapter applies the same
//! guardrails the webhook delivery path uses: HTTPS only, no redirects, a
//! request timeout, and rejection of hosts that resolve to private, loopback,
//! link-local or cloud-metadata addresses.
//!
//! The address rules are mirrored from
//! `crates/webhook/src/outbound/http_validator.rs`, whose validator is
//! `pub(super)` and therefore not reachable from this service. If a third
//! caller appears, that validator is worth promoting into a shared crate rather
//! than copied again.
//!
//! Known residual risk, shared with the webhook path it mirrors: the host is
//! resolved for validation and then resolved again by the request itself, so a
//! DNS record that changes between the two can still point the request at a
//! blocked address. Closing that means pinning the request to the address that
//! was validated; it is deliberately left as-is here so both paths keep the
//! same behaviour and can be fixed together.

#[cfg(test)]
mod test;

use std::net::{IpAddr, Ipv4Addr};
use std::time::Duration;

use anyhow::{Result, bail};
use futures::StreamExt;
use reqwest::{Client, Response, Url, redirect::Policy};
use tokio::net::lookup_host;

use crate::domain::models::{RemoteAgentRunRequest, RemoteAgentRunResponse, RemoteAgentTask};
use crate::domain::ports::RemoteAgentClient;

/// Wall-clock budget for a single remote run. Deliberately shorter than
/// [`crate::domain::models::MAX_ACTION_TIME`] so a hung endpoint releases the
/// action's claim well before the staleness window expires.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(120);
/// Bytes of a failed response echoed into the execution record.
const RESPONSE_PREVIEW_MAX_BYTES: usize = 4096;
/// Upper bound on a response body this service will buffer.
const MAX_RESPONSE_BYTES: usize = 1024 * 1024;
/// Upper bound on the assistant text stored from a successful response.
const MAX_OUTPUT_CHARS: usize = 100_000;

/// Whether non-public endpoints may be used. Self-hosted deployments own both
/// ends of the connection, so they can opt into local addresses; the default
/// matches the webhook default and refuses them.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum RemoteAgentEndpointPolicy {
    /// Require HTTPS endpoints that resolve to public addresses.
    #[default]
    PublicHttpsOnly,
    /// Allow HTTP and non-public addresses. Intended for local development and
    /// self-hosted deployments where the operator owns the remote agent.
    AllowLocal,
}

impl RemoteAgentEndpointPolicy {
    /// Whether a URL scheme is permitted by this policy.
    fn allows_scheme(self, scheme: &str) -> bool {
        scheme == "https" || (self == Self::AllowLocal && scheme == "http")
    }

    /// Whether loopback, private and link-local addresses are permitted.
    fn allows_local_addresses(self) -> bool {
        self == Self::AllowLocal
    }
}

/// `reqwest`-backed [`RemoteAgentClient`].
#[derive(Clone)]
pub struct ReqwestRemoteAgentClient {
    client: Client,
    endpoint_policy: RemoteAgentEndpointPolicy,
}

impl ReqwestRemoteAgentClient {
    /// Create a client that requires public HTTPS endpoints.
    pub fn new() -> Result<Self, reqwest::Error> {
        Self::new_with_endpoint_policy(RemoteAgentEndpointPolicy::default())
    }

    /// Create a client with an explicit endpoint policy.
    pub fn new_with_endpoint_policy(
        endpoint_policy: RemoteAgentEndpointPolicy,
    ) -> Result<Self, reqwest::Error> {
        let client = Client::builder()
            .timeout(REQUEST_TIMEOUT)
            .redirect(Policy::none())
            .build()?;

        Ok(Self {
            client,
            endpoint_policy,
        })
    }
}

impl RemoteAgentClient for ReqwestRemoteAgentClient {
    #[tracing::instrument(skip(self, task, request), fields(action_id = %request.action_id), err)]
    async fn run(
        &self,
        task: &RemoteAgentTask,
        request: &RemoteAgentRunRequest,
    ) -> Result<RemoteAgentRunResponse> {
        let url = validate_endpoint_url(&task.endpoint_url, self.endpoint_policy)?;
        validate_resolved_addresses(&url, self.endpoint_policy).await?;

        // `reqwest::Error`'s Display embeds the request URL, and this error is
        // persisted on the execution record and shown in the UI, so strip it.
        let response = self
            .client
            .post(url)
            .json(request)
            .send()
            .await
            .map_err(|e| anyhow::anyhow!("remote agent request failed: {}", e.without_url()))?;

        let status = response.status();
        let body = read_capped_body(response).await?;

        if !status.is_success() {
            bail!(
                "remote agent returned {}: {}",
                status.as_u16(),
                preview(&body)
            );
        }

        Ok(parse_response(&body))
    }
}

/// Read a response body, refusing to buffer more than
/// [`MAX_RESPONSE_BYTES`]. A remote agent is operator-run but not trusted to
/// bound its own output, and this runs inside the service process.
async fn read_capped_body(response: Response) -> Result<String> {
    let mut stream = response.bytes_stream();
    let mut buffer: Vec<u8> = Vec::new();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk
            .map_err(|e| anyhow::anyhow!("remote agent response could not be read: {}", e.without_url()))?;

        if buffer.len() + chunk.len() > MAX_RESPONSE_BYTES {
            bail!("remote agent response exceeded {MAX_RESPONSE_BYTES} bytes");
        }

        buffer.extend_from_slice(&chunk);
    }

    Ok(String::from_utf8_lossy(&buffer).into_owned())
}

/// Interpret a successful response body.
///
/// The documented contract is a JSON [`RemoteAgentRunResponse`]. Self-hosted
/// agents that answer with plain text are still usable: their body becomes the
/// output verbatim, which keeps the integration approachable without loosening
/// the documented shape.
fn parse_response(body: &str) -> RemoteAgentRunResponse {
    let output = match serde_json::from_str::<RemoteAgentRunResponse>(body) {
        Ok(parsed) => parsed.output,
        Err(_) => body.trim().to_string(),
    };

    RemoteAgentRunResponse {
        output: truncate_chars(&output, MAX_OUTPUT_CHARS),
    }
}

/// Parse and scheme-check the endpoint, rejecting obviously local hosts before
/// any DNS work happens.
fn validate_endpoint_url(value: &str, policy: RemoteAgentEndpointPolicy) -> Result<Url> {
    let Ok(url) = Url::parse(value) else {
        bail!("remote agent endpoint URL is invalid");
    };

    if !policy.allows_scheme(url.scheme()) {
        bail!("remote agent endpoint URL must use HTTPS");
    }

    let Some(host) = url.host_str() else {
        bail!("remote agent endpoint URL host is invalid");
    };

    if !policy.allows_local_addresses() && is_blocked_host(host) {
        bail!("remote agent endpoint host is not allowed");
    }

    Ok(url)
}

/// Resolve the endpoint host and reject it if any address it resolves to is
/// disallowed. Checking after resolution is what stops a public hostname that
/// points at an internal address.
async fn validate_resolved_addresses(url: &Url, policy: RemoteAgentEndpointPolicy) -> Result<()> {
    if policy.allows_local_addresses() {
        return Ok(());
    }

    let Some(host) = url.host_str().map(str::to_owned) else {
        bail!("remote agent endpoint URL host is invalid");
    };
    let Some(port) = url.port_or_known_default() else {
        bail!("remote agent endpoint URL port is invalid");
    };

    let resolved = match tokio::time::timeout(REQUEST_TIMEOUT, lookup_host((host.as_str(), port)))
        .await
    {
        Ok(Ok(resolved)) => resolved,
        Ok(Err(_)) => bail!("remote agent endpoint host could not be resolved"),
        Err(_) => bail!("remote agent endpoint host resolution timed out"),
    };

    let mut saw_address = false;
    for address in resolved {
        saw_address = true;
        if is_blocked_ip(address.ip()) {
            bail!("remote agent endpoint host resolves to a disallowed address");
        }
    }

    if !saw_address {
        bail!("remote agent endpoint host could not be resolved");
    }

    Ok(())
}

/// Hosts that are rejected without resolving them first.
fn is_blocked_host(host: &str) -> bool {
    let host = host.trim_matches(['[', ']']).to_ascii_lowercase();
    if host == "localhost" || host.ends_with(".localhost") {
        return true;
    }

    host.parse::<IpAddr>().is_ok_and(is_blocked_ip)
}

/// Addresses a scheduled action must never reach.
fn is_blocked_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => {
            ip.is_private()
                || ip.is_loopback()
                || ip.is_link_local()
                || ip.is_broadcast()
                || ip.is_unspecified()
                || ip.octets() == [169, 254, 169, 254]
                || is_shared_v4(ip)
        }
        IpAddr::V6(ip) => {
            // `::ffff:169.254.169.254` reaches the same host as the IPv4
            // address it embeds, so fold mapped addresses back onto the IPv4
            // rules before applying the v6 ones.
            if let Some(mapped) = ip.to_ipv4_mapped() {
                return is_blocked_ip(IpAddr::V4(mapped));
            }

            ip.is_loopback()
                || ip.is_unspecified()
                || ip.is_unique_local()
                || (ip.segments()[0] & 0xffc0) == 0xfe80
        }
    }
}

/// RFC 6598 shared address space (100.64.0.0/10), used for carrier-grade NAT
/// and inside some cloud networks. `Ipv4Addr::is_shared` is still unstable, so
/// check the prefix directly.
fn is_shared_v4(ip: Ipv4Addr) -> bool {
    let [first, second, ..] = ip.octets();
    first == 100 && (64..=127).contains(&second)
}

/// First [`RESPONSE_PREVIEW_MAX_BYTES`] of a body, on a char boundary.
fn preview(body: &str) -> &str {
    if body.len() <= RESPONSE_PREVIEW_MAX_BYTES {
        return body;
    }

    let mut end = RESPONSE_PREVIEW_MAX_BYTES;
    while end > 0 && !body.is_char_boundary(end) {
        end -= 1;
    }
    &body[..end]
}

/// Keep at most `max` characters, counting characters rather than bytes so the
/// result is always valid UTF-8.
fn truncate_chars(value: &str, max: usize) -> String {
    if value.chars().count() <= max {
        return value.to_string();
    }

    value.chars().take(max).collect()
}
