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

#[tokio::test]
async fn a_runtime_panic_is_reported_as_failure_instead_of_an_empty_success() {
    let (parts, mut receiver) = mpsc::channel(2);
    forward_turn_result(async { panic!("provider initialization failed") }, &parts).await;
    drop(parts);
    let error = receiver.recv().await.unwrap().unwrap_err();
    assert!(error.to_string().contains("runtime ended unexpectedly"));
    assert!(receiver.recv().await.is_none());
}

#[tokio::test]
async fn a_failure_after_partial_output_is_still_forwarded_to_the_consumer() {
    let (parts, mut receiver) = mpsc::channel(2);
    forward_turn_result(
        async {
            parts
                .send(Ok(StreamPart::Content("Partial answer".into())))
                .await
                .unwrap();
            Err(AgentError::Other(anyhow::anyhow!("provider unavailable")))
        },
        &parts,
    )
    .await;
    assert!(matches!(
        receiver.recv().await.unwrap(),
        Ok(StreamPart::Content(_))
    ));
    assert_eq!(
        receiver.recv().await.unwrap().unwrap_err().to_string(),
        "provider unavailable"
    );
}

/// A stand-in for the toolset prompt, short enough to assert on positionally.
const TOOLS: &str = "TOOLS";

#[path = "test/code_tools.rs"]
mod code_tools;

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

#[test]
fn reduced_definitions_keep_user_input_and_user_tool_review() {
    let tools = NativeTools::new();
    assert!(tools.for_turn(true).tools.contains_key("AskUser"));
    assert!(!tools.for_turn(false).tools.contains_key("AskUser"));
    for supports_input in [true, false] {
        let selected = tools.for_turn(supports_input);
        for name in ["SendEmail", "CreateCalendarEvent"] {
            assert!(selected.user_tools.contains_key(name));
        }
        // macro.search, macro.workspace and macro.chats replace these.
        for name in ["ContentSearch", "NameSearch", "ListEntities", "ReadChat"] {
            assert!(!selected.tools.contains_key(name));
        }
    }
    for name in ["ContentSearch", "NameSearch", "ListEntities", "ReadChat"] {
        assert!(!tools.tool_names.contains(name));
        assert!(!tools.deferred.iter().any(|tool| tool.name == name));
    }
}

#[derive(Deserialize, JsonSchema)]
#[schemars(title = "ReadTurnContext", description = "Read this call's context.")]
#[serde(deny_unknown_fields)]
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

    fn refuse_remote_mcp<'a>(
        &'a self,
        _: AgentSessionId,
        _: &'a str,
    ) -> std::pin::Pin<Box<dyn Future<Output = Option<String>> + Send + 'a>> {
        Box::pin(async { None })
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
            reviewed_tools: Vec::new(),
            remote: None,
        };
        let result = tools
            .dispatch_tool_call(
                label.to_owned(),
                RequestContext::new(MacroUserIdStr::try_from(user.to_owned()).unwrap()),
                "ReadTurnContext",
                &serde_json::json!({"acting_as":"owner"}),
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
    let session = AgentSessionId::new();
    let prompt = system_prompt(
        agent_code_mode::domain::CodeModeKind::TypeScript,
        &TOOLS,
        session,
        ReplyDelivery::Streamed,
        None,
        Some("be terse"),
        None,
    )
    .to_string();

    assert!(
        prompt.starts_with(&prompt::agent_session::PROMPT.to_string()),
        "the session preamble comes first"
    );
    assert!(
        prompt.contains(&format!(
            "{TOOLS}\n<session_instructions>\nbe terse\n</session_instructions>"
        )),
        "the static Macro prompt sits immediately before session instructions"
    );
    assert!(prompt.ends_with(&format!(
        "\n<session_instructions>\nbe terse\n</session_instructions>\n<agent_session>\nThis \
         conversation is agent session {session}. Once it grows long, its earlier part is \
         summarized to keep it within your context. To find the exact words of anything said \
         earlier, summarized or not, run ContentSearch with agentSessionIds \
         [\"{session}\"]. ContentSearch remains a direct tool for scoped session-history search.\n</agent_session>"
    )));
}

