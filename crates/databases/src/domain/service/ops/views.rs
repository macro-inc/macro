//! The view ops: creating, changing, removing and ordering views, and moving
//! a board's cards, each checked against what earlier ops leave.

use std::collections::{HashMap, HashSet};

use models_databases::position::{key_between, keys_between};
use models_databases::views::{
    CardPosition, DatabaseView, LaneKey, NewView, RequestedLayout, SchemaColumn, ViewId,
    ViewLayout, ViewPosition, ViewQuery, arrange_lane, check, check_lane, place_card,
};
use models_databases::{ColumnId, OptionId, TakenId, ViewChange};
use models_properties::service::property_value::PropertyValue;

use super::{Place, Planner, refuse, refuse_taken};
use crate::domain::catalog::{StorageTable, storage_schema_columns};
use crate::domain::journal::cell_value;
use crate::domain::models::{DatabaseError, Position, PropertyDefinitionId, RowId, TableId, Write};
use crate::domain::service::{same_name, validate_name};

/// Where one board's cards are: each row of its table with its lane (the
/// option or person its grouping cell holds) and, when it was placed in
/// that lane, its key there.
#[derive(Debug, Clone)]
pub(super) struct Board {
    /// The definition of the column the board was loaded grouped by.
    pub(super) grouping: PropertyDefinitionId,
    pub(super) cards: HashMap<RowId, (LaneKey, Option<Position>)>,
}

impl Board {
    /// A board's cards from its table's rows, their grouping cells, and the
    /// places stored for it. A place stored for another lane than the row's
    /// is no place: the row has moved since.
    pub(super) fn new(
        grouping: PropertyDefinitionId,
        rows: &[RowId],
        cells: &HashMap<RowId, PropertyValue>,
        positions: &[CardPosition],
    ) -> Self {
        let cards = rows
            .iter()
            .map(|row| {
                let lane = LaneKey::of_cell(cells.get(row).and_then(cell_value).as_ref());
                let position = positions
                    .iter()
                    .find(|placed| placed.row == *row && placed.lane == lane)
                    .map(|placed| placed.position.clone());
                (*row, (lane, position))
            })
            .collect();
        Self { grouping, cards }
    }

    /// One lane's cards other than `except`, in board order.
    fn lane(&self, lane: &LaneKey, except: RowId) -> Vec<(RowId, Option<Position>)> {
        let mut cards: Vec<(RowId, Option<Position>)> = self
            .cards
            .iter()
            .filter(|(row, (card_lane, _))| **row != except && card_lane == lane)
            .map(|(row, (_, position))| (*row, position.clone()))
            .collect();
        arrange_lane(&mut cards);
        cards
    }
}

/// What a `MoveCard` asks: which card goes to which lane, next to which
/// neighbour.
struct CardMove {
    row: RowId,
    lane: LaneKey,
    before: Option<RowId>,
    after: Option<RowId>,
}

impl Planner {
    /// A view change; a creation names a view that does not exist yet, so
    /// only the others need the view.
    pub(super) fn view_write(
        &mut self,
        index: usize,
        entry: &StorageTable,
        id: ViewId,
        change: &ViewChange,
    ) -> Result<Write, DatabaseError> {
        let table = entry.table.id;
        let current = self.view(index, entry, id).cloned();
        match change {
            ViewChange::Create { view } => {
                if self.view_id_taken(id) {
                    return Err(refuse_taken(index, TakenId::View(id)));
                }
                let NewView {
                    name,
                    query,
                    layout,
                } = view;
                let name = self.view_name(index, entry, None, name)?;
                let layout = stored_layout(index, entry, layout, None)?;
                self.check_view(index, entry, query, &layout)?;
                let now = self.now;
                let views = self.views_of(entry);
                let position = key_between(views.last().map(|view| &view.position), None)
                    .map_err(|error| refuse(index, None, None, error.to_string()))?;
                let view = DatabaseView {
                    id,
                    database_id: entry.table.database_id,
                    table_id: table,
                    name,
                    position,
                    query: query.clone(),
                    layout,
                    created_at: now,
                    updated_at: now,
                };
                views.push(view.clone());
                Ok(Write::CreateView { view })
            }
            ViewChange::Update {
                name,
                query,
                layout,
            } => {
                let current = current?;
                let name = match name {
                    Some(name) => self.view_name(index, entry, Some(id), name)?,
                    None => current.name.clone(),
                };
                let query = query.clone().unwrap_or_else(|| current.query.clone());
                let layout = match layout {
                    Some(layout) => stored_layout(index, entry, layout, current.layout.title())?,
                    None => current.layout.clone(),
                };
                self.check_view(index, entry, &query, &layout)?;
                let regrouped = current.layout.group_by() != layout.group_by();
                let view = DatabaseView {
                    name,
                    query,
                    layout,
                    updated_at: self.now,
                    ..current
                };
                self.replace_view(entry, view.clone());
                Ok(Write::UpdateView { view, regrouped })
            }
            ViewChange::Delete => {
                current?;
                self.views_of(entry).retain(|view| view.id != id);
                Ok(Write::DeleteView {
                    table_id: table,
                    view_id: id,
                })
            }
            ViewChange::MoveCard {
                row,
                lane,
                before,
                after,
            } => self.move_card(
                index,
                entry,
                current?,
                CardMove {
                    row: *row,
                    lane: lane.clone(),
                    before: *before,
                    after: *after,
                },
            ),
        }
    }

