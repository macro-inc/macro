//! [`ChannelMessages`] over the message service.

#[cfg(test)]
mod test;

use entity_access::domain::models::AccessError;
use entity_access::domain::ports::EntityAccessService;
use macro_user_id::user_id::MacroUserIdStr;
use messages::domain::api::MessageReader;
use messages::domain::models::{Message, MessageParent};
use messages::domain::ports::MessageError;
use messages::domain::service::MessageView;
use model_entity::EntityType;
use uuid::Uuid;

use crate::ping::{ChannelMessages, LocatedMessage};

/// Reads a channel message the way the channel's own endpoints do: under the
/// reader's view of its channel.
pub(crate) struct ChannelMessageLinks<Access, Messages> {
    pub access: Access,
    pub messages: Messages,
}

impl<Access, Messages> ChannelMessages for ChannelMessageLinks<Access, Messages>
where
    Access: EntityAccessService,
    Messages: MessageReader,
{
    async fn locate(
        &self,
        user: &MacroUserIdStr<'_>,
        message_id: &str,
    ) -> Result<Option<LocatedMessage>, rootcause::Report> {
        let Ok(message_id) = Uuid::parse_str(message_id) else {
            return Ok(None);
        };

        // Comments on documents, projects and CRM records are messages too;
        // only a channel's are linked this way.
        let channel_id = match self.messages.parent_of(message_id).await {
            Ok(Some(MessageParent::Channel(channel_id))) => channel_id,
            Ok(_) | Err(MessageError::NotFound) => return Ok(None),
            Err(error) => return Err(rootcause::Report::new(error).into_dynamic()),
        };

        let view = match self
            .access
            .generate_entity_access_receipt::<MessageView>(
                &user.0,
                None,
                &channel_id.to_string(),
                EntityType::Channel,
            )
            .await
        {
            Ok(view) => view,
            Err(
                AccessError::BadRequest(_)
                | AccessError::NotFound(_)
                | AccessError::Unauthorized
                | AccessError::UnauthorizedWithMessage(_),
            ) => return Ok(None),
            Err(error) => return Err(rootcause::Report::new(error).into_dynamic()),
        };

        located(channel_id, self.messages.get(view, message_id).await)
    }
}

/// A deleted message, or one its reader may not see, is one that is not there;
/// only a failed read is an error.
fn located(
    channel_id: Uuid,
    message: Result<Message, MessageError>,
) -> Result<Option<LocatedMessage>, rootcause::Report> {
    match message {
        Ok(message) if message.deleted_at.is_some() => Ok(None),
        Ok(message) => Ok(Some(LocatedMessage {
            channel_id,
            message_id: message.id,
            thread_id: message.thread_id,
        })),
        Err(MessageError::NotFound | MessageError::Forbidden) => Ok(None),
        Err(error) => Err(rootcause::Report::new(error).into_dynamic()),
    }
}
