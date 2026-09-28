//! Minimal network access required by Macro's session-scoped MCP gateway.
use super::model::{Error, Result};
use serde_json::{Value, json};

/// Add the deployment's exact gateway host to a limited environment's allowlist.
/// Omitted fields in Claude's update API retain their values, so the patch never
/// changes package access, connector access, or any other environment setting.
/// Explicitly disabled or unknown policies require the owner to configure them.
pub fn gateway_network_patch(network: &Value, host: &str) -> Result<Option<Value>> {
    match network["type"].as_str() {
        Some("unrestricted") => return Ok(None),
        Some("limited") => {}
        _ => return Err(Error::EnvironmentNetwork),
    }
    let hosts = network["allowed_hosts"]
        .as_array()
        .filter(|hosts| hosts.iter().all(Value::is_string))
        .ok_or(Error::EnvironmentNetwork)?;
    if hosts.iter().any(|entry| entry.as_str() == Some(host)) {
        return Ok(None);
    }
    let mut hosts = hosts.clone();
    hosts.push(json!(host));
    Ok(Some(json!({"type":"limited", "allowed_hosts":hosts})))
}

#[cfg(test)]
mod test;
