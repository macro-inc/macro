//! The order of a board's lanes when its view is not sorted, and where a
//! moved card lands: one rule, for the board the browser draws and the moves
//! the server applies.

use std::cmp::Ordering;

use crate::ids::RowId;
use crate::position::{Position, PositionError, key_between, keys_between};

/// Put one lane's cards, each with its position in the lane if it has one,
/// in the order the board shows them: cards with a position by it, then the
/// rest by row id, which is creation order because row ids are minted in
/// time order.
pub fn arrange_lane(cards: &mut [(RowId, Option<Position>)]) {
    cards.sort_by(|(left_row, left), (right_row, right)| match (left, right) {
        (Some(left), Some(right)) => left.cmp(right).then(left_row.cmp(right_row)),
        (Some(_), None) => Ordering::Less,
        (None, Some(_)) => Ordering::Greater,
        (None, None) => left_row.cmp(right_row),
    });
}

/// Why a card could not be placed.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum PlacementError {
    /// A neighbour named is not a card of the lane.
    #[error("row {0} is not a card of that lane")]
    NotInLane(RowId),
    /// Both neighbours were named but `after` is not the card right after
    /// `before`, so there is no place between them.
    #[error("row {after} is not the card right after row {before}")]
    NotAdjacent {
        /// The card named to precede the moved one.
        before: RowId,
        /// The card named to follow it.
        after: RowId,
    },
    /// The lane's positions could not be extended.
    #[error(transparent)]
    Position(#[from] PositionError),
}

/// The positions to store so `card` lands right after `before` and right
/// before `after`; either may be left out, and with neither it goes to the
/// end of `lane`. Both named must be adjacent. The lane is in board order
/// without the card. Only a card with a position can
/// sit before one without, so landing after cards that have none gives them
/// positions too, in their current order, before the card's own; the card's
/// is always last.
pub fn place_card(
    lane: &[(RowId, Option<Position>)],
    card: RowId,
    before: Option<RowId>,
    after: Option<RowId>,
) -> Result<Vec<(RowId, Position)>, PlacementError> {
    let index_of = |row: RowId| {
        lane.iter()
            .position(|(card, _)| *card == row)
            .ok_or(PlacementError::NotInLane(row))
    };
    let index = match (before, after) {
        (Some(before), Some(after)) => {
            let index = index_of(before)? + 1;
            if index_of(after)? != index {
                return Err(PlacementError::NotAdjacent { before, after });
            }
            index
        }
        (Some(before), None) => index_of(before)? + 1,
        (None, Some(after)) => index_of(after)?,
        (None, None) => lane.len(),
    };
    let positioned = lane
        .iter()
        .take_while(|(_, position)| position.is_some())
        .count();
    let position_at = |index: usize| lane[index].1.as_ref();
    if index <= positioned {
        let lower = index.checked_sub(1).and_then(position_at);
        let upper = (index < positioned).then(|| position_at(index)).flatten();
        return Ok(vec![(card, key_between(lower, upper)?)]);
    }
    let lower = positioned.checked_sub(1).and_then(position_at);
    let rows = lane[positioned..index]
        .iter()
        .map(|(row, _)| *row)
        .chain(std::iter::once(card));
    let keys = keys_between(lower, None, index - positioned + 1)?;
    Ok(rows.zip(keys).collect())
}
