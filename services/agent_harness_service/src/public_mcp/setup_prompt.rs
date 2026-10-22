//! The `setup` MCP prompt, and how the server learns whether a person's
//! workspace is set up when they connect.
//!
//! Server instructions carry the setup flow on their own; the prompt is an
//! extra for clients that surface prompts, so a person can pick "Set up
//! Macro" and get the full checklist as their request.

#[cfg(test)]
mod test;

use std::{pin::Pin, sync::Arc, time::Duration};

use agent_setup::domain::service::AgentSetupService;
use macro_user_id::user_id::MacroUserIdStr;
use prompt::mcp_setup::SetupHint;
use rmcp::model::{
    GetPromptRequestParams, GetPromptResult, Prompt, PromptArgument, PromptMessage,
    PromptMessageRole,
};

/// The prompt's name.
pub const SETUP_PROMPT: &str = "setup";
const TOOLS_ARGUMENT: &str = "tools";
/// How long `initialize` waits to learn the setup state before falling back
/// to instructions that work either way.
const HINT_TIMEOUT: Duration = Duration::from_millis(1500);

/// The prompts this server offers.
pub fn prompts() -> Vec<Prompt> {
    vec![
        Prompt::new(
            SETUP_PROMPT,
            Some(
                "Set up your Macro workspace from here: connect your tools, agree what to bring \
                 over, import it, and get a report of what came in.",
            ),
            Some(vec![
                PromptArgument::new(TOOLS_ARGUMENT)
                    .with_title("Your tools")
                    .with_description(
                        "The tools you use, e.g. Notion, Linear, Gmail. Optional: your agent can \
                         check your connected tools.",
                    )
                    .with_required(false),
            ]),
        )
        .with_title("Set up Macro"),
    ]
}

/// The `setup` prompt's messages, or `None` for another prompt name.
pub fn get(request: &GetPromptRequestParams) -> Option<GetPromptResult> {
    if request.name != SETUP_PROMPT {
        return None;
    }
    let tools = request
        .arguments
        .as_ref()
        .and_then(|arguments| arguments.get(TOOLS_ARGUMENT))
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|tools| !tools.is_empty());
    let ask = match tools {
        Some(tools) => format!("Set up my Macro workspace. I use {tools}."),
        None => "Set up my Macro workspace. Check my other connected tools to see what I use."
            .to_owned(),
    };
    let text = format!(
        "{ask} Use Macro's Setup tools and this checklist.\n\n{}",
        system_skills::macro_setup::SKILL.render_content()
    );
    Some(
        GetPromptResult::new(vec![PromptMessage::new_text(PromptMessageRole::User, text)])
            .with_description("Set up Macro with your agent"),
    )
}

/// Boxed future returned by [`SetupHintSource`].
pub type HintFuture<'a> = Pin<Box<dyn Future<Output = SetupHint> + Send + 'a>>;

/// Tells the server whether a person's workspace is set up.
pub trait SetupHintSource: Send + Sync + 'static {
    /// The person's setup state, or [`SetupHint::Unknown`] when it can't be
    /// told quickly.
    fn hint(&self, user: MacroUserIdStr<'static>) -> HintFuture<'_>;
}

/// A source that never knows.
#[cfg(test)]
pub struct UnknownSetup;

#[cfg(test)]
impl SetupHintSource for UnknownSetup {
    fn hint(&self, _user: MacroUserIdStr<'static>) -> HintFuture<'_> {
        Box::pin(async { SetupHint::Unknown })
    }
}

/// Setup state from the setup service.
pub struct ServiceSetupHint {
    service: Arc<AgentSetupService>,
}

impl ServiceSetupHint {
    /// A source backed by the setup service.
    pub fn new(service: Arc<AgentSetupService>) -> Self {
        Self { service }
    }
}

impl SetupHintSource for ServiceSetupHint {
    fn hint(&self, user: MacroUserIdStr<'static>) -> HintFuture<'_> {
        Box::pin(async move {
            match tokio::time::timeout(HINT_TIMEOUT, self.service.leads_with_setup(&user)).await {
                Ok(Ok(true)) => SetupHint::NotSetUp,
                Ok(Ok(false)) => SetupHint::SetUp,
                Ok(Err(error)) => {
                    tracing::warn!(error=?error, "failed to read setup state for instructions");
                    SetupHint::Unknown
                }
                Err(_) => SetupHint::Unknown,
            }
        })
    }
}
