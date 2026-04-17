use chrono::DateTime;
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::report;
use serde::{Deserialize, Serialize};
use std::hash::{DefaultHasher, Hasher};
use utoipa::ToSchema;
mod device;
pub mod digest_state;
mod metadata;
mod unsubscribe;
pub use device::*;
pub use metadata::*;
pub use unsubscribe::*;

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(transparent)]
pub struct ChannelMessageDocumentMetadata(pub DocumentMentionMetadata);

#[derive(Serialize, Deserialize, Debug, Clone, ToSchema, Default)]
#[serde(rename_all = "camelCase")]
pub struct NotificationTemporalData {
    pub created_at: Option<DateTime<chrono::Utc>>,
    pub viewed_at: Option<DateTime<chrono::Utc>>,
    pub updated_at: Option<DateTime<chrono::Utc>>,
    pub deleted_at: Option<DateTime<chrono::Utc>>,
}

/// used to build up the data to construct a [HashedCollapseKey]
pub struct NotifCollapseKey(DefaultHasher);

/// contains the string representation of a notification collapse key
/// this is used to uniquely identify notifications delivered to an ios device
#[derive(Debug, Clone)]
pub struct HashedCollapseKey(String);

impl AsRef<str> for HashedCollapseKey {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

impl HashedCollapseKey {
    pub fn from_hashed(s: String) -> Self {
        Self(s)
    }

    pub fn into_inner(self) -> String {
        self.0
    }
}

impl NotifCollapseKey {
    pub fn new(s: &str) -> Self {
        let mut hasher = DefaultHasher::new();
        hasher.write(s.as_bytes());
        NotifCollapseKey(hasher)
    }

    pub fn append(mut self, s: &str) -> Self {
        self.0.write(s.as_bytes());
        self
    }

