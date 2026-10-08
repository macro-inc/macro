use super::*;
use crate::domain::engine::AgentIdentity;
use agent_session::domain::model::AgentSessionId;
use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolResult,
};
use async_trait::async_trait;
use schemars::JsonSchema;
use serde::Deserialize;
use std::sync::Mutex;

/// A stand-in for the toolset prompt, short enough to assert on positionally.
const TOOLS: &str = "TOOLS";

#[test]
fn cached_definitions_keep_client_capabilities_and_reviewable_tools() {
    let tools = NativeTools::new();
    let supported = tools.for_turn(true);
    let unsupported = tools.for_turn(false);

    assert!(supported.tools.contains_key("AskUser"));
    assert!(!unsupported.tools.contains_key("AskUser"));
    assert!(Arc::ptr_eq(&supported, &tools.for_turn(true)));
    assert!(Arc::ptr_eq(&unsupported, &tools.for_turn(false)));
    assert_eq!(
        supported
            .tools
            .keys()
            .filter(|name| name.as_str() != "AskUser")
            .collect::<Vec<_>>(),
        unsupported.tools.keys().collect::<Vec<_>>()
    );
    for tools in [supported, unsupported] {
        for name in ["SendEmail", "CreateCalendarEvent"] {
            assert!(tools.user_tools.contains_key(name));
        }
    }
}

#[derive(Deserialize, JsonSchema)]
#[schemars(title = "ReadTurnContext", description = "Read this call's context.")]
struct ReadTurnContext {}

impl ToolAnnotated for ReadTurnContext {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::read_only("Read context");
}

#[async_trait]
impl AsyncTool<String> for ReadTurnContext {
    type Output = serde_json::Value;

    async fn call(
        &self,
        context: ServiceContext<String>,
        request: RequestContext,
    ) -> ToolResult<Self::Output> {
        Ok(serde_json::json!({
            "context": context.0,
            "user": request.user_id.to_string(),
        }))
    }
}

struct RecordingGate {
    refused: AgentSessionId,
    calls: Mutex<Vec<AgentSessionId>>,
}

impl NativeToolGate for RecordingGate {
    fn check<'a>(
        &'a self,
        session: AgentSessionId,
        _tool: &'a str,
        _arguments: &'a serde_json::Value,
    ) -> std::pin::Pin<Box<dyn Future<Output = NativeToolVerdict> + Send + 'a>> {
        Box::pin(async move {
            self.calls.lock().unwrap().push(session);
            if session == self.refused {
                NativeToolVerdict::Refuse("not approved".to_owned())
            } else {
                NativeToolVerdict::Run
            }
        })
    }
}

#[tokio::test]
async fn shared_definitions_keep_the_callers_context_and_check_each_sessions_gate() {
    let definitions: Arc<dyn AiToolSet<String> + Send + Sync> =
        Arc::new(AsyncToolCollection::<String>::new().add_tool::<ReadTurnContext, String>());
    let allowed = AgentSessionId::new();
    let refused = AgentSessionId::new();
    let gate = Arc::new(RecordingGate {
        refused,
        calls: Mutex::new(Vec::new()),
    });
    for (session, user, label) in [
        (allowed, "macro|first@example.com", "first turn"),
        (refused, "macro|second@example.com", "refused turn"),
        (allowed, "macro|third@example.com", "third turn"),
    ] {
        let tools = GatedToolSet {
            tools: Arc::clone(&definitions),
            gate: gate.clone(),
            session,
            awaiting: Arc::default(),
        };
        let result = tools
            .dispatch_tool_call(
                label.to_owned(),
                RequestContext::new(MacroUserIdStr::try_from(user.to_owned()).unwrap()),
                "ReadTurnContext",
                &serde_json::json!({}),
            )
            .await
            .unwrap();
        if session == refused {
            assert_eq!(result.unwrap_err().description, "not approved");
        } else {
            assert_eq!(
                result.unwrap(),
                serde_json::json!({"context": label, "user": user})
            );
        }
    }
    assert_eq!(*gate.calls.lock().unwrap(), vec![allowed, refused, allowed]);
}

#[test]
fn instructions_are_a_delimited_section_after_the_standing_prompt() {
    let prompt = system_prompt(&TOOLS, None, Some("be terse"), None).to_string();

    assert!(
        prompt.starts_with(&prompt::agent_session::PROMPT.to_string()),
        "the session preamble comes first when the agent is unnamed"
    );
    assert!(
        prompt.contains(&format!(
            "{TOOLS}\n<session_instructions>\nbe terse\n</session_instructions>"
        )),
        "the static Macro prompt sits immediately before session instructions"
    );
    assert!(prompt.ends_with("\n<session_instructions>\nbe terse\n</session_instructions>"));
}

