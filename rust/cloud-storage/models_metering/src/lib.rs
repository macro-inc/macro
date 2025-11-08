use ai::types::{
    Model, Usage as AiUsage, deserialize_model_without_version, serialize_model_without_version,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, Default, sqlx::FromRow)]
pub struct Usage {
    pub id: Uuid,
    /// Whether the request was through openrouter.ai
    pub used_open_router: bool,
    /// The company providing the model
    pub provider: String,
    /// The AI model
    pub model: String,
    pub usage: serde_json::Value,
    pub user_id: String,
    pub service_name: String,
    pub operation_type: String,
    // Number of tokens sent - taken from [`Usage::usage`] which is possibly an estimate
    pub input_tokens: i32,
    // Number of tokens received - taken from [`Usage::usage`] which is possibly an estimate
    pub output_tokens: i32,
    pub created_at: DateTime<Utc>,
}

pub enum OperationType {
    StreamCompletion,
    Chat,
    SimpleStreamCompletion,
}

mod operation_types {
    pub const STREAM_COMPLETION: &str = "stream_completion";
    pub const CHAT: &str = "chat";
    pub const SIMPLE_STREAM_COMPLETION: &str = "simple_stream_completion";
}

impl From<OperationType> for String {
    fn from(val: OperationType) -> Self {
        (match val {
            OperationType::StreamCompletion => operation_types::STREAM_COMPLETION,
            OperationType::Chat => operation_types::CHAT,
            OperationType::SimpleStreamCompletion => operation_types::SIMPLE_STREAM_COMPLETION,
        })
        .to_string()
    }
}

pub enum ServiceName {
    DocumentCognitionService,
}

mod service_names {
    pub const DOCUMENT_COGNITION_SERVICE: &str = "document_cognition_service";
}

impl From<ServiceName> for String {
    fn from(val: ServiceName) -> Self {
        // this just ensures the compiler will fail when new variants added. So we can fix
        let ServiceName::DocumentCognitionService = val;
        service_names::DOCUMENT_COGNITION_SERVICE.to_string()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, derive_builder::Builder)]
#[builder(pattern = "owned")]
pub struct CreateUsageRecordRequest {
    pub used_open_router: bool,
    #[serde(
        serialize_with = "serialize_model_without_version",
        deserialize_with = "deserialize_model_without_version"
    )]
    pub model: Model,
    pub usage: serde_json::Value,
    pub user_id: String,
    #[builder(setter(custom))]
    pub service_name: String,
    #[builder(setter(custom))]
    pub operation_type: String,
    pub input_tokens: i32,
    pub output_tokens: i32,
}

impl CreateUsageRecordRequest {
    pub fn new(
        usage: AiUsage,
        used_open_router: bool,
        model: Model,
        user_id: String,
        service_name: ServiceName,
        operation_type: OperationType,
    ) -> Self {
        let (input_tokens, output_tokens) = usage.get_input_and_output_tokens();
        let usage = serde_json::to_value(usage.get_response_obj())
            .expect("known to succeed for all values");
        Self {
            used_open_router,
            model,
            usage,
            user_id,
            service_name: service_name.into(),
            operation_type: operation_type.into(),
            input_tokens: input_tokens as i32,
            output_tokens: output_tokens as i32,
        }
    }
    pub fn total_tokens(&self) -> i32 {
        self.input_tokens + self.output_tokens
    }
}

impl CreateUsageRecordRequestBuilder {
    pub fn operation_type(mut self, value: OperationType) -> Self {
        self.operation_type = Some(value.into());
        self
    }
    pub fn service_name(mut self, value: ServiceName) -> Self {
        self.service_name = Some(value.into());
        self
    }
    pub fn with_tokens(mut self, ai_usage: AiUsage) -> Self {
        let (input, output) = ai_usage.get_input_and_output_tokens();
        let usage_obj = serde_json::to_value(ai_usage.get_response_obj())
            .expect("known to succeed for all values");
        self.input_tokens = Some(input as i32);
        self.output_tokens = Some(output as i32);
        self.usage = Some(usage_obj);
        self
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct UsageQuery {
    pub user_id: Option<String>,
    pub service_name: Option<String>,
    pub start_date: Option<DateTime<Utc>>,
    pub end_date: Option<DateTime<Utc>>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, Default)]
pub struct UsageReport {
    pub records: Vec<Usage>,
    pub total_count: i64,
    pub total_input_tokens: i64,
    pub total_output_tokens: i64,
}

/// paths of the API endepoints
pub mod paths {
    pub const HEALTH: &str = "/health";
    pub const USAGE: &str = "/usage";
}
