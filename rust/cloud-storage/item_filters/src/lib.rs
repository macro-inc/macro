#![deny(missing_docs)]
//! This crate contains all filters for various item types to be used in soup/search.

use non_empty::IsEmpty;
use serde::{Deserialize, Serialize};
use strum::{Display, EnumString};

pub mod ast;

/// Fields that can be searched on in search queries
#[derive(Serialize, Deserialize, Debug, Copy, Clone, EnumString, Display, PartialEq, Default)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema, schemars::JsonSchema))]
pub enum SearchOn {
    /// Search on the name/title field only
    Name,
    /// Search on the content field only (default)
    #[default]
    Content,
    /// Search on both name and content fields
    NameContent,
}

/// Notification-level filters that apply to an entity type.
#[derive(Debug, Serialize, Deserialize, Default, PartialEq, Clone)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema, schemars::JsonSchema))]
pub struct NotificationFilters {
    /// Filter by notification done state.
    /// None to ignore, true to include only done notifications, false to include only not-done notifications.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub done: Option<bool>,

    /// Filter by notification seen state.
    /// None to ignore, true to include only seen notifications, false to include only unseen notifications.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seen: Option<bool>,
}

impl IsEmpty for NotificationFilters {
    fn is_empty(&self) -> bool {
        let NotificationFilters { done, seen } = self;
        done.is_none() && seen.is_none()
    }
}

/// Task-only filters nested under document filters.
#[derive(Debug, Serialize, Deserialize, Default, PartialEq, Clone)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema, schemars::JsonSchema))]
pub struct TaskFilters {
    /// Include tasks that are created by me, assigned to me, and not completed,
    /// even when they do not match other document filters.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub include_cbm_atm_nc: Option<bool>,
}

impl IsEmpty for TaskFilters {
    fn is_empty(&self) -> bool {
        // false is equivalent to "disabled" and should not affect filtering.
        self.include_cbm_atm_nc != Some(true)
    }
}

/// The document filters used to filter down what documents you search over.
#[derive(Debug, Serialize, Deserialize, Default, PartialEq, Clone)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema, schemars::JsonSchema))]
pub struct DocumentFilters {
    /// Document file types to search. Examples: ['pdf'], ['md', 'txt']. Empty to search all file types.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub file_types: Vec<String>,

    /// Document ids to search over. Examples: ['doc1'], ['doc1', 'doc2']. Empty to search all accessible documents.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub document_ids: Vec<String>,

    /// A list of project ids to search within. Examples: ['project1'].
    /// filtering. Empty to ignore project filtering.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub project_ids: Vec<String>,

    /// Filter by document owner. Examples: ['macro|user1@user.com'], ['macro|user1@user.com', 'macro|user2@user.com']. Empty to search all owners.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub owners: Vec<String>,

    /// Filter by document importance. None to ignore, true to pass through (no clause), false to short-circuit and return nothing.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub importance: Option<bool>,

    /// Filter by document notification state.
    #[serde(default, skip_serializing_if = "NotificationFilters::is_empty")]
    pub notification_filters: NotificationFilters,

    /// Task-specific filters that only apply to task subtype documents.
    #[serde(default, skip_serializing_if = "TaskFilters::is_empty")]
    pub task_filters: TaskFilters,

    /// Filter by document sub type. Examples: ['task']. Empty to search all sub types.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sub_types: Vec<String>,

    /// Filter by email attachment status. true = only email attachments, false = only non-email attachments, None = both.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_email_attachment: Option<bool>,
}

impl IsEmpty for DocumentFilters {
    fn is_empty(&self) -> bool {
        let DocumentFilters {
            file_types,
            document_ids,
            project_ids,
            owners,
            importance,
            notification_filters,
            task_filters,
            sub_types,
            is_email_attachment,
        } = self;
        file_types.is_empty()
            && document_ids.is_empty()
            && project_ids.is_empty()
            && owners.is_empty()
            && importance.is_none()
            && notification_filters.is_empty()
            && task_filters.is_empty()
            && sub_types.is_empty()
            && is_email_attachment.is_none()
    }
}