    pub(super) fn order_views(
        &mut self,
        index: usize,
        entry: &StorageTable,
        order: &[ViewId],
    ) -> Result<Write, DatabaseError> {
        let views = self.views_of(entry);
        let current: HashSet<ViewId> = views.iter().map(|view| view.id).collect();
        let named: HashSet<ViewId> = order.iter().copied().collect();
        if named.len() != order.len() || named != current {
            return Err(refuse(
                index,
                None,
                None,
                "the order must name every view of this table exactly once",
            ));
        }
        let keys = keys_between(None, None, order.len())
            .map_err(|error| refuse(index, None, None, error.to_string()))?;
        let positions: Vec<ViewPosition> = order
            .iter()
            .zip(keys)
            .map(|(view, position)| ViewPosition {
                view: *view,
                position,
            })
            .collect();
        for view in views.iter_mut() {
            if let Some(placed) = positions.iter().find(|placed| placed.view == view.id) {
                view.position = placed.position.clone();
            }
        }
        views.sort_by(|left, right| left.position.cmp(&right.position));
        Ok(Write::OrderViews {
            table_id: entry.table.id,
            positions,
        })
    }

    /// Whether a view of any of the database's tables, as the ops so far
    /// leave them, goes by `id`.
    fn view_id_taken(&self, id: ViewId) -> bool {
        self.entries.iter().any(|entry| {
            self.views
                .get(&entry.table.id)
                .unwrap_or(&entry.views)
                .iter()
                .any(|view| view.id == id)
        })
    }

    fn move_card(
        &mut self,
        index: usize,
        entry: &StorageTable,
        board: DatabaseView,
        CardMove {
            row,
            lane,
            before,
            after,
        }: CardMove,
    ) -> Result<Write, DatabaseError> {
        let view = board.id;
        let ViewLayout::Board { group_by, .. } = board.layout else {
            return Err(refuse(
                index,
                None,
                None,
                format!(
                    "\"{}\" is a table view; only a board's cards move",
                    board.name
                ),
            ));
        };
        if !board.query.sort.is_empty() {
            return Err(refuse(
                index,
                None,
                None,
                format!(
                    "\"{}\" is sorted, so its cards keep the sort's order; remove the sort to \
                     arrange them by hand",
                    board.name
                ),
            ));
        }
        let column = entry
            .columns
            .iter()
            .find(|column| column.column.id == group_by)
            .ok_or_else(|| refuse(index, None, Some(group_by), "no such column in this table"))?;
        let grouping = self
            .schema_of(entry)
            .into_iter()
            .find(|schema| schema.id == group_by)
            .ok_or_else(|| refuse(index, None, Some(group_by), "no such column in this table"))?;
        check_lane(&grouping, &lane)
            .map_err(|problem| refuse(index, None, Some(group_by), problem.to_string()))?;
        let cell = self.value(
            Place {
                op: index,
                row: None,
                column: group_by,
            },
            column,
            &lane.cell(),
        )?;
        if !column.column.nullable && cell.is_none() {
            return Err(refuse(
                index,
                None,
                Some(group_by),
                "the required column needs a value",
            ));
        }
        let definition = column.definition.definition.id;
        let state = self
            .boards
            .get_mut(&view)
            .filter(|state| state.grouping == definition)
            .ok_or_else(|| {
                refuse(
                    index,
                    None,
                    None,
                    "the board was regrouped by this request; move its cards in another",
                )
            })?;
        if !state.cards.contains_key(&row) {
            return Err(refuse(
                index,
                None,
                None,
                format!("no row {row} in this table"),
            ));
        }
        let placed = place_card(&state.lane(&lane, row), row, before, after)
            .map_err(|error| refuse(index, None, None, error.to_string()))?;
        let positions: Vec<CardPosition> = placed
            .into_iter()
            .map(|(card, position)| {
                state
                    .cards
                    .insert(card, (lane.clone(), Some(position.clone())));
                CardPosition {
                    row: card,
                    lane: lane.clone(),
                    position,
                }
            })
            .collect();
        Ok(Write::MoveCard {
            table_id: entry.table.id,
            view_id: view,
            row,
            positions,
            cell: (definition, cell),
        })
    }

