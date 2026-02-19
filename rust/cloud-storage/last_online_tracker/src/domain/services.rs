use crate::domain::ports::{LastOnlineRepo, SystemTime};
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use std::time::Duration;

#[cfg(test)]
mod test;

pub struct LastOnlineService<T, R> {
    time: T,
    repo: R,
}

impl<T: SystemTime, R: LastOnlineRepo> LastOnlineService<T, R> {
    pub fn new(time: T, repo: R) -> Self {
        LastOnlineService { time, repo }
    }

    #[tracing::instrument(err, skip(self))]
    pub async fn record_last_online(&self, user: MacroUserIdStr<'_>) -> Result<(), Report> {
        let now = self.time.now();
        self.repo.set_last_online(user, now).await
    }

    pub async fn get_last_online(
        &self,
        user: MacroUserIdStr<'_>,
    ) -> Result<Option<DateTime<Utc>>, Report> {
        self.repo.get_last_online(user).await
    }

    pub async fn time_since_last_online(
        &self,
        user: MacroUserIdStr<'_>,
    ) -> Result<Option<Duration>, Report> {
        let last = self.get_last_online(user).await?;
        let now = self.time.now();

        Ok(last
            .map(|time| now.signed_duration_since(time).to_std())
            .transpose()?)
    }
}
