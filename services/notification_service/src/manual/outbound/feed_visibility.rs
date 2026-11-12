//! [`FeedVisibility`] over the inbox's and Home's own candidate rules. The
//! composition root supplies the candidate source (Soup on the primary
//! database; see `crate::wiring`).

use attention_feed::domain::models::FeedViewer;
use attention_feed::domain::ports::CandidateSource;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::Entity;

use crate::manual::{Feed, FeedVerdict, FeedVisibility};

#[cfg(test)]
mod test;

/// Asks the inbox, then Home, whether they would list a new notification,
/// each through its own candidate request.
pub(crate) struct FeedCandidateVisibility<Source>(pub Source);

impl<Source> FeedVisibility for FeedCandidateVisibility<Source>
where
    Source: CandidateSource,
{
    async fn admits(
        &self,
        viewer: &MacroUserIdStr<'static>,
        link: &Entity<'static>,
    ) -> Result<FeedVerdict, rootcause::Report> {
        // No team receipt: it only admits CRM records and team foreign
        // entities, which manual notifications cannot link to.
        let viewer = FeedViewer {
            user: viewer.clone(),
            team: None,
        };
        if !notification_inbox::domain::service::admits_new_notification(
            &self.0,
            &viewer,
            link.clone(),
        )
        .await?
        {
            return Ok(FeedVerdict::NotListed(Feed::Inbox));
        }
        if !work_feed::domain::service::admits_new_notification(&self.0, &viewer, link.clone())
            .await?
        {
            return Ok(FeedVerdict::NotListed(Feed::Home));
        }
        Ok(FeedVerdict::Listed)
    }
}
