//! [`FeedVisibility`] over the Notifications inbox's own candidate rules. The
//! composition root supplies the candidate source (Soup on the primary
//! database; see `crate::wiring`).

use attention_feed::domain::ports::CandidateSource;
use attention_feed::inbound::viewers::{FeedViewerResolver, resolve_viewer};
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::Entity;

use crate::ping::FeedVisibility;

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
    Viewers: FeedViewerResolver,
{
    async fn admits(
        &self,
        viewer: &MacroUserIdStr<'static>,
        link: &Entity<'static>,
    ) -> Result<bool, rootcause::Report> {
        let viewer = resolve_viewer(&self.viewers, viewer.clone()).await?;
        notification_inbox::domain::service::admits_new_notification(
            &self.source,
            &viewer,
            link.clone(),
        )
        .await
    }
}
