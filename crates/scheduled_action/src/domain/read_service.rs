use std::sync::Arc;

use entity_access::domain::ports::ScheduledActionGrants;
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;

use super::models::ScheduledAction;
use super::ports::{ScheduledActionReadService, ScheduledActionRepo};
use super::service::list_accessible_actions;

pub struct ScheduledActionReadServiceImpl<R, G> {
    repo: Arc<R>,
    grants: Arc<G>,
}

impl<R, G> ScheduledActionReadServiceImpl<R, G> {
    pub fn new(repo: Arc<R>, grants: Arc<G>) -> Self {
        Self { repo, grants }
    }
}

impl<R, G> ScheduledActionReadService for ScheduledActionReadServiceImpl<R, G>
where
    R: ScheduledActionRepo,
    G: ScheduledActionGrants,
{
    async fn list_accessible(
        &self,
        user_id: MacroUserIdStr<'static>,
    ) -> Result<Vec<ScheduledAction>, Report> {
        list_accessible_actions(self.repo.as_ref(), self.grants.as_ref(), &user_id)
            .await
            .map_err(|error| rootcause::report!(error).into_dynamic())
    }
}
