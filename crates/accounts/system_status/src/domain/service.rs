//! System status service implementation.

#[cfg(test)]
mod test;

use chrono::Utc;
use macro_user_id::{cow_str::CowLike, user_id::MacroUserIdStr};

use crate::domain::{
    models::{CurrentSystemStatus, StatusUpdate, SystemStatus, SystemStatusError},
    ports::{StatusBroadcaster, SystemStatusRepo, SystemStatusService},
};

/// Most updates the history lists.
const HISTORY_LIMIT: u16 = 100;

/// The concrete system status service.
pub struct SystemStatusServiceImpl<R, B> {
    repo: R,
    broadcaster: B,
}

impl<R, B> SystemStatusServiceImpl<R, B> {
    /// Create a service over the given storage and broadcaster.
    pub fn new(repo: R, broadcaster: B) -> Self {
        Self { repo, broadcaster }
    }
}

impl<R: SystemStatusRepo, B: StatusBroadcaster> SystemStatusService
    for SystemStatusServiceImpl<R, B>
{
    #[tracing::instrument(skip_all, err)]
    async fn current_status(&self) -> Result<CurrentSystemStatus, SystemStatusError> {
        let latest = self
            .repo
            .latest_update()
            .await
            .map_err(|e| rootcause::Report::new(e).into_dynamic())?;
        Ok(latest.into())
    }

    #[tracing::instrument(skip_all, err)]
    async fn history(
        &self,
        caller: &MacroUserIdStr<'_>,
    ) -> Result<Vec<StatusUpdate>, SystemStatusError> {
        require_staff(caller)?;
        Ok(self
            .repo
            .list_updates(HISTORY_LIMIT)
            .await
            .map_err(|e| rootcause::Report::new(e).into_dynamic())?)
    }

    #[tracing::instrument(
        name = "system_status.set",
        skip_all,
        fields(
            status_update.id = tracing::field::Empty,
            broadcast.ok = tracing::field::Empty,
        ),
        err
    )]
    async fn set_status(
        &self,
        caller: &MacroUserIdStr<'_>,
        status: SystemStatus,
    ) -> Result<StatusUpdate, SystemStatusError> {
        require_staff(caller)?;

        let update = StatusUpdate {
            id: macro_uuid::generate_uuid_v7(),
            status,
            user_id: caller.clone().into_owned(),
            created_at: Utc::now(),
        };
        tracing::Span::current().record("status_update.id", tracing::field::display(update.id));
        self.repo
            .insert_update(&update)
            .await
            .map_err(|e| rootcause::Report::new(e).into_dynamic())?;

        // The update is stored, so it is the current status whether or not the
        // push lands: apps that miss it pick it up on their next fetch. Failing
        // here would only invite a retry that records the same status twice.
        let broadcast = self
            .broadcaster
            .broadcast(&Some(update.clone()).into())
            .await;
        tracing::Span::current().record("broadcast.ok", broadcast.is_ok());
        if let Err(error) = broadcast {
            tracing::warn!(error = ?error, "failed to broadcast system status");
        }

        Ok(update)
    }
}

fn require_staff(user: &MacroUserIdStr<'_>) -> Result<(), SystemStatusError> {
    if user.is_macro_staff() {
        Ok(())
    } else {
        Err(SystemStatusError::Forbidden)
    }
}