/// A session nobody watches reads its own short prompt, not the
/// conversation's preamble and tool guidance, and no pointer to a
/// ContentSearch it does not have; the rest of its part stays, and its
/// turn's documentation rides on its request instead.
#[test]
fn an_unseen_turn_reads_its_own_short_prompt() {
    let session = AgentSessionId::new();
    let identity = AgentIdentity {
        bot: bot_id::BotId::TEST_A,
        name: "Grunk".to_owned(),
        handle: "grunk".to_owned(),
    };
    let prompt = system_prompt(
        agent_code_mode::domain::CodeModeKind::TypeScript,
        &TOOLS,
        session,
        ReplyDelivery::Unseen,
        Some(&identity),
        Some("be terse"),
        Some("prefers Rust"),
    );
    let text = prompt.to_string();

    assert!(text.starts_with(unseen::PROMPT));
    assert!(text.contains("Never guess a method"));
    assert!(!text.contains(TOOLS));
    assert!(!text.contains(&prompt::agent_session::PROMPT.to_string()));
    assert!(!text.contains("<agent_session>"));
    assert!(!text.contains(opener::NOT_OPENED));
    assert!(text.contains(&prompt::agent_identity::render("Grunk", "grunk")));
    assert!(text.contains("<session_instructions>\nbe terse\n</session_instructions>"));
    assert!(text.contains("<user_memory>\nprefers Rust\n</user_memory>"));
    assert!(!text.contains("<macro_sdk>"));
}

/// Every session one background opener starts gets the same instructions,
/// so they sit in the cached shared block, read back across those sessions;
/// only the owner's memory comes after.
#[test]
fn an_unseen_turn_caches_its_instructions_with_the_shared_block() {
    let prompt = system_prompt(
        agent_code_mode::domain::CodeModeKind::TypeScript,
        &TOOLS,
        AgentSessionId::new(),
        ReplyDelivery::Unseen,
        None,
        Some("draft routines"),
        Some("prefers Rust"),
    );

    assert_eq!(
        prompt.shared(),
        Some(
            format!(
                "{}\n<session_instructions>\ndraft routines\n</session_instructions>",
                unseen::PROMPT
            )
            .as_str()
        )
    );
    assert_eq!(
        prompt.rest(),
        "\n<user_memory>\nprefers Rust\n</user_memory>"
    );
    let other = system_prompt(
        agent_code_mode::domain::CodeModeKind::TypeScript,
        &TOOLS,
        AgentSessionId::new(),
        ReplyDelivery::Unseen,
        None,
        Some("draft routines"),
        None,
    );
    assert_eq!(other.shared(), prompt.shared());
}

/// A background session given instructions brings its own reference; any
/// other turn has its documentation picked for its request.
#[test]
fn only_a_background_session_with_instructions_skips_picked_documentation() {
    assert!(!routes_documentation(
        ReplyDelivery::Unseen,
        Some("draft routines")
    ));
    assert!(routes_documentation(ReplyDelivery::Unseen, None));
    assert!(routes_documentation(ReplyDelivery::Unseen, Some("  ")));
    assert!(routes_documentation(
        ReplyDelivery::Streamed,
        Some("be terse")
    ));
    assert!(routes_documentation(ReplyDelivery::Whole, Some("be terse")));
}

/// An unseen turn (a routine draft) runs at low effort where its model takes
/// one; any other turn keeps the effort it was given.
#[test]
fn an_unseen_turn_runs_at_low_effort_where_its_model_takes_one() {
    use agent::ReasoningEffort;
    let model = "anthropic/claude-sonnet-5-5";
    assert_eq!(
        unseen_effort(true, model, ReasoningEffort::default()),
        ReasoningEffort::Low
    );
    assert_eq!(
        unseen_effort(false, model, ReasoningEffort::High),
        ReasoningEffort::High
    );
    assert_eq!(
        unseen_effort(true, "some/model", ReasoningEffort::default()),
        ReasoningEffort::default()
    );
}

