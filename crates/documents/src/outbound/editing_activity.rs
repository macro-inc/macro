//! Redis storage for shared document editing-session inactivity windows.

use std::time::Duration;

use activity::Activity;
use redis::{ExistenceCheck, SetExpiry, SetOptions};
use rootcause::Report;
use uuid::Uuid;

use crate::domain::ports::EditingActivityStore;

/// Refreshes editing sessions atomically across document-service instances.
/// This is a best-effort debounce; cache loss starts a new session.
#[derive(Clone)]
pub struct RedisEditingActivityStore {
    client: redis::Client,
}

impl RedisEditingActivityStore {
    /// Reuse the hosting service's Redis configuration.
    pub fn new(client: redis::Client) -> Self {
        Self { client }
    }
}

fn session_key(activity: &Activity) -> Result<String, Report> {
    // Encoding a tuple keeps separators within identifiers unambiguous.
    let identity = serde_json::to_string(&(
        activity.actor.as_ref(),
        &activity.subject_id,
        &activity.entity_id,
    ))?;
    Ok(format!("documents:editing:{identity}"))
}

impl EditingActivityStore for RedisEditingActivityStore {
    async fn refresh_editing_sessions(
        &self,
        activities: &[Activity],
        source_event_id: Uuid,
        idle: Duration,
    ) -> Result<Vec<bool>, Report> {
        if activities.is_empty() {
            return Ok(Vec::new());
        }

        // `SET NX GET` starts a session owned by this event, or returns the
        // event that owns the current one; `EXPIRE` extends either window.
        // Requires Redis 7.0+ for `NX` with `GET`.
        let event_id = source_event_id.to_string();
        let start_session = SetOptions::default()
            .conditional_set(ExistenceCheck::NX)
            .get(true)
            .with_expiration(SetExpiry::EX(idle.as_secs()));
        let mut pipeline = redis::pipe();
        pipeline.atomic();
        for activity in activities {
            let key = session_key(activity)?;
            pipeline
                .set_options(&key, &event_id, start_session.clone())
                .expire(&key, idle.as_secs() as i64)
                .ignore();
        }

        let mut connection = self.client.get_multiplexed_async_connection().await?;
        let owners: Vec<Option<String>> = pipeline.query_async(&mut connection).await?;
        // A new session, or a replay of the event that opened it, is admitted.
        Ok(owners
            .into_iter()
            .map(|owner| owner.is_none_or(|owner| owner == event_id))
            .collect())
    }
}

#[cfg(test)]
mod test;
