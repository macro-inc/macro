//! Writes the direct local service endpoints consumed by the TypeScript SDK.

use std::collections::BTreeMap;
use std::path::PathBuf;

use anyhow::{Context, Result};
use serde::Serialize;

use super::instance::{Instance, Port};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PortMap {
    instance: String,
    web_app_url: String,
    hosts: BTreeMap<&'static str, String>,
    sdk_webhook_host_receiver_port: u16,
}

/// Write the direct host-port endpoints for a local stack instance.
pub fn write(instance: &Instance) -> Result<PathBuf> {
    let url = |port| format!("http://localhost:{}", instance.port(port));
    let hosts = BTreeMap::from([
        ("agent-proxy", url(Port::AgentProxy)),
        ("auth", url(Port::Auth)),
        ("cognition", url(Port::DocCognition)),
        ("connection", url(Port::ConnGateway)),
        ("contacts", url(Port::Contacts)),
        ("email", url(Port::Email)),
        ("notification", url(Port::Notification)),
        ("properties", url(Port::DocStorage)),
        ("search", url(Port::DocStorage)),
        ("static-files", url(Port::StaticFile)),
        ("storage", url(Port::DocStorage)),
        ("unfurl", url(Port::Unfurl)),
    ]);
    let portmap = PortMap {
        instance: instance.name().to_string(),
        web_app_url: url(Port::Frontend),
        hosts,
        sdk_webhook_host_receiver_port: super::sdk_webhook::host_receiver_port(instance),
    };
    let path = instance.ensure_artifact_dir()?.join("portmap.json");
    let contents = serde_json::to_string_pretty(&portmap).context("serializing port map")?;
    std::fs::write(&path, format!("{contents}\n"))
        .with_context(|| format!("writing {}", path.display()))?;
    Ok(path)
}