/// A named agent is told who it is before its instructions, even when it
/// has no session instructions — otherwise "who are you" has nothing to go on.
#[test]
fn identity_opens_the_session_part_and_does_not_need_instructions() {
    let session = AgentSessionId::new();
    let identity = AgentIdentity {
        bot: bot_id::BotId::TEST_A,
        name: "Grunk".to_owned(),
        handle: "grunk".to_owned(),
    };
    let prompt = system_prompt(
        agent_code_mode::domain::CodeModeKind::TypeScript,
        &TOOLS,
        session,
        ReplyDelivery::Streamed,
        Some(&identity),
        None,
        None,
    );
    let identity_section = prompt::agent_identity::render("Grunk", "grunk");

    assert!(
        prompt.rest().starts_with(&format!("\n{identity_section}")),
        "identity is the first thing the session's part says"
    );
    assert!(!prompt.to_string().contains("session_instructions"));
}

/// The order is the contract, not an accident: instructions qualify the
/// standing prompt, and memory comes last so a remembered fact is never read
/// as an instruction.
#[test]
fn memory_follows_instructions_rather_than_preceding_them() {
    let session = AgentSessionId::new();
    let prompt = system_prompt(
        agent_code_mode::domain::CodeModeKind::TypeScript,
        &TOOLS,
        session,
        ReplyDelivery::Streamed,
        None,
        Some("be terse"),
        Some("prefers Rust"),
    )
    .to_string();

    let instructions = prompt
        .find("<session_instructions>")
        .expect("the instructions section should be present");
    let memory = prompt
        .find("<user_memory>")
        .expect("the memory section should be present");
    assert!(instructions < memory);
}

/// Sessions of every agent differ only after the static Macro prompt, so
/// the part before it is cached once for all of them.
#[test]
fn sessions_share_everything_before_their_identity() {
    let session = AgentSessionId::new();
    let identity = AgentIdentity {
        bot: bot_id::BotId::TEST_A,
        name: "Grunk".to_owned(),
        handle: "grunk".to_owned(),
    };
    let first = system_prompt(
        agent_code_mode::domain::CodeModeKind::TypeScript,
        &TOOLS,
        session,
        ReplyDelivery::Streamed,
        Some(&identity),
        Some("task A"),
        Some("prefers Rust"),
    );
    let second = system_prompt(
        agent_code_mode::domain::CodeModeKind::TypeScript,
        &TOOLS,
        session,
        ReplyDelivery::Streamed,
        None,
        Some("task B"),
        None,
    );

    let shared = format!("{}{TOOLS}", prompt::agent_session::PROMPT);
    assert_eq!(first.shared(), Some(shared.as_str()));
    assert_eq!(second.shared(), Some(shared.as_str()));
    let agent_session = format!(
        "\n<agent_session>\nThis conversation is agent session {session}. Once it grows long, \
         its earlier part is summarized to keep it within your context. To find the exact words \
         of anything said earlier, summarized or not, run ContentSearch with agentSessionIds \
         [\"{session}\"]. ContentSearch remains a direct tool for scoped session-history search.\n</agent_session>"
    );
    assert_eq!(
        first.rest(),
        format!(
            "\n{}\n<session_instructions>\ntask A\n</session_instructions>{agent_session}\n<user_memory>\nprefers Rust\n</user_memory>",
            prompt::agent_identity::render("Grunk", "grunk"),
        )
    );
    assert_eq!(
        second.rest(),
        format!("\n<session_instructions>\ntask B\n</session_instructions>{agent_session}")
    );
}

