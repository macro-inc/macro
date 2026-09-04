//! Public `QuerySoup` tool.

use std::borrow::Cow;
use std::sync::Arc;

use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolCallError,
    ToolResult,
};
use async_trait::async_trait;
use email::domain::ports::EmailService;
use schemars::JsonSchema;
use schemars::Schema;
use schemars::generate::SchemaGenerator;
use schemars::json_schema;
use serde::{Deserialize, Serialize};
use soup::domain::ports::SoupService;
use soup::inbound::toolset::SoupToolContext;

use crate::listing::{SoupLister, SoupListing};
use crate::read_query::{QueryRejected, ReadQuery};
use crate::schema;

const MAX_RESULT_BYTES: usize = 256 * 1024;

/// Browse the unified inbox by writing a GraphQL query against the tool's own
/// read-only schema.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuerySoup {
    /// GraphQL document. Exactly one operation, and it must be a `query`.
    pub query: String,
    /// Values for `$variables` used by `query`. JSON object or omitted.
    #[serde(default)]
    pub variables: Option<serde_json::Value>,
}

/// GraphQL execution data. Keys are selected field names (`soup` or aliases).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(transparent)]
pub struct QuerySoupData(pub serde_json::Map<String, serde_json::Value>);

impl JsonSchema for QuerySoupData {
    fn schema_name() -> Cow<'static, str> {
        Cow::Borrowed("QuerySoupData")
    }

    fn json_schema(_generator: &mut SchemaGenerator) -> Schema {
        json_schema!({
            "title": "QuerySoupData",
            "description": "GraphQL data map. Each selected soup field or alias is a SoupQueryPage.",
            "type": "object",
            "additionalProperties": true
        })
    }
}

impl JsonSchema for QuerySoup {
    fn schema_name() -> Cow<'static, str> {
        Cow::Borrowed("QuerySoup")
    }

    fn json_schema(_generator: &mut SchemaGenerator) -> Schema {
        json_schema!({
            "title": "QuerySoup",
            "description": crate::schema::description::text(),
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "GraphQL document with exactly one `query` operation against the schema in this tool's description."
                },
                "variables": {
                    "type": ["object", "null"],
                    "description": "Values for the document's $variables, as a JSON object."
                }
            },
            "required": ["query"]
        })
    }
}

impl ToolAnnotated for QuerySoup {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::read_only("Query workspace");
}

#[async_trait]
impl<T, E> AsyncTool<SoupToolContext<T, E>> for QuerySoup
where
    T: SoupService,
    E: EmailService,
{
    type Output = QuerySoupData;

    #[tracing::instrument(skip_all, fields(user_id = ?request_context.user_id), err)]
    async fn call(
        &self,
        service_context: ServiceContext<SoupToolContext<T, E>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        let read = ReadQuery::parse(&self.query, self.variables.clone())
            .map_err(QueryRejected::into_tool_error)?;
        let lister: Arc<dyn SoupLister> = Arc::new(SoupListing::new(
            service_context.service.clone(),
            service_context.email_service.clone(),
            request_context.user_id.clone(),
            service_context.self_chat_id,
        ));
        let response = schema::SCHEMA
            .execute(read.into_request().data(lister))
            .await;
        project_response(response)
    }
}

fn project_response(response: async_graphql::Response) -> ToolResult<QuerySoupData> {
    if !response.errors.is_empty() {
        return Err(ToolCallError {
            description: describe_errors(&response.errors),
            internal_error: anyhow::anyhow!("QuerySoup GraphQL errors: {:?}", response.errors),
        });
    }
    let data = response.data.into_json().map_err(|error| ToolCallError {
        description: format!("failed to encode QuerySoup result: {error}"),
        internal_error: anyhow::anyhow!(error),
    })?;
    let object = match data {
        serde_json::Value::Object(map) => map,
        other => {
            return Err(ToolCallError {
                description: "QuerySoup result was not a GraphQL object".to_string(),
                internal_error: anyhow::anyhow!("expected object, got {other}"),
            });
        }
    };
    let bytes = serde_json::to_vec(&object).map_err(|error| ToolCallError {
        description: format!("failed to encode QuerySoup result: {error}"),
        internal_error: anyhow::anyhow!(error),
    })?;
    if bytes.len() > MAX_RESULT_BYTES {
        return Err(ToolCallError {
            description: format!(
                "Result is {}; QuerySoup returns at most {}. Lower limit or select fewer fields \
                 (drop properties, snippet, sourceMetadata).",
                human(bytes.len()),
                human(MAX_RESULT_BYTES)
            ),
            internal_error: anyhow::anyhow!("QuerySoup result exceeded {MAX_RESULT_BYTES} bytes"),
        });
    }
    Ok(QuerySoupData(object))
}

/// Compact REST keys from the deleted ListEntities tool, mapped to GraphQL names.
const COMPACT_KEYS: &[(&str, &str)] = &[
    ("dst", "subType"),
    ("ua", "updatedAt"),
    ("propf", "filters.propertiesFilter or taskFilter"),
    ("df", "filters.documentFilter"),
    ("ef", "filters.emailFilter"),
    ("pd", "propertyDefinitionId"),
    ("et", "entityTypes"),
    ("so", "sortMethod"),
    ("er", "entityRef"),
];

pub(crate) fn describe_errors(errors: &[async_graphql::ServerError]) -> String {
    errors
        .iter()
        .map(|error| {
            let mut message = error.to_string();
            if message.contains("Unknown field") {
                message.push_str(
                    " Call DescribeSoup with the kind's topic to see its filter literal and fields.",
                );
            }
            if message.contains("GraphqlSoupEntityType") {
                message.push_str(
                    " QuerySoup does not list reminders or CRM companies; use ListReminders / ListCompanies.",
                );
            }
            for (compact, graphql) in COMPACT_KEYS {
                let quoted = format!("\"{compact}\"");
                if message.contains(&quoted) {
                    message.push_str(&format!(
                        " `{compact}` is a deleted ListEntities key; write `{graphql}`."
                    ));
                }
            }
            message
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn human(bytes: usize) -> String {
    if bytes >= 1024 * 1024 {
        format!("{:.1} MB", bytes as f64 / (1024.0 * 1024.0))
    } else {
        format!("{} KB", bytes.div_ceil(1024))
    }
}
