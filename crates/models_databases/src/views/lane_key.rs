//! Which lane of a board a card is in: the one rule from a grouping cell to
//! its lane, and from a lane to the cell a card moved there gets.

use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};

use crate::ids::OptionId;
use crate::ops::{CellValue, EntityKind, EntityRef, OptionRef};

/// A lane of a board, named by what its cards' grouping cells hold: one
/// option of a select, one person, or nothing.
#[derive(
    Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, utoipa::ToSchema, specta::Type,
)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[serde(tag = "kind", content = "id", rename_all = "snake_case")]
pub enum LaneKey {
    /// The cards holding this option of the board's select column.
    #[schema(value_type = Uuid)]
    Option(OptionId),
    /// The cards naming this person in the board's person column.
    #[schema(value_type = String)]
    User(
        #[specta(type = String)]
        #[cfg_attr(feature = "schema", schemars(with = "String"))]
        MacroUserIdStr<'static>,
    ),
    /// The cards whose grouping cell is empty.
    None,
}

impl LaneKey {
    /// The lane of the person an entity id names; a reference that is not
    /// a Macro user id names no one, so its card is in the empty lane.
    pub fn person(entity_id: &str) -> LaneKey {
        MacroUserIdStr::try_from(entity_id.to_string())
            .map(LaneKey::User)
            .unwrap_or(LaneKey::None)
    }

    /// The lane a grouping cell puts its card in. A board groups by a
    /// single-valued column, so only the cell's first value counts.
    pub fn of_cell(cell: Option<&CellValue>) -> LaneKey {
        match cell {
            Some(CellValue::Options(options)) => match options.first() {
                Some(OptionRef::Id(option)) => LaneKey::Option(*option),
                Some(OptionRef::Label(_)) | None => LaneKey::None,
            },
            Some(CellValue::Entities(references)) => match references.first() {
                Some(reference) if reference.entity_type == EntityKind::User => {
                    LaneKey::person(&reference.entity_id)
                }
                _ => LaneKey::None,
            },
            _ => LaneKey::None,
        }
    }

    /// The grouping cell of a card moved into the lane.
    pub fn cell(&self) -> CellValue {
        match self {
            LaneKey::Option(option) => CellValue::Options(vec![OptionRef::Id(*option)]),
            LaneKey::User(user) => CellValue::Entities(vec![EntityRef {
                entity_type: EntityKind::User,
                entity_id: user.to_string(),
            }]),
            LaneKey::None => CellValue::Clear,
        }
    }
}
