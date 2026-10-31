//! Read-only query proposals for live database answers.

use agent::ReasoningEffort;
use agent::structured_output::{DynamicSchema, dynamic_structured_completion};
use agent::types::{AssistantMessagePart, ChatMessage, ChatMessageContent, Role};
use agent::{AgentLoop, StreamAccumulator};
use ai_tools::ToolServiceContext;
use ai_usage::UsageContext;
use futures::StreamExt;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::Instant;
use tracing::Instrument;
use utoipa::ToSchema;

#[cfg(test)]
mod test;

const MAX_DISCOVERY_TURNS: usize = 8;
const MAX_ANSWER_TOKENS: u64 = 4096;

/// The question and untrusted schema hints; authorization remains in the read services.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct DatabaseQueryRequest {
    pub model: String,
    pub prompt: String,
    pub sql: String,
    pub schema: serde_json::Value,
    /// The SQL engine's error from one failed proposal, used for a bounded repair.
    #[serde(default)]
    pub error: Option<String>,
}

/// A proposal, never stored results or permission to read the named database.
#[derive(Debug, Serialize, Deserialize, ToSchema, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DatabaseQueryAnswer {
    pub answerable: bool,
    pub database_id: Option<String>,
    pub sql: String,
    pub explanation: String,
    pub title: String,
    pub display_mode: DatabaseQueryDisplayMode,
    pub chart: Option<DatabaseQueryChart>,
}

/// Supported live-answer presentations.
#[derive(Debug, Serialize, Deserialize, ToSchema, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum DatabaseQueryDisplayMode {
    Scalar,
    Table,
    Bar,
    Line,
    Area,
    Scatter,
    Pie,
}

/// Chart fields name the proposal's result columns exactly.
#[derive(Debug, Serialize, Deserialize, ToSchema, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct DatabaseQueryChart {
    pub x: String,
    pub y: Vec<String>,
    pub title: String,
    pub color: Option<String>,
    pub stack: bool,
}

impl DatabaseQueryRequest {
    fn has_schema(&self) -> bool {
        self.schema["databaseId"]
            .as_str()
            .is_some_and(|id| !id.is_empty())
            && self.schema["tables"].as_array().is_some_and(|tables| {
                tables.iter().any(|table| {
                    table["platform"] != true
                        && table["columns"]
                            .as_array()
                            .is_some_and(|columns| !columns.is_empty())
                })
            })
    }
}

fn answer_schema() -> DynamicSchema {
    DynamicSchema {
        name: "database_answer".into(),
        description: None,
        schema: serde_json::to_value(schemars::schema_for!(DatabaseQueryAnswer))
            .expect("database answer schema is serializable"),
    }
}

fn parse_answer(text: &str) -> anyhow::Result<DatabaseQueryAnswer> {
    let trimmed = text.trim();
    let json = trimmed.strip_prefix("```").map_or(trimmed, |rest| {
        let inner = rest.strip_prefix("json").unwrap_or(rest);
        inner.strip_suffix("```").unwrap_or(inner).trim()
    });
    Ok(serde_json::from_str(json)?)
}

/// Generate once from a supplied schema, or discover with read-only tools and
/// reuse the agent's final JSON. Formatting is only a fallback for malformed output.
#[tracing::instrument(skip_all, fields(database_query.model = %request.model,
    database_query.source_mode = if request.has_schema() { "selected" } else { "automatic" },
    database_query.repair = request.error.is_some(),
    database_query.tool_count = 0_u64,
    database_query.database_id = tracing::field::Empty,
    database_query.discovery_ms = tracing::field::Empty,
    database_query.agent_ms = tracing::field::Empty,
    database_query.format_ms = tracing::field::Empty,
    database_query.format_fallback = false), err)]
