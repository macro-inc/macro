//! Remove configured MCP header values from inbound frames before recording them.

use agent_client_protocol::schema::v1::McpServer;
use agent_runtime_protocol::domain::schema::v0::ToServerMessage;

const REDACTED: &str = "[REDACTED]";
const MIN_SECRET_LENGTH: usize = 16;

/// `message` without any header value of `servers`, or `None` when that could
/// not be established and the frame must not be recorded.
pub(super) fn redact_inbound_credentials(
    message: ToServerMessage,
    servers: &[McpServer],
) -> Option<ToServerMessage> {
    let mut secrets = Vec::new();
    for server in servers {
        let headers = match server {
            McpServer::Http(server) => &server.headers,
            McpServer::Sse(server) => &server.headers,
            _ => continue,
        };
        for header in headers {
            if header.value.len() >= MIN_SECRET_LENGTH {
                secrets.push(header.value.as_str());
            }
            if let Some(token) = header.value.strip_prefix("Bearer ")
                && token.len() >= MIN_SECRET_LENGTH
            {
                secrets.push(token);
            }
        }
    }
    if secrets.is_empty() {
        return Some(message);
    }

    let scrubbed = scrubbed_json(&message, secrets);
    match scrubbed {
        Ok(None) => Some(message),
        Ok(Some(scrubbed)) => Some(scrubbed),
        Err(error) => {
            // Never the error's text: a parse error can quote the frame.
            tracing::warn!(
                category = ?error.classify(),
                "dropping an inbound session frame that could not be scrubbed"
            );
            None
        }
    }
}

/// The frame with `secrets` replaced, or `None` when it holds none of them.
/// Longest first, so a whole header value goes before the token inside it.
fn scrubbed_json(
    message: &ToServerMessage,
    mut secrets: Vec<&str>,
) -> serde_json::Result<Option<ToServerMessage>> {
    let mut serialized = serde_json::to_string(message)?;
    secrets.sort_unstable_by_key(|secret| std::cmp::Reverse(secret.len()));
    secrets.dedup();

    let mut found = false;
    for secret in secrets {
        let escaped = serde_json::to_string(secret)?;
        let escaped = &escaped[1..escaped.len() - 1];
        if serialized.contains(escaped) {
            serialized = serialized.replace(escaped, REDACTED);
            found = true;
        }
    }

    if !found {
        return Ok(None);
    }
    serde_json::from_str(&serialized).map(Some)
}

#[cfg(test)]
mod test;
