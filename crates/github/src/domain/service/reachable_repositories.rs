//! Listing the repositories a Macro user can reach through our GitHub App.
//!
//! The forward direction of the check
//! [`InstallationTokenService`](super::InstallationTokenService) makes
//! backwards. That service starts from a repository, finds its installation
//! and asks whether the user has a claim to it; this one starts from the user,
//! finds the installations they have a claim to, and asks GitHub what each one
//! covers.
//!
//! The claim is the same in both directions - an installation the user made
//! themselves, or one made by a team they belong to - and it is still the thing
//! that keeps a caller from seeing repositories belonging to someone else who
//! happens to have installed our App.
//!
//! A team claim is not a claim to a teammate's personal repositories. A team
//! installation on someone's user account would otherwise list those
//! repositories to every teammate; only organisation repositories from team
//! installations are offered. Repositories under an installation the user
//! made themselves stay on the list, whether they live under a person or an
//! organisation.
//!
//! Reaching nothing is an empty list, not an error: a user who has installed
//! nothing is in a perfectly ordinary state.

use std::num::NonZeroUsize;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use cowlike::CowLike;
use lru::LruCache;
use macro_user_id::user_id::MacroUserIdStr;

use crate::domain::models::{GithubError, GithubRepository, app_jwt};
use crate::domain::ports::{GithubRepositoryClient, GithubSyncRepo};

use super::InstallationTokenConfig;

#[cfg(test)]
mod test;

/// How long a user's listing stands before it is fetched again.
///
/// Installing or uninstalling the App is rare and deliberate, and a user who
/// has just done either will not be looking at a chooser within the window; a
/// listing costs one GitHub call per installation, so short-lived staleness is
/// the cheaper mistake.
const CACHE_TTL: Duration = Duration::from_secs(10 * 60);

/// How many users' listings are kept at once. The bound exists so entries for
/// users who never come back are evicted rather than held forever; freshness
/// comes from [`CACHE_TTL`], never from cache residency.
const CACHE_CAPACITY: usize = 1024;

/// Answers "which repositories can this user reach through our App?".
pub struct ReachableRepositoriesService<Installations, Client> {
    config: InstallationTokenConfig,
    installations: Installations,
    client: Client,
    cached: Mutex<LruCache<MacroUserIdStr<'static>, CachedListing>>,
}

struct CachedListing {
    repositories: Vec<GithubRepository>,
    fetched_at: Instant,
}

impl<Installations, Client> ReachableRepositoriesService<Installations, Client>
where
    Installations: GithubSyncRepo,
    Client: GithubRepositoryClient,
{
    /// Build the service over the App's credentials, the installation records
    /// that say who owns which installation, and a GitHub client.
    pub fn new(
        config: InstallationTokenConfig,
        installations: Installations,
        client: Client,
    ) -> Self {
        Self {
            config,
            installations,
            client,
            cached: Mutex::new(LruCache::new(
                NonZeroUsize::new(CACHE_CAPACITY).expect("a nonzero capacity"),
            )),
        }
    }

    /// Every repository under an installation `macro_user_id` made themselves,
    /// plus organisation repositories under an installation a team they belong
    /// to made - deduplicated by `owner/name` and sorted.
    ///
    /// A user who reaches nothing gets an empty list.
    #[tracing::instrument(skip(self), err, fields(%macro_user_id))]
    pub async fn for_user(
        &self,
        macro_user_id: &MacroUserIdStr<'_>,
    ) -> Result<Vec<GithubRepository>, GithubError> {
        if let Some(cached) = self.cached_listing(macro_user_id) {
            return Ok(cached);
        }

        let teams = self
            .installations
            .get_user_team_ids(macro_user_id.as_ref())
            .await
            .map_err(|error| {
                GithubError::Internal(anyhow::anyhow!("could not read user teams: {error:?}"))
            })?;

        let personal_ids = self
            .installations
            .get_installation_ids_for_sources(macro_user_id.as_ref(), &[])
            .await
            .map_err(|error| {
                GithubError::Internal(anyhow::anyhow!(
                    "could not read user installations: {error:?}"
                ))
            })?;
        let claimed_ids = self
            .installations
            .get_installation_ids_for_sources(macro_user_id.as_ref(), &teams)
            .await
            .map_err(|error| {
                GithubError::Internal(anyhow::anyhow!(
                    "could not read user installations: {error:?}"
                ))
            })?;
        let team_ids: Vec<String> = claimed_ids
            .into_iter()
            .filter(|installation_id| !personal_ids.contains(installation_id))
            .collect();

        let (personal, personal_complete) = self.list_all(&personal_ids).await?;
        let (team, team_complete) = self.list_all(&team_ids).await?;
        let mut repositories = personal;
        repositories.extend(
            team.into_iter()
                .filter(|repository| repository.owner_kind.is_organization()),
        );
        repositories
            .sort_by(|left, right| (&left.owner, &left.name).cmp(&(&right.owner, &right.name)));
        repositories.dedup_by(|left, right| left.owner == right.owner && left.name == right.name);
        let complete = personal_complete && team_complete;

        // Retry unavailable installations on the next request, not in ten minutes.
        if complete {
            self.cached.lock().expect("listing cache poisoned").put(
                macro_user_id.clone().into_owned(),
                CachedListing {
                    repositories: repositories.clone(),
                    fetched_at: Instant::now(),
                },
            );
        }

        Ok(repositories)
    }

    /// The user's listing, if one was fetched recently enough to still stand.
    fn cached_listing(&self, macro_user_id: &MacroUserIdStr<'_>) -> Option<Vec<GithubRepository>> {
        let key = macro_user_id.clone().into_owned();
        let mut cached = self.cached.lock().expect("listing cache poisoned");

        match cached.get(&key) {
            Some(listing) if listing.fetched_at.elapsed() < CACHE_TTL => {
                Some(listing.repositories.clone())
            }
            // An expired entry is dropped now rather than on capacity pressure.
            Some(_) => {
                cached.pop(&key);
                None
            }
            None => None,
        }
    }

    /// The union of every installation's repositories.
    async fn list_all(
        &self,
        installation_ids: &[String],
    ) -> Result<(Vec<GithubRepository>, bool), GithubError> {
        if installation_ids.is_empty() {
            return Ok((Vec::new(), true));
        }

        let jwt = app_jwt(&self.config.client_id, &self.config.private_key_pem)?;
        let mut repositories = Vec::new();

        let mut failure = None;
        let mut succeeded = 0;
        for installation_id in installation_ids {
            let result = async {
                let installation = installation_id.parse::<u64>().map_err(|error| {
                    GithubError::Internal(anyhow::anyhow!(
                        "installation id {installation_id} is not a number: {error}"
                    ))
                })?;
                self.client
                    .repositories_for_installation(&jwt, installation)
                    .await
            }
            .await;
            match result {
                Ok(listed) => {
                    repositories.extend(listed);
                    succeeded += 1;
                }
                Err(error) => {
                    tracing::warn!(%installation_id, error = ?error, "could not list GitHub installation repositories");
                    failure = Some(error);
                }
            }
        }
        let complete = failure.is_none();
        if succeeded == 0
            && let Some(error) = failure
        {
            return Err(error);
        }

        // Two installations can cover the same repository - a user's own and
        // their team's, say - and the caller wants one entry per repository.
        repositories
            .sort_by(|left, right| (&left.owner, &left.name).cmp(&(&right.owner, &right.name)));
        repositories.dedup_by(|left, right| left.owner == right.owner && left.name == right.name);

        Ok((repositories, complete))
    }
}
