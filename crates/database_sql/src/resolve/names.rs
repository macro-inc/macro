//! Looking names up in the catalog, case-insensitively, with a suggestion
//! when nothing matches. A [`Scope`] is the relations a `SELECT` reads and
//! the keys it hands out for their columns.

use models_databases::{ColumnId, TableId};
use uuid::Uuid;

use crate::catalog::{Catalog, Column, ColumnKind, EntityKind, Table};
use crate::parse::{ColumnRef, FromItem, Identifier, TableName};

use super::{Binding, ResolveError, column_key, row_id_key, row_position_key};

/// The name of a table's row id column.
pub const ROW_ID: &str = "row_id";

/// The name of a table's row position column: the fractional index the
/// table orders its rows by.
pub const ROW_POSITION: &str = "row_position";

/// The columns every table has without declaring them: its row id and its
/// row position. Each stand-in's id is its key. They are not catalog
/// columns, so `SELECT *` and schema listings leave them out.
pub fn virtual_columns(table: TableId) -> [Column; 2] {
    [
        Column {
            id: row_id_key(table),
            placement: ColumnId::from_uuid(row_id_key(table)),
            name: ROW_ID.into(),
            kind: ColumnKind::Entity {
                multi: false,
                target: EntityKind::Row,
            },
        },
        Column {
            id: row_position_key(table),
            placement: ColumnId::from_uuid(row_position_key(table)),
            name: ROW_POSITION.into(),
            kind: ColumnKind::Text,
        },
    ]
}

/// Case-insensitive equality on names.
fn same(left: &str, right: &str) -> bool {
    left.eq_ignore_ascii_case(right)
}

/// The catalog table a statement names.
pub fn table<'catalog>(
    catalog: &'catalog Catalog,
    name: &TableName,
) -> Result<&'catalog Table, ResolveError> {
    let mut matches: Vec<&Table> = catalog
        .tables
        .iter()
        .filter(|table| {
            same(&table.name, &name.table.0)
                && name
                    .database
                    .as_ref()
                    .is_none_or(|database| same(&table.database, &database.0))
        })
        .collect();
    if name.database.is_none()
        && let Some(scope) = catalog.scope
        && matches.iter().any(|table| table.database_id == scope)
    {
        matches.retain(|table| table.database_id == scope);
    }
    // Names match case-insensitively, but when that is ambiguous the exact
    // spelling decides: `Test.Table 1` and `test.Table 1` are different tables.
    let exact: Vec<&Table> = matches
        .iter()
        .copied()
        .filter(|table| {
            table.name == name.table.0
                && name
                    .database
                    .as_ref()
                    .is_none_or(|database| table.database == database.0)
        })
        .collect();
    let matches = if exact.len() == 1 { exact } else { matches };
    match matches.as_slice() {
        [table] => Ok(table),
        [] => Err(ResolveError::UnknownTable {
            name: written(name),
            suggestion: closest(&name.table.0, catalog.tables.iter(), |table| &table.name)
                .map(qualified),
        }),
        several => Err(ResolveError::AmbiguousTable {
            name: name.table.0.clone(),
            databases: several.iter().map(|table| table.database.clone()).collect(),
        }),
    }
}

/// The table name as the statement wrote it.
fn written(name: &TableName) -> String {
    match &name.database {
        Some(database) => format!("{}.{}", database.0, name.table.0),
        None => name.table.0.clone(),
    }
}

/// The qualified name of a catalog table, for messages.
pub fn qualified(table: &Table) -> String {
    format!("{}.{}", table.database, table.name)
}

/// The column a statement names in one table.
pub fn column<'table>(
    table: &'table Table,
    name: &Identifier,
) -> Result<&'table Column, ResolveError> {
    table
        .columns
        .iter()
        .find(|column| same(&column.name, &name.0))
        .ok_or_else(|| ResolveError::UnknownColumn {
            name: name.0.clone(),
            table: qualified(table),
            suggestion: closest(&name.0, table.columns.iter(), |column| &column.name)
                .map(|column| column.name.clone()),
        })
}

/// One relation of a `SELECT`: a table and the alias qualifying its columns.
pub struct ScopeRelation<'catalog> {
    /// The alias: the one written, else the table name.
    pub alias: String,
    /// The table.
    pub table: &'catalog Table,
}

/// The relations a `SELECT` reads, and every key handed out for their
/// columns.
pub struct Scope<'catalog> {
    /// The relations, `FROM` first.
    pub relations: Vec<ScopeRelation<'catalog>>,
    /// Every column bound so far, first use first.
    pub bindings: Vec<Binding>,
}

/// A column reference bound to a relation.
#[derive(Debug, Clone)]
pub struct Bound {
    /// The key later stages use.
    pub key: Uuid,
    /// The relation the column belongs to.
    pub relation: usize,
    /// The column; for `row_id` and `row_position`, a stand-in (see
    /// [`virtual_columns`]).
    pub column: Column,
    /// The property definition; `None` for a stand-in.
    pub definition: Option<Uuid>,
}

impl<'catalog> Scope<'catalog> {
    /// A scope with only the `FROM` table.
    pub fn new(catalog: &'catalog Catalog, from: &FromItem) -> Result<Self, ResolveError> {
        let mut scope = Scope {
            relations: Vec::new(),
            bindings: Vec::new(),
        };
        scope.add(catalog, from)?;
        Ok(scope)
    }

