//! A board view's rows as cards in lanes.

#[cfg(test)]
mod test;

use models_databases::RowId;
use models_databases::position::Position;
use models_databases::views::{
    CardPosition, DatabaseView, Lane, LaneKey, ViewLayout, ViewProblem, arrange_lane,
};
use serde::{Deserialize, Serialize};
use specta::Type;

use crate::catalog::{Catalog, ColumnKind};
use crate::fold::Cell;
use crate::run::Outcome;

use super::{checked_table, placed};

/// A board's lanes in display order, every lane included.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Board {
    /// The lanes, in display order.
    pub lanes: Vec<BoardLane>,
}

/// One lane and its cards.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BoardLane {
    /// The lane: an option, a person, or the lane of empty cells.
    pub key: LaneKey,
    /// Whether the lane is hidden: by the layout, or for being empty.
    pub hidden: bool,
    /// The cards' rows, in display order.
    pub cards: Vec<RowId>,
}

/// Lay out the rows `outcome` holds (what running
/// [`compile_view`](super::compile_view)'s query produced) as the view's
/// board, ordering unsorted lanes by the stored `positions`.
pub fn board(
    view: &DatabaseView,
    catalog: &Catalog,
    outcome: &Outcome,
    positions: &[CardPosition],
) -> Result<Board, ViewProblem> {
    let table = checked_table(view, catalog)?;
    let ViewLayout::Board {
        group_by,
        lanes: listed,
        hide_empty_lanes,
        ..
    } = &view.layout
    else {
        return Err(ViewProblem::NotABoard);
    };
    let grouping = placed(table, *group_by);
    let cell_index = outcome
        .columns
        .iter()
        .position(|column| column.column == Some(grouping.id))
        .ok_or(ViewProblem::UnknownColumn { column: *group_by })?;
    let card_lanes: Vec<LaneKey> = outcome
        .rows
        .iter()
        .map(|cells| lane_of(cells.get(cell_index).and_then(Option::as_ref)))
        .collect();

    let order = lane_order(&grouping.kind, listed, &card_lanes);
    let mut cards: Vec<Vec<RowId>> = vec![Vec::new(); order.len()];
    for (row, lane) in outcome.row_ids.iter().zip(&card_lanes) {
        let lane = order
            .iter()
            .position(|key| key == lane)
            .or_else(|| order.iter().position(|key| *key == LaneKey::None))
            .expect("every board has the lane of empty cells");
        cards[lane].push(*row);
    }

    let sorted = !view.query.sort.is_empty();
    let lanes = order
        .into_iter()
        .zip(cards)
        .map(|(key, cards)| {
            let cards = if sorted {
                cards
            } else {
                arranged(&key, cards, positions)
            };
            let hidden_by_layout = listed.iter().any(|lane| lane.key == key && lane.hidden);
            BoardLane {
                key,
                hidden: hidden_by_layout || (*hide_empty_lanes && cards.is_empty()),
                cards,
            }
        })
        .collect();
    Ok(Board { lanes })
}

/// One lane's cards in hand-arranged order. A stored position counts only
/// in the lane it was stored for: a card whose cell has since changed has no
/// place in its new lane yet.
fn arranged(lane: &LaneKey, cards: Vec<RowId>, positions: &[CardPosition]) -> Vec<RowId> {
    let mut placed: Vec<(RowId, Option<Position>)> = cards
        .into_iter()
        .map(|row| {
            let position = positions
                .iter()
                .find(|stored| stored.row == row && stored.lane == *lane)
                .map(|stored| stored.position.clone());
            (row, position)
        })
        .collect();
    arrange_lane(&mut placed);
    placed.into_iter().map(|(row, _)| row).collect()
}

/// The lane a card's grouping cell puts it in: a single select's one
/// option, a single person column's one person, or the lane of empty cells.
fn lane_of(cell: Option<&Cell>) -> LaneKey {
    match cell {
        Some(Cell::Options(options)) => match options.as_slice() {
            [only] => LaneKey::Option(*only),
            _ => LaneKey::None,
        },
        Some(Cell::Entities(references)) => match references.as_slice() {
            [only] => LaneKey::person(only),
            _ => LaneKey::None,
        },
        _ => LaneKey::None,
    }
}

/// Every lane of the board in display order: the listed lanes first, then
/// the lane of empty cells, then a select's options in the column's order,
/// or the people the cards name by id. A person's lane shows only while a
/// card names them, listed or not.
fn lane_order(grouping: &ColumnKind, listed: &[Lane], card_lanes: &[LaneKey]) -> Vec<LaneKey> {
    let lanes: Vec<LaneKey> = match grouping {
        ColumnKind::Select { options, .. } => std::iter::once(LaneKey::None)
            .chain(options.iter().map(|option| LaneKey::Option(option.id)))
            .collect(),
        _ => {
            let mut people: Vec<String> = card_lanes
                .iter()
                .filter_map(|lane| match lane {
                    LaneKey::User(user) => Some(user.to_string()),
                    LaneKey::Option(_) | LaneKey::None => None,
                })
                .collect();
            people.sort();
            people.dedup();
            std::iter::once(LaneKey::None)
                .chain(people.iter().map(|person| LaneKey::person(person)))
                .collect()
        }
    };
    let mut order: Vec<LaneKey> = listed
        .iter()
        .map(|lane| lane.key.clone())
        .filter(|key| lanes.contains(key))
        .collect();
    let unlisted: Vec<LaneKey> = lanes
        .into_iter()
        .filter(|lane| !order.contains(lane))
        .collect();
    order.extend(unlisted);
    order
}
