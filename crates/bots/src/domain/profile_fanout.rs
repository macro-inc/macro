//! Pushes a changed bot's current profile to the people who see it.

use rootcause::{Report, prelude::IntoRootcause};

use super::{
    models::BotId,
    ports::{BotProfilePublisher, BotRepo},
};

/// Sends a bot's profile, as it is now, to its audience.
pub struct BotProfileFanout<R, P> {
    repo: R,
    publisher: P,
}

impl<R: BotRepo, P: BotProfilePublisher> BotProfileFanout<R, P> {
    /// Build the fan-out over a bot repository and a publisher.
    pub fn new(repo: R, publisher: P) -> Self {
        Self { repo, publisher }
    }

    /// Publish `bot_id`'s current profile. It is read rather than taken from
    /// the event: an update event names only the fields it changed, and a
    /// later change may have landed since. A deleted bot's profile carries its
    /// deletion time.
    #[tracing::instrument(name = "bots.publish_profile", skip(self), fields(%bot_id, recipients), err)]
    pub async fn publish(&self, bot_id: BotId) -> Result<(), Report> {
        let mut profiles = self
            .repo
            .get_owner_profiles(&[bot_id])
            .await
            .map_err(|error| error.into().into_rootcause())?;
        let Some(profile) = profiles.remove(&bot_id) else {
            tracing::warn!("changed bot has no profile");
            return Ok(());
        };

        let recipients = self
            .repo
            .bot_audience(bot_id)
            .await
            .map_err(|error| error.into().into_rootcause())?;
        tracing::Span::current().record("recipients", recipients.len());
        if recipients.is_empty() {
            return Ok(());
        }

        self.publisher.publish_profile(profile, recipients).await
    }
}