/// The chat filters used to filter down what chats you search over.
#[derive(Debug, Serialize, Deserialize, Default, PartialEq, Clone)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema, schemars::JsonSchema))]
pub struct ChatFilters {
    /// Chat message roles to search. Examples: ['user'], ['assistant']. Empty to search all roles.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub role: Vec<String>,

    /// Chat ids to search over. Examples: ['chat1'], ['chat1', 'chat2']. When provided, chat search will only match results on these chats. Empty to search all accessible chats.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub chat_ids: Vec<String>,

    /// A list of project ids to search within. Examples: ['project1']. Empty to ignore project filtering.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub project_ids: Vec<String>,

    /// Filter by chat owner. Examples: ['macro|user1@user.com'], ['macro|user1@user.com', 'macro|user2@user.com']. Empty to search all owners.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub owners: Vec<String>,

    /// Filter by chat importance. None to ignore, true to pass through (no clause), false to short-circuit and return nothing.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub importance: Option<bool>,

    /// Filter by chat notification state.
    #[serde(default, skip_serializing_if = "NotificationFilters::is_empty")]
    pub notification_filters: NotificationFilters,
}

impl IsEmpty for ChatFilters {
    fn is_empty(&self) -> bool {
        let ChatFilters {
            role,
            chat_ids,
            project_ids,
            owners,
            importance,
            notification_filters,
        } = self;
        role.is_empty()
            && chat_ids.is_empty()
            && project_ids.is_empty()
            && owners.is_empty()
            && importance.is_none()
            && notification_filters.is_empty()
    }
}

/// Controls whether shared email threads are included in results.
#[derive(Debug, Serialize, Deserialize, Default, PartialEq, Clone, Copy)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema, schemars::JsonSchema))]
pub enum SharedEmailFilter {
    /// Only show the user's own threads (default)
    #[default]
    Exclude,
    /// Show both own and shared threads
    Include,
    /// Show only threads shared with the user
    Only,
}

impl SharedEmailFilter {
    /// Returns true if this is the default (Exclude) variant.
    pub fn is_default(&self) -> bool {
        matches!(self, SharedEmailFilter::Exclude)
    }
}

/// The email filters used to filter down what emails you search over.
#[derive(Debug, Serialize, Deserialize, Default, PartialEq, Clone)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema, schemars::JsonSchema))]
pub struct EmailFilters {
    /// Email sender addresses to filter by. Examples: ['user@example.com']. Empty to search all senders.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub senders: Vec<String>,
    /// Email CC addresses to filter by. Examples: ['user@example.com']. Empty if not filtering by CC.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub cc: Vec<String>,
    /// Email BCC addresses to filter by. Examples: ['user@example.com']. Empty if not filtering by BCC.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub bcc: Vec<String>,
    /// Email Recipient addresses to filter by. Examples: ['user@example.com']. Empty if not filtering by Recipient.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub recipients: Vec<String>,

    /// Email thread IDs to filter by. Examples: ['thread-uuid-1']. Empty to search all threads.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub email_thread_ids: Vec<String>,

    /// Restrict to specific inboxes by email_links.id. Empty means "any inbox the
    /// caller can access" (soup expands to the full set at the router edge).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub link_ids: Vec<String>,

    /// A list of project ids to search within. Empty to ignore project filtering.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub project_ids: Vec<String>,

    /// Filter by email importance. None to not filter. True to show only important emails
    /// (drafts, personal, sent, or uncategorized). False to show only unimportant emails
    /// (those categorized as promotions, social, updates, or forums).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub importance: Option<bool>,

    /// Filter by email notification state.
    #[serde(default, skip_serializing_if = "NotificationFilters::is_empty")]
    pub notification_filters: NotificationFilters,

    /// Only include emails that have at least one of these labels. Supports both Gmail system labels (e.g. "INBOX", "CATEGORY_PROMOTIONS") and user-created labels (e.g. "github"). Empty to not filter by included labels.
    /// Note: SPAM and TRASH emails are not indexed in OpenSearch, so they will never appear in results regardless of this filter.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub include_labels: Vec<String>,

