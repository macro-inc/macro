//! The setup tools: one per step of agent-led setup, named `Setup*`.
//!
//! Each tool is a thin call into [`AgentSetupService`]. Results are short
//! summaries with a `next_step` written as an instruction to the agent;
//! errors say what to do instead.

#[cfg(test)]
mod test;

use rootcause::compat::anyhow1::IntoAnyhow;
use std::{sync::Arc, time::Duration};

use ai_toolset::{
    AsyncTool, AsyncToolCollection, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations,
    ToolCallError, ToolResult,
};
use async_trait::async_trait;
use schemars::JsonSchema;
use serde::Deserialize;

use crate::domain::{
    models::{
        ConnectResult, DiscoverResult, ImportStarted, PlanRequest, ProposedPlan, Selection,
        SetupReport, SetupState,
    },
    ports::SetupError,
    service::{AgentSetupService, DISCOVERY_WAIT, IMPORT_WAIT, MAX_WAIT},
};

/// The setup tools' context: the service, when the host wires one.
#[derive(Clone, Default)]
pub struct SetupToolContext {
    service: Option<Arc<AgentSetupService>>,
}

impl SetupToolContext {
    /// A context backed by `service`.
    pub fn wired(service: Arc<AgentSetupService>) -> Self {
        Self {
            service: Some(service),
        }
    }

    /// A context for hosts without agent-led setup.
    pub fn unavailable() -> Self {
        Self::default()
    }

    fn service(&self) -> ToolResult<&Arc<AgentSetupService>> {
        self.service.as_ref().ok_or_else(|| ToolCallError {
            description:
                "Setup isn't available here. Send the person to Macro's web app to set up."
                    .to_owned(),
            internal_error: anyhow::anyhow!("agent setup service not wired into this host"),
        })
    }
}

/// The setup tools, for hosts where an outside agent drives setup (MCP).
pub fn setup_toolset() -> AsyncToolCollection<SetupToolContext> {
    AsyncToolCollection::new()
        .add_tool::<SetupGetState, SetupToolContext>()
        .add_tool::<SetupConnect, SetupToolContext>()
        .add_tool::<SetupDiscover, SetupToolContext>()
        .add_tool::<SetupProposePlan, SetupToolContext>()
        .add_tool::<SetupImport, SetupToolContext>()
        .add_tool::<SetupGetStatus, SetupToolContext>()
}

fn tool_error(step: &str, error: SetupError) -> ToolCallError {
    match error {
        SetupError::Actionable(message) => ToolCallError {
            internal_error: anyhow::anyhow!("{message}"),
            description: message,
        },
        SetupError::Internal(error) => ToolCallError {
            description: format!(
                "Macro hit an error while {step}. Try once more; if it fails again, tell the \
                 person this step is unavailable right now and call SetupGetState later."
            ),
            internal_error: error.into_anyhow(),
        },
    }
}

fn check_setup_id(request_context: &RequestContext, setup_id: Option<&str>) -> ToolResult<()> {
    AgentSetupService::check_setup_id(&request_context.user_id, setup_id)
        .map_err(|error| tool_error("checking the setup", error))
}

fn wait(seconds: Option<u32>, default: Duration) -> Duration {
    seconds
        .map(|seconds| Duration::from_secs(u64::from(seconds)))
        .unwrap_or(default)
        .min(MAX_WAIT)
}

/// One app's selection, as the agent writes it.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
pub struct SelectionInput {
    /// The app, e.g. "notion".
    #[schemars(description = "The app, as SetupDiscover named it, e.g. \"notion\".")]
    pub app: String,
    /// Bring every candidate.
    #[schemars(description = "True to bring every candidate SetupDiscover listed for this app.")]
    #[serde(default)]
    pub all: bool,
    /// Or these refs.
    #[schemars(description = "Or the refs of the candidates to bring, from SetupDiscover.")]
    #[serde(default)]
    pub refs: Vec<String>,
}

impl From<&SelectionInput> for Selection {
    fn from(input: &SelectionInput) -> Self {
        Selection {
            app: input.app.clone(),
            all: input.all,
            refs: input.refs.clone(),
        }
    }
}

/// Start here: the setup state and the next step.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[schemars(
    title = "SetupGetState",
    description = "Start here when the person wants to set up Macro, import their work into it, \
                   or connect a tool to it, and whenever you're unsure what's left. Returns the \
                   account, the Gmail inbox, each of the person's apps (connected, discovered, \
                   imported), what's missing, and next_step: the one thing to do next. \
                   Read-only; call it as often as you like."
)]
pub struct SetupGetState {
    /// The person's tools.
    #[schemars(
        description = "Every tool the person uses, by name, e.g. [\"notion\", \"linear\", \
                       \"gmail\", \"hubspot\"]. Check your other connected tools first; ask the \
                       person only if you can't tell."
    )]
    #[serde(default)]
    pub apps: Vec<String>,
    /// The setup handle from an earlier result.
    #[schemars(description = "setup_id from an earlier setup result, if you have one.")]
    #[serde(default)]
    pub setup_id: Option<String>,
}

