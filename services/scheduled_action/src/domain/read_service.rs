use std::sync::Arc;

use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;

use super::models::ScheduledAction;
use super::ports::{ScheduledActionReadService, ScheduledActionRepo};
use super::service::list_owned_actions;

pub struct ScheduledActionReadServiceImpl<R> {
    repo: Arc<R>,
}

impl<R> ScheduledActionReadServiceImpl<R> {
    pub fn new(repo: Arc<R>) -> Self {
        Self { repo }
    }
}

impl<R: ScheduledActionRepo> ScheduledActionReadService for ScheduledActionReadServiceImpl<R> {
    async fn list_owned(
        &self,
        user_id: MacroUserIdStr<'static>,
    ) -> Result<Vec<ScheduledAction>, Report> {
        list_owned_actions(self.repo.as_ref(), &user_id)
            .await
            .map_err(|error| rootcause::report!(error).into_dynamic())
    }
}