/// Absent instructions add no section at all, rather than an empty one the
/// model would have to interpret.
#[test]
fn no_instructions_means_no_section() {
    let session = AgentSessionId::new();
    let prompt = system_prompt(
        agent_code_mode::domain::CodeModeKind::TypeScript,
        &TOOLS,
        session,
        ReplyDelivery::Streamed,
        None,
        None,
        Some("prefers Rust"),
    )
    .to_string();

    assert!(!prompt.contains("session_instructions"));
    assert!(prompt.contains("<user_memory>\nprefers Rust\n</user_memory>"));
}

/// An empty string is a caller stating "no instructions" clumsily, and it must
/// not become a blank delimited section.
#[test]
fn empty_instructions_add_no_section() {
    let session = AgentSessionId::new();
    let prompt = system_prompt(
        agent_code_mode::domain::CodeModeKind::TypeScript,
        &TOOLS,
        session,
        ReplyDelivery::Streamed,
        None,
        Some(""),
        None,
    )
    .to_string();

    assert!(!prompt.contains("session_instructions"));
}

/// A reply read only once finished gets no opening line, so its session part
/// says so; the cached block every session shares stays the same.
#[test]
fn a_whole_reply_is_told_no_opening_line_was_shown_without_splitting_the_cache() {
    let session = AgentSessionId::new();
    let streamed = system_prompt(
        agent_code_mode::domain::CodeModeKind::TypeScript,
        &TOOLS,
        session,
        ReplyDelivery::Streamed,
        None,
        None,
        None,
    );
    let whole = system_prompt(
        agent_code_mode::domain::CodeModeKind::TypeScript,
        &TOOLS,
        session,
        ReplyDelivery::Whole,
        None,
        None,
        None,
    );

    assert_eq!(streamed.shared(), whole.shared());
    assert!(!streamed.to_string().contains(opener::NOT_OPENED));
    assert!(whole.to_string().contains(opener::NOT_OPENED));
}

#[tokio::test]
async fn opening_verdict_split_across_deltas_keeps_the_head_of_the_line() {
    let (lines, mut receiver) = mpsc::channel(8);
    for delta in ["tr", "ue|Hi", " there", "!"] {
        lines.send(delta.to_owned()).await.unwrap();
    }

    let verdict = opener::verdict(&mut receiver).await;

    assert!(matches!(verdict, Some(opener::Verdict::Complete(head)) if head == "Hi"));
    assert_eq!(receiver.recv().await.as_deref(), Some(" there"));
}

#[tokio::test]
async fn opening_verdict_reads_false_as_an_opening_only() {
    let (lines, mut receiver) = mpsc::channel(8);
    lines
        .send("false| Let me check your calendar.".to_owned())
        .await
        .unwrap();

    let verdict = opener::verdict(&mut receiver).await;

    assert!(matches!(
        verdict,
        Some(opener::Verdict::Opening(head)) if head == "Let me check your calendar."
    ));
}

#[tokio::test]
async fn opening_verdict_skip_shows_nothing() {
    let (lines, mut receiver) = mpsc::channel(8);
    for delta in ["sk", "ip|"] {
        lines.send(delta.to_owned()).await.unwrap();
    }

    let verdict = opener::verdict(&mut receiver).await;

    assert!(matches!(verdict, Some(opener::Verdict::Silent)));
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

#[tokio::test]
async fn a_summary_turns_closed_opener_has_no_verdict() {
    // A summary turn races nothing: its opener is closed before it speaks.
    let mut receiver = mpsc::channel::<String>(1).1;

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

struct SelectedActor(MacroUserIdStr<'static>);
impl NativeToolGate for SelectedActor {
    fn check<'a>(
        &'a self,
        _: AgentSessionId,
        _: &'a str,
        _: &'a serde_json::Value,
    ) -> std::pin::Pin<Box<dyn Future<Output = NativeToolVerdict> + Send + 'a>> {
        Box::pin(async { NativeToolVerdict::RunAs(self.0.clone()) })
    }

    fn refuse_remote_mcp<'a>(
        &'a self,
        _: AgentSessionId,
        _: &'a str,
    ) -> std::pin::Pin<Box<dyn Future<Output = Option<String>> + Send + 'a>> {
        Box::pin(async { None })
    }
}

