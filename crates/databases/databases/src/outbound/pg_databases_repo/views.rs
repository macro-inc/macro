//! View and card-place statements over any connection.
//!
//! A card's lane is stored as text (`database_view_positions.lane`): an
//! option's lane as the option's id, the lane of empty cells as the empty
//! string, and a person's lane as `user:` and their user id. Options and
//! empty cells keep the spelling they had when only selects grouped
//! boards, so places stored then read the same; a user id never parses as
//! a uuid, and the prefix keeps it from ever being taken for one.

#[cfg(test)]
mod test;

use macro_user_id::user_id::MacroUserIdStr;
use models_databases::views::LaneKey;
use sqlx::PgExecutor;
use uuid::Uuid;

use super::{PgDatabasesRepoError, stored, uuids};
use crate::domain::models::{
    CardPosition, ColumnId, DatabaseId, DatabaseView, OptionId, RowId, TableId, ViewId,
    ViewPosition,
};

/// What a person's stored lane starts with.
const USER_LANE_PREFIX: &str = "user:";

/// The lane as stored.
fn stored_lane(lane: &LaneKey) -> String {
    match lane {
        LaneKey::Option(option) => option.to_string(),
        LaneKey::User(user) => format!("{USER_LANE_PREFIX}{user}"),
        LaneKey::None => String::new(),
    }
}

/// The lane a stored key names.
fn lane_of(stored: &str) -> Result<LaneKey, PgDatabasesRepoError> {
    let corrupt = || PgDatabasesRepoError::CorruptLane(stored.to_string());
    if stored.is_empty() {
        return Ok(LaneKey::None);
    }
    if let Some(user) = stored.strip_prefix(USER_LANE_PREFIX) {
        return MacroUserIdStr::try_from(user.to_string())
            .map(LaneKey::User)
            .map_err(|_| corrupt());
    }
    stored
        .parse::<OptionId>()
        .map(LaneKey::Option)
        .map_err(|_| corrupt())
}

/// Every view of the given tables, ordered by table then position.
pub(crate) async fn views_for_tables(
    executor: impl PgExecutor<'_>,
    table_ids: &[TableId],
) -> Result<Vec<DatabaseView>, PgDatabasesRepoError> {
    let rows = sqlx::query!(
        r#"
        SELECT view.id, view.database_id, view.table_id, view.name, view.position, view.query,
               view.layout, view.created_at, view.updated_at,
               (SELECT first.id FROM database_columns first
                WHERE first.table_id = view.table_id
                ORDER BY first.position, first.id
                LIMIT 1) AS "first_column?"
        FROM database_views view
        WHERE view.table_id = ANY($1)
        ORDER BY view.table_id, view.position, view.id
        "#,
        &uuids(table_ids),
    )
    .fetch_all(executor)
    .await?;
    rows.into_iter()
        .map(|row| {
            let id = ViewId::from_uuid(row.id);
            Ok(DatabaseView {
                id,
                database_id: DatabaseId::from_uuid(row.database_id),
                table_id: TableId::from_uuid(row.table_id),
                name: row.name,
                position: row.position.parse()?,
                query: serde_json::from_value(row.query)?,
                layout: stored::layout(row.layout, id, row.first_column.map(ColumnId::from_uuid))?,
                created_at: row.created_at,
                updated_at: row.updated_at,
            })
        })
        .collect()
}

/// Where a board's cards sit, those that have a place, by lane then key.
pub(crate) async fn view_positions(
    executor: impl PgExecutor<'_>,
    view_id: ViewId,
) -> Result<Vec<CardPosition>, PgDatabasesRepoError> {
    let rows = sqlx::query!(
        r#"
        SELECT row_id, lane, position
        FROM database_view_positions
        WHERE view_id = $1
        ORDER BY lane, position, row_id
        "#,
        view_id.into_uuid(),
    )
    .fetch_all(executor)
    .await?;
    rows.into_iter()
        .map(|row| {
            Ok(CardPosition {
                row: RowId::from_uuid(row.row_id),
                lane: lane_of(&row.lane)?,
                position: row.position.parse()?,
            })
        })
        .collect()
}