    /// Exclude emails that have any of these labels. Supports both Gmail system labels (e.g. "CATEGORY_PROMOTIONS") and user-created labels. Empty to not exclude any labels.
    /// Note: SPAM and TRASH emails are not indexed in OpenSearch, so they are already excluded by default.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub exclude_labels: Vec<String>,

    /// Controls whether shared email threads are included in results.
    /// Defaults to "exclude" (only the user's own threads).
    #[serde(default, skip_serializing_if = "SharedEmailFilter::is_default")]
    pub shared: SharedEmailFilter,

    /// CRM-scoped domain filter. When non-empty, expands visibility to every
    /// teammate's mailbox and restricts to threads involving any of these
    /// domains (in any of sender/cc/bcc/recipient). Each domain is authorized
    /// against `crm_domains` + `crm_companies` (must exist for the caller's
    /// team, company must not be hidden, `email_sync` must be true).
    /// Mutually exclusive with `crm_addresses`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub crm_domains: Vec<String>,

    /// CRM-scoped address filter. When non-empty, expands visibility to every
    /// teammate's mailbox and restricts to threads involving any of these
    /// fully-qualified addresses. Each address is authorized against
    /// `crm_contacts` + `crm_companies` (contact must not be hidden, company
    /// must not be hidden, `email_sync` must be true).
    /// Mutually exclusive with `crm_domains`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub crm_addresses: Vec<String>,

    /// When `Some(true)`, only include threads that have at least one message
    /// with an iCalendar attachment (`.ics` filename or `application/ics` mime
    /// type). `Some(false)` and `None` apply no constraint.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub calendar_only: Option<bool>,
}

impl IsEmpty for EmailFilters {
    fn is_empty(&self) -> bool {
        let EmailFilters {
            senders,
            cc,
            bcc,
            recipients,
            email_thread_ids,
            link_ids,
            project_ids,
            importance,
            notification_filters,
            include_labels,
            exclude_labels,
            shared,
            crm_domains,
            crm_addresses,
            calendar_only,
        } = self;
        senders.is_empty()
            && cc.is_empty()
            && bcc.is_empty()
            && recipients.is_empty()
            && email_thread_ids.is_empty()
            && link_ids.is_empty()
            && project_ids.is_empty()
            && importance.is_none()
            && notification_filters.is_empty()
            && include_labels.is_empty()
            && exclude_labels.is_empty()
            && shared.is_default()
            && crm_domains.is_empty()
            && crm_addresses.is_empty()
            && !calendar_only.unwrap_or(false)
    }
}

/// Viewer-relative attendance status for a call record.
/// Serializes as `ATTENDED`, `MISSED`, or `UNATTENDED`.
#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, Clone, Copy)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema, schemars::JsonSchema))]
pub enum CallStatus {
    /// The viewer is a call participant.
    Attended,
    /// The viewer is not a call participant and is in the call's channel.
    Missed,
    /// The viewer is not a call participant and is not in the call's channel.
    Unattended,
}

/// Filters for call records.
#[derive(Debug, Serialize, Deserialize, Default, PartialEq, Clone)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema, schemars::JsonSchema))]
pub struct CallFilters {
    /// Call record IDs to filter by. Empty to include all calls.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub call_ids: Vec<String>,
    /// Channel IDs to filter calls by. Empty to include all calls.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub channel_ids: Vec<String>,
    /// Speaker macro user ids. Empty to include all.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub speaker_ids: Vec<String>,
    /// Filter by the requesting user's viewer-relative call status.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<CallStatus>,
    /// Legacy filter by whether the requesting user attended the call.
    /// Prefer [`CallFilters::status`] for new callers.
    /// `None` = no filter, `Some(true)` = only calls the user joined,
    /// `Some(false)` = only calls the user did not join.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attended: Option<bool>,
}

impl IsEmpty for CallFilters {
    fn is_empty(&self) -> bool {
        let CallFilters {
            call_ids,
            channel_ids,
            speaker_ids,
            status,
            attended,
        } = self;
        call_ids.is_empty()
            && channel_ids.is_empty()
            && speaker_ids.is_empty()
            && status.is_none()
            && attended.is_none()
    }
}

