//! Who counts in for nightly generations from the suggestions feed: like an app
//! load, only paid plans, with their next run set for their night.

use std::sync::Arc;

use chrono::{DateTime, Utc};
use chrono_tz::Tz;
use macro_user_id::cowlike::CowLike as _;
use macro_user_id::user_id::MacroUserIdStr;
use suggestions::domain::ports::SuggestionAudience;

use super::night;
use super::ports::{GenerationRepo, Plans};

/// [`SuggestionAudience`] that records only people on a paid plan.
pub struct PaidAudience<Repo> {
    repo: Arc<Repo>,
    plans: Arc<dyn Plans>,
}

impl<Repo> PaidAudience<Repo> {
    /// Readers recorded in `repo` when `plans` says they pay.
    pub fn new(repo: Arc<Repo>, plans: Arc<dyn Plans>) -> Self {
        Self { repo, plans }
    }
}

#[async_trait::async_trait]
impl<Repo: GenerationRepo> SuggestionAudience for PaidAudience<Repo> {
    async fn seen(
        &self,
        user: &MacroUserIdStr<'_>,
        timezone: &str,
        now: DateTime<Utc>,
    ) -> Result<(), rootcause::Report> {
        let Ok(zone) = timezone.parse::<Tz>() else {
            return Ok(());
        };
        let user = user.clone().into_owned();
        // Unknown plans count as unpaid: no nightly run.
        if !self.plans.paid(&user).await? {
            return Ok(());
        }
        self.repo
            .see(&user, zone.name(), now, night::upcoming(&user, zone, now))
            .await
            .map_err(|error| rootcause::Report::new(error).into_dynamic())
    }
}
