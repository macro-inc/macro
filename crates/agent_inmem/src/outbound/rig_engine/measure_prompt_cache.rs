//! Measures Anthropic prompt-cache reads and writes per model call, against
//! the real API, with Macro's real tools and system prompt routed through the
//! production agent loop. Tool calls other than `LoadTools` answer `ok`
//! without running, so nothing touches a workspace.
//!
//! ```text
//! doppler run --project agent-harness-service --config dev -- \
//!   cargo test -p agent_inmem measure_prompt_cache -- --ignored --nocapture
//! ```

use super::*;
use ai_toolset::{RequestSchema, SearchableTool, ToolResult, ToolSetError};
use ai_usage::financial::{FinalizeInvocation, UsageEvidence, WriteDisposition};
use ai_usage::{AiFeature, FinancialFuture, TrackedInvocation, UsageContext, UsageTracking};
use std::pin::Pin;
use std::sync::Mutex;

const MODEL: &str = "anthropic/claude-sonnet-5-5";

/// Every model call's reported usage, in order.
#[derive(Default)]
struct RecordedUsage(Mutex<Vec<UsageEvidence>>);

impl UsageTracking for RecordedUsage {
    fn begin(&self, _: TrackedInvocation) -> FinancialFuture<'_, WriteDisposition> {
        Box::pin(async { Ok(WriteDisposition::Inserted) })
    }

    fn finalize(&self, evidence: FinalizeInvocation) -> FinancialFuture<'_, WriteDisposition> {
        self.0.lock().unwrap().push(evidence.usage);
        Box::pin(async { Ok(WriteDisposition::Inserted) })
    }
}

/// The agent session's tools as production defers them; `LoadTools` loads,
/// every other call answers without running.
struct InertTools(Arc<dyn AiToolSet<InMemToolContext> + Send + Sync>);

impl AiToolSet<()> for InertTools {
    fn dispatch_tool_call<'a>(
        &'a self,
        _: (),
        request_context: ai_toolset::RequestContext,
        tool_name: &'a str,
        json: &'a serde_json::Value,
    ) -> Pin<
        Box<dyn Future<Output = Result<ToolResult<serde_json::Value>, ToolSetError>> + 'a + Send>,
    > {
        Box::pin(async move {
            if tool_name == "LoadTools" {
                let names: Vec<String> =
                    serde_json::from_value(json["names"].clone()).unwrap_or_default();
                let loaded: Vec<SearchableTool> = request_context
                    .searchable_tools
                    .iter()
                    .filter(|tool| names.contains(&tool.name))
                    .cloned()
                    .collect();
                if let Some(loader) = &request_context.tool_loader {
                    loader.load(loaded);
                }
                return Ok(Ok(serde_json::json!({ "loaded": names })));
            }
            Ok(Ok(serde_json::json!({ "ok": true })))
        })
    }

    fn request_schemas(&self) -> Option<Vec<RequestSchema>> {
        self.0.request_schemas()
    }

    fn searchable_catalog(&self) -> Vec<SearchableTool> {
        self.0.searchable_catalog()
    }

    fn searchable_toolset_names(&self) -> Vec<String> {
        self.0.searchable_toolset_names()
    }
}

/// One session's turn: each model call's (input, cache read, cache write).
async fn turn(
    native: &NativeTools,
    run: &str,
    instructions: &str,
    prompt: &str,
) -> Vec<(u64, u64, u64)> {
    let identity = AgentIdentity {
        bot: bot_id::BotId::TEST_A,
        // Unique per run, so every run starts from a cold cache.
        name: format!("Macro {run}"),
        handle: "macro".to_owned(),
    };
    let system_prompt = system_prompt(
        &native.prompt,
        "",
        agent_session::domain::model::AgentSessionId::new(),
        ReplyDelivery::Streamed,
        Some(&identity),
        Some(instructions),
        None,
    );
    let messages = vec![agent::types::ChatMessage {
        content: agent::types::ChatMessageContent::Text(prompt.to_owned()),
        role: agent::types::Role::User,
        attachments: None,
    }];
    send(native, system_prompt, &messages).await.0
}

