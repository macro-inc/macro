//! Who receives `macro.passwords` events outside Macro, and in what shape:
//! the access of [`PasswordTopicEvent`] and its public projection.

#[cfg(test)]
mod test;

use crate::{AccessRequestResolution, AccessRequestResolvedMetadata, PasswordTopicEvent};
use macro_event_broker::access::EventAccess;
use serde::Serialize;
use uuid::Uuid;

impl EventAccess for PasswordTopicEvent {
    type PublicPayload = PasswordPublicEvent;

    fn access(
        &self,
    ) -> Result<
        macro_event_broker::access::Access<'_, Self::PublicPayload>,
        macro_event_broker::access::AccessError,
    > {
        use macro_event_broker::access::{
            Access, Audience, EntityRef, PublicEntityType, PublicEvent, Stage,
        };
        use std::borrow::Cow;

        match self {
            // A vault fact is addressed to one account: only its personal
            // webhooks and streams receive it, never teammates or entity
            // accessors. The recipient routes it and stays out of the body.
            Self::AccessRequestResolved(metadata) => Ok(Access::Public(PublicEvent {
                name: "passwords.access_request.resolved",
                entity: EntityRef::new(
                    PublicEntityType::PasswordItem,
                    metadata.item_id.to_string(),
                ),
                audience: Audience::Recipient {
                    user_id: metadata.recipient_user_id.clone(),
                },
                stage: Stage::Stable,
                payload: Cow::Owned(PasswordPublicEvent::AccessRequestResolved(metadata.into())),
            })),
        }
    }
}

/// The public projection of [`PasswordTopicEvent`], delivered under the same
/// event names: the metadata without its routing recipient.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(tag = "event_type", content = "metadata")]
pub enum PasswordPublicEvent {
    /// An authorized human resolved, or revoked, an agent's access request.
    #[serde(rename = "passwords.access_request.resolved")]
    AccessRequestResolved(PublicAccessRequestResolved),
}

/// Public body of `passwords.access_request.resolved`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct PublicAccessRequestResolved {
    /// Team owning the item.
    pub team_id: Uuid,
    /// Requested item.
    pub item_id: Uuid,
    /// Resolved request.
    pub request_id: Uuid,
    /// Resolution.
    pub status: AccessRequestResolution,
}

impl From<&AccessRequestResolvedMetadata> for PublicAccessRequestResolved {
    fn from(metadata: &AccessRequestResolvedMetadata) -> Self {
        Self {
            team_id: metadata.team_id,
            item_id: metadata.item_id,
            request_id: metadata.request_id,
            status: metadata.status,
        }
    }
}
