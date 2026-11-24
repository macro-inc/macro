//! Atomic activity ingestion for the facts shown in channel timelines.

use activity::{
    Activity,
    domain::ports::{ActivityReceipt, ActivityRepo},
    outbound::pg_activity_repo::PgActivityRepo,
};
use sqlx::PgPool;
use std::time::Duration;
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

/// Times a batch asks for its channels before its consumer gives up.
///
/// One refusal means a channel had four writes in flight for two seconds. The
/// consumer cannot skip a record, so it waits out a busy channel here: an
/// error from this repository ends the consumer's run and makes every topic it
/// reads rebalance.
const ADMISSION_ATTEMPTS: u32 = 15;
/// Pause after the first refusal; each later one waits this much longer.
const ADMISSION_BACKOFF: Duration = Duration::from_millis(250);
/// Longest pause between two attempts.
const ADMISSION_BACKOFF_MAX: Duration = Duration::from_secs(2);

/// Admit every channel once, in a common order, before a connection is taken.
///
/// A refused attempt returns the permits it holds before it waits, so a batch
/// that is waiting on one channel never occupies another's slot.
#[tracing::instrument(
    name = "activity.admit_channel_timeline",
    skip_all,
    fields(channels = channels.len() as i64, attempts = tracing::field::Empty),
    err
)]
async fn admit_channels(
    channels: &[Uuid],
) -> Result<Vec<message_write_gate::WritePermit>, message_write_gate::AdmissionTimeout> {
    let mut attempt = 1;
    loop {
        match admit_channels_once(channels).await {
            Ok(permits) => {
                tracing::Span::current().record("attempts", attempt);
                return Ok(permits);
            }
            Err(error) if attempt >= ADMISSION_ATTEMPTS => {
                tracing::Span::current().record("attempts", attempt);
                return Err(error);
            }
            Err(_) => {
                tokio::time::sleep((ADMISSION_BACKOFF * attempt).min(ADMISSION_BACKOFF_MAX)).await;
                attempt += 1;
            }
        }
    }
}

async fn admit_channels_once(
    channels: &[Uuid],
) -> Result<Vec<message_write_gate::WritePermit>, message_write_gate::AdmissionTimeout> {
    let mut permits = Vec::with_capacity(channels.len());
    for channel_id in channels {
        permits.push(message_write_gate::acquire("channel", &channel_id.to_string()).await?);
    }
    Ok(permits)
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
        let _permits = admit_channels(&admitted_channels).await.map_err(|error| {
            sqlx::Error::Io(std::io::Error::new(std::io::ErrorKind::TimedOut, error))
        })?;
        let mut tx = self.pool.begin().await?;
        activity::outbound::pg_activity_repo::insert_activities(&mut *tx, activities).await?;

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