#[tokio::test]
async fn native_dispatch_uses_the_resolved_account_and_strips_routing_arguments() {
    let requester = MacroUserIdStr::try_from_email("requester@example.com").unwrap();
    let tools = GatedToolSet {
        tools: Arc::new(AsyncToolCollection::<String>::new().add_tool::<ReadTurnContext, String>()),
        gate: Arc::new(SelectedActor(requester.clone())),
        session: AgentSessionId::new(),
        awaiting: Arc::default(),
        reviewed_tools: Vec::new(),
        remote: None,
    };
    let result = tools
        .dispatch_tool_call(
            "context".into(),
            RequestContext::new(MacroUserIdStr::try_from_email("owner@example.com").unwrap()),
            "ReadTurnContext",
            &serde_json::json!({"acting_as":"requester"}),
        )
        .await
        .unwrap()
        .unwrap();
    assert_eq!(result["user"], requester.to_string());
    let schema = tools.request_schemas().unwrap().remove(0).schema;
    assert!(
        schema.as_value()["required"]
            .as_array()
            .unwrap()
            .contains(&serde_json::json!("acting_as"))
    );
}

/// Holds every call until the owner's answer arrives on `answer`.
struct HeldForOwner {
    held: tokio::sync::Notify,
    answer: tokio::sync::Mutex<Option<tokio::sync::oneshot::Receiver<NativeToolVerdict>>>,
}

impl NativeToolGate for HeldForOwner {
    fn check<'a>(
        &'a self,
        _: AgentSessionId,
        _: &'a str,
        _: &'a serde_json::Value,
    ) -> std::pin::Pin<Box<dyn Future<Output = NativeToolVerdict> + Send + 'a>> {
        Box::pin(async move {
            let answer = self.answer.lock().await.take().unwrap();
            self.held.notify_one();
            answer.await.unwrap()
        })
    }

    fn refuse_remote_mcp<'a>(
        &'a self,
        _: AgentSessionId,
        _: &'a str,
    ) -> std::pin::Pin<Box<dyn Future<Output = Option<String>> + Send + 'a>> {
        Box::pin(async { None })
    }
}

#[tokio::test]
async fn cancelling_the_turn_ends_a_call_held_for_the_owner_and_a_later_approval_runs_nothing() {
    let (approve, answer) = tokio::sync::oneshot::channel();
    let gate = Arc::new(HeldForOwner {
        held: tokio::sync::Notify::new(),
        answer: tokio::sync::Mutex::new(Some(answer)),
    });
    let tools = Arc::new(GatedToolSet {
        tools: Arc::new(AsyncToolCollection::<String>::new().add_tool::<ReadTurnContext, String>()),
        gate: gate.clone(),
        session: AgentSessionId::new(),
        awaiting: Arc::default(),
        reviewed_tools: Vec::new(),
        remote: None,
    });
    let request = RequestContext::new(MacroUserIdStr::try_from_email("owner@example.com").unwrap());
    let cancel = request.cancel.clone();
    let call = tokio::spawn({
        let tools = Arc::clone(&tools);
        async move {
            tools
                .dispatch_tool_call(
                    "context".into(),
                    request,
                    "ReadTurnContext",
                    &serde_json::json!({"acting_as":"owner"}),
                )
                .await
        }
    });
    gate.held.notified().await;

    cancel.cancel();
    let result = tokio::time::timeout(std::time::Duration::from_secs(5), call)
        .await
        .expect("cancelling the turn ends the held call")
        .unwrap()
        .unwrap();

    assert_eq!(result.unwrap_err().description, TURN_CANCELLED);
    assert!(
        approve
            .send(NativeToolVerdict::RunAs(
                MacroUserIdStr::try_from_email("owner@example.com").unwrap()
            ))
            .is_err(),
        "nobody is left waiting to act on a later approval"
    );
}