/// Sends `messages` as one turn, returning each model call's (input, cache
/// read, cache write) and the parts the turn persists.
async fn send(
    native: &NativeTools,
    system_prompt: SystemPrompt,
    messages: &[agent::types::ChatMessage],
) -> (
    Vec<(u64, u64, u64)>,
    Vec<agent::types::AssistantMessagePart>,
) {
    let tools: Arc<dyn AiToolSet<InMemToolContext> + Send + Sync> = Arc::new(DeferredToolSet::new(
        native.for_turn(false),
        Arc::clone(&native.deferred),
    ));
    let user = MacroUserIdStr::try_from_email("cache-measure@macro.com").unwrap();
    let usage = UsageContext::new(AiFeature::AgentSession, user);
    let recorded = Arc::new(RecordedUsage::default());
    let metering = agent::MeteringContext::tracking_only(recorded.clone(), usage.clone());
    let parts = metering
        .scope(async {
            let mut session = AgentLoop::new(Arc::new(ai_usage::NoOpUsageRecorder))
                .with_model(MODEL)
                .session(
                    Arc::new(InertTools(tools)),
                    Arc::new(()),
                    system_prompt,
                    usage,
                )
                .await;
            let mut stream = session
                .send_message(agent::to_rig_messages(messages))
                .await
                .unwrap();
            let mut accumulator = agent::StreamAccumulator::new();
            while let Some(part) = stream.next().await {
                accumulator.push(part.unwrap());
            }
            accumulator.into_parts()
        })
        .await;
    let calls = recorded
        .0
        .lock()
        .unwrap()
        .iter()
        .map(|evidence| match evidence {
            UsageEvidence::Reported(usage) => {
                (usage.input(), usage.cache_read(), usage.cache_write())
            }
            other => panic!("unreported usage: {other:?}"),
        })
        .collect();
    (calls, parts)
}

fn print(label: &str, calls: &[(u64, u64, u64)]) {
    for (index, (input, read, write)) in calls.iter().enumerate() {
        println!(
            "{label} call {}: input {input}, cache read {read}, cache write {write}",
            index + 1
        );
    }
}

#[tokio::test]
#[ignore = "calls the Anthropic API; run under doppler with --nocapture"]
async fn measure_prompt_cache() {
    let native = NativeTools::new();
    let run = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos()
        .to_string();
    let task = |id: &str| {
        format!(
            "You've been assigned the original Macro task linked below. Carry out its requested work.\n\
             <m-document-mention>{{\"documentId\":\"{id}\",\"documentName\":\"Original assigned task\"}}</m-document-mention>"
        )
    };

    let load = turn(
        &native,
        &format!("{run}-load"),
        &task("01a11170-ddae-7975-8fa5-9cf207fd77a6"),
        "Call LoadTools to load ListReminders. Do not call ListReminders or any other tool. \
         After LoadTools answers, reply with the single word done.",
    )
    .await;
    print("LoadTools run", &load);

    let first = turn(
        &native,
        &format!("{run}-sessions"),
        &task("01a11170-ddae-7975-8fa5-9cf207fd77a6"),
        "Reply with the single word hi. Do not call any tool.",
    )
    .await;
    let second = turn(
        &native,
        &format!("{run}-sessions"),
        &task("01a11171-1ca6-7a6b-9594-99b4f2b56c34"),
        "Reply with the single word hi. Do not call any tool.",
    )
    .await;
    print("session 1", &first);
    print("session 2", &second);
}

/// Three turns of one code-mode session, each replaying the persisted
/// history the way production does, with SDK documentation that differs per
/// turn. Turns 2 and 3 should read most of their input from the cache.
#[tokio::test]
#[ignore = "calls the Anthropic API; run under doppler with --nocapture"]
async fn measure_prompt_cache_turns() {
    let native = NativeTools::from_factory(ai_tools::tools_for_agent_code_mode, true);
    let run = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos()
        .to_string();
    let identity = AgentIdentity {
        bot: bot_id::BotId::TEST_A,
        name: format!("Macro {run}-turns"),
        handle: "macro".to_owned(),
    };
    let session_id = agent_session::domain::model::AgentSessionId::new();
    let prompts = [
        "Call ExecuteCode once with source `export async function main() { return {data: 1}; }`. \
         After it answers, reply with the single word done.",
        "Reply with the single word hi. Do not call any tool.",
        "Reply with the single word bye. Do not call any tool.",
    ];
    let mut messages: Vec<agent::types::ChatMessage> = Vec::new();
    for (index, prompt) in prompts.iter().enumerate() {
        // Stands in for `select_documentation`, which picks different SDK
        // references for each request.
        let sdk_docs = format!(
            "\n<macro_sdk>\nTurn {index} reference.\n{}</macro_sdk>",
            "documents.search(query) returns an async iterator of documents.\n"
                .repeat(60 * (index + 1))
        );
        let system_prompt = system_prompt(
            &native.prompt,
            &sdk_docs,
            session_id,
            ReplyDelivery::Streamed,
            Some(&identity),
            None,
            None,
        );
        messages.push(agent::types::ChatMessage {
            content: agent::types::ChatMessageContent::Text((*prompt).to_owned()),
            role: agent::types::Role::User,
            attachments: None,
        });
        let (calls, parts) = send(&native, system_prompt, &messages).await;
        print(&format!("turn {}", index + 1), &calls);
        if index > 0 {
            let (input, read, write) = calls[0];
            println!(
                "turn {} first call: {}% of input read from cache",
                index + 1,
                read * 100 / (input + read + write)
            );
        }
        messages.push(agent::types::ChatMessage {
            content: agent::types::ChatMessageContent::AssistantMessageParts(parts),
            role: agent::types::Role::Assistant,
            attachments: None,
        });
    }
}
