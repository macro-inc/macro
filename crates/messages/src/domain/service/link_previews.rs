//! Previews of the pages a channel message links to. They are computed after
//! a post or edit and stored with the message, so a client renders each card
//! with the message instead of growing the message once a page loads.
use super::*;
use std::sync::Arc;

/// Which links get a card, and what a page's card shows.
#[derive(Clone)]
pub(super) struct LinkPreviewSources {
    links: Arc<dyn MessageLinkExtractor>,
    pages: Arc<dyn LinkPreviewFetcher>,
}

impl<R: MessageRepository, E: MessageEventPublisher> MessageService<R, E> {
    /// Supply link extraction and page fetching. Without them, messages keep
    /// no link previews.
    pub fn with_link_previews(
        mut self,
        links: impl MessageLinkExtractor,
        pages: impl LinkPreviewFetcher,
    ) -> Self {
        self.link_previews = Some(LinkPreviewSources {
            links: Arc::new(links),
            pages: Arc::new(pages),
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
    /// the newer change.
    #[tracing::instrument(
        name = "message.link_previews.refresh",
        err,
        skip(self, parent),
        fields(links, fetched, previews, changed)
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

        let urls = sources.links.extract(&message.content).await?;
        let previews = previews_for(sources, &message, &urls).await;

        let span = tracing::Span::current();
        span.record("links", urls.len());
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