/// Records every call it is handed, and answers each with its name.
#[derive(Default)]
struct RecordingTools(Mutex<Vec<String>>);

impl AiToolSet<String> for RecordingTools {
    fn dispatch_tool_call<'a>(
        &'a self,
        _: String,
        _: RequestContext,
        tool_name: &'a str,
        _: &'a serde_json::Value,
    ) -> ai_toolset::ToolCallFuture<'a> {
        self.0.lock().unwrap().push(tool_name.to_owned());
        Box::pin(async move { Ok(Ok(serde_json::json!(tool_name))) })
    }

    fn request_schemas(&self) -> Option<Vec<ai_toolset::RequestSchema>> {
        None
    }
}

/// Refuses every remote MCP tool, as a scoped session's gate does, and
/// remembers which it was asked about.
#[derive(Default)]
struct RefusesRemoteMcp(Mutex<Vec<String>>);

impl NativeToolGate for RefusesRemoteMcp {
    fn check<'a>(
        &'a self,
        _: AgentSessionId,
        _: &'a str,
        _: &'a serde_json::Value,
    ) -> std::pin::Pin<Box<dyn Future<Output = NativeToolVerdict> + Send + 'a>> {
        Box::pin(async { NativeToolVerdict::Run })
    }

    fn refuse_remote_mcp<'a>(
        &'a self,
        _: AgentSessionId,
        tool: &'a str,
    ) -> std::pin::Pin<Box<dyn Future<Output = Option<String>> + Send + 'a>> {
        self.0.lock().unwrap().push(tool.to_owned());
        Box::pin(async { Some("outside this session's scope".to_owned()) })
    }
}

/// An MCP server with no behaviour, serving `tools` under `name` once
/// listed; dropping the returned service closes it.
async fn listed_server(
    name: &str,
    tools: &[&str],
) -> (
    rmcp::service::RunningService<rmcp::RoleServer, NoTools>,
    mcp_toolset::ListedServer,
) {
    use rmcp::ServiceExt as _;
    let (server_io, client_io) = tokio::io::duplex(4096);
    let (server, client) = tokio::join!(
        NoTools.serve(server_io),
        mcp_toolset::client_info().serve(client_io),
    );
    let tools = tools
        .iter()
        .map(|tool| {
            rmcp::model::Tool::new(
                (*tool).to_owned(),
                "Fixture tool",
                Arc::new(serde_json::Map::new()),
            )
        })
        .collect();
    (
        server.unwrap(),
        mcp_toolset::ListedServer {
            name: name.to_owned(),
            client: Arc::new(client.unwrap()),
            tools,
            trace_context: mcp_toolset::TraceContext::Withhold,
        },
    )
}

struct NoTools;
impl rmcp::ServerHandler for NoTools {}

