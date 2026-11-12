//! Authorization adapter for registered harness model discovery.

use agent_harness::domain::model_load::{HarnessModelAccess, HarnessModelReach};
use harness_id::HarnessId;
use harnesses::domain::ports::{HarnessRepo, HarnessService};
use harnesses::domain::service::HarnessServiceImpl;
use macro_user_id::user_id::MacroUserIdStr;

/// Visibility adapter backed by the harness domain's existing list policy.
pub struct VisibleHarnessAccess<Repo> {
    harnesses: HarnessServiceImpl<Repo>,
}

impl<Repo> VisibleHarnessAccess<Repo> {
    /// Build an access adapter over the harness repository.
    pub fn new(repo: Repo) -> Self {
        Self {
            harnesses: HarnessServiceImpl::new(repo),
        }
    }
}

impl<Repo> HarnessModelAccess for VisibleHarnessAccess<Repo>
where
    Repo: HarnessRepo,
{
    async fn reach(
        &self,
        caller: &MacroUserIdStr<'static>,
        harness: HarnessId,
    ) -> Result<HarnessModelReach, String> {
        let visible = self
            .harnesses
            .list_harnesses(caller.clone())
            .await
            .map_err(|error| error.to_string())?;
        Ok(
            match visible.iter().find(|candidate| candidate.id == harness) {
                None => HarnessModelReach::Forbidden,
                Some(found) if found.connected => HarnessModelReach::Connected,
                Some(_) => HarnessModelReach::Disconnected,
            },
        )
    }
}
