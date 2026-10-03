//! Stage three: divide a resolved `SELECT` into what the server answers and
//! what we finish ourselves.
//!
//! Each relation is one server-side query: a table scope plus, when the
//! filter allows it, a `propf` expression the server evaluates with its
//! indexes. Everything Soup cannot express — comparisons on numbers, dates,
//! text and checkboxes, negations (whose `NULL` semantics differ from
//! SQL's), conditions spanning relations, joins, sorting by a column,
//! aggregation, `DISTINCT` — is left in the [`Plan`] for the fold to apply
//! to the rows that come back.
//!
//! Split is total: every resolved query has a plan.

mod propf;
mod pushdown;
#[cfg(test)]
mod test;

use filter_ast::Expr;
use item_filters::ast::properties::PropertiesLiteral;
use models_databases::TableId;
use serde::{Deserialize, Serialize};
use specta::Type;
use uuid::Uuid;

use crate::catalog::{Catalog, Column, ColumnKind, TableSource};
use crate::fold::Cell;
pub use propf::{Propf, PropfLiteral, PropfValue};

use crate::resolve::{
    AggregateFunction, Binding, Filter, JoinKind, Order, OrderKey, Relation, SelectItem,
    SelectQuery, binding,
};

/// A resolved `SELECT`, divided.
#[derive(Debug, Clone, PartialEq)]
pub struct Plan {
    /// One fetch per relation, `FROM` first; the key hints are filled in
    /// by the engine once the earlier relations are in.
    pub relations: Vec<RelationPlan>,
    /// The joins, in statement order.
    pub joins: Vec<JoinPlan>,
    /// The part of `WHERE` no relation's query applied.
    pub residual: Option<Filter>,
    /// Whether repeated result rows are dropped.
    pub distinct: bool,
    /// The shape of the result: plain rows or aggregates.
    pub shape: Shape,
    /// The ordering, applied after `shape`.
    pub order_by: Vec<Order>,
    /// `LIMIT`, applied after ordering.
    pub limit: Option<u32>,
    /// `OFFSET`, applied after ordering.
    pub offset: Option<u32>,
    /// What every key in the plan refers to.
    pub bindings: Vec<Binding>,
}

/// The fetch of one relation.
#[derive(Debug, Clone, PartialEq)]
pub struct RelationPlan {
    /// The table, with the alias its columns are qualified by.
    pub relation: Relation,
    /// What to ask the server.
    pub query: GqlQuery,
    /// The keys whose values the fetched rows must carry for the rest of the
    /// plan to run: selected, aggregated, grouped, sorted on, joined on, or
    /// tested by the residual filter. Pushed-down conditions need nothing
    /// back, and the row id is always carried.
    pub needs: Vec<Uuid>,
}

/// A join to apply in the fold: each `on` pair is (a key of an earlier
/// relation, a key of the joined relation).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct JoinPlan {
    /// The relation joined in.
    pub relation: usize,
    /// Inner or left.
    pub kind: JoinKind,
    /// The equalities, all of which must hold.
    pub on: Vec<(Uuid, Uuid)>,
}

/// Every GraphQL query a plan can send.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum GqlQuery {
    /// `Query.soup` scoped to one table, paged to completion.
    Soup {
        /// The table whose rows are read.
        table: TableId,
        /// The pushed-down part of `WHERE`, as the Soup `propf` expression.
        #[serde(rename = "propf")]
        #[specta(type = Option<Propf>)]
        property_filter: Option<Expr<PropertiesLiteral>>,
        /// For a joined relation, the values the join needs, and for a read
        /// naming its rows by id, those rows; a driver may narrow its fetch
        /// to rows carrying one of them. The fold applies the predicates
        /// regardless, so fetching more is safe.
        key_hint: Option<KeyHint>,
    },
    /// `Query.groupSoup` scoped to one table, for `COUNT(*)` per group of a
    /// select or entity column: the bins' `totalCount` answers the query
    /// without fetching rows.
    GroupSoup {
        /// The table whose rows are counted.
        table: TableId,
        /// The pushed-down part of `WHERE`.
        #[serde(rename = "propf")]
        #[specta(type = Option<Propf>)]
        property_filter: Option<Expr<PropertiesLiteral>>,
        /// The column whose values form the bins.
        group_by: Uuid,
    },
    /// The people the viewer can see, as [`crate::catalog::people_table`]
    /// describes them; `ids` narrows to those users when the join already
    /// knows who it needs.
    People {
        /// The user ids wanted, or every visible person.
        ids: Option<Vec<String>>,
    },
}