/// A remote MCP tool is put to the gate before it runs, and a refusal runs
/// nothing; the harness's internal server gates its own tools, so its calls
/// go through untouched. Which server a call reaches is the one its tool was
/// registered under: a custom server named to mangle like the internal one
/// is asked about like any other, whichever registered first.
#[tokio::test]
async fn a_remote_mcp_tool_runs_only_when_the_gate_lets_it() {
    let (_impostor, impostor) = listed_server("macro_internal_", &["post"]).await;
    let (_internal, internal) = listed_server("macro_internal", &["ExecuteCode"]).await;
    let (_slack, slack) = listed_server("slack", &["send_message"]).await;
    let remote = mcp_toolset::RemoteMcpToolSet::from_listed(vec![impostor, internal, slack], None);
    let inner = Arc::new(RecordingTools::default());
    let gate = Arc::new(RefusesRemoteMcp::default());
    let tools = GatedToolSet {
        tools: inner.clone(),
        gate: gate.clone(),
        session: AgentSessionId::new(),
        awaiting: Arc::default(),
        reviewed_tools: Vec::new(),
        remote: Some(remote.clone()),
    };
    let owner = MacroUserIdStr::try_from_email("owner@example.com").unwrap();
    for refused in ["mcp__slack__send_message", "mcp__macro_internal__post"] {
        let result = tools
            .dispatch_tool_call(
                "context".into(),
                RequestContext::new(owner.clone()),
                refused,
                &serde_json::Value::Null,
            )
            .await
            .unwrap();
        assert_eq!(
            result.unwrap_err().description,
            "outside this session's scope",
            "{refused}"
        );
    }
    let result = tools
        .dispatch_tool_call(
            "context".into(),
            RequestContext::new(owner.clone()),
            "mcp__macro_internal__ExecuteCode",
            &serde_json::Value::Null,
        )
        .await
        .unwrap();
    assert_eq!(
        result.unwrap(),
        serde_json::json!("mcp__macro_internal__ExecuteCode")
    );
    assert_eq!(
        *gate.0.lock().unwrap(),
        vec!["mcp__slack__send_message", "mcp__macro_internal__post"]
    );
    assert_eq!(
        *inner.0.lock().unwrap(),
        vec!["mcp__macro_internal__ExecuteCode"]
    );

    let unscoped = GatedToolSet {
        tools: inner.clone(),
        gate: Arc::new(crate::domain::tool_gate::UngatedNativeTools),
        session: AgentSessionId::new(),
        awaiting: Arc::default(),
        reviewed_tools: Vec::new(),
        remote: Some(remote),
    };
    let result = unscoped
        .dispatch_tool_call(
            "context".into(),
            RequestContext::new(owner),
            "mcp__slack__send_message",
            &serde_json::Value::Null,
        )
        .await
        .unwrap();
    assert_eq!(
        result.unwrap(),
        serde_json::json!("mcp__slack__send_message")
    );
}

/// Records every call it is handed with its arguments, and answers each
/// with its name.
#[derive(Default)]
struct RecordingCalls(Mutex<Vec<(String, serde_json::Value)>>);

impl AiToolSet<String> for RecordingCalls {
    fn dispatch_tool_call<'a>(
        &'a self,
        _: String,
        _: RequestContext,
        tool_name: &'a str,
        json: &'a serde_json::Value,
    ) -> ai_toolset::ToolCallFuture<'a> {
        self.0
            .lock()
            .unwrap()
            .push((tool_name.to_owned(), json.clone()));
        Box::pin(async move { Ok(Ok(serde_json::json!(tool_name))) })
    }

    fn request_schemas(&self) -> Option<Vec<ai_toolset::RequestSchema>> {
        None
    }
}

/// Refuses the tools it names and remembers every tool it was asked about.
struct RefusesTools {
    refused: &'static [&'static str],
    asked: Mutex<Vec<String>>,
}

impl NativeToolGate for RefusesTools {
    fn check<'a>(
        &'a self,
        _: AgentSessionId,
        tool: &'a str,
        _: &'a serde_json::Value,
    ) -> std::pin::Pin<Box<dyn Future<Output = NativeToolVerdict> + Send + 'a>> {
        self.asked.lock().unwrap().push(tool.to_owned());
        let verdict = if self.refused.contains(&tool) {
            NativeToolVerdict::Refuse("outside this session's scope".to_owned())
        } else {
            NativeToolVerdict::Run
        };
        Box::pin(async move { verdict })
    }

    fn refuse_remote_mcp<'a>(
        &'a self,
        _: AgentSessionId,
        _: &'a str,
    ) -> std::pin::Pin<Box<dyn Future<Output = Option<String>> + Send + 'a>> {
        Box::pin(async { None })
    }
}

