//! Event stream ports backed by DSS-owned services: bot ownership and GitHub
//! installation claims.

use bots::domain::models::{BotId, BotOwner};
use bots::domain::ports::BotRepo;
use event_stream::domain::ports::GithubClaims;
use event_stream::inbound::stream_router::BotOwners;
use github::domain::ports::GithubInstallationClaims;
use macro_user_id::user_id::MacroUserIdStr;
use std::sync::Arc;
use uuid::Uuid;

/// Bot ownership from the bots repository.
pub struct RepoBotOwners<R> {
    repo: Arc<R>,
}

impl<R> RepoBotOwners<R> {
    /// Read ownership through `repo`.
    pub fn new(repo: Arc<R>) -> Self {
        Self { repo }
    }
}

impl<R> Clone for RepoBotOwners<R> {
    fn clone(&self) -> Self {
        Self {
            repo: self.repo.clone(),
        }
    }
}

impl<R: BotRepo> BotOwners for RepoBotOwners<R>
where
    R::Err: Into<anyhow::Error>,
{
    async fn is_owned_by(&self, bot_id: Uuid, user_id: &str) -> Result<bool, rootcause::Report> {
        let bot = self
            .repo
            .get_bot(BotId::new_from_uuid(bot_id))
            .await
            .map_err(|error| rootcause::report!("failed to read a bot: {:?}", error.into()))?;
        Ok(matches!(
            bot.and_then(|bot| bot.owner),
            Some(BotOwner::User { user_id: owner }) if owner == user_id
        ))
    }
}

/// GitHub installation claims, by the rule routines use.
pub struct InstallationClaims<C> {
    claims: C,
}

impl<C> InstallationClaims<C> {
    /// Read claims through `claims`.
    pub fn new(claims: C) -> Self {
        Self { claims }
    }
}

impl<C: GithubInstallationClaims + Send + Sync + 'static> GithubClaims for InstallationClaims<C> {
    async fn has_claim(
        &self,
        user: &MacroUserIdStr<'static>,
        installation_id: &str,
    ) -> Result<bool, rootcause::Report> {
        // Installation ids are numeric; anything else names no installation.
        let Ok(installation_id) = installation_id.parse::<u64>() else {
            return Ok(false);
        };
        self.claims
            .has_claim(user, installation_id)
            .await
            .map_err(|error| {
                rootcause::report!("failed to read a GitHub installation claim: {error:?}")
            })
    }
}