/// The most values a [`KeyHint`] carries. Past it a narrowed fetch costs
/// more than it saves, so the joined relation is fetched whole.
pub const MAX_KEY_HINT_VALUES: usize = 100;

/// The values a joined relation is matched on.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct KeyHint {
    /// The property matched; `None` when the row id is.
    pub column: Option<Uuid>,
    /// The values the earlier rows carry, each once, one entity or option
    /// per cell.
    pub values: Vec<Cell>,
}

/// What the result rows look like.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Shape {
    /// One result row per fetched row, with these keys.
    Rows(Vec<Uuid>),
    /// One result row per group (or one row in all, without `GROUP BY`),
    /// with these items.
    Aggregate {
        /// The key grouped on.
        group_by: Option<Uuid>,
        /// The select list, in order.
        items: Vec<SelectItem>,
    },
}

/// Divide a resolved `SELECT`.
pub fn split(catalog: &Catalog, mut query: SelectQuery) -> Plan {
    let relations = query.relations.len();
    let (pushed, residual) = match query.where_.take() {
        Some(filter) => pushdown::divide(filter, &query.bindings, &query.relations, &query.joins),
        None => (vec![None; relations], None),
    };

    let columns: Option<Vec<Uuid>> = query
        .items
        .iter()
        .map(|item| match item {
            SelectItem::Column(key) => Some(*key),
            SelectItem::Aggregate { .. } => None,
        })
        .collect();
    let shape = match (columns, query.group_by) {
        (Some(columns), None) => Shape::Rows(columns),
        _ => Shape::Aggregate {
            group_by: query.group_by,
            items: query.items.clone(),
        },
    };

    // The property `groupSoup` bins on, when its counts answer the query.
    let bins_on = query
        .group_by
        .filter(|group| {
            relations == 1
                && query.relations[0].source == TableSource::Database
                && !query.distinct
                && residual.is_none()
                && query.items.iter().all(|item| {
                    *item == SelectItem::Column(*group)
                        || matches!(
                            item,
                            SelectItem::Aggregate {
                                function: AggregateFunction::Count,
                                column: None
                            }
                        )
                })
        })
        .and_then(|group| server_side_group(catalog, &query.bindings, &query.relations, group));

    let needs = if bins_on.is_some() {
        Vec::new()
    } else {
        needed_keys(
            &query.items,
            query.group_by,
            &query.order_by,
            residual.as_ref(),
            &query.joins,
        )
    };

    let relation_plans = query
        .relations
        .iter()
        .zip(pushed)
        .enumerate()
        .map(|(index, (relation, property_filter))| {
            let query_for_relation = match (relation.source, bins_on) {
                (TableSource::People, _) => GqlQuery::People { ids: None },
                (TableSource::Database, Some(group_by)) => GqlQuery::GroupSoup {
                    table: relation.table,
                    property_filter,
                    group_by,
                },
                (TableSource::Database, None) => GqlQuery::Soup {
                    table: relation.table,
                    property_filter,
                    key_hint: None,
                },
            };
            RelationPlan {
                relation: relation.clone(),
                query: query_for_relation,
                needs: needs
                    .iter()
                    .copied()
                    .filter(|key| {
                        binding(&query.bindings, *key)
                            .is_some_and(|binding| binding.relation == index)
                    })
                    .collect(),
            }
        })
        .collect();

    Plan {
        relations: relation_plans,
        joins: query
            .joins
            .iter()
            .map(|join| JoinPlan {
                relation: join.relation,
                kind: join.kind,
                on: join.on.clone(),
            })
            .collect(),
        residual,
        limit: query.limit,
        offset: query.offset,
        distinct: query.distinct,
        shape,
        order_by: query.order_by,
        bindings: query.bindings,
    }
}

