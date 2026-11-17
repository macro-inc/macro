//! `macrod mcp artifacts`: the stdio MCP server agents launch.

use std::path::PathBuf;
use std::sync::Arc;

use rmcp::model::{
    CallToolRequestParams, CallToolResponse, CallToolResult, ContentBlock, Implementation,
    ListToolsResult, PaginatedRequestParams, ServerCapabilities, ServerConfig, Tool,
};
use rmcp::service::RequestContext;
use rmcp::{RoleServer, ServerHandler, ServiceExt as _};
use schemars::JsonSchema;
use serde::Deserialize;

use super::files::{self, FileError};
use super::publish::{Egress, Publication, PublishError, Scene};
use super::{TOOL_NAME, environment, web_links};

#[cfg(test)]
mod test;

/// The tool's description: what it does, and how to build an artifact from
/// the user's own UI. Kept short; every session pays for it.
pub(crate) const DESCRIPTION: &str = "\
Publish a directory of HTML, CSS, JS, images and fonts from your workspace as a Macro artifact \
that people open, share and comment on. macrod reads, hashes and uploads the files itself; never \
paste file contents into this call. Needs index.html at the top; paths stay relative and links \
between files are relative (`theme.css`, `scenes/empty.html`). Pages run sandboxed with no \
network except scripts/styles from cdnjs.cloudflare.com, cdn.jsdelivr.net and unpkg.com. \
Pass artifact_id to publish a new version of an artifact (scenes are kept unless given). \
To show the user's own UI: find its design system (token files, Tailwind theme, the app's \
compiled CSS); render the real components with the repo's dev server or a small harness page \
in a headless browser and serialize the markup plus every stylesheet rule; inline the fonts. \
Write that once as theme.css, then build each scene page from the captured markup and classes, \
with index.html listing the scenes. Define colors as :root tokens with [data-theme=\"dark\"] \
overrides, and set data-theme from the page's ?theme= parameter.";

/// The tool's input.
#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
#[schemars(title = "PublishArtifact")]
pub(crate) struct PublishArtifact {
    /// The artifact's top directory, relative to the workspace; the
    /// workspace itself when unset.
    pub(crate) dir: Option<String>,
    /// Files to publish, relative to `dir`; every file under `dir` except
    /// dot-files when unset.
    pub(crate) paths: Option<Vec<String>>,
    /// The artifact to publish a new version of. Omit to create one.
    pub(crate) artifact_id: Option<String>,
    /// A new artifact's name. Required when creating.
    pub(crate) name: Option<String>,
    /// Named pages people can open and share on their own.
    pub(crate) scenes: Option<Vec<Scene>>,
    /// What changed in this version.
    pub(crate) message: Option<String>,
    /// The version you last saw; the publish is refused if someone has
    /// published since.
    pub(crate) base_version: Option<u32>,
}

#[derive(Debug, thiserror::Error)]
enum ToolError {
    #[error(transparent)]
    Files(#[from] FileError),
    #[error(transparent)]
    Publish(#[from] PublishError),
    #[error("reading the files stopped: {0}")]
    Reading(#[from] tokio::task::JoinError),
}

/// The server: one workspace, one session's egress.
pub(crate) struct ArtifactServer {
    root: PathBuf,
    egress: Egress,
    web_url: String,
}

impl ArtifactServer {
    pub(crate) fn new(root: PathBuf, egress: Egress, web_url: String) -> Self {
        Self {
            root,
            egress,
            web_url,
        }
    }

    /// Run the tool, answering with the published artifact's links.
    pub(crate) async fn publish(
        &self,
        input: PublishArtifact,
    ) -> Result<serde_json::Value, String> {
        self.try_publish(input)
            .await
            .map_err(|error| error.to_string())
    }

    async fn try_publish(&self, input: PublishArtifact) -> Result<serde_json::Value, ToolError> {
        let root = self.root.clone();
        let dir = input.dir.clone();
        let paths = input.paths.clone();
        let files = tokio::task::spawn_blocking(move || {
            files::collect(&root, dir.as_deref(), paths.as_deref())
        })
        .await??;

        let published = self
            .egress
            .publish(Publication {
                files,
                artifact_id: input.artifact_id,
                name: input.name,
                scenes: input.scenes,
                message: input.message,
                base_version: input.base_version,
            })
            .await?;
        let (web_url, scene_urls) =
            web_links(&self.web_url, &published.artifact_id, &published.scenes);
        Ok(serde_json::json!({
            "artifact_id": published.artifact_id,
            "version": published.version,
            "web_url": web_url,
            "scene_urls": scene_urls,
            "uploaded_files": published.uploaded,
            "reused_files": published.reused,
        }))
    }
}

impl ServerHandler for ArtifactServer {
    fn get_info(&self) -> ServerConfig {
        let mut info = ServerConfig::new(ServerCapabilities::builder().enable_tools().build());
        info.server_info = Implementation::new(super::SERVER_NAME, env!("CARGO_PKG_VERSION"));
        info
    }

    async fn list_tools(
        &self,
        _: Option<PaginatedRequestParams>,
        _: RequestContext<RoleServer>,
    ) -> Result<ListToolsResult, rmcp::ErrorData> {
        Ok(ListToolsResult {
            tools: vec![tool()?],
            ..Default::default()
        })
    }

    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        _: RequestContext<RoleServer>,
    ) -> Result<CallToolResponse, rmcp::ErrorData> {
        if request.name != TOOL_NAME {
            return Err(rmcp::ErrorData::invalid_params("unknown tool", None));
        }
        let input: PublishArtifact = serde_json::from_value(serde_json::Value::Object(
            request.arguments.unwrap_or_default(),
        ))
        .map_err(|error| rmcp::ErrorData::invalid_params(error.to_string(), None))?;
        Ok(match self.publish(input).await {
            Ok(value) => CallToolResult::success(vec![ContentBlock::text(value.to_string())]),
            Err(error) => CallToolResult::error(vec![ContentBlock::text(error)]),
        }
        .into())
    }
}

fn tool() -> Result<Tool, rmcp::ErrorData> {
    let schema = serde_json::to_value(schemars::schema_for!(PublishArtifact))
        .map_err(|_| rmcp::ErrorData::internal_error("tool schema unavailable", None))?;
    let Some(schema) = schema.as_object().cloned() else {
        return Err(rmcp::ErrorData::internal_error(
            "tool schema unavailable",
            None,
        ));
    };
    Ok(Tool::new(TOOL_NAME, DESCRIPTION, Arc::new(schema)))
}

/// Serve the tool on stdio until the agent closes it.
pub(crate) async fn serve() -> rootcause::Result<()> {
    let egress = Egress::new(
        &environment::MacrodEgressUrl::new()?,
        &environment::MacrodSessionToken::new()?,
    )?;
    let server = ArtifactServer::new(
        super::root()?,
        egress,
        environment::MacrodWebUrl::new()?.to_string(),
    );
    let running = server.serve(rmcp::transport::stdio()).await?;
    running.waiting().await?;
    Ok(())
}
