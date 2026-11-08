//! Native Codex MCP launch configuration. Credentials stay in private files,
//! never in the shell command, command arguments, or a user's global config.

use super::store::write_private;
use serde_json::Value;
use std::path::{Path, PathBuf};

#[cfg(test)]
mod test;

pub(crate) struct CodexMcp {
    pub args: Vec<String>,
    pub environment: PathBuf,
}

pub(crate) fn codex(dir: &Path, servers: &[Value]) -> rootcause::Result<CodexMcp> {
    use std::os::unix::fs::DirBuilderExt as _;
    std::fs::DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(dir)?;
    let mut args = Vec::new();
    let mut environment = String::new();
    for (index, server) in servers.iter().enumerate() {
        let name = server["name"]
            .as_str()
            .ok_or_else(|| rootcause::report!("MCP server needs a name"))?;
        let mut config = toml_edit::InlineTable::new();
        if let Some(url) = server["url"].as_str() {
            if server["type"].as_str() != Some("http") {
                rootcause::bail!("Codex native MCP requires streamable HTTP, not SSE");
            }
            let parsed = reqwest::Url::parse(url)?;
            if !parsed.username().is_empty()
                || parsed.password().is_some()
                || parsed.query().is_some()
            {
                rootcause::bail!("MCP URL credentials must be supplied through headers");
            }
            config.insert("url", url.into());
            let mut headers = toml_edit::InlineTable::new();
            for (header_index, header) in server["headers"]
                .as_array()
                .into_iter()
                .flatten()
                .enumerate()
            {
                let name = header["name"]
                    .as_str()
                    .ok_or_else(|| rootcause::report!("invalid MCP header name"))?;
                let value = header["value"]
                    .as_str()
                    .ok_or_else(|| rootcause::report!("invalid MCP header value"))?;
                let variable = format!("MACROD_MCP_{index}_{header_index}");
                headers.insert(name, variable.clone().into());
                environment.push_str(&format!(
                    "export {variable}={}\n",
                    shell_words::quote(value)
                ));
            }
            config.insert("env_http_headers", headers.into());
        } else {
            let command = server["command"]
                .as_str()
                .ok_or_else(|| rootcause::report!("MCP server needs a command or URL"))?;
            let mut script = String::new();
            for entry in server["env"].as_array().into_iter().flatten() {
                let name = entry["name"]
                    .as_str()
                    .ok_or_else(|| rootcause::report!("invalid MCP environment name"))?;
                if !valid_variable(name) {
                    rootcause::bail!("invalid MCP environment variable");
                }
                let value = entry["value"]
                    .as_str()
                    .ok_or_else(|| rootcause::report!("invalid MCP environment value"))?;
                script.push_str(&format!("export {name}={}\n", shell_words::quote(value)));
            }
            let mut command_line = vec![command.to_owned()];
            for arg in server["args"].as_array().into_iter().flatten() {
                command_line.push(
                    arg.as_str()
                        .ok_or_else(|| rootcause::report!("invalid MCP argument"))?
                        .to_owned(),
                );
            }
            script.push_str(&format!("exec {}\n", shell_words::join(&command_line)));
            let launcher = dir.join(format!("mcp-{index}.sh"));
            write_private(&launcher, script.as_bytes())?;
            config.insert("command", "/bin/sh".into());
            let mut launch_args = toml_edit::Array::new();
            launch_args.push(launcher.to_string_lossy().as_ref());
            config.insert("args", launch_args.into());
        }
        // TOML quotes both the server key and the inline table's strings.
        args.extend([
            "--config".to_owned(),
            format!(
                "mcp_servers.{}={}",
                toml_edit::Value::from(name),
                toml_edit::Value::InlineTable(config)
            ),
        ]);
    }
    let environment_path = dir.join("mcp-environment.sh");
    write_private(&environment_path, environment.as_bytes())?;
    Ok(CodexMcp {
        args,
        environment: environment_path,
    })
}

fn valid_variable(name: &str) -> bool {
    let mut chars = name.chars();
    chars
        .next()
        .is_some_and(|ch| ch.is_ascii_alphabetic() || ch == '_')
        && chars.all(|ch| ch.is_ascii_alphanumeric() || ch == '_')
}