pub async fn generate(
    request: DatabaseQueryRequest,
    reference: String,
    tools: Arc<dyn ai_toolset::ToolSet<ToolServiceContext> + Send + Sync>,
    mut context: ToolServiceContext,
    usage: UsageContext,
) -> anyhow::Result<DatabaseQueryAnswer> {
    let selected = request.has_schema();
    let mut system = format!(
        "{reference}\n{}",
        include_str!("database_query/instructions.md")
    );
    if selected {
        system.push_str("\nThe full selected source schema is already supplied. Propose the SELECT directly without tools. The host's read-only SQL engine validates and executes it before showing any answer; do not claim you executed it. If an engine error is supplied, correct it.\n");
    } else {
        system.push_str(&format!("\nFinal JSON schema:\n{}", answer_schema().schema));
    }
    context.usage_context = usage.clone();
    let available = if selected {
        None
    } else {
        let started = Instant::now();
        let databases = tools
            .try_tool_call(
                context.clone(),
                ai_toolset::RequestContext::new(usage.user.clone()),
                "ListDatabases",
                &serde_json::json!({}),
            )
            .instrument(tracing::info_span!("database_query.discovery"))
            .await?
            .map_err(|error| anyhow::anyhow!("Database discovery failed: {error:?}"))?;
        tracing::Span::current().record(
            "database_query.discovery_ms",
            started.elapsed().as_millis() as u64,
        );
        Some(databases)
    };
    let message = ChatMessage {
        role: Role::User,
        content: ChatMessageContent::Text(
            serde_json::json!({
                "question": request.prompt,
                "currentSql": request.sql,
                "schema": request.schema,
                "error": request.error,
                "availableDatabases": available,
            })
            .to_string(),
        ),
        attachments: None,
    };
    let mut conversation = vec![message];
    if !selected {
        let started = Instant::now();
        let agent = AgentLoop::new(context.recorder.clone())
            .with_model(&request.model)
            .with_agent_name("database_query")
            .with_reasoning_effort(ReasoningEffort::Low)
            .with_max_turns(MAX_DISCOVERY_TURNS)
            .with_max_tokens(MAX_ANSWER_TOKENS);
        let mut session = agent
            .session(tools, Arc::new(context.clone()), &system, usage.clone())
            .await;
        let mut stream = session
            .send_message(agent::to_rig_messages(&conversation))
            .await?;
        let mut accumulator = StreamAccumulator::new();
        while let Some(part) = stream.next().await {
            accumulator.push(part?);
        }
        drop(stream);
        let parts = accumulator.into_parts();
        let span = tracing::Span::current();
        span.record(
            "database_query.agent_ms",
            started.elapsed().as_millis() as u64,
        );
        span.record(
            "database_query.tool_count",
            1 + parts
                .iter()
                .filter(|part| matches!(part, AssistantMessagePart::ToolCall { .. }))
                .count() as u64,
        );
        // Ignore any narration before tools. Only the final text may be the answer.
        if let Some(AssistantMessagePart::Text { text }) = parts.last()
            && let Ok(answer) = parse_answer(text)
        {
            if let Some(id) = &answer.database_id {
                span.record("database_query.database_id", id);
            }
            return Ok(answer);
        }
        span.record("database_query.format_fallback", true);
        conversation.push(ChatMessage {
            role: Role::Assistant,
            content: ChatMessageContent::AssistantMessageParts(parts),
            attachments: None,
        });
        conversation.push(ChatMessage {
            role: Role::User,
            content: ChatMessageContent::Text(
                "Return the database answer as JSON matching the required schema.".into(),
            ),
            attachments: None,
        });
    }
    let started = Instant::now();
    let answer = dynamic_structured_completion(
        request.model,
        &system,
        agent::to_rig_messages(&conversation),
        answer_schema(),
        context.recorder.as_ref(),
        usage,
    )
    .instrument(tracing::info_span!("database_query.format"))
    .await?;
    tracing::Span::current().record(
        "database_query.format_ms",
        started.elapsed().as_millis() as u64,
    );
    let answer: DatabaseQueryAnswer = serde_json::from_value(answer)?;
    if let Some(id) = &answer.database_id {
        tracing::Span::current().record("database_query.database_id", id);
    }
    Ok(answer)
}
