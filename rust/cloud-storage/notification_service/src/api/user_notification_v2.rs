use ::notification::domain::models::UserNotificationRow;
use model_notifications::{
    ChannelInviteMetadata, ChannelMentionMetadata, ChannelMessageSendMetadata,
    ChannelReplyMetadata, DocumentMentionMetadata, InviteToTeamMetadata, NewEmailMetadata,
    TaskAssignedMetadata,
};
use serde::{Deserialize, Serialize};

#[cfg(test)]
mod tests;

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
                $Variant:ident($Ty:ty),
            )+
        }
    ) => {
        $(#[$enum_meta])*
        $vis enum $Name {
            $(
                $(#[$variant_meta])*
                $Variant($Ty),
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
    #[derive(Debug, Clone, Serialize, Deserialize)]
    #[serde(tag = "tag", content = "content", rename_all = "snake_case")]
    pub enum NotifEvent {
        /// Someone mentioned you in a channel.
        ChannelMention(ChannelMentionMetadata),
        /// Someone mentioned you in a document.
        DocumentMention(DocumentMentionMetadata),
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
    }
);

/// The strongly typed response for listing user notifications.
#[derive(Debug, Serialize)]
pub struct GetAllUserNotificationsResponse {
    /// The list of items returned.
    pub items: Vec<UserNotificationRow<NotifEvent>>,
    /// The next page cursor if it exists.
    pub next_cursor: Option<String>,
}

/// Convert a [`UserNotificationRow<serde_json::Value>`] into a
/// [`UserNotificationRow<NotifEvent>`] by tagging and deserializing the metadata.
pub fn to_typed_row(
    row: UserNotificationRow<serde_json::Value>,
) -> Result<UserNotificationRow<NotifEvent>, serde_json::Error> {
    row.into_tagged()
        .into_json()?
        .deserialize_json::<NotifEvent>()
}

/// Build the strongly typed v2 router.
///
/// Instantiates the notification crate's generic router, then overwrites the
/// GET `/` route with a wrapper that deserializes each row into [`NotifEvent`].
pub fn router<
    S: ::notification::domain::service::NotificationIngress,
    O: Clone + Send + Sync + 'static,
>(
    state: ::notification::inbound::http::NotificationRouterState<S>,
) -> axum::Router<O> {
    ::notification::inbound::http::router::<S, serde_json::Value>()
        .route("/", axum::routing::get(list_typed_notifications::<S>))
        .with_state(state)
}

/// Wrapper handler that calls the inner generic list handler with `serde_json::Value`,
/// then converts each row to [`UserNotificationRow<NotifEvent>`].
///
/// Rows that fail to deserialize are dropped with a warning log.
async fn list_typed_notifications<S: ::notification::domain::service::NotificationIngress>(
    state: axum::extract::State<::notification::inbound::http::NotificationRouterState<S>>,
    macro_user: model_user::axum_extractor::MacroUserExtractor,
    query: axum::extract::Query<::notification::inbound::http::Params>,
    cursor: models_pagination::CursorExtractor<uuid::Uuid, models_pagination::CreatedAt, ()>,
) -> Result<
    axum::Json<GetAllUserNotificationsResponse>,
    (
        axum::http::StatusCode,
        axum::Json<model_error_response::ErrorResponse<'static>>,
    ),
> {
    let axum::Json(response) = ::notification::inbound::http::list_user_notifications::<
        S,
        serde_json::Value,
    >(state, macro_user, query, cursor)
    .await?;

    let items = response
        .items
        .into_iter()
        .filter_map(|row| {
            to_typed_row(row)
                .inspect_err(|e| tracing::warn!(error=?e, "failed to deserialize notification row"))
                .ok()
        })
        .collect();

    Ok(axum::Json(GetAllUserNotificationsResponse {
        items,
        next_cursor: response.next_cursor,
    }))
}