/// Filters for foreign entity records.
#[derive(Debug, Serialize, Deserialize, Default, PartialEq, Clone)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema, schemars::JsonSchema))]
pub struct ForeignEntityFilters {
    /// Internal foreign entity record IDs to filter by. Empty to include all records.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub ids: Vec<String>,
    /// External entity identifiers to filter by. Empty to include all external IDs.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub foreign_entity_ids: Vec<String>,
    /// External source names to filter by. Empty to include all sources.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub foreign_entity_sources: Vec<String>,
    /// When true, only return foreign entities whose metadata lists the requesting user as a
    /// participant (GitHub `involves:me` semantics for `github_pull_request` records). False or
    /// absent applies no filter. Serialized in filter ASTs as the `"me"` literal.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub includes_me: bool,
}

impl IsEmpty for ForeignEntityFilters {
    fn is_empty(&self) -> bool {
        let ForeignEntityFilters {
            ids,
            foreign_entity_ids,
            foreign_entity_sources,
            includes_me,
        } = self;
        ids.is_empty()
            && foreign_entity_ids.is_empty()
            && foreign_entity_sources.is_empty()
            && !*includes_me
    }
}

/// The channel message filters used to filter down what channel messages you search over.
#[derive(Debug, Serialize, Deserialize, Default, PartialEq, Clone)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema, schemars::JsonSchema))]
pub struct ChannelFilters {
    /// Channel thread IDs to search within. Examples: ['thread123']. Empty to search all threads.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub thread_ids: Vec<String>,
    /// Channel user mentions to search for. Examples: ['@username']. Empty if not filtering by mentions.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub mentions: Vec<String>,
    /// Channel organization ID to search within. Empty to ignore organization filtering.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub org_id: Option<i64>,
    /// Channel team ID to search within. Empty to ignore team filtering.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub team_id: Option<String>,
    /// Channel IDs to search within. Examples: ['general']. Empty to search all accessible channels.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub channel_ids: Vec<String>,
    /// Sender IDs to search within. Examples: ['user1']. Empty to search all accessible senders.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sender_ids: Vec<String>,

    /// Channel types to filter by. Examples: ['public'], ['direct_message', 'private']. Empty to search all channel types.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub channel_types: Vec<String>,

    /// Filter by channel importance. None to ignore, true to pass through (no clause), false to short-circuit and return nothing.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub importance: Option<bool>,

    /// Filter by channel notification state.
    #[serde(default, skip_serializing_if = "NotificationFilters::is_empty")]
    pub notification_filters: NotificationFilters,
}

impl IsEmpty for ChannelFilters {
    fn is_empty(&self) -> bool {
        let ChannelFilters {
            thread_ids,
            mentions,
            org_id,
            team_id,
            channel_ids,
            sender_ids,
            channel_types,
            importance,
            notification_filters,
        } = self;
        thread_ids.is_empty()
            && mentions.is_empty()
            && org_id.is_none()
            && team_id.is_none()
            && channel_ids.is_empty()
            && sender_ids.is_empty()
            && channel_types.is_empty()
            && importance.is_none()
            && notification_filters.is_empty()
    }
}

/// A single property-based filter condition.
///
/// Each filter targets a specific property definition on entities of a given type,
/// matching against select option UUIDs or entity reference IDs.
/// Multiple values within a single filter are OR'd together.
/// Multiple filters are AND'd together.
#[derive(Debug, Serialize, Deserialize, Default, PartialEq, Clone)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema, schemars::JsonSchema))]
pub struct PropertyFilter {
    /// The UUID of the property definition to filter on.
    pub property_definition_id: String,
    /// The entity type for the property lookup (e.g., "TASK", "DOCUMENT", "PROJECT").
    /// When None, matches across all entity types.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub entity_type: Option<String>,
    /// Select option UUIDs to match. Multiple values are OR'd together.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub option_ids: Vec<String>,
    /// Entity reference IDs to match. Multiple values are OR'd together.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub entity_ids: Vec<String>,
}

impl IsEmpty for PropertyFilter {
    fn is_empty(&self) -> bool {
        self.option_ids.is_empty() && self.entity_ids.is_empty()
    }
}

