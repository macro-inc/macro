//! [`FeedVisibility`] over the Notifications inbox's own candidate rules. The
//! composition root supplies the candidate source (Soup on the primary
//! database; see `crate::wiring`).

use attention_feed::domain::ports::CandidateSource;
use attention_feed::inbound::viewers::{FeedViewerResolver, resolve_viewer};
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::Entity;
use models_soup::comms::ChannelType;
use models_soup::item::SoupItem;
use soup::domain::models::SoupProjectionHydration;

use crate::ping::{FeedVisibility, Listing};

#[cfg(test)]
mod test;

/// Asks the inbox whether it would list a new notification, through its own
/// candidate request, for the viewer and their team, so CRM records the team
/// keeps are listed as the inbox lists them.
pub(crate) struct FeedCandidateVisibility<Source, Viewers> {
    pub source: Source,
    pub viewers: Viewers,
}

impl<Source, Viewers> FeedVisibility for FeedCandidateVisibility<Source, Viewers>
where
    Source: CandidateSource,
    Source::Entity: SharedName,
    Viewers: FeedViewerResolver,
{
    async fn listing(
        &self,
        viewer: &MacroUserIdStr<'static>,
        link: &Entity<'static>,
    ) -> Result<Option<Listing>, rootcause::Report> {
        let viewer = resolve_viewer(&self.viewers, viewer.clone()).await?;
        let listed = notification_inbox::domain::service::new_notification_listing(
            &self.source,
            &viewer,
            link.clone(),
        )
        .await?;
        Ok(listed.map(|entity| Listing {
            name: entity.shared_name(),
        }))
    }
}

/// The name a listed entity has for every viewer alike.
pub(crate) trait SharedName {
    fn shared_name(&self) -> Option<String>;
}

impl SharedName for SoupProjectionHydration {
    fn shared_name(&self) -> Option<String> {
        match &self.item {
            SoupItem::Channel(channel) => {
                let channel = &channel.channel.channel;
                channel_name(channel.channel_type, channel.name.as_deref())
            }
            SoupItem::EmailThread(thread) => shared(thread.thread.name.as_deref()),
            item => shared(item.name()),
        }
    }
}

/// How a channel's messages name it: `#name` for a public or team channel,
/// the bare name for a private one, and nothing for a direct message, which
/// each side names after the other.
fn channel_name(channel_type: ChannelType, name: Option<&str>) -> Option<String> {
    let name = shared(name)?;
    match channel_type {
        ChannelType::Public | ChannelType::Team => Some(format!("#{name}")),
        ChannelType::Private => Some(name),
        ChannelType::DirectMessage => None,
    }
}

/// `name` trimmed, or nothing when it is blank.
fn shared(name: Option<&str>) -> Option<String> {
    let name = name?.trim();
    (!name.is_empty()).then(|| name.to_owned())
}
