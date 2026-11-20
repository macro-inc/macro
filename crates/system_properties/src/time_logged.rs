//! A task's Time logged: the total of its time entries, in whole minutes.
//!
//! The total is derived, so only the time tracking repository writes it: inside
//! the transaction that changed one of the task's entries, after taking that
//! task's lock, from the sum that transaction just read. Writing it publishes no
//! property event; time tracking publishes its own. The properties service
//! refuses every other write of [`SystemPropertyKey::TIME_LOGGED_UUID`].

#[cfg(test)]
mod test;

use macro_uuid::generate_uuid_v7;
use models_properties::api::PropertyValue;
use sqlx::{PgExecutor, Postgres, Transaction};

use crate::{SystemPropertyError, SystemPropertyKey};

/// Store `minutes` as the task's Time logged, in the caller's transaction.
#[tracing::instrument(skip(tx), err)]
pub async fn write_task_time_logged(
    tx: &mut Transaction<'_, Postgres>,
    task_id: &str,
    minutes: u32,
) -> Result<(), SystemPropertyError> {
    let values = serde_json::to_value(PropertyValue::Num(f64::from(minutes)))?;

    sqlx::query!(
        r#"
        INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id, values)
        VALUES ($1, $2, 'TASK', $3, $4)
        ON CONFLICT (entity_id, entity_type, property_definition_id)
        DO UPDATE SET values = EXCLUDED.values, updated_at = NOW()
        "#,
        generate_uuid_v7(),
        task_id,
        SystemPropertyKey::TIME_LOGGED_UUID,
        values,
    )
    .execute(&mut **tx)
    .await?;

    Ok(())
}

/// The task's Time logged; zero for a task that has logged nothing.
#[tracing::instrument(skip(executor), err)]
pub async fn read_task_time_logged<'e, E: PgExecutor<'e>>(
    executor: E,
    task_id: &str,
) -> Result<u32, SystemPropertyError> {
    let minutes = sqlx::query_scalar!(
        r#"
        SELECT (values->>'value')::numeric::bigint AS "minutes"
        FROM entity_properties
        WHERE entity_id = $1
          AND entity_type = 'TASK'
          AND property_definition_id = $2
        "#,
        task_id,
        SystemPropertyKey::TIME_LOGGED_UUID,
    )
    .fetch_optional(executor)
    .await?
    .flatten()
    .unwrap_or(0);

    u32::try_from(minutes).map_err(|_| {
        SystemPropertyError::Validation(format!("stored Time logged is out of range: {minutes}"))
    })
}