    /// The views of a table as the ops so far leave them, in their order.
    pub(super) fn views_of(&mut self, entry: &StorageTable) -> &mut Vec<DatabaseView> {
        self.views
            .entry(entry.table.id)
            .or_insert_with(|| entry.views.clone())
    }

    fn view(
        &mut self,
        index: usize,
        entry: &StorageTable,
        id: ViewId,
    ) -> Result<&DatabaseView, DatabaseError> {
        self.views_of(entry)
            .iter()
            .find(|view| view.id == id)
            .ok_or_else(|| refuse(index, None, None, format!("no view {id} on this table")))
    }

    fn replace_view(&mut self, entry: &StorageTable, view: DatabaseView) {
        if let Some(current) = self
            .views_of(entry)
            .iter_mut()
            .find(|current| current.id == view.id)
        {
            *current = view;
        }
    }

    /// A view's name, trimmed, checked to be unique among the table's other
    /// views ignoring case.
    fn view_name(
        &mut self,
        index: usize,
        entry: &StorageTable,
        view: Option<ViewId>,
        name: &str,
    ) -> Result<String, DatabaseError> {
        let name = validate_name(name).map_err(|error| match error {
            DatabaseError::InvalidSchemaOperation(reason) => {
                refuse(index, None, None, format!("a view's {reason}"))
            }
            other => other,
        })?;
        if self
            .views_of(entry)
            .iter()
            .any(|other| Some(other.id) != view && same_name(&other.name, &name))
        {
            return Err(refuse(
                index,
                None,
                None,
                format!("a view named `{name}` already exists on this table"),
            ));
        }
        Ok(name)
    }

    /// Check a view against its table, with the options the ops so far
    /// leave its columns.
    fn check_view(
        &mut self,
        index: usize,
        entry: &StorageTable,
        query: &ViewQuery,
        layout: &ViewLayout,
    ) -> Result<(), DatabaseError> {
        let columns = self.schema_of(entry);
        check(query, layout, &columns)
            .map_err(|problem| refuse(index, None, None, problem.to_string()))
    }

    /// A table's columns as a view's checks see them, with the options the
    /// ops so far leave them.
    fn schema_of(&mut self, entry: &StorageTable) -> Vec<SchemaColumn> {
        let mut columns = storage_schema_columns(&entry.columns);
        for (column, schema) in entry.columns.iter().zip(&mut columns) {
            if !schema.options.is_empty() || column.takes_options() {
                schema.options = self
                    .labels_of(&column.definition)
                    .iter()
                    .map(|(id, _)| *id)
                    .collect();
            }
        }
        columns
    }

    /// The views of the tables binding `definition` that name `option`,
    /// without it, as the ops so far leave them.
    pub(super) fn views_without_option(
        &mut self,
        tables: &[TableId],
        definition: PropertyDefinitionId,
        option: OptionId,
    ) -> Vec<DatabaseView> {
        let entries = self.entries.clone();
        let mut rewritten = Vec::new();
        for entry in entries
            .iter()
            .filter(|entry| tables.contains(&entry.table.id))
        {
            let Some(column) = entry.column_for(definition).map(|column| column.column.id) else {
                continue;
            };
            let now = self.now;
            for view in self.views_of(entry).iter_mut() {
                let query = view.query.without_option(column, option);
                let layout = view.layout.without_option(column, option);
                if query != view.query || layout != view.layout {
                    view.query = query;
                    view.layout = layout;
                    view.updated_at = now;
                    rewritten.push(view.clone());
                }
            }
        }
        rewritten
    }
}

/// The layout an op asks for, as stored: a board without a card title keeps
/// `current_title`, or takes the table's first column.
fn stored_layout(
    index: usize,
    entry: &StorageTable,
    layout: &RequestedLayout,
    current_title: Option<ColumnId>,
) -> Result<ViewLayout, DatabaseError> {
    let first_column = entry.columns.first().map(|column| column.column.id);
    layout
        .clone()
        .with_default_title(current_title.or(first_column))
        .ok_or_else(|| {
            refuse(
                index,
                None,
                None,
                "the table has no column to title a board's cards by",
            )
        })
}