impl ToolAnnotated for SetupGetState {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::read_only("Check Macro setup");
}

#[async_trait]
impl AsyncTool<SetupToolContext> for SetupGetState {
    type Output = SetupState;

    #[tracing::instrument(skip_all, fields(user_id = %request_context.user_id), err)]
    async fn call(
        &self,
        service_context: ServiceContext<SetupToolContext>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        check_setup_id(&request_context, self.setup_id.as_deref())?;
        service_context
            .service()?
            .state(&request_context.user_id, &self.apps)
            .await
            .map_err(|error| tool_error("reading the setup", error))
    }
}

/// Connect links for apps still to connect.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[schemars(
    title = "SetupConnect",
    description = "Get one Macro link per app the person still has to connect: Notion, Linear, \
                   Slack, Gmail, or another app Macro can connect. The person opens each link, \
                   approves access, and Macro records the connection and starts looking through \
                   the app. Show every link in one message and wait for them to say they're done. \
                   Apps already connected aren't linked again; Macro starts looking through them. \
                   Call again for a fresh link if one expired."
)]
pub struct SetupConnect {
    /// The apps to connect.
    #[schemars(description = "The apps to connect, e.g. [\"notion\", \"linear\"].")]
    pub apps: Vec<String>,
    /// The setup handle.
    #[schemars(description = "setup_id from an earlier setup result, if you have one.")]
    #[serde(default)]
    pub setup_id: Option<String>,
}

impl ToolAnnotated for SetupConnect {
    const ANNOTATIONS: ToolAnnotations =
        ToolAnnotations::additive("Get Macro connect links").with_idempotent();
}

#[async_trait]
impl AsyncTool<SetupToolContext> for SetupConnect {
    type Output = ConnectResult;

    #[tracing::instrument(skip_all, fields(user_id = %request_context.user_id), err)]
    async fn call(
        &self,
        service_context: ServiceContext<SetupToolContext>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        check_setup_id(&request_context, self.setup_id.as_deref())?;
        service_context
            .service()?
            .connect(&request_context.user_id, &self.apps)
            .await
            .map_err(|error| tool_error("preparing connect links", error))
    }
}

/// Discover what to bring over.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[schemars(
    title = "SetupDiscover",
    description = "See what Macro found in the person's connected apps: titles with short refs, \
                   grouped by area. Macro starts looking as soon as an app is connected; this \
                   waits up to 25 seconds while it finishes, so call it again if it is still \
                   looking. Read-only; you only see titles, the content stays in Macro."
)]
pub struct SetupDiscover {
    /// The apps to discover.
    #[schemars(description = "Connected apps to look through, e.g. [\"notion\", \"linear\"].")]
    pub apps: Vec<String>,
    /// How long to wait.
    #[schemars(description = "Seconds to wait for results, up to 45. Defaults to 25.")]
    #[serde(default)]
    pub wait_seconds: Option<u32>,
    /// The setup handle.
    #[schemars(description = "setup_id from an earlier setup result, if you have one.")]
    #[serde(default)]
    pub setup_id: Option<String>,
}

impl ToolAnnotated for SetupDiscover {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::read_only("See what Macro found");
}

#[async_trait]
impl AsyncTool<SetupToolContext> for SetupDiscover {
    type Output = DiscoverResult;

    #[tracing::instrument(skip_all, fields(user_id = %request_context.user_id), err)]
    async fn call(
        &self,
        service_context: ServiceContext<SetupToolContext>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        check_setup_id(&request_context, self.setup_id.as_deref())?;
        service_context
            .service()?
            .discover(
                &request_context.user_id,
                &self.apps,
                wait(self.wait_seconds, DISCOVERY_WAIT),
            )
            .await
            .map_err(|error| tool_error("reading what Macro found", error))
    }
}

/// Turn choices into the one plan to approve.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[schemars(
    title = "SetupProposePlan",
    description = "Turn the person's choices into the one plan they approve in the chat. Pass a \
                   selection per app (all, or refs from SetupDiscover), the refs they declined, \
                   other_apps (tools setup doesn't import, like a CRM, so the plan says what \
                   happens with them) and scope_notes in their words. Returns plan_text to show \
                   as written and plan_id for SetupImport. Changes nothing."
)]
pub struct SetupProposePlan {
    /// Per-app selections.
    #[schemars(description = "One selection per app to import from.")]
    #[serde(default)]
    pub selections: Vec<SelectionInput>,
    /// Declined refs.
    #[schemars(description = "Refs the person said no to. They are left out, not deleted.")]
    #[serde(default)]
    pub declined: Vec<String>,
    /// Tools setup does not import.
    #[schemars(
        description = "Other tools the person uses that setup doesn't import, e.g. [\"hubspot\"]."
    )]
    #[serde(default)]
    pub other_apps: Vec<String>,
    /// The person's own words about scope.
    #[schemars(
        description = "What the person asked for, in their words, e.g. \"just the Eng teamspace\"."
    )]
    #[serde(default)]
    pub scope_notes: Option<String>,
    /// The setup handle.
    #[schemars(description = "setup_id from an earlier setup result, if you have one.")]
    #[serde(default)]
    pub setup_id: Option<String>,
}