    /// Bring one more table into scope; answers its relation index.
    pub fn add(
        &mut self,
        catalog: &'catalog Catalog,
        item: &FromItem,
    ) -> Result<usize, ResolveError> {
        let table = table(catalog, &item.table)?;
        let alias = item
            .alias
            .as_ref()
            .map_or_else(|| table.name.clone(), |alias| alias.0.clone());
        if let Some(taken) = self
            .relations
            .iter()
            .find(|relation| same(&relation.alias, &alias))
        {
            return Err(ResolveError::DuplicateAlias {
                alias,
                table: qualified(taken.table),
            });
        }
        self.relations.push(ScopeRelation { alias, table });
        Ok(self.relations.len() - 1)
    }

    /// Whether the scope has a single relation.
    pub fn is_single(&self) -> bool {
        self.relations.len() == 1
    }

    /// The column a reference names, recorded in the bindings.
    pub fn column(&mut self, reference: &ColumnRef) -> Result<Bound, ResolveError> {
        let bound = self.lookup(reference)?;
        if !self.bindings.iter().any(|binding| binding.key == bound.key) {
            self.bindings.push(Binding {
                key: bound.key,
                relation: bound.relation,
                column: bound.definition,
            });
        }
        Ok(bound)
    }

    fn lookup(&self, reference: &ColumnRef) -> Result<Bound, ResolveError> {
        let candidates: Vec<usize> = match &reference.table {
            Some(alias) => {
                let index = self
                    .relations
                    .iter()
                    .position(|relation| same(&relation.alias, &alias.0))
                    .ok_or_else(|| ResolveError::UnknownAlias {
                        alias: alias.0.clone(),
                        column: reference.column.0.clone(),
                        relations: self.describe_relations(),
                    })?;
                vec![index]
            }
            None => (0..self.relations.len()).collect(),
        };

        let name = &reference.column.0;
        let found: Vec<Bound> = candidates
            .iter()
            .filter_map(|&index| self.bind(index, name))
            .collect();
        let mut found = found.into_iter();
        match (found.next(), found.next()) {
            (Some(bound), None) => Ok(bound),
            (None, _) => Err(self.unknown_column(&candidates, name)),
            (Some(first), Some(second)) => Err(ResolveError::AmbiguousColumn {
                name: name.clone(),
                qualified: [first, second]
                    .into_iter()
                    .chain(found)
                    .map(|bound| format!("{}.{}", self.relations[bound.relation].alias, name))
                    .collect(),
            }),
        }
    }

    /// The column of that name in one relation, if it has one.
    fn bind(&self, index: usize, name: &str) -> Option<Bound> {
        let table = self.relations[index].table;
        if let Some(column) = virtual_columns(table.id)
            .into_iter()
            .find(|column| same(&column.name, name))
        {
            return Some(Bound {
                key: column.id,
                relation: index,
                column,
                definition: None,
            });
        }
        table
            .columns
            .iter()
            .find(|column| same(&column.name, name))
            .map(|column| Bound {
                key: column_key(index, column.id),
                relation: index,
                column: column.clone(),
                definition: Some(column.id),
            })
    }

    fn unknown_column(&self, candidates: &[usize], name: &str) -> ResolveError {
        let tables: Vec<&Table> = candidates
            .iter()
            .map(|&index| self.relations[index].table)
            .collect();
        ResolveError::UnknownColumn {
            name: name.to_owned(),
            table: tables
                .iter()
                .map(|table| qualified(table))
                .collect::<Vec<_>>()
                .join(" or "),
            suggestion: closest(
                name,
                tables.iter().flat_map(|table| table.columns.iter()),
                |column| &column.name,
            )
            .map(|column| column.name.clone()),
        }
    }

    /// `crm.deals as d` for every relation, for messages.
    pub fn describe_relations(&self) -> Vec<String> {
        self.relations
            .iter()
            .map(|relation| format!("{} as {}", qualified(relation.table), relation.alias))
            .collect()
    }

    /// How a bound column reads in a message: `alias.column` when the scope
    /// has several relations, the bare name otherwise.
    pub fn describe(&self, bound: &Bound) -> String {
        if self.is_single() {
            bound.column.name.clone()
        } else {
            format!(
                "{}.{}",
                self.relations[bound.relation].alias, bound.column.name
            )
        }
    }
}

/// The candidate whose name is within a small edit distance of `name`, if
/// any.
fn closest<'candidate, Candidate>(
    name: &str,
    candidates: impl Iterator<Item = &'candidate Candidate>,
    name_of: impl Fn(&Candidate) -> &str,
) -> Option<&'candidate Candidate> {
    let limit = (name.len() / 3).clamp(1, 3);
    candidates
        .map(|candidate| (edit_distance(name, name_of(candidate)), candidate))
        .filter(|(distance, _)| *distance <= limit)
        .min_by_key(|(distance, _)| *distance)
        .map(|(_, candidate)| candidate)
}

/// Levenshtein distance, case-insensitive.
fn edit_distance(left: &str, right: &str) -> usize {
    let left: Vec<char> = left.to_lowercase().chars().collect();
    let right: Vec<char> = right.to_lowercase().chars().collect();
    let mut previous: Vec<usize> = (0..=right.len()).collect();
    for (left_index, left_character) in left.iter().enumerate() {
        let mut current = vec![left_index + 1];
        for (right_index, right_character) in right.iter().enumerate() {
            let substitution =
                previous[right_index] + usize::from(left_character != right_character);
            current.push(
                substitution
                    .min(previous[right_index + 1] + 1)
                    .min(current[right_index] + 1),
            );
        }
        previous = current;
    }
    previous[right.len()]
}
