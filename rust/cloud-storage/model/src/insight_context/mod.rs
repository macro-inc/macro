pub mod chat;
pub mod document;
pub mod email_insights;
pub mod insights_backfill;

use ai_format::format_date;
use chrono::serde::{ts_seconds, ts_seconds_option};
use chrono::{DateTime, Utc};
use email_insights::{EmailInfo, GenerateEmailInsightContext};
use serde::{Deserialize, Serialize};
use sqlx::Type;
use sqlx::{FromRow, types::Json};
use std::fmt::Display;
use strum::{Display, EnumString};
use utoipa::ToSchema;
use uuid::Uuid;

const MAX_MESSAGE_DEDUPLICATION_ID_LEN: usize = 128;
const MAX_MESSAGE_GROUP_ID_LEN: usize = 128;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum InsightContextQueueMessage {
    #[serde(rename = "context")]
    Context(ProvidedContext),
    #[serde(rename = "test")]
    Test { content: String },
    #[serde(rename = "email")]
    Email {
        context: GenerateEmailInsightContext,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct ProvidedContext {
    /// the context provider source name: "chat" | "channels" | ...
    pub provider_source: String,
    /// user id context was created for
    pub user_id: String,
    /// database key of item
    pub resource_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UserInsightRecord {
    pub id: Option<String>,
    pub user_id: String,
    pub content: String,
    pub generated: bool,
    #[serde(with = "ts_seconds")]
    #[schema(value_type = i64, nullable=false)]
    pub created_at: DateTime<Utc>,
    #[serde(with = "ts_seconds")]
    #[schema(value_type = i64, nullable=false)]
    pub updated_at: DateTime<Utc>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(with = "ts_seconds_option")]
    pub span_start: Option<DateTime<Utc>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(with = "ts_seconds_option")]
    pub span_end: Option<DateTime<Utc>>,
    pub source: String,
    pub source_location: Option<SourceLocation>,
    pub confidence: Option<i32>,
    pub insight_type: Option<InsightType>,
    pub relevance_keywords: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EmailSourceLocation {
    // this is a uuid
    pub thread_ids: Vec<String>,
    // this is a uuid
    pub message_ids: Vec<String>,
    // email addresses from the messages (from, to, cc, bcc)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email_addresses: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, Eq, PartialEq)]
#[serde(untagged)]
#[serde(rename_all = "camelCase")]
pub enum SourceLocation {
    Email(EmailSourceLocation),
}

#[derive(Debug, Clone, FromRow)]
pub struct UserInsightRow {
    pub id: Option<String>,
    pub user_id: String,
    pub content: String,
    pub generated: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub span_start: Option<DateTime<Utc>>,
    pub span_end: Option<DateTime<Utc>>,
    pub source: String,
    pub source_location: Option<Json<SourceLocation>>,
    pub confidence: Option<i32>,
    pub insight_type: Option<InsightType>,
    pub relevance_keywords: Option<Vec<String>>,
}

impl UserInsightRecord {
    pub fn user_created(content: String, user_id: &str) -> Self {
        let now = Utc::now();
        Self {
            id: None,
            user_id: user_id.to_string(),
            content,
            generated: false,
            created_at: now,
            updated_at: now,
            confidence: None,
            source: "user_created".to_string(),
            source_location: None,
            span_end: None,
            span_start: None,
            insight_type: None,
            relevance_keywords: None,
        }
    }
}

#[derive(
    Type, EnumString, Debug, Clone, Copy, Serialize, Deserialize, ToSchema, Display, Eq, PartialEq,
)]
#[strum(serialize_all = "lowercase")]
#[sqlx(rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum Confidence {
    Low,
    Medium,
    High,
}

#[derive(
    Type, EnumString, Debug, Clone, Copy, Serialize, Deserialize, ToSchema, Display, Eq, PartialEq,
)]
#[strum(serialize_all = "lowercase")]
#[sqlx(rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum InsightType {
    Actionable,    // Requires user action
    Informational, // Background information
    Warning,       // Potential issues to watch
    Trend,         // Pattern or trend analysis
}

impl Display for UserInsightRecord {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let date_string = match (self.span_start, self.span_end) {
            (Some(start), Some(end)) => {
                format!("from {} to {}, ", format_date(start), format_date(end))
            }
            (Some(start), None) => format!("starting in {}, ", format_date(start)),
            _ => String::new(),
        };
        let confidence = self
            .confidence
            .map(|c| format!("Confidence: {}, ", c))
            .unwrap_or_default();

        write!(
            f,
            r#"
{}
{confidence}{date_string}{}
"#,
            self.content, self.source
        )
    }
}

impl From<UserInsightRow> for UserInsightRecord {
    fn from(row: UserInsightRow) -> Self {
        Self {
            id: row.id,
            user_id: row.user_id,
            content: row.content,
            generated: row.generated,
            created_at: row.created_at,
            updated_at: row.updated_at,
            span_start: row.span_start,
            span_end: row.span_end,
            source: row.source,
            confidence: row.confidence,
            source_location: row.source_location.map(|json| json.0),
            insight_type: row.insight_type,
            relevance_keywords: row.relevance_keywords,
        }
    }
}

impl InsightContextQueueMessage {
    pub fn deduplication_id(&self) -> String {
        let mut deduplication_id = match self {
            InsightContextQueueMessage::Email { context } => match &context.info {
                EmailInfo::Backfill(batch) => {
                    format!("backfill:{}", batch.job_id)
                }
                EmailInfo::NewMessages(msgs) => {
                    format!("newmessages:{}", msgs.batch_id)
                }
                EmailInfo::LinkDeleted(link_info) => {
                    format!(
                        "linkdeleted:{}:{}",
                        context.macro_user_id, link_info.email_address
                    )
                }
            },
            InsightContextQueueMessage::Context(context) => {
                format!(
                    "context:{}:{}",
                    context.provider_source, context.resource_id
                )
            }
            InsightContextQueueMessage::Test { .. } => {
                format!("test:{}", Uuid::new_v4())
            }
        };
        deduplication_id.truncate(MAX_MESSAGE_DEDUPLICATION_ID_LEN);
        deduplication_id
    }

    pub fn group_id(&self) -> String {
        let mut group_id = match self {
            InsightContextQueueMessage::Email { context } => match &context.info {
                EmailInfo::Backfill(batch) => {
                    format!("backfill:{}", batch.job_id)
                }
                EmailInfo::NewMessages(_) => {
                    format!("newmessages:{}", context.macro_user_id)
                }
                EmailInfo::LinkDeleted(_) => {
                    format!("linkdeleted:{}", context.macro_user_id)
                }
            },
            InsightContextQueueMessage::Context(context) => context.provider_source.clone(),
            InsightContextQueueMessage::Test { .. } => {
                format!("testgroup:{}", Uuid::new_v4())
            }
        };
        group_id.truncate(MAX_MESSAGE_GROUP_ID_LEN);
        group_id
    }
}
