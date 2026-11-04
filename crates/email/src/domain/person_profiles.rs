//! Public professional profiles (LinkedIn link, headline, title, company,
//! photo) of the people in an email thread, cached per address.
//!
//! The source is a people-data provider (Apollo.io bulk people enrichment),
//! not LinkedIn: LinkedIn's terms forbid scraping and its APIs cannot look a
//! member up by email address. Apollo charges a credit per matched person (a
//! miss is free) and caps calls per plan window, so each address is resolved
//! at most once per [`REFRESH_AFTER`], misses included, and one thread read
//! makes at most one provider call, for [`MAX_LOOKUPS_PER_READ`] addresses.

use chrono::{DateTime, TimeDelta, Utc};
use entity_access::domain::models::{EntityAccessReceipt, EntityType, ViewAccessLevel};
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use std::collections::{HashMap, HashSet};
use std::future::Future;
use uuid::Uuid;

#[cfg(test)]
mod test;

/// How long a stored profile, or a stored miss, is served before it is looked up again.
pub const REFRESH_AFTER: TimeDelta = TimeDelta::days(90);
/// Addresses one read sends to the provider: Apollo's bulk-match batch size.
/// Further unknown participants are looked up on later reads.
pub const MAX_LOOKUPS_PER_READ: usize = 10;
/// Upper bound on participants read for one thread.
pub const MAX_THREAD_PARTICIPANTS: i64 = 100;

/// One person's public profile, keyed by their lowercased email address.
/// Every detail is `None` for an address the provider could not match.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
pub struct PersonProfile {
    /// Lowercased email address.
    pub email_address: String,
    /// LinkedIn profile URL (`https://www.linkedin.com/in/…`).
    pub linkedin_url: Option<String>,
    /// LinkedIn headline.
    pub headline: Option<String>,
    /// Current job title.
    pub title: Option<String>,
    /// Current employer.
    pub organization_name: Option<String>,
    /// Profile photo URL.
    pub photo_url: Option<String>,
}

impl PersonProfile {
    /// A profile with no details, which caches a miss.
    pub fn unmatched(email_address: String) -> Self {
        Self {
            email_address,
            ..Self::default()
        }
    }

    fn has_details(&self) -> bool {
        self.linkedin_url.is_some()
            || self.headline.is_some()
            || self.title.is_some()
            || self.organization_name.is_some()
            || self.photo_url.is_some()
    }
}

/// Failures of the thread profile read.
#[derive(Debug, thiserror::Error)]
pub enum PersonProfileError {
    /// The receipt is not for an email thread or carries no user identity.
    #[error("authentication required")]
    Unauthorized,
    /// Persistence failed.
    #[error("internal error")]
    Internal(Report),
}

impl From<Report> for PersonProfileError {
    fn from(report: Report) -> Self {
        Self::Internal(report)
    }
}

/// Persisted facts for profile lookups.
pub trait PersonProfileRepository: Send + Sync + 'static {
    /// Distinct lowercased sender and recipient addresses of the thread's
    /// non-draft messages, in order of first appearance.
    fn thread_participants(
        &self,
        thread_id: Uuid,
        limit: i64,
    ) -> impl Future<Output = Result<Vec<String>, Report>> + Send;
    /// Lowercased addresses of the user's own and delegated inboxes.
    fn viewer_addresses(
        &self,
        user: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Vec<String>, Report>> + Send;
    /// Stored profiles and misses for `addresses` resolved at or after `fresh_after`.
    fn stored_profiles(
        &self,
        addresses: &[String],
        fresh_after: DateTime<Utc>,
    ) -> impl Future<Output = Result<Vec<PersonProfile>, Report>> + Send;
    /// Store resolved profiles and misses, replacing older entries.
    fn store_profiles(
        &self,
        profiles: &[PersonProfile],
        resolved_at: DateTime<Utc>,
    ) -> impl Future<Output = Result<(), Report>> + Send;
}

/// Outcome of one provider lookup.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PersonResolution {
    /// The provider answered: one profile per requested address, in request
    /// order, with no details for an address it could not match.
    Resolved(Vec<PersonProfile>),
    /// No answer this time (network error, rate limit, bad response); nothing
    /// is stored, so the next read retries.
    Unavailable,
}

/// Looks people up by email address. Best-effort: failures are
/// [`PersonResolution::Unavailable`], logged by the implementation.
pub trait PersonProfileResolver: Send + Sync + 'static {
    /// Resolve up to [`MAX_LOOKUPS_PER_READ`] lowercased addresses.
    fn resolve(&self, addresses: &[String]) -> impl Future<Output = PersonResolution> + Send;
}

/// Thread profile reads over the cache, resolving unknown participants
/// when a resolver is configured.
#[derive(Debug, Clone)]
pub struct PersonProfileService<R, P> {
    repo: R,
    resolver: Option<P>,
}

impl<R: PersonProfileRepository, P: PersonProfileResolver> PersonProfileService<R, P> {
    /// Construct with the repository and, when lookups are enabled, the resolver.
    /// Without a resolver only stored profiles are served.
    pub fn new(repo: R, resolver: Option<P>) -> Self {
        Self { repo, resolver }
    }

    /// Profiles of the senders and recipients of an authorized thread, in order
    /// of first appearance, excluding the viewer's own inboxes and people with
    /// no known details.
    #[tracing::instrument(skip_all, fields(participants, stored, looked_up), err)]
    pub async fn thread_profiles(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<Vec<PersonProfile>, PersonProfileError> {
        if receipt.entity().entity_type != EntityType::EmailThread {
            return Err(PersonProfileError::Unauthorized);
        }
        let viewer = receipt
            .acting_user_id()
            .ok_or(PersonProfileError::Unauthorized)?;
        let thread_id = Uuid::parse_str(&receipt.entity().entity_id)
            .map_err(|error| rootcause::report!("invalid thread id: {error}"))?;

        let (participants, own) = futures::try_join!(
            self.repo
                .thread_participants(thread_id, MAX_THREAD_PARTICIPANTS),
            self.repo.viewer_addresses(viewer),
        )?;
        let own: HashSet<String> = own.into_iter().collect();
        let participants: Vec<String> = participants
            .into_iter()
            .filter(|address| !own.contains(address))
            .collect();
        let span = tracing::Span::current();
        span.record("participants", participants.len());
        if participants.is_empty() {
            return Ok(Vec::new());
        }

        let now = Utc::now();
        let mut known: HashMap<String, PersonProfile> = self
            .repo
            .stored_profiles(&participants, now - REFRESH_AFTER)
            .await?
            .into_iter()
            .map(|profile| (profile.email_address.clone(), profile))
            .collect();
        span.record("stored", known.len());

        if let Some(resolver) = &self.resolver {
            let unknown: Vec<String> = participants
                .iter()
                .filter(|address| !known.contains_key(*address))
                .take(MAX_LOOKUPS_PER_READ)
                .cloned()
                .collect();
            span.record("looked_up", unknown.len());
            if !unknown.is_empty()
                && let PersonResolution::Resolved(resolved) = resolver.resolve(&unknown).await
            {
                // A failed write still answers this read; the next read looks them up again.
                if let Err(error) = self.repo.store_profiles(&resolved, now).await {
                    tracing::warn!(?error, "failed to store person profiles");
                }
                known.extend(
                    resolved
                        .into_iter()
                        .map(|profile| (profile.email_address.clone(), profile)),
                );
            }
        }

        Ok(participants
            .into_iter()
            .filter_map(|address| known.remove(&address))
            .filter(PersonProfile::has_details)
            .collect())
    }
}
