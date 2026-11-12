//! Previews of the pages a channel message links to. They are computed after
//! a post or edit and stored with the message, so a client renders each card
//! with the message instead of growing the message once a page loads.
use super::*;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use std::sync::Arc;

/// Which links get a card, what a page's card shows, and who has cards.
#[derive(Clone)]
pub(super) struct LinkPreviewSources {
    links: Arc<dyn MessageLinkExtractor>,
    pages: Arc<dyn LinkPreviewFetcher>,
    gate: Arc<dyn LinkPreviewGate>,
}

impl<R: MessageRepository, E: MessageEventPublisher> MessageService<R, E> {
    /// Supply link extraction, page fetching, and who has link previews.
    /// Without them, messages keep no link previews.
    pub fn with_link_previews(
        mut self,
        links: impl MessageLinkExtractor,
        pages: impl LinkPreviewFetcher,
        gate: impl LinkPreviewGate,
    ) -> Self {
        self.link_previews = Some(LinkPreviewSources {
            links: Arc::new(links),
            pages: Arc::new(pages),
            gate: Arc::new(gate),
        });
        self
    }

    /// Recompute a channel message's link previews from its current content
    /// and tell its viewers when they changed.
    ///
    /// Trusted enrichment, run for a committed post or edit: it reads and
    /// writes the message without a caller capability and publishes only to
    /// the parent's own audience. Safe to repeat: an unchanged set writes and
    /// publishes nothing, and a message edited or deleted meanwhile is left to
    /// the newer change. A message whose sender removed its previews keeps
    /// none, and one whose author doesn't have link previews loses any it
    /// has.
    #[tracing::instrument(
        name = "message.link_previews.refresh",
        err,
        skip(self, parent),
        fields(enabled, links, fetched, previews, changed)
    )]
    pub async fn refresh_link_previews(
        &self,
        parent: &MessageParent,
        id: Uuid,
    ) -> Result<(), MessageError> {
        let Some(sources) = &self.link_previews else {
            return Ok(());
        };
        // Only channel messages show link cards.
        if !matches!(parent, MessageParent::Channel(_)) {
            return Ok(());
        }
        let Some(message) = self.repo.get(parent, id).await? else {
            return Ok(());
        };
        if message.deleted_at.is_some() {
            return Ok(());
        }
        if self.repo.link_previews_suppressed(parent, id).await? {
            return Ok(());
        }

        let span = tracing::Span::current();
        let urls = sources.links.extract(&message.content).await?;
        span.record("links", urls.len());
        // Most messages link nothing: they have no cards to add or take down,
        // so their author's flag isn't read.
        if urls.is_empty() && message.link_previews.is_empty() {
            return Ok(());
        }
        let enabled = match author(&message) {
            Some(author) => sources.gate.enabled_for(&author).await,
            None => false,
        };
        span.record("enabled", enabled);
        // An author without link previews gets none, and loses any stored
        // while they had them.
        let previews = if enabled {
            previews_for(sources, &message, &urls).await
        } else {
            Vec::new()
        };

        span.record("previews", previews.len());
        let changed = previews != message.link_previews;
        span.record("changed", changed);
        if !changed {
            return Ok(());
        }

        let Some(message) = self
            .repo
            .replace_link_previews(parent, id, &message.content, &previews)
            .await?
        else {
            return Ok(());
        };
        let actor = message.sender_id.clone();
        self.publish_message(
            actor,
            None,
            &message,
            MessageChange::LinkPreviewsUpdated {
                message: message.clone(),
            },
        )
        .await;
        Ok(())
    }

    /// Remove a message's link previews for everyone, for good: it gets none
    /// again, whatever links a later edit adds. Only its sender may, and only
    /// while they have link previews; otherwise there is nothing to remove.
    ///
    /// Safe to repeat: a message already without previews stays so, and its
    /// viewers are told again.
    #[tracing::instrument(
        name = "message.link_previews.remove",
        err,
        skip(self, access),
        fields(enabled)
    )]
    pub async fn remove_link_previews(
        &self,
        access: EntityAccessReceipt<MessageWrite>,
        id: Uuid,
    ) -> Result<Message, MessageError> {
        let parent = parent_from_receipt(&access)?;
        let actor = actor_from_receipt(&access, &parent)?;
        let enabled = match (&self.link_previews, access.acting_user_id()) {
            (Some(sources), Some(caller)) => sources.gate.enabled_for(caller).await,
            _ => false,
        };
        tracing::Span::current().record("enabled", enabled);
        if !enabled {
            return Err(MessageError::NotFound);
        }
        self.ensure_parent(&parent).await?;
        let current = self.active_message(&parent, id, false).await?;
        reject_call_root(&current)?;
        // Narrower than editing: a moderator may edit a message, but only its
        // sender decides how their links are shown.
        if current.sender_id != actor {
            return Err(MessageError::Forbidden);
        }

        let message = self.repo.suppress_link_previews(&parent, id).await?;
        self.publish_message(
            actor,
            None,
            &message,
            MessageChange::LinkPreviewsUpdated {
                message: message.clone(),
            },
        )
        .await;
        Ok(message)
    }
}

/// The person whose link previews a message follows: its sender, or for a
/// bot's message the person who triggered it. Webhook and other unprompted
/// posts, and call guests, have none.
fn author(message: &Message) -> Option<MacroUserIdStr<'static>> {
    if let Some(user) = message.sender_id.as_user() {
        return Some(user.clone());
    }
    let triggered_by = message.triggered_by.as_deref()?;
    MacroUserIdStr::parse_from_str(triggered_by)
        .ok()
        .map(CowLike::into_owned)
}

/// Previews for `urls` in order. A link the message already has a preview
/// for keeps it, so an edit elsewhere in the text or a streamed reply growing
/// fetches only its new links. Pages with no preview are left out.
async fn previews_for(
    sources: &LinkPreviewSources,
    message: &Message,
    urls: &[String],
) -> Vec<LinkPreview> {
    let previews = futures::future::join_all(urls.iter().map(|url| async move {
        let existing = message
            .link_previews
            .iter()
            .find(|preview| preview.url == *url);
        match existing {
            Some(preview) => Some(preview.clone()),
            None => sources.pages.fetch(url).await,
        }
    }))
    .await;

    let fetched = urls
        .iter()
        .filter(|url| !message.link_previews.iter().any(|p| p.url == **url))
        .count();
    tracing::Span::current().record("fetched", fetched);

    previews.into_iter().flatten().collect()
}