/// Store a new view.
pub(crate) async fn insert_view(
    executor: impl PgExecutor<'_>,
    view: &DatabaseView,
) -> Result<(), PgDatabasesRepoError> {
    sqlx::query!(
        r#"
        INSERT INTO database_views
            (id, database_id, table_id, name, position, query, layout, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        "#,
        view.id.into_uuid(),
        view.database_id.into_uuid(),
        view.table_id.into_uuid(),
        view.name,
        view.position.as_str(),
        serde_json::to_value(&view.query)?,
        serde_json::to_value(&view.layout)?,
        view.created_at,
        view.updated_at,
    )
    .execute(executor)
    .await?;
    Ok(())
}

/// Replace a view's name, query and layout; `false` when the table no
/// longer has it.
pub(crate) async fn update_view(
    executor: impl PgExecutor<'_>,
    view: &DatabaseView,
) -> Result<bool, PgDatabasesRepoError> {
    let updated = sqlx::query!(
        r#"
        UPDATE database_views
        SET name = $3, query = $4, layout = $5, updated_at = $6
        WHERE id = $1 AND table_id = $2
        "#,
        view.id.into_uuid(),
        view.table_id.into_uuid(),
        view.name,
        serde_json::to_value(&view.query)?,
        serde_json::to_value(&view.layout)?,
        view.updated_at,
    )
    .execute(executor)
    .await?;
    Ok(updated.rows_affected() == 1)
}

/// Remove a view, its card places with it; `false` when the table no longer
/// has it.
pub(crate) async fn delete_view(
    executor: impl PgExecutor<'_>,
    table_id: TableId,
    view_id: ViewId,
) -> Result<bool, sqlx::Error> {
    let deleted = sqlx::query!(
        "DELETE FROM database_views WHERE id = $1 AND table_id = $2",
        view_id.into_uuid(),
        table_id.into_uuid(),
    )
    .execute(executor)
    .await?;
    Ok(deleted.rows_affected() == 1)
}

/// Give a table's views new positions; `false` when one of them is not the
/// table's any more.
pub(crate) async fn order_views(
    executor: impl PgExecutor<'_>,
    table_id: TableId,
    positions: &[ViewPosition],
) -> Result<bool, sqlx::Error> {
    let views: Vec<Uuid> = positions
        .iter()
        .map(|placed| placed.view.into_uuid())
        .collect();
    let keys: Vec<String> = positions
        .iter()
        .map(|placed| placed.position.to_string())
        .collect();
    let updated = sqlx::query!(
        r#"
        UPDATE database_views target
        SET position = ordered.position
        FROM UNNEST($2::uuid[], $3::text[]) AS ordered(id, position)
        WHERE target.id = ordered.id AND target.table_id = $1
        "#,
        table_id.into_uuid(),
        &views,
        &keys,
    )
    .execute(executor)
    .await?;
    Ok(updated.rows_affected() == positions.len() as u64)
}

/// Forget where a board's cards were.
pub(crate) async fn clear_positions(
    executor: impl PgExecutor<'_>,
    view_id: ViewId,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        "DELETE FROM database_view_positions WHERE view_id = $1",
        view_id.into_uuid()
    )
    .execute(executor)
    .await?;
    Ok(())
}

/// Store cards' places on a board, each replacing the card's earlier one.
pub(crate) async fn place_cards(
    executor: impl PgExecutor<'_>,
    view_id: ViewId,
    positions: &[CardPosition],
) -> Result<(), sqlx::Error> {
    let rows: Vec<Uuid> = positions
        .iter()
        .map(|placed| placed.row.into_uuid())
        .collect();
    let lanes: Vec<String> = positions
        .iter()
        .map(|placed| stored_lane(&placed.lane))
        .collect();
    let keys: Vec<String> = positions
        .iter()
        .map(|placed| placed.position.to_string())
        .collect();
    sqlx::query!(
        r#"
        INSERT INTO database_view_positions (view_id, row_id, lane, position)
        SELECT $1, row_id, lane, position
        FROM UNNEST($2::uuid[], $3::text[], $4::text[]) AS placed(row_id, lane, position)
        ON CONFLICT (view_id, row_id)
        DO UPDATE SET lane = EXCLUDED.lane, position = EXCLUDED.position
        "#,
        view_id.into_uuid(),
        &rows,
        &lanes,
        &keys,
    )
    .execute(executor)
    .await?;
    Ok(())
}

/// Forget the places cards had in the lane of an option that is gone, on
/// every board of the given tables.
pub(crate) async fn clear_lane(
    executor: impl PgExecutor<'_>,
    table_ids: &[TableId],
    option: OptionId,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"
        DELETE FROM database_view_positions placed
        USING database_views board
        WHERE placed.view_id = board.id AND board.table_id = ANY($1) AND placed.lane = $2
        "#,
        &uuids(table_ids),
        stored_lane(&LaneKey::Option(option)),
    )
    .execute(executor)
    .await?;
    Ok(())
}
