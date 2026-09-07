//! Channel policy for resolving authored group mentions into human recipients.
use super::ports::ChannelRepo;
use macro_user_id::user_id::MacroUserIdStr;
use messages::domain::ports::{MessageError, MessageGroupRecipients};
use uuid::Uuid;

/// Current active human members, independent of the composing client's cached roster.
#[derive(Clone)]
pub struct ChannelGroupRecipients<R>(pub R);
#[async_trait::async_trait]
impl<R: ChannelRepo> MessageGroupRecipients for ChannelGroupRecipients<R> {
    async fn channel_members(
        &self,
        channel: Uuid,
    ) -> Result<Vec<MacroUserIdStr<'static>>, MessageError> {
        let participants = self.0.get_participants(channel).await.map_err(|error| {
            let error: anyhow::Error = error.into();
            MessageError::Repository(rootcause::report!(error).into())
        })?;
        Ok(participants
            .into_iter()
            .filter(|participant| participant.left_at.is_none())
            .filter_map(|participant| MacroUserIdStr::try_from(participant.user_id).ok())
            .collect())
    }
}

#[cfg(test)]
mod test;
