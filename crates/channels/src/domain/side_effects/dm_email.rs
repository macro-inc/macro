//! Immediate email delivery for human DMs to people without Macro accounts.

use super::*;

impl<C, R, N, K, B> ChannelSideEffectService<C, R, N, K, B>
where
    C: ChannelSideEffectContext + Clone,
    R: ChannelRealtimePublisher + Clone,
    N: ChannelNotificationSender + Clone,
    K: ChannelContactsDispatcher + Clone,
{
    #[tracing::instrument(skip_all, fields(channel_id = %channel_id, message_id = %message.id))]
    pub(super) async fn send_unregistered_dm_email(
        &self,
        channel_id: Uuid,
        message: &MutatedMessage,
        context: &mut PostedMessageNotificationContext,
    ) {
        if context.metadata.channel_type != ChannelType::DirectMessage {
            return;
        }
        let Some(sender) = context.sender.as_user().cloned() else {
            return;
        };
        let recipients = &context.recipients_without_sender;
        let existing = match self
            .context
            .get_existing_user_ids(recipients.iter().cloned().collect())
            .await
        {
            Ok(existing) => existing,
            Err(err) => {
                let err: anyhow::Error = err.into();
                tracing::error!(error=?err, "unable to resolve DM email recipients");
                return;
            }
        };
        let unregistered: HashSet<_> = recipients
            .iter()
            .filter(|id| !existing.contains(id.as_ref()))
            .cloned()
            .collect();
        if unregistered.is_empty() {
            return;
        }

        let effect = ChannelNotificationEffect::Invite {
            message_id: Some(message.id),
            channel_id,
            invited_by_user_id: sender,
            registered_recipient_ids: HashSet::new(),
            unregistered_recipient_ids: unregistered.clone(),
            sender_profile_picture_url: context.sender_profile_picture_url.clone(),
            message_content: Some(message.content.clone()),
            metadata: context.metadata.clone(),
        };
        if let Err(err) = self.notifications.send(effect).await {
            let err: anyhow::Error = err.into();
            tracing::error!(error=?err, "unable to queue DM email");
            return;
        }

        // The DM invitation template includes the message and queues a standalone
        // email. Keep these recipients out of the normal mention/reply/first-message
        // paths so one message cannot also send a second invitation or digest.
        context
            .recipients_without_sender
            .retain(|id| !unregistered.contains(id));
        context
            .recipients_without_sender_and_mentions
            .retain(|id| !unregistered.contains(id));
        context
            .user_mentions
            .retain(|id| !unregistered.iter().any(|user| user.as_ref() == id));
        context
            .thread_context
            .participants
            .retain(|id| !unregistered.contains(id));
    }
}
