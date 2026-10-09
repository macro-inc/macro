//! Curated SDK capabilities and in-code exploration over the registered tools.
use super::{
    CodeModeTools, ExecutionIdentity, ToolDocumentation,
    ai::{CodeAiService, GenerationRequest, GenerationResult},
    service::allowed_tool,
};
use async_trait::async_trait;
use code_execution::domain::HostResult;
use schemars::JsonSchema;
use serde::Deserialize;
use serde_json::{Value, json};
use std::sync::Arc;
use tokio_util::sync::CancellationToken;

/// The same curated index embedded in the runner's sdk.help().
pub fn sdk_guide() -> String {
    let docs: Value =
        serde_json::from_str(include_str!("../sdk-docs.json")).expect("generated SDK docs");
    docs[""].as_str().expect("generated SDK index").to_owned()
}

#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
struct DescribeSdk {
    #[serde(default)]
    names: Vec<String>,
}

/// Adds admitted AI generation and discovery to the normal tool capabilities.
pub struct SdkTools {
    tools: Arc<dyn CodeModeTools>,
    ai: CodeAiService,
}

impl SdkTools {
    /// All calls still pass through the outer approval and recording layers.
    pub fn new(tools: Arc<dyn CodeModeTools>, ai: CodeAiService) -> Self {
        Self { tools, ai }
    }

    fn describe(&self, args: &Value) -> anyhow::Result<Value> {
        let request: DescribeSdk = serde_json::from_value(args.clone())?;
        anyhow::ensure!(
            request.names.len() <= 5,
            "Describe at most five exact tool names."
        );
        let catalog = self.catalog();
        let selected = if request.names.is_empty() {
            catalog
                .iter()
                .filter(|tool| allowed_tool(tool))
                .collect::<Vec<_>>()
        } else {
            request
                .names
                .iter()
                .map(|name| {
                    catalog
                        .iter()
                        .find(|t| t.name == *name && allowed_tool(t))
                        .ok_or_else(|| {
                            anyhow::anyhow!(
                                "Unknown SDK method {name}. Use sdk.help('tools') for the catalog."
                            )
                        })
                })
                .collect::<anyhow::Result<Vec<_>>>()?
        };
        Ok(json!({ "tools": selected.into_iter().map(|t| json!({
            "name": t.name, "description": if request.names.is_empty() { t.description.chars().take(320).collect::<String>() } else { t.description.clone() },
            "input_schema": (!request.names.is_empty()).then(|| t.input_schema.to_string()),
            "output_schema": (!request.names.is_empty()).then(|| t.output_schema.to_string()),
        })).collect::<Vec<_>>() }))
    }
}

#[async_trait]
impl CodeModeTools for SdkTools {
    fn catalog(&self) -> Vec<ToolDocumentation> {
        let mut tools = self.tools.catalog();
        for (name, description) in [
            (
                "GenerateCodeText",
                "Curated Vercel AI SDK text generation. Prefer sdk.ai.generateText(options); explore sdk.help('ai').",
            ),
            (
                "GenerateCodeObject",
                "Curated Vercel AI SDK generation with validated JSON Schema output. Prefer sdk.ai.generateObject(options); schema is required. Explore sdk.help('ai').",
            ),
        ] {
            let mut input_schema =
                serde_json::to_value(schemars::schema_for!(GenerationRequest)).expect("schema");
            if name == "GenerateCodeObject" {
                input_schema["required"]
                    .as_array_mut()
                    .expect("required prompt")
                    .push(json!("schema"));
            } else {
                input_schema["properties"]
                    .as_object_mut()
                    .expect("properties")
                    .remove("schema");
            }
            tools.push(ToolDocumentation {
                name: name.into(),
                description: description.into(),
                input_schema,
                output_schema: serde_json::to_value(schemars::schema_for!(GenerationResult))
                    .expect("schema"),
                user_tool: false,
            });
        }
        tools.push(ToolDocumentation { name: "DescribeCodeSdk".into(), description: "Explore the available remote SDK tools; use sdk.help('tools') or sdk.help('ExactToolName').".into(),
            input_schema: serde_json::to_value(schemars::schema_for!(DescribeSdk)).expect("schema"), output_schema: json!({"type":"object"}), user_tool: false });
        tools
    }

    async fn call(
        &self,
        identity: &ExecutionIdentity,
        name: &str,
        args: &Value,
        cancel: CancellationToken,
    ) -> HostResult {
        let result = match name {
            "DescribeCodeSdk" => self.describe(args),
            "GenerateCodeText" | "GenerateCodeObject" => {
                let run = async {
                    let request = serde_json::from_value::<GenerationRequest>(args.clone())?;
                    let result = self
                        .ai
                        .generate(identity, &request, name == "GenerateCodeObject")
                        .await?;
                    Ok::<_, anyhow::Error>(serde_json::to_value(result)?)
                };
                tokio::select! {
                    biased;
                    _ = cancel.cancelled() => Err(anyhow::anyhow!("AI generation cancelled.")),
                    result = run => result,
                }
            }
            _ => return self.tools.call(identity, name, args, cancel).await,
        };
        match result {
            Ok(value) => HostResult::Ok { value },
            Err(error) => HostResult::Error {
                message: error.to_string(),
            },
        }
    }
}
