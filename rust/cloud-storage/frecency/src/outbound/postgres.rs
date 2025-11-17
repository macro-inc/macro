//! This module provides the implementation for storing frecency data in postgres
use crate::domain::{
    models::{
        AggregateFrecency, AggregateId, EventRecord, EventRecordWithId, FrecencyData,
        FrecencyPageRequest, TimestampWeight,
    },
    ports::{AggregateFrecencyStorage, EventRecordStorage, UnprocessedEventsRepo},
};
use chrono::{DateTime, Utc};
use macro_user_id::{
    cowlike::CowLike,
    user_id::{MacroUserIdStr, ParseErr},
};
use model_entity::{Entity, EntityType, TrackAction, TrackingData};
use sqlx::{PgPool, Postgres, QueryBuilder, Row, Transaction, prelude::FromRow};
use std::{borrow::Cow, collections::VecDeque, str::FromStr};
use thiserror::Error;

#[cfg(test)]
mod tests;

/// Concrete implementation of storage ports against a postgres instance
#[derive(Debug, Clone)]
pub struct FrecencyPgStorage {
    pool: PgPool,
}

/// the types of errors that can occur on [FrecencyPgStorage]
#[derive(Debug, Error)]
pub enum FrecencyStorageErr {
    /// there was a sqlx error
    #[error(transparent)]
    Db(#[from] sqlx::Error),
    /// the database contained invalid user id data
    #[error(transparent)]
    UserIdErr(#[from] ParseErr),
    /// encounted an unknown entity type
    #[error(transparent)]
    UnknownEntity(#[from] model_entity::ParseError),
    /// failed to deserialize a type from json
    #[error(transparent)]
    Serde(#[from] serde_json::Error),
}

impl FrecencyPgStorage {
    /// create a new instance of Self
    pub fn new(pool: PgPool) -> Self {
        FrecencyPgStorage { pool }
    }

    async fn static_get_top_entities(
        &self,
        user_id: MacroUserIdStr<'_>,
        from_score: Option<f64>,
        limit: u32,
    ) -> Result<Vec<AggregateFrecency>, FrecencyStorageErr> {
        let rows = sqlx::query!(
            r#"
                SELECT *
                FROM frecency_aggregates
                WHERE user_id = $1
                ORDER BY frecency_score DESC
                LIMIT $2
                "#,
            user_id.as_ref(),
            limit as i64
        )
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter()
            .map(|row| {
                let aggregate_row = AggregateRow {
                    entity_id: row.entity_id,
                    entity_type: row.entity_type.parse()?,
                    user_id: row.user_id,
                    event_count: row.event_count as usize,
                    frecency_score: row.frecency_score,
                    first_event: row.first_event,
                    recent_events: serde_json::from_value(row.recent_events)?,
                };
                Ok(aggregate_row.into_aggregate_frecency()?)
            })
            .collect()
    }
}

struct EventRow<'a, T> {
    /// the pk id in the database
    id: T,
    user_id: Cow<'a, str>,
    entity_type: Cow<'a, str>,
    event_type: Cow<'a, str>,
    timestamp: DateTime<Utc>,
    connection_id: Cow<'a, str>,
    entity_id: Cow<'a, str>,
    /// tracks whether we have calculated the aggregate score for this record yet
    was_processed: bool,
}

impl<'a> EventRow<'a, ()> {
    fn new_from_event_record(event: EventRecord<'a>) -> Self {
        EventRow {
            id: (),
            user_id: event.event.entity.user_id,
            entity_type: Cow::Borrowed(<&'static str>::from(
                event.event.entity.extra.extra.entity_type,
            )),
            event_type: Cow::Borrowed(<&'static str>::from(event.event.action)),
            timestamp: event.timestamp,
            connection_id: event.event.entity.extra.connection_id,
            entity_id: event.event.entity.extra.extra.entity_id,
            was_processed: false,
        }
    }
}

impl<'a> EventRow<'a, i64> {
    fn into_event_record(self) -> Result<EventRecordWithId<'a, i64>, anyhow::Error> {
        let EventRow {
            id,
            user_id,
            entity_type,
            event_type,
            timestamp,
            connection_id,
            entity_id,
            was_processed: _,
        } = self;

        Ok(EventRecordWithId {
            event_record: EventRecord {
                event: TrackingData {
                    entity: EntityType::from_str(&entity_type)?
                        .with_entity_string(entity_id.into_owned())
                        .with_connection_string(connection_id.into_owned())
                        .with_user_string(user_id.into_owned()),
                    action: TrackAction::from_str(&event_type)?,
                },
                timestamp,
            },
            id,
        })
    }
}

impl EventRecordStorage for FrecencyPgStorage {
    type Err = sqlx::Error;

    async fn set_event(&self, record: EventRecord<'_>) -> Result<(), Self::Err> {
        let EventRow {
            id: (),
            user_id,
            entity_type,
            event_type,
            timestamp,
            connection_id,
            entity_id,
            was_processed,
        } = EventRow::new_from_event_record(record);

        let _res = sqlx::query!(
            r#"
            INSERT INTO frecency_events (
                user_id,
                entity_type,
                event_type,
                timestamp,
                connection_id,
                entity_id,
                was_processed
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            "#,
            &user_id,
            entity_type.as_ref(),
            event_type.as_ref(),
            timestamp,
            &connection_id,
            &entity_id,
            was_processed
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }
}

#[derive(FromRow)]
struct AggregateRow {
    entity_id: String,
    #[sqlx(try_from = "String")]
    entity_type: EntityType,
    user_id: String,
    #[sqlx(try_from = "i32")]
    event_count: usize,
    frecency_score: f64,
    first_event: DateTime<Utc>,
    recent_events: sqlx::types::Json<VecDeque<TimestampWeight>>,
}

impl AggregateRow {
    fn into_aggregate_frecency(self) -> Result<AggregateFrecency, ParseErr> {
        let AggregateRow {
            entity_id,
            entity_type,
            user_id,
            event_count,
            frecency_score,
            first_event,
            recent_events,
        } = self;

        Ok(AggregateFrecency {
            id: AggregateId {
                entity: entity_type.with_entity_string(entity_id.to_string()),
                user_id: MacroUserIdStr::parse_from_str(&user_id).map(CowLike::into_owned)?,
            },
            data: FrecencyData {
                event_count,
                frecency_score,
                first_event,
                recent_events: recent_events.0,
            },
        })
    }
}

impl AggregateFrecencyStorage for FrecencyPgStorage {
    type Err = FrecencyStorageErr;

    async fn get_top_entities(
        &self,
        req: FrecencyPageRequest<'_>,
    ) -> Result<Vec<AggregateFrecency>, Self::Err> {
        let FrecencyPageRequest {
            user_id,
            from_score,
            limit,
            filters,
        } = req;
        match filters {
            None => {
                self.static_get_top_entities(user_id, from_score, limit)
                    .await
            }
            Some(_ast) => todo!(),
        }
    }

    async fn set_aggregate(
        &self,
        frecency: crate::domain::models::AggregateFrecency,
    ) -> Result<(), Self::Err> {
        let entity_type = frecency.id.entity.entity_type.to_string();
        let entity_id = frecency.id.entity.entity_id;
        let recent_events_json = serde_json::to_value(&frecency.data.recent_events)
            .expect("Failed to serialize recent_events");

        sqlx::query!(
            r#"
                INSERT INTO frecency_aggregates (
                    entity_id,
                    entity_type,
                    user_id,
                    event_count,
                    frecency_score,
                    first_event,
                    recent_events
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT (user_id, entity_type, entity_id)
                DO UPDATE SET
                    event_count = EXCLUDED.event_count,
                    frecency_score = EXCLUDED.frecency_score,
                    recent_events = EXCLUDED.recent_events
                "#,
            entity_id.as_ref(),
            entity_type,
            frecency.id.user_id.as_ref(),
            frecency.data.event_count as i32,
            frecency.data.frecency_score,
            frecency.data.first_event,
            recent_events_json
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    async fn get_aggregate_for_user_entities<T>(
        &self,
        user_id: MacroUserIdStr<'static>,
        entities: T,
    ) -> Result<Vec<crate::domain::models::AggregateFrecency>, Self::Err>
    where
        T: Iterator<Item = Entity<'static>>,
    {
        let user_id = user_id.0.as_ref().to_string();
        let entity_pairs: Vec<(String, String)> = entities
            .map(|e| (e.entity_type.to_string(), e.entity_id.into_owned()))
            .collect();

        // Build the WHERE conditions for each entity
        let mut conditions = Vec::new();
        let mut params = Vec::new();

        params.push(user_id.clone());

        for (entity_type, entity_id) in entity_pairs {
            conditions.push(format!(
                "(entity_type = ${} AND entity_id = ${})",
                params.len() + 1,
                params.len() + 2
            ));
            params.push(entity_type);
            params.push(entity_id);
        }

        if conditions.is_empty() {
            return Ok(Vec::new());
        }

        // Build and execute dynamic query
        let query = format!(
            r#"
                SELECT 
                    entity_id,
                    entity_type,
                    user_id,
                    event_count,
                    frecency_score,
                    first_event,
                    recent_events
                FROM frecency_aggregates
                WHERE user_id = $1 AND ({})
                ORDER BY frecency_score DESC
                "#,
            conditions.join(" OR ")
        );

        let mut sql_query = sqlx::query(&query);
        for param in params {
            sql_query = sql_query.bind(param);
        }

        let rows = sql_query.fetch_all(&self.pool).await?;

        let out: Result<Vec<_>, _> = rows
            .into_iter()
            .map(|row| {
                let aggregate_row = AggregateRow {
                    entity_id: row.try_get("entity_id").unwrap(),
                    entity_type: row
                        .try_get::<String, _>("entity_type")
                        .unwrap()
                        .parse()
                        .unwrap(),
                    user_id: row.try_get("user_id").unwrap(),
                    event_count: row.try_get::<i32, _>("event_count").unwrap() as usize,
                    frecency_score: row.try_get("frecency_score").unwrap(),
                    first_event: row.try_get("first_event").unwrap(),
                    recent_events: serde_json::from_value(row.try_get("recent_events").unwrap())
                        .unwrap(),
                };
                aggregate_row.into_aggregate_frecency()
            })
            .collect();
        Ok(out?)
    }
}

/// concrete struct which implements [UnprocessedEventsRepo]
/// This uses transactions to ensure that the act of processing events remains atomic
pub struct FrecencyPgProcessor {
    pool: PgPool,
    tx: tokio::sync::Mutex<Option<Transaction<'static, Postgres>>>,
}

// Define a unique lock ID for frecency polling
const FRECENCY_POLLER_LOCK_ID: i64 = 999_999_001;

impl FrecencyPgProcessor {
    /// create a new instance of self from a [PgPool]
    pub fn new(pool: PgPool) -> Self {
        FrecencyPgProcessor {
            pool,
            tx: tokio::sync::Mutex::new(None),
        }
    }
}

type ExistingEventRow = EventRow<'static, i64>;

/// the types of errors that can occur with the poller
#[derive(Debug, Error)]
pub enum PollerErr {
    /// there was an issue accessing the db tx
    #[error("Expected to be inside a transaction, but no transaction was present")]
    TxErr,
    /// failed to acquire advisory lock on db
    #[error("another poller currently holds the frecency lock")]
    DbLockErr,
    /// failed to acquire mutex lock
    #[error(transparent)]
    MutexErr(#[from] tokio::sync::TryLockError),
    /// sqlx database error
    #[error(transparent)]
    Sqlx(#[from] sqlx::Error),
    /// error parsing macro user id
    #[error(transparent)]
    ParseErr(#[from] ParseErr),
    /// some other error
    #[error(transparent)]
    OtherErr(#[from] anyhow::Error),
}

/// we need to bind 7 parameters per event we need to process to insert 1 [AggregateFrecency].
/// Due to the u16 max upper bound on query parameters this is the limit for items that can be processed in one batch.
/// Leftover entries just get processed later
static FETCH_LIMIT: u16 = u16::MAX / 7;

impl UnprocessedEventsRepo for FrecencyPgProcessor {
    type Err = PollerErr;
    type EventId = i64;

    async fn get_unprocessed_events(
        &self,
    ) -> Result<Vec<EventRecordWithId<'static, i64>>, Self::Err> {
        let mut tx = self.pool.begin().await?;
        let true = sqlx::query_scalar!(
            r#"
               SELECT pg_try_advisory_xact_lock($1)
            "#,
            FRECENCY_POLLER_LOCK_ID
        )
        .fetch_one(&mut *tx)
        .await?
        .unwrap_or(false) else {
            return Err(PollerErr::DbLockErr);
        };

        let res: Vec<ExistingEventRow> = sqlx::query_as!(
            ExistingEventRow,
            r#"
            SELECT *
            FROM
                frecency_events
            WHERE was_processed = false
            LIMIT $1
            "#,
            FETCH_LIMIT as i64
        )
        .fetch_all(&mut *tx)
        .await?;

        let res: Result<Vec<_>, _> = res.into_iter().map(|r| r.into_event_record()).collect();

        let mut guard = self.tx.try_lock()?;
        *guard = Some(tx);
        res.map_err(PollerErr::from)
    }

    async fn mark_processed<'a>(
        &self,
        event: Vec<EventRecordWithId<'a, i64>>,
    ) -> Result<(), Self::Err> {
        let mut guard = self.tx.try_lock()?;

        let mut tx = guard.take().ok_or(PollerErr::TxErr)?;

        if event.is_empty() {
            tx.commit().await?;
            return Ok(());
        }

        let mut query_builder = QueryBuilder::<Postgres>::new(
            r#"
            UPDATE frecency_events
            SET was_processed = true
            WHERE id IN (
            "#,
        );

        let mut separated = query_builder.separated(", ");
        for e in event {
            separated.push_bind(e.id);
        }
        separated.push_unseparated(")");

        let query = query_builder.build();

        query.execute(&mut *tx).await?;

        tx.commit().await?;
        Ok(())
    }

    async fn get_aggregates_for_users_entities(
        &self,
        aggregates: Vec<AggregateId<'_>>,
    ) -> Result<Vec<AggregateFrecency>, Self::Err> {
        let mut guard = self.tx.try_lock()?;
        let tx = guard.as_deref_mut().ok_or(PollerErr::TxErr)?;

        let mut query_builder = QueryBuilder::<Postgres>::new(
            r#"
            SELECT
                entity_id,
                entity_type,
                user_id,
                event_count,
                frecency_score,
                first_event,
                recent_events
            FROM frecency_aggregates
            WHERE
                (user_id, entity_id, entity_type)
            IN 
            "#,
        );

        query_builder.push_tuples(aggregates, |mut b, AggregateId { user_id, entity }| {
            b.push_bind(user_id.as_ref().to_string())
                .push_bind(entity.entity_id)
                .push_bind(<&'static str>::from(entity.entity_type));
        });

        let query = query_builder.build_query_as::<AggregateRow>();

        let output = query.fetch_all(tx).await?;

        let out: Result<Vec<_>, _> = output
            .into_iter()
            .map(AggregateRow::into_aggregate_frecency)
            .collect();

        Ok(out?)
    }

    async fn set_aggregates(&self, aggregates: Vec<AggregateFrecency>) -> Result<(), Self::Err> {
        let mut guard = self.tx.try_lock()?;
        let tx = guard.as_deref_mut().ok_or(PollerErr::TxErr)?;

        if aggregates.is_empty() {
            return Ok(());
        }

        let mut query_builder = QueryBuilder::<Postgres>::new(
            r#"
            INSERT INTO frecency_aggregates (
                entity_id,
                entity_type,
                user_id,
                event_count,
                frecency_score,
                first_event,
                recent_events
            )
            "#,
        );

        query_builder.push_values(aggregates, |mut b, aggregate| {
            let entity_type = aggregate.id.entity.entity_type.to_string();
            let entity_id = aggregate.id.entity.entity_id.to_string();
            let recent_events_json = serde_json::to_value(&aggregate.data.recent_events)
                .expect("Failed to serialize recent_events");

            b.push_bind(entity_id)
                .push_bind(entity_type)
                .push_bind(aggregate.id.user_id.as_ref().to_string())
                .push_bind(aggregate.data.event_count as i32)
                .push_bind(aggregate.data.frecency_score)
                .push_bind(aggregate.data.first_event)
                .push_bind(recent_events_json);
        });

        query_builder.push(
            r#"
            ON CONFLICT (user_id, entity_type, entity_id)
            DO UPDATE SET
                event_count = EXCLUDED.event_count,
                frecency_score = EXCLUDED.frecency_score,
                recent_events = EXCLUDED.recent_events
            "#,
        );

        let query = query_builder.build();
        query.execute(tx).await?;

        Ok(())
    }
}