    pub fn into_hashed(self) -> HashedCollapseKey {
        let bytes = self.0.finish();
        HashedCollapseKey::from_hashed(format!("{bytes:x}"))
    }
}

#[derive(Debug, Clone)]
pub enum DeviceEndpoint {
    Android(String),
    Ios(String),
}

impl DeviceEndpoint {
    pub fn arn(&self) -> &str {
        match self {
            DeviceEndpoint::Android(a) => a.as_ref(),
            DeviceEndpoint::Ios(i) => i.as_ref(),
        }
    }
}

/// Defines a notification event enum with compile-time safety guarantees.
///
/// The `tag` field in the database row is the `Notification::TYPE_NAME` of the
/// metadata that was stored. When we deserialize that row back into this enum,
/// serde matches the `tag` value against the `snake_case` of the variant name.
/// If those two strings ever diverge, deserialization fails at runtime.
/// This macro prevents that by asserting the invariant at compile time.
///
/// Accepts a standard enum definition and emits it unchanged, then generates
/// `const` assertions that verify two properties for every `Variant(MetadataType)`:
///
/// 1. `MetadataType` implements [`Notification`](::notification::domain::models::Notification).
/// 2. `MetadataType::TYPE_NAME` equals the variant name converted to `snake_case`
///    (via [`paste`]), which is also the serde tag produced by `rename_all = "snake_case"`.
///
/// Because the enum and the assertions share the same variant list, adding a new
/// variant without a matching `Notification` impl — or with a mismatched
/// `TYPE_NAME` — is a compile error.
macro_rules! define_notif_event {
    (
        $(#[$enum_meta:meta])*
        $vis:vis enum $Name:ident {
            $(
                $(#[$variant_meta:meta])*
                $Variant:ident($(#[$field_meta:meta])* $Ty:ty),
            )+
        }
    ) => {
        $(#[$enum_meta])*
        $vis enum $Name {
            $(
                $(#[$variant_meta])*
                $Variant($(#[$field_meta])* $Ty),
            )+
        }

        // Compile-time assertions:
        // 1. Every inner type implements Notification.
        // 2. TYPE_NAME matches the snake_case of the variant name.
        paste::paste! {
            const _: () = {
                const fn str_eq(a: &[u8], b: &[u8]) -> bool {
                    if a.len() != b.len() { return false; }
                    let mut i = 0;
                    while i < a.len() {
                        if a[i] != b[i] { return false; }
                        i += 1;
                    }
                    true
                }

                $(
                    const _: () = assert!(
                        str_eq(
                            <$Ty as ::notification::domain::models::Notification>::TYPE_NAME.as_bytes(),
                            stringify!([< $Variant:snake >]).as_bytes(),
                        ),
                        concat!(
                            stringify!($Name), "::", stringify!($Variant),
                            " snake_case does not match Notification::TYPE_NAME for ", stringify!($Ty),
                        ),
                    );
                )+
            };
        }
    };
}

define_notif_event!(
    /// Mirrors [`model_notifications::NotificationEvent`] but uses `tag` / `content`
    /// as the serde adjacently-tagged field names so it can be deserialized from the
    /// shape produced by [`UserNotificationRow::into_tagged`] +
    /// [`UserNotificationRow::into_json`].
    ///
    /// Only includes variants whose metadata types implement the `Notification` trait.
    #[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
    #[serde(tag = "tag", content = "content", rename_all = "snake_case")]
    pub enum NotifEvent {
        /// Someone mentioned you in a channel.
        ChannelMention(ChannelMentionMetadata),

        /// Someone mentioned a document in a channel.
        DocumentMention(DocumentMentionMetadata),

        /// User was mentioned in a comment in a document
        MentionedInDocumentComment(MentionedInDocumentCommentMetadata),

        /// Someone replied to a document comment thread the user participated in.
        RepliedToDocumentCommentThread(RepliedToDocumentCommentThreadMetadata),

        /// Someone commented on a document the user owns.
        CommentedOnDocument(CommentedOnDocumentMetadata),

        /// The user was invited to a channel.
        ChannelInvite(ChannelInviteMetadata),

        /// A user sent a message in a channel.
        ChannelMessageSend(ChannelMessageSendMetadata),

        /// Someone replied to a thread in a channel that the user is part of.
        ChannelMessageReply(ChannelReplyMetadata),

        /// A new email has been sent to the user.
        NewEmail(NewEmailMetadata),

        /// A user was invited to a team.
        InviteToTeam(InviteToTeamMetadata),

        /// A user was assigned to a task.
        TaskAssigned(TaskAssignedMetadata),

        /// An AI assistant responded to a chat.
        AiResponse(AiResponseMetadata),
    }
);

impl NotificationTitle for NotifEvent {
    fn format_title(
        &self,
        sender_id: Option<MacroUserIdStr<'_>>,
    ) -> Result<String, rootcause::Report> {
        match self {
            NotifEvent::ChannelMention(channel_mention_metadata) => {
                channel_mention_metadata.format_title(sender_id)
            }
            NotifEvent::DocumentMention(document_mention_metadata) => {
                document_mention_metadata.format_title(sender_id)
            }
            NotifEvent::MentionedInDocumentComment(mentioned_in_document_comment_metadata) => {
                mentioned_in_document_comment_metadata.format_title(sender_id)
            }
            NotifEvent::RepliedToDocumentCommentThread(m) => m.format_title(sender_id),
            NotifEvent::CommentedOnDocument(m) => m.format_title(sender_id),
            NotifEvent::ChannelInvite(m) => m.format_title(sender_id),
            NotifEvent::ChannelMessageSend(channel_message_send_metadata) => {
                channel_message_send_metadata.format_title(sender_id)
            }
            NotifEvent::ChannelMessageReply(channel_reply_metadata) => {
                channel_reply_metadata.format_title(sender_id)
            }
            NotifEvent::NewEmail(new_email_metadata) => new_email_metadata.format_title(sender_id),
            NotifEvent::InviteToTeam(_) => Err(report!("not implemented")),
            NotifEvent::TaskAssigned(task_assigned_metadata) => {
                task_assigned_metadata.format_title(sender_id)
            }
            NotifEvent::AiResponse(ai_response_metadata) => {
                ai_response_metadata.format_title(sender_id)
            }
        }
    }

    fn format_body(
        &self,
        sender_id: Option<MacroUserIdStr<'_>>,
    ) -> Result<String, rootcause::Report> {
        match self {
            NotifEvent::ChannelMention(channel_mention_metadata) => {
                channel_mention_metadata.format_body(sender_id)
            }
            NotifEvent::DocumentMention(document_mention_metadata) => {
                document_mention_metadata.format_body(sender_id)
            }
            NotifEvent::MentionedInDocumentComment(mentioned_in_document_comment_metadata) => {
                mentioned_in_document_comment_metadata.format_body(sender_id)
            }
            NotifEvent::RepliedToDocumentCommentThread(m) => m.format_body(sender_id),
            NotifEvent::CommentedOnDocument(m) => m.format_body(sender_id),
            NotifEvent::ChannelInvite(m) => m.format_body(sender_id),
            NotifEvent::ChannelMessageSend(channel_message_send_metadata) => {
                channel_message_send_metadata.format_body(sender_id)
            }
            NotifEvent::ChannelMessageReply(channel_reply_metadata) => {
                channel_reply_metadata.format_body(sender_id)
            }
            NotifEvent::NewEmail(new_email_metadata) => new_email_metadata.format_body(sender_id),
            NotifEvent::InviteToTeam(_) => Err(report!("not implemented")),
            NotifEvent::TaskAssigned(task_assigned_metadata) => {
                task_assigned_metadata.format_body(sender_id)
            }
            NotifEvent::AiResponse(ai_response_metadata) => {
                ai_response_metadata.format_body(sender_id)
            }
        }
    }
}
