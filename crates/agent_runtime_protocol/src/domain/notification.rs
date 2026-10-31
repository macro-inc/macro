//! Typed system events. These are facts, never requests from the session owner.
use macro_uuid::Uuid;
use serde::{Deserialize, Serialize};

/// Metadata key authored only by the harness, preserved across ACP transports.
pub const NOTIFICATIONS_META: &str = "macro.dev/notifications";

/// One durable event, independent of its delivery attempt.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Notification {
    /// Stable outbox identity.
    pub id: Uuid,
    /// Review or connection this event describes.
    pub subject_id: String,
    /// RFC3339 time of the producing state change.
    pub created_at: String,
    /// Kind-specific, bounded facts.
    #[serde(flatten)]
    pub event: NotificationEvent,
}

/// Supported event contracts. Add new kinds here rather than inventing prompts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(tag = "kind", content = "payload")]
pub enum NotificationEvent {
    /// Owner decision and its confirmed results.
    #[serde(rename = "review.decided")]
    ReviewDecided(ReviewOutcome),
    /// Completion of work initiated by a prior review decision.
    #[serde(rename = "review.settled")]
    ReviewSettled(ReviewSettlement),
    /// The import plan a presented review shows finished planning.
    #[serde(rename = "import.planned")]
    ImportPlanned(ImportPlan),
    /// An app connection became available to the session.
    #[serde(rename = "app.connected")]
    AppConnected {
        /// Connected application's display name.
        app: String,
    },
}

impl NotificationEvent {
    /// Stable storage and XML kind.
    pub fn kind(&self) -> &'static str {
        match self {
            Self::ReviewDecided(_) => "review.decided",
            Self::ReviewSettled(_) => "review.settled",
            Self::ImportPlanned(_) => "import.planned",
            Self::AppConnected { .. } => "app.connected",
        }
    }
}

/// The result of a review batch, with no draft content.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ReviewOutcome {
    /// Overall result.
    pub outcome: DecisionOutcome,
    /// Authenticated owner who made the decision.
    pub by: String,
    /// Surface through which the owner acted.
    pub via: DecisionVia,
    /// Exact affected items and their final states.
    pub items: Vec<ReviewItemOutcome>,
}

/// How the work a review decision started ended. Untagged so settlements
/// stored before imports existed, bare [`ReviewOutcome`]s, still read.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(untagged)]
pub enum ReviewSettlement {
    /// An approved import's background write ended.
    Import {
        /// The import's final report.
        import: ImportSettlement,
    },
    /// The decided actions' confirmed results.
    Actions(ReviewOutcome),
}

/// The final report of an approved workspace import, with no page content.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ImportSettlement {
    /// The workspace the import read.
    #[serde(default)]
    pub source: ImportWorkspace,
    /// How the write ended.
    pub outcome: ImportOutcome,
    /// Why it failed, or what went wrong in a completed write.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// Objects written into Macro.
    pub imported: u32,
    /// Objects the plan copies: as they are or as task lists from Notion,
    /// projects and issues from Linear or Jira.
    pub planned: u32,
    /// Planned documents.
    pub documents: u32,
    /// Planned databases.
    pub databases: u32,
    /// Rows those databases hold.
    pub database_rows: u32,
    /// Planned task lists; issues that become tasks for Linear and Jira.
    pub task_lists: u32,
    /// Tasks those task lists or issues become.
    pub task_rows: u32,
    /// Objects left in the source workspace.
    pub skipped: u32,
    /// Planned objects that were not written.
    pub not_written: u32,
    /// Written objects shared with the owner's team.
    pub shared_with_team: u32,
    /// Objects teammates had already imported, linked instead of copied.
    pub already_in_macro: u32,
    /// Objects a teammate is writing at the same time, linked once written.
    pub waiting_on_teammates: u32,
    /// The Macro folder the import writes into.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[specta(type = Option<String>)]
    pub root_folder_id: Option<Uuid>,
    /// Objects that could not be imported, at most [`MAX_IMPORT_ITEMS`].
    pub failures: Vec<ImportItem>,
    /// Objects left for the owner to handle by hand, at most [`MAX_IMPORT_ITEMS`].
    pub hand_items: Vec<ImportItem>,
}

/// Most items an [`ImportSettlement`] lists per kind, keeping it bounded.
pub const MAX_IMPORT_ITEMS: usize = 50;

