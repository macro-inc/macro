use async_graphql::{Enum, ID, SimpleObject};
use email::domain::models::{
    EmailSyncStatus, LabelListVisibility, LabelType, LinkLabel, MessageListVisibility,
    UserEmailLink, UserEmailLinkSettings, UserProvider,
};
use uuid::Uuid;

/// Canonical normalized GraphQL email label used by both email threads and
/// the authenticated user's label catalog.
#[derive(SimpleObject)]
#[graphql(name = "GraphqlSoupEmailLabel")]
pub struct GraphqlEmailLabel {
    /// Stable database identifier for the label.
    id: ID,
    /// Identifier of the email link that owns the label.
    link_id: ID,
    /// Provider-specific label identifier.
    provider_label_id: String,
    /// User-visible label name.
    name: String,
    /// Label creation timestamp in RFC 3339 format.
    created_at: String,
    /// Provider message-list visibility value.
    message_list_visibility: &'static str,
    /// Provider label-list visibility value.
    label_list_visibility: &'static str,
    /// Whether the label is provider-created or user-created.
    #[graphql(name = "type")]
    type_: &'static str,
}

impl GraphqlEmailLabel {
    /// Construct the canonical label object from domain label fields.
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        id: Uuid,
        link_id: Uuid,
        provider_label_id: String,
        name: String,
        created_at: chrono::DateTime<chrono::Utc>,
        message_list_visibility: MessageListVisibility,
        label_list_visibility: LabelListVisibility,
        type_: LabelType,
    ) -> Self {
        Self {
            id: ID(id.to_string()),
            link_id: ID(link_id.to_string()),
            provider_label_id,
            name,
            created_at: created_at.to_rfc3339(),
            message_list_visibility: match message_list_visibility {
                MessageListVisibility::Show => "show",
                MessageListVisibility::Hide => "hide",
            },
            label_list_visibility: match label_list_visibility {
                LabelListVisibility::LabelShow => "label_show",
                LabelListVisibility::LabelShowIfUnread => "label_show_if_unread",
                LabelListVisibility::LabelHide => "label_hide",
            },
            type_: match type_ {
                LabelType::System => "system",
                LabelType::User => "user",
            },
        }
    }
}

impl From<LinkLabel> for GraphqlEmailLabel {
    fn from(label: LinkLabel) -> Self {
        Self::new(
            label.id,
            label.link_id,
            label.provider_label_id,
            label.name,
            label.created_at,
            label.message_list_visibility,
            label.label_list_visibility,
            label.type_,
        )
    }
}

/// Email provider for an authenticated user's linked inbox.
#[derive(Enum, Debug, Clone, Copy, PartialEq, Eq)]
pub enum GraphqlEmailProvider {
    /// Google Gmail.
    Gmail,
}

impl From<UserProvider> for GraphqlEmailProvider {
    fn from(provider: UserProvider) -> Self {
        match provider {
            UserProvider::Gmail => Self::Gmail,
        }
    }
}

/// Coarse synchronization state for an authenticated user's linked inbox.
#[derive(Enum, Debug, Clone, Copy, PartialEq, Eq)]
pub enum GraphqlEmailSyncStatus {
    /// Initial synchronization is queued or running.
    Syncing,
    /// The inbox is active and synchronized.
    UpToDate,
    /// Initial synchronization failed or was cancelled.
    Error,
    /// The provider grant must be reauthorized.
    NeedsReauth,
    /// Synchronization is disabled.
    Inactive,
}

impl From<EmailSyncStatus> for GraphqlEmailSyncStatus {
    fn from(status: EmailSyncStatus) -> Self {
        match status {
            EmailSyncStatus::Syncing => Self::Syncing,
            EmailSyncStatus::UpToDate => Self::UpToDate,
            EmailSyncStatus::Error => Self::Error,
            EmailSyncStatus::NeedsReauth => Self::NeedsReauth,
            EmailSyncStatus::Inactive => Self::Inactive,
        }
    }
}

/// Signature settings embedded in an authenticated user's email link.
#[derive(SimpleObject)]
pub struct GraphqlEmailLinkSettings {
    /// Whether signatures are included on replies and forwards.
    signature_on_replies_forwards: bool,
    /// Saved, sanitized signature HTML, when configured.
    signature: Option<String>,
}

impl From<UserEmailLinkSettings> for GraphqlEmailLinkSettings {
    fn from(settings: UserEmailLinkSettings) -> Self {
        Self {
            signature_on_replies_forwards: settings.signature_on_replies_forwards,
            signature: settings.signature,
        }
    }
}

/// Enriched email link accessible to the authenticated user.
#[derive(SimpleObject)]
pub struct GraphqlEmailLink {
    /// Stable email link identifier.
    id: ID,
    /// Macro user that owns the inbox.
    macro_id: String,
    /// Provider email address for the inbox.
    email_address: String,
    /// SFS URL of the inbox's self-contact photo, when available.
    photo_url: Option<String>,
    /// Email provider.
    provider: GraphqlEmailProvider,
    /// Whether ongoing provider synchronization is enabled.
    is_sync_active: bool,
    /// Coarse synchronization state derived by the email domain.
    sync_status: GraphqlEmailSyncStatus,
    /// Whether the provider grant must be reauthorized.
    needs_reauth: bool,
    /// Inbox signature settings.
    settings: GraphqlEmailLinkSettings,
    /// Whether this is the owner's primary inbox.
    is_primary: bool,
    /// Link creation timestamp in RFC 3339 format.
    created_at: String,
    /// Link last-updated timestamp in RFC 3339 format.
    updated_at: String,
}

impl From<UserEmailLink> for GraphqlEmailLink {
    fn from(link: UserEmailLink) -> Self {
        Self {
            id: ID(link.id.to_string()),
            macro_id: link.macro_id.to_string(),
            email_address: link.email_address.0.as_ref().to_owned(),
            photo_url: link.photo_url,
            provider: link.provider.into(),
            is_sync_active: link.is_sync_active,
            sync_status: link.sync_status.into(),
            needs_reauth: link.needs_reauth,
            settings: link.settings.into(),
            is_primary: link.is_primary,
            created_at: link.created_at.to_rfc3339(),
            updated_at: link.updated_at.to_rfc3339(),
        }
    }
}