/// A tool that uses nobody's access still asks the gate, so a scoped
/// session's gate can refuse it; one it lets through runs with its
/// arguments as they came, since it takes no account.
#[tokio::test]
async fn a_tool_that_uses_nobodys_access_still_asks_the_gate() {
    let inner = Arc::new(RecordingCalls::default());
    let gate = Arc::new(RefusesTools {
        refused: &["WebFetch"],
        asked: Mutex::new(Vec::new()),
    });
    let tools = GatedToolSet {
        tools: inner.clone(),
        gate: gate.clone(),
        session: AgentSessionId::new(),
        awaiting: Arc::default(),
        reviewed_tools: Vec::new(),
        remote: None,
    };
    let owner = MacroUserIdStr::try_from_email("owner@example.com").unwrap();
    let fetch = serde_json::json!({"url": "https://example.com/?q=secret"});
    let refused = tools
        .dispatch_tool_call(
            "context".into(),
            RequestContext::new(owner.clone()),
            "WebFetch",
            &fetch,
        )
        .await
        .unwrap()
        .unwrap_err();
    assert_eq!(refused.description, "outside this session's scope");

    let search = serde_json::json!({"query": "weather"});
    let result = tools
        .dispatch_tool_call(
            "context".into(),
            RequestContext::new(owner),
            "WebSearch",
            &search,
        )
        .await
        .unwrap()
        .unwrap();
    assert_eq!(result, serde_json::json!("WebSearch"));
    assert_eq!(*gate.asked.lock().unwrap(), ["WebFetch", "WebSearch"]);
    assert_eq!(*inner.0.lock().unwrap(), [("WebSearch".to_owned(), search)]);
}

/// A turn taught the dialect opens with the session preamble that names
/// dialect operations; a TypeScript turn's is today's.
#[test]
fn the_session_preamble_follows_the_turns_code_mode_kind() {
    use agent_code_mode::domain::CodeModeKind;
    let session = AgentSessionId::new();
    let prompt = |kind| {
        system_prompt(
            kind,
            &TOOLS,
            session,
            ReplyDelivery::Streamed,
            None,
            None,
            None,
        )
        .to_string()
    };
    let typescript = prompt(CodeModeKind::TypeScript);
    assert!(typescript.contains(&prompt::agent_session::PROMPT.to_string()));
    let dialect = prompt(CodeModeKind::Dialect);
    assert!(dialect.contains(prompt::dialect::agent_session_prompt()));
    assert!(!dialect.contains("macro.connectedApps"));
}

/// An unseen dialect turn (a routine draft whose owner has agent
/// permissions) is taught the dialect: no TypeScript SDK call, its own
/// operations. A TypeScript one keeps today's prompt.
#[test]
fn an_unseen_dialect_turn_is_taught_only_the_dialect() {
    let text = system_prompt(
        agent_code_mode::domain::CodeModeKind::Dialect,
        &TOOLS,
        AgentSessionId::new(),
        ReplyDelivery::Unseen,
        None,
        Some("draft routines"),
        None,
    )
    .to_string();
    let sdk_calls: Vec<&str> = text
        .match_indices("macro.")
        .map(|(index, _)| &text[index..(index + 24).min(text.len())])
        .filter(|call| {
            let rest = &call["macro.".len()..];
            rest.starts_with(|c: char| c.is_ascii_lowercase()) && !rest.starts_with("com")
        })
        .collect();
    assert_eq!(sdk_calls, Vec::<&str>::new());
    for marker in ["entity index", "SDK objects"] {
        assert!(!text.contains(marker), "{marker}");
    }
    assert!(text.contains("tools.<service>.<operation>"));
    assert!(text.contains("tools.storage.post_items_soup_ast"));
    assert!(text.starts_with(&unseen::PROMPT[..unseen::PROMPT.find("# About Macro").unwrap()]));
    assert!(text.contains("<session_instructions>\ndraft routines\n</session_instructions>"));
    for (from, _) in unseen::DIALECT_SWAPS {
        assert!(unseen::PROMPT.contains(from), "{from}");
    }

    let typescript = system_prompt(
        agent_code_mode::domain::CodeModeKind::TypeScript,
        &TOOLS,
        AgentSessionId::new(),
        ReplyDelivery::Unseen,
        None,
        None,
        None,
    )
    .to_string();
    assert_eq!(typescript, unseen::PROMPT);
}
