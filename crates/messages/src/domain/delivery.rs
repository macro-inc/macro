use super::{models::*, notification::*, ports::*};
use std::collections::HashSet;

#[cfg(test)]
mod test;

/// Parent and thread facts used when delivering a discussion event.
#[derive(Debug, Clone)]
pub struct DiscussionContext {
    /// Document name or email subject.
    pub name: String,
    /// Authenticated parent owner.
    pub owner: String,
    /// Document extension, absent for email.
    pub file_type: Option<String>,
    /// Whether the document is a task.
    pub is_task: bool,
    /// Prior authors in this thread.
    pub participants: Vec<String>,
    /// Current task assignees.
    pub assignees: Vec<String>,
    /// Optional sender avatar used by push notification attachments.
    pub sender_profile_picture: Option<String>,
    /// Current PUBLIC or TEAM document link access, if enabled.
    pub link_share_access: Option<entity_access::domain::models::AccessLevel>,
}

/// Reads facts without deciding notification or access policy.
pub trait DiscussionContextReader: Send + Sync + 'static {
    /// Read the sender avatar, independently of notification policy.
    fn sender_profile_picture(
        &self,
        _actor: &str,
    ) -> impl Future<Output = Result<Option<String>, rootcause::Report>> + Send {
        async { Ok(None) }
    }
    /// Load parent metadata, authors, and task assignments.
    fn context(
        &self,
        parent: &MessageParent,
        root: uuid::Uuid,
    ) -> impl Future<Output = Result<DiscussionContext, rootcause::Report>> + Send;
}

/// Current parent access, rechecked before any content is delivered.
pub trait MessageAudienceAccess: Send + Sync + 'static {
    /// Return only candidates who can currently view this parent.
    fn viewers(
        &self,
        parent: &MessageParent,
        candidates: HashSet<String>,
    ) -> impl Future<Output = Result<HashSet<String>, rootcause::Report>> + Send;
}

/// Live subscriptions and targeted event transport.
pub trait MessageRealtime: Send + Sync + 'static {
    /// Users watching the parent; these are candidates, not authorization evidence.
    fn subscribers(
        &self,
        parent: &MessageParent,
    ) -> impl Future<Output = Result<HashSet<String>, rootcause::Report>> + Send;
    /// Send a change only to the verified users.
    fn send(
        &self,
        event: &MessageEvent,
        users: HashSet<String>,
    ) -> impl Future<Output = Result<(), rootcause::Report>> + Send;
}

/// A notification whose semantic reason and audience have been selected.
pub struct DiscussionNotification<'a> {
    /// Committed message event.
    pub event: &'a MessageEvent,
    /// Message being announced.
    pub message: &'a Message,
    /// Parent display metadata.
    pub context: &'a DiscussionContext,
    /// Recipient with current view access.
    pub recipient: String,
    /// Contextual wording and routing.
    pub reason: CommentNotificationReason,
}

/// Notification transport; it cannot grant access to mentioned users.
pub trait DiscussionNotifier: Send + Sync + 'static {
    /// Deliver an already-selected notification.
    fn send(
        &self,
        notification: DiscussionNotification<'_>,
    ) -> impl Future<Output = Result<(), rootcause::Report>> + Send;
}

/// Persists document visibility selected by the discussion mention policy.
pub trait DiscussionMentionSharing: Send + Sync + 'static {
    /// Record explicit access without lowering existing grants. The adapter must
    /// recheck the observed link level before writing if it may have changed.
    fn grant(
        &self,
        document: uuid::Uuid,
        users: Vec<String>,
        level: entity_access::domain::models::AccessLevel,
    ) -> impl Future<Output = Result<(), rootcause::Report>> + Send;
}

/// Delivery compositions without document sharing.
#[derive(Clone)]
pub struct NoDiscussionSharing;
impl DiscussionMentionSharing for NoDiscussionSharing {
    async fn grant(
        &self,
        _: uuid::Uuid,
        _: Vec<String>,
        _: entity_access::domain::models::AccessLevel,
    ) -> Result<(), rootcause::Report> {
        Ok(())
    }
}

/// Discussion delivery policy shared by documents and internal email discussions.
#[derive(Clone)]
pub struct DiscussionDelivery<C, A, R, N, S = NoDiscussionSharing> {
    context: C,
    access: A,
    realtime: R,
    notifications: N,
    sharing: S,
}

