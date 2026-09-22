//! Redis storage for shared document editing-session inactivity windows.

use std::time::Duration;

use activity::Activity;
use rootcause::Report;
use uuid::Uuid;

use crate::domain::ports::EditingActivityStore;

const REFRESH_SESSION: &str = include_str!("editing_activity/refresh.lua");

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

        let mut pipeline = redis::pipe();
        let event_id = source_event_id.to_string();
        for activity in activities {
            pipeline
                .cmd("EVAL")
                .arg(REFRESH_SESSION)
                .arg(1)
                .arg(session_key(activity)?)
                .arg(&event_id)
                .arg(idle.as_secs());
        }

        let mut connection = self.client.get_multiplexed_async_connection().await?;
        let admitted: Vec<bool> = pipeline.query_async(&mut connection).await?;
        Ok(admitted)
    }
}

#[cfg(test)]
mod test;
