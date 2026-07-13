//! ListInboxes tool for enumerating the inboxes a user can read or act on.

use crate::domain::ports::{EmailService, GmailTokenProvider};
use ai_toolset::{AsyncTool, RequestContext, ServiceContext, ToolCallError, ToolResult};
use async_trait::async_trait;
use entity_access::domain::ports::EntityAccessService;
use macro_user_id::user_id::MacroUserIdStr;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::EmailToolContext;

/// A connected inbox surfaced to the AI.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ToolInbox {
    /// The inbox's email address. Pass this as the `inbox` parameter to scope
    /// reads, searches, or label lookups to this inbox.
    pub email_address: String,
    /// Whether this is the caller's primary (default) inbox — the one email
    /// tools use when no inbox is specified.
    pub is_primary: bool,
    /// Whether this inbox belongs to another user and was delegated to the
    /// caller (versus one of the caller's own connected inboxes).
    pub is_delegated: bool,
}

/// Response from the ListInboxes tool.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListInboxesResponse {
    /// The inboxes the caller can read or act on.
    pub inboxes: Vec<ToolInbox>,
    /// A human-readable summary of the inboxes.
    pub summary: String,
}

/// List the email inboxes the user can access.
#[derive(Debug, Deserialize, JsonSchema, Clone, Default)]
#[schemars(
    title = "ListInboxes",
    description = "\
List the email inboxes the user can read or act on. Returns the caller's primary inbox, any \
other inboxes they have connected, and any inboxes delegated to them by teammates. Each entry \
has an `emailAddress`, `isPrimary` (the default inbox used when no inbox is specified), and \
`isDelegated` (true when the inbox belongs to another user).\n\
\n\
Use this when the user references a specific or non-default mailbox (e.g. \"my work inbox\", \
\"the shared inbox\", \"the inbox Alex shared with me\") so you can pass the exact \
`emailAddress` to the `inbox` parameter of ListEntities, ContentSearch, or NameSearch, or to \
ListLabels. Most users have a single inbox, in which case email tools operate on it by default \
and you do not need this tool. Do not guess inbox addresses — list them here first."
)]
pub struct ListInboxes {}

#[async_trait]
impl<T, G, E> AsyncTool<EmailToolContext<T, G, E>> for ListInboxes
where
    T: EmailService,
    G: GmailTokenProvider,
    E: EntityAccessService,
{
    type Output = ListInboxesResponse;

    #[tracing::instrument(skip_all, fields(user_id=?request_context.user_id), err)]
    async fn call(
        &self,
        service_context: ServiceContext<EmailToolContext<T, G, E>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        tracing::info!("List inboxes");

        let inboxes = service_context
            .service
            .get_inboxes_for_macro_id(MacroUserIdStr((*request_context.user_id).clone()))
            .await
            .map_err(|e| ToolCallError {
                description: format!("Failed to list inboxes: {e}"),
                internal_error: e.into(),
            })?;

        let caller_macro_id = request_context.user_id.to_string();
        let tool_inboxes: Vec<ToolInbox> = inboxes
            .iter()
            .map(|link| {
                let owned = link.macro_id.to_string() == caller_macro_id;
                ToolInbox {
                    email_address: link.email_address.0.as_ref().to_string(),
                    is_primary: owned && link.is_primary,
                    is_delegated: !owned,
                }
            })
            .collect();

        let summary = build_summary(&tool_inboxes);

        Ok(ListInboxesResponse {
            inboxes: tool_inboxes,
            summary,
        })
    }
}

fn build_summary(inboxes: &[ToolInbox]) -> String {
    if inboxes.is_empty() {
        return "No email inboxes are connected.".to_string();
    }

    let delegated = inboxes.iter().filter(|i| i.is_delegated).count();
    let own = inboxes.len() - delegated;

    let mut parts = Vec::new();
    if own > 0 {
        parts.push(format!(
            "{own} connected inbox{}",
            if own == 1 { "" } else { "es" }
        ));
    }
    if delegated > 0 {
        parts.push(format!(
            "{delegated} delegated inbox{}",
            if delegated == 1 { "" } else { "es" }
        ));
    }

    format!("Found {}.", parts.join(" and "))
}