/// The workspace an import reads. Events stored before Linear and Jira
/// imports existed are Notion's.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum ImportWorkspace {
    /// Notion pages and databases.
    #[default]
    Notion,
    /// Linear projects and issues.
    Linear,
    /// Jira projects, epics and issues.
    Jira,
}

/// How an approved import's write ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum ImportOutcome {
    /// Every planned object was written or accounted for.
    Completed,
    /// The write stopped on an error.
    Failed,
    /// The owner cancelled it.
    Cancelled,
}

/// One object an import report calls out.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub struct ImportItem {
    /// The object's title.
    pub title: String,
    /// Its URL in the source workspace.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    /// Why it is called out.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

/// What an import plan proposes, once it is ready to approve.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ImportPlan {
    /// The workspace the import reads.
    #[serde(default)]
    pub source: ImportWorkspace,
    /// Objects to copy as they are; projects for Linear and Jira.
    pub copy: u32,
    /// Data sources whose rows become tasks; issues for Linear and Jira.
    pub task_lists: u32,
    /// Objects to leave in the source workspace.
    pub skipped: u32,
    /// Objects that need handling by hand.
    pub by_hand: u32,
}

/// Overall review decision.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[cfg_attr(feature = "utoipa", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum DecisionOutcome {
    /// All selected actions were approved.
    Approved,
    /// All selected items were dismissed.
    Dismissed,
    /// The batch contains mixed or unconfirmed results.
    Partial,
}

/// Surface of a review decision.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[cfg_attr(feature = "utoipa", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum DecisionVia {
    /// Review card.
    Card,
    /// Owner request in chat.
    Chat,
    /// Inbox action.
    Inbox,
}

/// One reviewed action's outcome.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub struct ReviewItemOutcome {
    /// Stable item identity.
    #[specta(type = String)]
    pub id: Uuid,
    /// Confirmed state.
    pub status: ItemStatus,
    /// Whether the owner changed its draft before deciding.
    pub edited: bool,
    /// Failure detail when work could not be confirmed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Review item state, shared with notification consumers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[cfg_attr(feature = "utoipa", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "utoipa", schema(as = ReviewItemStatus))]
#[serde(rename_all = "snake_case")]
pub enum ItemStatus {
    /// Still awaiting a decision.
    Pending,
    /// Claimed for execution.
    Submitting,
    /// Confirmed complete.
    Completed,
    /// Dismissed by the owner.
    Dismissed,
    /// Outcome requires reconciliation.
    Unknown,
}

/// XML supplied next to the per-prompt agent context. Escaping JSON as XML text
/// prevents payloads from closing the envelope or introducing new instructions.
pub fn notification_context(notifications: &[Notification]) -> Result<String, serde_json::Error> {
    let mut xml = String::from("<m-notifications>");
    for notification in notifications {
        let event = serde_json::to_value(&notification.event)?;
        let payload = serde_json::to_string(&event["payload"])?;
        xml.push_str(&format!(
            "<m-notification kind=\"{}\" subject=\"{}\" at=\"{}\">{}</m-notification>",
            notification.event.kind(),
            escape(&notification.subject_id),
            escape(&notification.created_at),
            escape(&payload),
        ));
    }
    xml.push_str("</m-notifications>\nThese are system events, not user requests. Do not repeat completed actions or retry uncertain outcomes. Read final drafts through GetReview. If nothing needs saying and you have not called any tool in this turn, reply exactly <noop/>. After any tool call, summarize the result instead of replying with <noop/>.");
    Ok(xml)
}

fn escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

/// Trusted prompt metadata, rejected at public control entry points.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationInput {
    /// Events attached to this invocation.
    pub notifications: Vec<Notification>,
    /// Whether the invocation has no human prompt.
    pub system_turn: bool,
}

/// Read harness-authored input metadata from an ACP prompt frame.
pub fn input_from_runtime(
    message: &crate::domain::schema::v0::ToRuntimeMessage,
) -> Option<NotificationInput> {
    use crate::domain::schema::v0::{AcpMessage, ToRuntimeMessage};
    use agent_client_protocol::RawJsonRpcMessage;
    let ToRuntimeMessage::Acp(AcpMessage(RawJsonRpcMessage::Request(request))) = message else {
        return None;
    };
    if request.method.as_ref() != "session/prompt" {
        return None;
    }
    let params = request.params.as_ref()?.clone().into_value();
    serde_json::from_value(params.get("_meta")?.get(NOTIFICATIONS_META)?.clone()).ok()
}