impl SetupProposePlan {
    fn request(&self) -> PlanRequest {
        PlanRequest {
            selections: self.selections.iter().map(Selection::from).collect(),
            declined: self.declined.clone(),
            scope_notes: self.scope_notes.clone(),
            other_apps: self.other_apps.clone(),
        }
    }
}

impl ToolAnnotated for SetupProposePlan {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::read_only("Propose a setup plan");
}

#[async_trait]
impl AsyncTool<SetupToolContext> for SetupProposePlan {
    type Output = ProposedPlan;

    #[tracing::instrument(skip_all, fields(user_id = %request_context.user_id), err)]
    async fn call(
        &self,
        service_context: ServiceContext<SetupToolContext>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        check_setup_id(&request_context, self.setup_id.as_deref())?;
        service_context
            .service()?
            .propose_plan(&request_context.user_id, &self.request())
            .await
            .map_err(|error| tool_error("building the plan", error))
    }
}

/// Run an approved plan.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[schemars(
    title = "SetupImport",
    description = "Start importing a plan the person approved. Call it only after they approved \
                   plan_text from SetupProposePlan, with that plan_id, exactly the same \
                   selections and declined refs, and approved: true. Macro does the copying; \
                   declined items are left out, never deleted. Safe to repeat: items already \
                   underway are skipped."
)]
pub struct SetupImport {
    /// The approved plan.
    #[schemars(description = "plan_id from SetupProposePlan.")]
    pub plan_id: String,
    /// The same selections.
    #[schemars(description = "Exactly the selections passed to SetupProposePlan.")]
    #[serde(default)]
    pub selections: Vec<SelectionInput>,
    /// The same declined refs.
    #[schemars(description = "Exactly the declined refs passed to SetupProposePlan.")]
    #[serde(default)]
    pub declined: Vec<String>,
    /// The person approved.
    #[schemars(description = "True only once the person approved the plan in the chat.")]
    pub approved: bool,
    /// The setup handle.
    #[schemars(description = "setup_id from an earlier setup result, if you have one.")]
    #[serde(default)]
    pub setup_id: Option<String>,
}

impl ToolAnnotated for SetupImport {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::additive("Import the approved plan")
        .with_idempotent()
        .with_open_world();
}

#[async_trait]
impl AsyncTool<SetupToolContext> for SetupImport {
    type Output = ImportStarted;

    #[tracing::instrument(skip_all, fields(user_id = %request_context.user_id), err)]
    async fn call(
        &self,
        service_context: ServiceContext<SetupToolContext>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        check_setup_id(&request_context, self.setup_id.as_deref())?;
        let request = PlanRequest {
            selections: self.selections.iter().map(Selection::from).collect(),
            declined: self.declined.clone(),
            ..PlanRequest::default()
        };
        service_context
            .service()?
            .import(
                &request_context.user_id,
                &request,
                &self.plan_id,
                self.approved,
            )
            .await
            .map_err(|error| tool_error("starting the import", error))
    }
}

/// Progress and the final report.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[schemars(
    title = "SetupGetStatus",
    description = "Import progress, then the final report: what came in (with links), what \
                   didn't and why, what stays connected, and what setup doesn't import yet with \
                   alternatives (Slack history, CRM via CSV). Waits up to 20 seconds while items \
                   are still copying in. Read-only."
)]
pub struct SetupGetStatus {
    /// The person's tools.
    #[schemars(description = "Every tool the person uses, so the report covers each of them.")]
    #[serde(default)]
    pub apps: Vec<String>,
    /// How long to wait.
    #[schemars(
        description = "Seconds to wait while items are copying in, up to 45. Defaults to 20."
    )]
    #[serde(default)]
    pub wait_seconds: Option<u32>,
    /// The setup handle.
    #[schemars(description = "setup_id from an earlier setup result, if you have one.")]
    #[serde(default)]
    pub setup_id: Option<String>,
}

impl ToolAnnotated for SetupGetStatus {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::read_only("Check import progress");
}

#[async_trait]
impl AsyncTool<SetupToolContext> for SetupGetStatus {
    type Output = SetupReport;

    #[tracing::instrument(skip_all, fields(user_id = %request_context.user_id), err)]
    async fn call(
        &self,
        service_context: ServiceContext<SetupToolContext>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        check_setup_id(&request_context, self.setup_id.as_deref())?;
        service_context
            .service()?
            .status(
                &request_context.user_id,
                &self.apps,
                wait(self.wait_seconds, IMPORT_WAIT),
            )
            .await
            .map_err(|error| tool_error("reading import progress", error))
    }
}
