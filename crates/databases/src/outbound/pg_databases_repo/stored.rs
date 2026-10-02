//! What earlier builds stored, read into today's model. A board stored
//! before boards named a card title has none; a lane stored before people
//! grouped boards names its option, or `null` for the lane of empty cells,
//! as `option`; and a card move the journal kept from then names its lane
//! the same way. The model stays strict: the leniency lives here, where
//! stored rows are read.

#[cfg(test)]
mod test;

use models_databases::views::{Lane, LaneKey, ViewColumn, ViewLayout};
use models_databases::{ColumnId, DatabaseOp, OptionId};
use serde::Deserialize;
use serde_json::Value;

use super::PgDatabasesRepoError;
use crate::domain::journal::ChangeInverse;
use crate::domain::models::ViewId;

/// A view's layout as any build stored it.
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum StoredLayout {
    Table {
        columns: Vec<ViewColumn>,
    },
    #[serde(rename_all = "camelCase")]
    Board {
        group_by: ColumnId,
        #[serde(default)]
        title: Option<ColumnId>,
        lanes: Vec<StoredLane>,
        card_fields: Vec<ColumnId>,
        hide_empty_lanes: bool,
    },
}

/// A board's lane as any build stored it.
#[derive(Deserialize)]
#[serde(untagged)]
enum StoredLane {
    Keyed(Lane),
    BeforePeople {
        option: Option<OptionId>,
        #[serde(default)]
        hidden: bool,
    },
}

/// A card move's lane as any build stored it.
#[derive(Deserialize)]
#[serde(untagged)]
enum StoredLaneKey {
    Keyed(LaneKey),
    BeforePeople(Option<OptionId>),
}

fn option_lane(option: Option<OptionId>) -> LaneKey {
    option.map_or(LaneKey::None, LaneKey::Option)
}

impl From<StoredLane> for Lane {
    fn from(stored: StoredLane) -> Self {
        match stored {
            StoredLane::Keyed(lane) => lane,
            StoredLane::BeforePeople { option, hidden } => Lane {
                key: option_lane(option),
                hidden,
            },
        }
    }
}

impl From<StoredLaneKey> for LaneKey {
    fn from(stored: StoredLaneKey) -> Self {
        match stored {
            StoredLaneKey::Keyed(lane) => lane,
            StoredLaneKey::BeforePeople(option) => option_lane(option),
        }
    }
}

/// A stored view's layout. A board stored without a card title is titled
/// by `first_column`, its table's first column, as a new board is.
pub(super) fn layout(
    stored: Value,
    view: ViewId,
    first_column: Option<ColumnId>,
) -> Result<ViewLayout, PgDatabasesRepoError> {
    Ok(match serde_json::from_value(stored)? {
        StoredLayout::Table { columns } => ViewLayout::Table { columns },
        StoredLayout::Board {
            group_by,
            title,
            lanes,
            card_fields,
            hide_empty_lanes,
        } => ViewLayout::Board {
            group_by,
            title: title
                .or(first_column)
                .ok_or(PgDatabasesRepoError::UntitledBoard(view))?,
            lanes: lanes.into_iter().map(Lane::from).collect(),
            card_fields,
            hide_empty_lanes,
        },
    })
}

/// A journaled change's ops.
pub(super) fn ops(mut stored: Value) -> Result<Vec<DatabaseOp>, PgDatabasesRepoError> {
    upgrade_lanes(&mut stored)?;
    Ok(serde_json::from_value(stored)?)
}

/// What undoes a journaled change.
pub(super) fn inverse(mut stored: Value) -> Result<ChangeInverse, PgDatabasesRepoError> {
    upgrade_lanes(&mut stored)?;
    Ok(serde_json::from_value(stored)?)
}

/// Rewrite every lane in a stored journal entry in today's shape: each lane
/// a board layout lists, and each card move's lane.
fn upgrade_lanes(value: &mut Value) -> Result<(), serde_json::Error> {
    match value {
        Value::Object(fields) => {
            if fields.get("kind").and_then(Value::as_str) == Some("move_card")
                && let Some(lane) = fields.get_mut("lane")
            {
                let stored: StoredLaneKey = serde_json::from_value(lane.take())?;
                *lane = serde_json::to_value(LaneKey::from(stored))?;
            }
            if let Some(Value::Array(lanes)) = fields.get_mut("lanes") {
                for lane in lanes.iter_mut() {
                    let stored: StoredLane = serde_json::from_value(lane.take())?;
                    *lane = serde_json::to_value(Lane::from(stored))?;
                }
            }
            for field in fields.values_mut() {
                upgrade_lanes(field)?;
            }
        }
        Value::Array(items) => {
            for item in items {
                upgrade_lanes(item)?;
            }
        }
        _ => {}
    }
    Ok(())
}
