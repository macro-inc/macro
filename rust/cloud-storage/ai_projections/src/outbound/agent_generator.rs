//! Agent-loop backed projection generator.

use std::future::Future;
use std::sync::Arc;

use agent::types::{ChatMessage, ChatMessageContent, Role};
use agent::{AgentLoop, AgentModel, StreamPart, to_rig_messages};
use ai_tools::{AiToolSet, ToolServiceContext, ToolSetWithPrompt};
use futures::StreamExt;
use serde_json::{Map, Value};

use crate::domain::models::{GenerateProjectionRequest, GeneratedProjection};
use crate::domain::ports::ProjectionGenerator;

const GENERATION_MODEL: AgentModel = AgentModel::Smart;

/// Projection generator backed by the in-process agent tool loop.
pub struct AgentProjectionGenerator {
    agent_loop: AgentLoop,
    tool_context: ToolServiceContext,
    toolset: Arc<AiToolSet>,
    system_prompt: String,
}

impl AgentProjectionGenerator {
    /// Create a generator from the shared AI tool service context and toolset.
    pub fn new(tool_context: ToolServiceContext, tools: ToolSetWithPrompt) -> Self {
        Self {
            agent_loop: AgentLoop::new(tool_context.recorder.clone()).with_model(GENERATION_MODEL),
            tool_context,
            toolset: tools.toolset,
            system_prompt: build_system_prompt(tools.prompt.as_ref()),
        }
    }

    async fn generate_projection_inner(
        &self,
        request: GenerateProjectionRequest,
    ) -> anyhow::Result<GeneratedProjection> {
        let usage_context = ai_usage::UsageContext::new(
            ai_usage::AiFeature::AIProjection,
            request.generation_user_id.clone(),
        );

        let mut tool_context = self.tool_context.clone();
        tool_context.usage_context = usage_context.clone();

        let mut session = self
            .agent_loop
            .session(
                self.toolset.clone(),
                Arc::new(tool_context),
                &self.system_prompt,
                usage_context,
            )
            .await;

        let message = ChatMessage {
            role: Role::User,
            content: ChatMessageContent::Text(build_projection_user_prompt(
                &request,
                &chrono::Utc::now().to_rfc3339(),
            )),
            attachments: None,
        };

        let mut output = String::new();
        let mut stream = session.send_message(to_rig_messages(&[message])).await?;
        while let Some(next) = stream.next().await {
            if let StreamPart::Content(text) = next? {
                output.push_str(&text);
            }
        }

        Ok(GeneratedProjection { output })
    }
}

impl ProjectionGenerator for AgentProjectionGenerator {
    type Err = anyhow::Error;

    fn generate_projection(
        &self,
        request: GenerateProjectionRequest,
    ) -> impl Future<Output = Result<GeneratedProjection, Self::Err>> + Send {
        self.generate_projection_inner(request)
    }
}

fn build_system_prompt(base_prompt: &dyn std::fmt::Display) -> String {
    format!(
        "{base_prompt}\n\n\
You materialize cached AI projections. Use the available tools when they are relevant. \
Return only the final projection output requested by the prompt, with no process commentary \
and no projection metadata unless the prompt explicitly asks for it."
    )
}

fn build_projection_user_prompt(request: &GenerateProjectionRequest, datetime: &str) -> String {
    let mut envelope = Map::new();
    envelope.insert(
        "projectionId".to_string(),
        Value::String(request.cache_key.projection_id.clone()),
    );
    envelope.insert(
        "target".to_string(),
        serde_json::to_value(&request.cache_key.target).expect("projection target serializes"),
    );
    envelope.insert(
        "currentDatetime".to_string(),
        Value::String(datetime.to_string()),
    );
    envelope.insert("prompt".to_string(), Value::String(request.prompt.clone()));

    if let Some(context) = &request.context {
        envelope.insert("context".to_string(), Value::String(context.clone()));
    }

    if let Some(schema) = &request.schema {
        envelope.insert("schema".to_string(), schema.clone());
    }

    let envelope = serde_json::to_string_pretty(&Value::Object(envelope))
        .expect("projection prompt envelope serializes");

    format!(
        "Materialize the AI projection described by this envelope. \
Use the prompt field as the user task and the context field as additional frontend context when present. \
Return only the materialized projection output.\n\n{envelope}"
    )
}

#[cfg(test)]
mod test {
    use chrono::{DateTime, Utc};
    use macro_user_id::user_id::MacroUserIdStr;
    use serde_json::json;

    use super::*;
    use crate::domain::models::{AiProjectionCacheKey, Target, prompt_hash};

    #[test]
    fn projection_prompt_includes_required_envelope_fields() {
        let request = generation_request(Some("Unread inbox notifications".to_string()));
        let prompt = build_projection_user_prompt(&request, &test_time().to_rfc3339());
        let envelope = parse_prompt_envelope(&prompt);

        assert_eq!(envelope["projectionId"], "inbox/important");
        assert_eq!(
            envelope["target"],
            json!({ "type": "user", "id": "macro|projection@example.com" })
        );
        assert_eq!(envelope["currentDatetime"], "2026-06-17T16:30:00+00:00");
        assert_eq!(envelope["prompt"], "What should I triage first?");
        assert_eq!(envelope["context"], "Unread inbox notifications");
        assert_eq!(envelope["schema"], json!({ "type": "string" }));
    }

    #[test]
    fn projection_prompt_omits_absent_context() {
        let request = generation_request(None);
        let prompt = build_projection_user_prompt(&request, &test_time().to_rfc3339());
        let envelope = parse_prompt_envelope(&prompt);

        assert!(envelope.get("context").is_none());
    }

    fn generation_request(context: Option<String>) -> GenerateProjectionRequest {
        let prompt = "What should I triage first?".to_string();
        let schema = Some(json!({ "type": "string" }));

        GenerateProjectionRequest {
            cache_key: AiProjectionCacheKey {
                projection_id: "inbox/important".to_string(),
                target: Target::user("macro|projection@example.com"),
                prompt_hash: prompt_hash(&prompt, context.as_deref(), schema.as_ref()),
            },
            prompt,
            context,
            schema,
            generation_user_id: user_id("macro|projection@example.com"),
        }
    }

    fn parse_prompt_envelope(prompt: &str) -> Value {
        let json_start = prompt.find('{').expect("prompt contains envelope JSON");
        serde_json::from_str(&prompt[json_start..]).expect("prompt envelope is JSON")
    }

    fn user_id(value: &str) -> MacroUserIdStr<'static> {
        MacroUserIdStr::try_from(value.to_string()).expect("valid macro user id")
    }

    fn test_time() -> DateTime<Utc> {
        DateTime::parse_from_rfc3339("2026-06-17T16:30:00Z")
            .expect("valid timestamp")
            .with_timezone(&Utc)
    }
}
