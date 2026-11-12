//! Atomic activity ingestion for the facts shown in channel timelines.

use activity::{
    Activity,
    domain::ports::{ActivityReceipt, ActivityRepo},
    outbound::pg_activity_repo::PgActivityRepo,
};
use sqlx::PgPool;
use uuid::Uuid;

use messages::domain::{models::MessageParent, ports::timeline_parent};

/// Composes activity persistence with the shared channel change log.
///
/// The consumer acknowledges its source only after this write succeeds. Both
/// rows commit together; replayed deterministic activity ids may append another
/// log row, which clients safely apply by activity id.
#[derive(Clone)]
pub(crate) struct PgChannelActivityRepo {
    pool: PgPool,
    activity: PgActivityRepo,
}

impl PgChannelActivityRepo {
    /// Use the primary database shared by activity and message persistence.
    pub(crate) fn new(pool: PgPool) -> Self {
        Self {
            activity: PgActivityRepo::new(pool.clone()),
            pool,
        }
    }
}

fn channel_activity_ids(activities: &[Activity]) -> (Vec<Uuid>, Vec<Uuid>) {
    activities
        .iter()
        .filter_map(|activity| match timeline_parent(activity) {
            Some(MessageParent::Channel(channel_id)) => Some((channel_id, activity.id)),
            _ => None,
        })
        .unzip()
}

impl ActivityRepo for PgChannelActivityRepo {
    type Err = sqlx::Error;

    #[tracing::instrument(skip_all, name = "activity.record_channel_timeline", fields(activities = activities.len() as i64), err)]
    async fn insert_activities(
        &self,
        activities: &[Activity],
    ) -> Result<Vec<ActivityReceipt>, Self::Err> {
        let (channel_ids, activity_ids) = channel_activity_ids(activities);
        if activity_ids.is_empty() {
            return self.activity.insert_activities(activities).await;
        }

        // Acquire each channel once, in a common order, before occupying a
        // database connection. Retain every permit through the batch commit.
        let mut admitted_channels = channel_ids.clone();
        admitted_channels.sort_unstable();
        admitted_channels.dedup();
        let mut permits = Vec::with_capacity(admitted_channels.len());
        for channel_id in admitted_channels {
            permits.push(
                message_write_gate::acquire("channel", &channel_id.to_string())
                    .await
                    .map_err(|error| {
                        sqlx::Error::Io(std::io::Error::new(std::io::ErrorKind::TimedOut, error))
                    })?,
            );
        }
        let mut tx = self.pool.begin().await?;
        self.activity
            .insert_activities_in(&mut tx, activities)
            .await?;

        let rows =
            channel_change_db_utils::append_activities_in(&mut tx, &channel_ids, &activity_ids)
                .await?;
        tx.commit().await?;
        Ok(rows
            .into_iter()
            .map(|row| ActivityReceipt {
                activity_id: row.activity_id,
                seq: Some(row.seq),
            })
            .collect())
    }

    async fn purge_entities(
        &self,
        entities: &[(activity::EntityType, String)],
    ) -> Result<(), Self::Err> {
        self.activity.purge_entities(entities).await
    }
}

#[cfg(test)]
mod test;