/// The crm company filters used to narrow which CRM companies appear in soup.
#[derive(Debug, Serialize, Deserialize, Default, PartialEq, Clone)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema, schemars::JsonSchema))]
pub struct CrmCompanyFilters {
    /// CRM company ids to filter by. Examples: ['11111111-...']. Empty to
    /// include all of the team's visible CRM companies.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub company_ids: Vec<String>,
    /// Optional `crm_companies.hidden` filter. `None` = visible only
    /// (default for back-compat with non-admin callers). `Some(false)` =
    /// visible only (explicit). `Some(true)` = hidden only — requires
    /// admin/owner team role; enforced upstream in soup's axum router.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hidden: Option<bool>,
}

impl IsEmpty for CrmCompanyFilters {
    fn is_empty(&self) -> bool {
        let CrmCompanyFilters {
            company_ids,
            hidden,
        } = self;
        company_ids.is_empty() && hidden.is_none()
    }
}

/// The project filters used to filter down what projects you search over.
#[derive(Debug, Serialize, Deserialize, Default, PartialEq, Clone)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema, schemars::JsonSchema))]
pub struct ProjectFilters {
    /// Project IDs to search within. Examples: ['project1']. Empty to search all accessible projects.
    /// By default matches children of these projects; set `include_root` to also match the projects themselves.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub project_ids: Vec<String>,

    /// When true, `project_ids` also matches the projects themselves in addition to their children.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub include_root: bool,

    /// Filter by project owner. Examples: ['macro|user1@user.com'], ['macro|user1@user.com', 'macro|user2@user.com']. Empty to search all owners.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub owners: Vec<String>,

    /// Filter by project importance. None to ignore, true to pass through (no clause), false to short-circuit and return nothing.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub importance: Option<bool>,

    /// Filter by project notification state.
    #[serde(default, skip_serializing_if = "NotificationFilters::is_empty")]
    pub notification_filters: NotificationFilters,
}

impl IsEmpty for ProjectFilters {
    fn is_empty(&self) -> bool {
        let ProjectFilters {
            project_ids,
            include_root: _,
            owners,
            importance,
            notification_filters,
        } = self;
        project_ids.is_empty()
            && owners.is_empty()
            && importance.is_none()
            && notification_filters.is_empty()
    }
}

/// a bundle of all of the filters for each entity type
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema, schemars::JsonSchema))]
pub struct EntityFilters {
    /// the bundled [ProjectFilters]
    #[serde(default)]
    pub project_filters: ProjectFilters,
    /// the bundled [DocumentFilters]
    #[serde(default)]
    pub document_filters: DocumentFilters,
    /// the bundled [ChatFilters]
    #[serde(default)]
    pub chat_filters: ChatFilters,
    /// the bundled [ChannelFilters]
    #[serde(default)]
    pub channel_filters: ChannelFilters,
    /// the bundled [CallFilters]
    #[serde(default)]
    pub call_filters: CallFilters,
    /// the bundled [EmailFilters]
    #[serde(default)]
    pub email_filters: EmailFilters,
    /// the bundled [CrmCompanyFilters]
    #[serde(default)]
    pub crm_company_filters: CrmCompanyFilters,
    /// the bundled [ForeignEntityFilters]
    #[serde(default)]
    pub foreign_entity_filters: ForeignEntityFilters,
    /// property-based filters applied across entity types
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub property_filters: Vec<PropertyFilter>,
}

impl IsEmpty for EntityFilters {
    fn is_empty(&self) -> bool {
        let EntityFilters {
            project_filters,
            document_filters,
            chat_filters,
            channel_filters,
            call_filters,
            email_filters,
            crm_company_filters,
            foreign_entity_filters,
            property_filters,
        } = self;
        project_filters.is_empty()
            && document_filters.is_empty()
            && chat_filters.is_empty()
            && channel_filters.is_empty()
            && call_filters.is_empty()
            && email_filters.is_empty()
            && crm_company_filters.is_empty()
            && foreign_entity_filters.is_empty()
            && property_filters.iter().all(IsEmpty::is_empty)
    }
}
