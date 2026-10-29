//! Thread audience policy; parent membership never grants access to a private exchange.
use super::*;

pub(super) fn principal(auth: &EntityAccessAuth) -> Option<String> {
    match auth {
        EntityAccessAuth::Authenticated(user) => Some(user.to_string()),
        EntityAccessAuth::Bot(bot) => Some(bot.bot_id_str().to_string()),
        EntityAccessAuth::Unauthenticated | EntityAccessAuth::Internal => None,
    }
}

pub(super) fn can_view(auth: &EntityAccessAuth, visibility: &MessageVisibility) -> bool {
    if visibility.is_public() {
        return true;
    }
    if let EntityAccessAuth::Bot(bot) = auth
        && let Some(acting) = bot.scope().acting_user_id()
        && let MessageVisibility::Private { user_id, .. } = visibility
        && acting.as_ref() != user_id
    {
        return false;
    }
    principal(auth).is_some_and(|id| visibility.permits(&id))
}

impl<R: MessageRepository, E: MessageEventPublisher> MessageService<R, E> {
    /// Supply bot-owned ephemeral settings for automatic privacy on mentions.
    pub fn with_ephemeral_agents(mut self, reader: impl EphemeralAgentReader) -> Self {
        self.ephemeral_agents = Some(std::sync::Arc::new(reader));
        self
    }

    #[tracing::instrument(skip_all, err)]
    pub(super) async fn post_visibility(
        &self,
        access: &EntityAccessReceipt<MessageWrite>,
        input: &mut PostMessage,
    ) -> Result<MessageVisibility, MessageError> {
        let mut bots = super::super::mentions::bot_mention_ids(&input.mentions);
        let ephemeral = match &self.ephemeral_agents {
            Some(reader) => !reader.ephemeral_agents(&bots).await?.is_empty(),
            None if bots.iter().any(|bot| bot_id::system_bot(*bot).is_none()) => {
                return Err(MessageError::Invalid("agent privacy is unavailable"));
            }
            None => false,
        };
        // A call's canonical thread is created atomically by its first post.
        // It is always shared, so privacy must not require that root to exist.
        if matches!(parent_from_receipt(access)?, MessageParent::Call(_)) {
            if input.ephemeral || ephemeral {
                return Err(MessageError::Invalid(
                    "call chat does not support private threads",
                ));
            }
            return Ok(MessageVisibility::Public);
        }
        if let Some(root) = input.thread_id {
            let state = self
                .active_thread(access.auth(), &parent_from_receipt(access)?, root)
                .await?;
            if !state.visibility.is_public() || (!input.ephemeral && !ephemeral) {
                return Ok(state.visibility);
            }
            // A private reply to a shared thread starts a separate private
            // thread rather than silently changing the old thread's audience.
            input.thread_id = None;
        }
        if !input.ephemeral && !ephemeral {
            return Ok(MessageVisibility::Public);
        }
        // Document anchors are serialized into shared content and cannot
        // carry a hidden thread.
        if input.anchor.is_some() {
            return Err(MessageError::Invalid(
                "private messages require an unanchored thread",
            ));
        }
        let user = access.acting_user_id().ok_or(MessageError::Forbidden)?;
        if let EntityAccessAuth::Bot(bot) = access.auth() {
            let sender = bot.bot_id();
            if !bots.contains(&sender) {
                bots.push(sender);
            }
        }
        Ok(MessageVisibility::Private {
            user_id: user.to_string(),
            bot_ids: bots
                .into_iter()
                .map(|id| id.into_storage_id().to_string())
                .collect(),
        })
    }
}