/// The catalog column behind a key, if it is not a row id.
pub fn column_of<'catalog>(
    catalog: &'catalog Catalog,
    bindings: &[Binding],
    relations: &[impl AsRef<Relation>],
    key: Uuid,
) -> Option<&'catalog Column> {
    let binding = binding(bindings, key)?;
    let definition = binding.column?;
    catalog
        .tables
        .iter()
        .find(|table| table.id == relations[binding.relation].as_ref().table)?
        .columns
        .iter()
        .find(|column| column.id == definition)
}

/// The stand-in column behind a key that has no definition: a table's row
/// id or row position.
pub fn virtual_column_of(
    bindings: &[Binding],
    relations: &[Relation],
    key: Uuid,
) -> Option<Column> {
    let binding = binding(bindings, key)?;
    if binding.column.is_some() {
        return None;
    }
    crate::resolve::virtual_column(relations[binding.relation].table, key)
}

impl AsRef<Relation> for RelationPlan {
    fn as_ref(&self) -> &Relation {
        &self.relation
    }
}

impl Plan {
    /// The catalog column behind a key, if it is not a row id.
    pub fn column<'catalog>(
        &self,
        catalog: &'catalog Catalog,
        key: Uuid,
    ) -> Option<&'catalog Column> {
        column_of(catalog, &self.bindings, &self.relations, key)
    }

    /// The `FROM` table.
    pub fn table(&self) -> TableId {
        self.relations[0].relation.table
    }
}

/// The property `groupSoup` can bin on for the key: only select and entity values of
/// a database table are indexed as facts, and only a single-valued cell
/// lands in exactly one bin (Soup bins a multi-valued cell once per member,
/// where SQL groups by the whole cell).
fn server_side_group(
    catalog: &Catalog,
    bindings: &[Binding],
    relations: &[Relation],
    key: Uuid,
) -> Option<Uuid> {
    column_of(catalog, bindings, relations, key)
        .filter(|column| {
            matches!(
                column.kind,
                ColumnKind::Select { multi: false, .. } | ColumnKind::Entity { multi: false, .. }
            )
        })
        .map(|column| column.id)
}

/// Every key the fold reads, first use first, no repeats.
fn needed_keys(
    items: &[SelectItem],
    group_by: Option<Uuid>,
    order_by: &[Order],
    residual: Option<&Filter>,
    joins: &[crate::resolve::ResolvedJoin],
) -> Vec<Uuid> {
    let mut needs = Vec::new();
    let mut need = |key: Uuid| {
        if !needs.contains(&key) {
            needs.push(key);
        }
    };
    for item in items {
        match item {
            SelectItem::Column(key) => need(*key),
            SelectItem::Aggregate {
                column: Some(key), ..
            } => need(*key),
            SelectItem::Aggregate { column: None, .. } => {}
        }
    }
    if let Some(key) = group_by {
        need(key);
    }
    for order in order_by {
        if let OrderKey::Column(key) = order.key {
            need(key);
        }
    }
    if let Some(filter) = residual {
        filter.for_each_column(&mut need);
    }
    for join in joins {
        for (left, right) in &join.on {
            need(*left);
            need(*right);
        }
    }
    needs
}

impl Filter {
    /// Visit every key the filter tests, in source order.
    pub fn for_each_column(&self, visit: &mut impl FnMut(Uuid)) {
        match self {
            Filter::Comparison { column, .. }
            | Filter::In { column, .. }
            | Filter::Has { column, .. }
            | Filter::IsNull { column, .. }
            | Filter::Like { column, .. } => visit(*column),
            Filter::And(parts) | Filter::Or(parts) => {
                for part in parts {
                    part.for_each_column(visit);
                }
            }
        }
    }
}