/// A named agent is told who it is before anything else, even when it has
/// no session instructions — otherwise "who are you" has nothing to go on.
#[test]
fn identity_precedes_the_standing_prompt_and_does_not_need_instructions() {
    let identity = AgentIdentity {
        bot: bot_id::BotId::TEST_A,
        name: "Grunk".to_owned(),
        handle: "grunk".to_owned(),
    };
    let prompt = system_prompt(&TOOLS, Some(&identity), None, None).to_string();
    let identity_section = prompt::agent_identity::render("Grunk", "grunk");

    assert!(
        prompt.starts_with(&identity_section),
        "identity is the first thing the model reads"
    );
    assert!(prompt.contains(&prompt::agent_session::PROMPT.to_string()));
    assert!(!prompt.contains("session_instructions"));
}

/// The order is the contract, not an accident: instructions qualify the
/// standing prompt, and memory comes last so a remembered fact is never read
/// as an instruction.
#[test]
fn memory_follows_instructions_rather_than_preceding_them() {
    let prompt = system_prompt(&TOOLS, None, Some("be terse"), Some("prefers Rust")).to_string();

    let instructions = prompt
        .find("<session_instructions>")
        .expect("the instructions section should be present");
    let memory = prompt
        .find("<user_memory>")
        .expect("the memory section should be present");
    assert!(instructions < memory);
}

/// Two sessions of one agent differ only after the static Macro prompt, so
/// the part before it is cached once for all of them.
#[test]
fn sessions_of_an_agent_share_everything_before_their_instructions() {
    let identity = AgentIdentity {
        bot: bot_id::BotId::TEST_A,
        name: "Grunk".to_owned(),
        handle: "grunk".to_owned(),
    };
    let first = system_prompt(
        &TOOLS,
        Some(&identity),
        Some("task A"),
        Some("prefers Rust"),
    );
    let second = system_prompt(&TOOLS, Some(&identity), Some("task B"), None);

    let shared = format!(
        "{}\n{}\n{}\n{TOOLS}",
        prompt::agent_identity::render("Grunk", "grunk"),
        prompt::agent_session::PROMPT,
        opener::ALREADY_OPENED,
    );
    assert_eq!(first.shared(), Some(shared.as_str()));
    assert_eq!(second.shared(), Some(shared.as_str()));
    assert_eq!(
        first.rest(),
        "\n<session_instructions>\ntask A\n</session_instructions>\n<user_memory>\nprefers Rust\n</user_memory>"
    );
    assert_eq!(
        second.rest(),
        "\n<session_instructions>\ntask B\n</session_instructions>"
    );
}

/// Absent instructions add no section at all, rather than an empty one the
/// model would have to interpret.
#[test]
fn no_instructions_means_no_section() {
    let prompt = system_prompt(&TOOLS, None, None, Some("prefers Rust")).to_string();

    assert!(!prompt.contains("session_instructions"));
    assert!(prompt.contains("<user_memory>\nprefers Rust\n</user_memory>"));
}

/// An empty string is a caller stating "no instructions" clumsily, and it must
/// not become a blank delimited section.
#[test]
fn empty_instructions_add_no_section() {
    let prompt = system_prompt(&TOOLS, None, Some(""), None).to_string();

    assert!(!prompt.contains("session_instructions"));
}

#[tokio::test]
async fn opening_verdict_split_across_deltas_keeps_the_head_of_the_line() {
    let (lines, mut receiver) = mpsc::channel(8);
    for delta in ["tr", "ue|Hi", " there", "!"] {
        lines.send(delta.to_owned()).await.unwrap();
    }

    let opening = opener::verdict(&mut receiver).await.unwrap();

    assert!(opening.complete);
    assert_eq!(opening.head, "Hi");
    assert_eq!(receiver.recv().await.as_deref(), Some(" there"));
}

#[tokio::test]
async fn opening_verdict_reads_false_as_an_opening_only() {
    let (lines, mut receiver) = mpsc::channel(8);
    lines
        .send("false| Let me check your calendar.".to_owned())
        .await
        .unwrap();

    let opening = opener::verdict(&mut receiver).await.unwrap();

    assert!(!opening.complete);
    assert_eq!(opening.head, "Let me check your calendar.");
}

#[tokio::test]
async fn opening_without_a_verdict_is_dropped() {
    let (lines, mut receiver) = mpsc::channel(8);
    lines
        .send("Sure, let me look into it.".to_owned())
        .await
        .unwrap();
    drop(lines);

    assert!(opener::verdict(&mut receiver).await.is_none());
}

#[test]
fn opening_transcript_leaves_out_the_hidden_agent_context() {
    let messages = vec![agent::types::ChatMessage {
        content: agent::types::ChatMessageContent::Text(
            "<m-agent-context>{\"version\":1,\"text\":\"<session owner=\\\"wolf@macro.com\\\"/>\"}</m-agent-context>\n\nwhat is going on in my workspace".to_owned(),
        ),
        role: agent::types::Role::User,
        attachments: None,
    }];

    assert_eq!(
        opener::transcript(&messages),
        "User: what is going on in my workspace"
    );
}