impl<C, A, R, N> DiscussionDelivery<C, A, R, N> {
    /// Compose delivery using fact, authorization, and transport ports.
    pub fn new(context: C, access: A, realtime: R, notifications: N) -> Self {
        Self {
            context,
            access,
            realtime,
            notifications,
            sharing: NoDiscussionSharing,
        }
    }

    /// Preserve explicit visibility for mentions on link-shared documents.
    pub fn with_sharing<S: DiscussionMentionSharing>(
        self,
        sharing: S,
    ) -> DiscussionDelivery<C, A, R, N, S> {
        DiscussionDelivery {
            context: self.context,
            access: self.access,
            realtime: self.realtime,
            notifications: self.notifications,
            sharing,
        }
    }
}

impl<
    C: DiscussionContextReader,
    A: MessageAudienceAccess,
    R: MessageRealtime,
    N: DiscussionNotifier,
    S: DiscussionMentionSharing,
> MessageEventPublisher for DiscussionDelivery<C, A, R, N, S>
{
    async fn publish(&self, event: MessageEvent) -> Result<(), rootcause::Report> {
        if !event.parent.is_discussion() {
            return Err(rootcause::report!(
                "discussion delivery requires a document or email parent"
            ));
        }
        // Run notification delivery even if the transient transport is unavailable.
        let realtime = async {
            let candidates = self.realtime.subscribers(&event.parent).await?;
            let viewers = self.access.viewers(&event.parent, candidates).await?;
            self.realtime.send(&event, viewers).await
        }
        .await;
        if let MessageChange::Posted { message, mentions } = &event.change {
            let mut context = self.context.context(&event.parent, event.root_id).await?;
            context.sender_profile_picture = self
                .context
                .sender_profile_picture(&event.actor)
                .await
                .unwrap_or(None);
            let mut audience = CommentAudience {
                mentioned: mentions
                    .iter()
                    .filter(|m| m.entity_type == "user")
                    .map(|m| m.entity_id.clone())
                    .collect(),
                participants: context.participants.clone(),
                assignees: context.assignees.clone(),
                owners: vec![context.owner.clone()],
                ..Default::default()
            };
            // Only document link sharing confers explicit visibility on mention.
            // Email discussion mentions never grant access to the parent mailbox.
            if let MessageParent::Document(_) = &event.parent
                && let Some(level) = context.link_share_access
                && let Ok(document) = uuid::Uuid::parse_str(&event.parent.entity_id())
                && !audience.mentioned.is_empty()
            {
                self.sharing
                    .grant(document, audience.mentioned.clone(), level)
                    .await?;
            }
            let candidates = audience
                .mentioned
                .iter()
                .chain(&audience.participants)
                .chain(&audience.assignees)
                .chain(&audience.owners)
                .cloned()
                .collect();
            audience.authorized = self.access.viewers(&event.parent, candidates).await?;
            let recipients = comment_recipients(
                &event.parent,
                &event.actor,
                message.thread_id.is_some(),
                &audience,
            );
            let mut delivery_error = None;
            for (recipient, reason) in recipients {
                if let Err(error) = self
                    .notifications
                    .send(DiscussionNotification {
                        event: &event,
                        message,
                        context: &context,
                        recipient,
                        reason,
                    })
                    .await
                {
                    delivery_error = Some(error);
                }
            }
            if let Some(error) = delivery_error {
                return Err(error);
            }
        }
        realtime
    }
}

/// Routes a committed event using its persisted parent, never client metadata.
#[derive(Clone)]
pub struct ParentMessagePublisher<C, D> {
    channels: C,
    discussions: D,
}

impl<C, D> ParentMessagePublisher<C, D> {
    /// Compose channel behavior with entity discussion behavior.
    pub fn new(channels: C, discussions: D) -> Self {
        Self {
            channels,
            discussions,
        }
    }
}

impl<C: MessageEventPublisher, D: MessageEventPublisher> MessageEventPublisher
    for ParentMessagePublisher<C, D>
{
    async fn publish(&self, event: MessageEvent) -> Result<(), rootcause::Report> {
        match event.parent {
            MessageParent::Channel(_) => self.channels.publish(event).await,
            _ => self.discussions.publish(event).await,
        }
    }
}
