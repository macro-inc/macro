//! Parameterized SQLite/Turso execution of the read-only `macro.people` relation.
//! The adapter supplies `__people`, an authorized on-disk projection. SQL text
//! cannot name physical cache tables or choose an account.

use crate::{
    catalog::{self, Catalog, PEOPLE_EMAIL, PEOPLE_ID, PEOPLE_NAME, TableSource},
    fold::{Cell, normalized_like},
    resolve::{
        self, AggregateFunction, ComparisonOperator, Direction, Filter, OrderKey, SelectItem,
        SelectQuery, Value, row_id_key, row_position_key,
    },
    run::{Outcome, OutcomeColumn, RunError, result_columns},
};
use models_databases::{MAX_STATEMENT_LENGTH, RowId};
use std::collections::BTreeSet;
use uuid::Uuid;

/// A statement cannot be executed by the local people relation, or a storage
/// adapter supplied a result that violates its contract.
#[derive(Debug, thiserror::Error)]
pub enum PeopleSqlError {
    /// The shared SQL compiler rejected the statement.
    #[error(transparent)]
    Engine(#[from] RunError),
    /// This capability cannot safely answer the request.
    #[error("{0}")]
    Unsupported(&'static str),
}

/// Maximum UTF-8 statement bytes accepted by the shared SQL grammar.
pub const MAX_PEOPLE_SQL_TEXT_BYTES: usize = MAX_STATEMENT_LENGTH;
/// Maximum materialized result window, independent of directory size.
pub const MAX_PEOPLE_SQL_ROWS: usize = 500;
/// Maximum select-list width, including repeated columns.
pub const MAX_PEOPLE_SQL_COLUMNS: usize = 64;
/// Maximum retained scalar text in one result window.
pub const MAX_PEOPLE_SQL_BYTES: usize = 512 * 1024;
/// Largest explicit identity set accepted by the local lookup entry point.
pub const MAX_PEOPLE_SQL_IDS: usize = 500;

/// A bound value, never interpolated SQL.
#[derive(Clone, Debug, PartialEq)]
pub enum SqlParameter {
    /// UTF-8 text.
    Text(String),
    /// UTF-8 exact fact, compared and ordered as bytes.
    Bytes(Vec<u8>),
    /// Integer window bound.
    Integer(i64),
}

/// A scalar read from SQLite. No normalized records cross this boundary.
#[derive(Clone, Debug, PartialEq)]
pub enum SqlScalar {
    /// SQL NULL.
    Null,
    /// UTF-8 value.
    Text(String),
    /// COUNT result.
    Integer(i64),
}

#[derive(Clone, Copy)]
enum Field {
    Id,
    Name,
    Email,
    RowId,
    Position,
}
impl Field {
    fn sql(self) -> &'static str {
        match self {
            Self::Id => "id",
            Self::Name => "name",
            Self::Email => "email",
            Self::RowId => "row_id",
            Self::Position => "row_position",
        }
    }
    fn lowered(self) -> &'static str {
        match self {
            Self::Name => "name_lower",
            Self::Email => "email_lower",
            _ => self.sql(),
        }
    }
}

/// Compiled executable text with private construction: only validated SELECTs
/// over the canonical people catalog can reach the storage adapter.
#[derive(Clone, Debug)]
pub struct PeopleSqlPlan {
    sql: String,
    parameters: Vec<SqlParameter>,
    attributes: BTreeSet<&'static str>,
    columns: Vec<OutcomeColumn>,
    origin: bool,
    limit: usize,
    capped: bool,
}

impl PeopleSqlPlan {
    /// Compile against the canonical people table. Unsupported joins fail
    /// explicitly; no caller may substitute an unfiltered directory scan.
    pub fn compile(sql: &str) -> Result<Self, PeopleSqlError> {
        if sql.len() > MAX_STATEMENT_LENGTH {
            return Err(invalid("people SQL exceeds its text bound"));
        }
        if crate::parse::parse_schema(sql)
            .map_err(RunError::Parse)?
            .is_some()
        {
            return Err(RunError::ReadOnly.into());
        }
        let catalog = Catalog {
            scope: None,
            tables: vec![catalog::people_table()],
        };
        let resolve::Query::Select(query) =
            resolve::compile(&catalog, sql).map_err(RunError::from)?
        else {
            return Err(RunError::ReadOnly.into());
        };
        Self::select(&catalog, query)
    }

    /// Exact identities needed by a bounded join. Empty means no people, not all.
    pub fn identities(ids: &[String]) -> Result<Self, PeopleSqlError> {
        if ids.len() > MAX_PEOPLE_SQL_IDS || ids.iter().any(|id| id.len() > 1024) {
            return Err(invalid("people identity lookup exceeds its bound"));
        }
        let catalog = Catalog {
            scope: None,
            tables: vec![catalog::people_table()],
        };
        let resolve::Query::Select(mut query) =
            resolve::compile(&catalog, "SELECT id, name, email FROM macro.people")
                .map_err(RunError::from)?
        else {
            return Err(RunError::ReadOnly.into());
        };
        query.where_ = Some(Filter::In {
            column: PEOPLE_ID,
            values: ids.iter().cloned().map(Value::Entity).collect(),
            negated: false,
        });
        Self::select(&catalog, query)
    }

    fn select(catalog: &Catalog, query: SelectQuery) -> Result<Self, PeopleSqlError> {
        if query.items.len() > MAX_PEOPLE_SQL_COLUMNS {
            return Err(invalid("people SQL exceeds its column bound"));
        }
        if query.relations.len() != 1 || query.relations[0].source != TableSource::People {
            return Err(invalid("local people SQL requires one people relation"));
        }
        let origin = query.group_by.is_none()
            && query
                .items
                .iter()
                .all(|item| matches!(item, SelectItem::Column(_)));
        let requested = query.limit.map(|value| value as usize);
        let limit = requested
            .unwrap_or(MAX_PEOPLE_SQL_ROWS)
            .min(MAX_PEOPLE_SQL_ROWS);
        let mut attributes = BTreeSet::new();
        for binding in &query.bindings {
            let field = field(&query, binding.key)?;
            if !matches!(field, Field::Position) {
                attributes.insert(field.sql());
            }
        }
        if origin {
            attributes.extend(["id", "row_id"]);
        }
        let mut builder = Builder {
            sql: String::new(),
            parameters: vec![],
            attributes,
            query: &query,
        };
        let where_ = if let Some(filter) = &query.where_ {
            builder.predicate(filter)?;
            std::mem::take(&mut builder.sql)
        } else {
            "1".into()
        };
        // Bind predicates first, then window values. No user identifiers enter SQL.
        if !origin {
            builder.sql.push_str(", __groups AS (SELECT ");
            builder.sql.push_str(match query.group_by {
                Some(key) => field(&query, key)?.sql(),
                None => "NULL",
            });
            builder.sql.push_str(" AS __group, ");
            for (index, item) in query.items.iter().enumerate() {
                if index > 0 {
                    builder.sql.push_str(", ");
                }
                builder.item(item)?;
                builder.sql.push_str(&format!(" AS c{index}"));
            }
            builder.sql.push_str(" FROM __people WHERE ");
            builder.sql.push_str(&where_);
            if let Some(group) = query.group_by {
                builder.sql.push_str(" GROUP BY ");
                builder.sql.push_str(field(&query, group)?.sql());
            }
            builder.sql.push(')');
            if query.distinct {
                builder
                    .sql
                    .push_str(", __ranked AS (SELECT *, ROW_NUMBER() OVER (PARTITION BY ");
                for index in 0..query.items.len() {
                    if index > 0 {
                        builder.sql.push_str(", ");
                    }
                    builder.sql.push_str(&format!("c{index}"));
                }
                builder.sql.push_str(" ORDER BY ");
                builder.order(false)?;
                builder.sql.push_str(") AS __rank FROM __groups)");
            }
            builder.sql.push(' ');
        } else if query.distinct {
            builder
                .sql
                .push_str(", __ranked AS (SELECT *, ROW_NUMBER() OVER (PARTITION BY ");
            for (index, item) in query.items.iter().enumerate() {
                if index > 0 {
                    builder.sql.push_str(", ");
                }
                let SelectItem::Column(key) = item else {
                    return Err(invalid("invalid distinct projection"));
                };
                builder.sql.push_str(field(&query, *key)?.sql());
            }
            builder.sql.push_str(" ORDER BY ");
            builder.order(true)?;
            builder.sql.push_str(") AS __rank FROM __people WHERE ");
            builder.sql.push_str(&where_);
            builder.sql.push_str(") ");
        } else {
            builder.sql.push(' ');
        }
        builder.sql.push_str("SELECT ");
        if origin {
            builder.sql.push_str("row_id AS __origin, ");
        }
        for (index, item) in query.items.iter().enumerate() {
            if index > 0 {
                builder.sql.push_str(", ");
            }
            if origin {
                builder.item(item)?;
                builder.sql.push_str(&format!(" AS c{index}"));
            } else {
                builder.sql.push_str(&format!("c{index}"));
            }
        }
        if query.distinct {
            builder.sql.push_str(" FROM __ranked WHERE __rank = 1");
        } else if !origin {
            builder.sql.push_str(" FROM __groups");
        } else {
            builder.sql.push_str(" FROM __people WHERE ");
            builder.sql.push_str(&where_);
        }
        builder.sql.push_str(" ORDER BY ");
        builder.order(origin)?;
        builder.sql.push_str(" LIMIT ? OFFSET ?");
        // LIMIT 0 must not fetch a lookahead row.
        builder
            .parameters
            .push(SqlParameter::Integer(if limit == 0 {
                0
            } else {
                i64::try_from(limit + 1).map_err(|_| invalid("invalid result limit"))?
            }));
        builder
            .parameters
            .push(SqlParameter::Integer(i64::from(query.offset.unwrap_or(0))));
        Ok(Self {
            columns: result_columns(catalog, &query)?,
            sql: builder.sql,
            parameters: builder.parameters,
            attributes: builder.attributes,
            origin,
            limit,
            capped: requested.is_none_or(|requested| requested > MAX_PEOPLE_SQL_ROWS),
        })
    }

    /// SQL after the adapter's scoped `WITH __people AS (...)` prefix.
    pub fn sql(&self) -> &str {
        &self.sql
    }
    /// Exact facts required by this query; COUNT(*) does not read private names.
    pub fn attributes(&self) -> impl Iterator<Item = &'static str> + '_ {
        self.attributes.iter().copied()
    }
    /// Literal and window arguments, in placeholder order.
    pub fn parameters(&self) -> &[SqlParameter] {
        &self.parameters
    }
    /// Maximum returned rows (the driver may read one extra for truncation).
    pub fn limit(&self) -> usize {
        self.limit
    }
    /// Decode only a bounded database result; never fold an input directory.
    pub fn outcome(&self, mut rows: Vec<Vec<SqlScalar>>) -> Result<Outcome, PeopleSqlError> {
        if rows.len() > self.limit + 1 {
            return Err(invalid("local SQL exceeded its result window"));
        }
        let truncated = self.capped && rows.len() > self.limit;
        rows.truncate(self.limit);
        let mut outcome = Outcome {
            columns: self.columns.clone(),
            read_tables: vec![catalog::PEOPLE_TABLE],
            truncated,
            ..Default::default()
        };
        for row in rows {
            if row.len() != self.columns.len() + usize::from(self.origin) {
                return Err(invalid("local SQL returned an invalid row shape"));
            }
            let mut values = row.into_iter();
            if self.origin {
                let Some(SqlScalar::Text(id)) = values.next() else {
                    return Err(invalid("missing result identity"));
                };
                outcome.row_ids.push(RowId::from_uuid(
                    Uuid::parse_str(&id).map_err(|_| invalid("invalid result identity"))?,
                ));
            }
            let cells = values
                .zip(&self.columns)
                .map(|(value, column)| {
                    Ok(match (value, column.kind) {
                        (SqlScalar::Null, _) => None,
                        (SqlScalar::Text(value), crate::OutcomeKind::Text) => {
                            Some(Cell::Text(value))
                        }
                        (SqlScalar::Text(value), crate::OutcomeKind::Entity) => {
                            Some(Cell::Entities(vec![value]))
                        }
                        (SqlScalar::Text(value), crate::OutcomeKind::Row) => {
                            Some(Cell::Row(RowId::from_uuid(
                                Uuid::parse_str(&value)
                                    .map_err(|_| invalid("invalid row identity"))?,
                            )))
                        }
                        (SqlScalar::Integer(value), crate::OutcomeKind::Number) if value >= 0 => {
                            Some(Cell::Number(value as f64))
                        }
                        _ => return Err(invalid("invalid SQL scalar type")),
                    })
                })
                .collect::<Result<_, _>>()?;
            outcome.rows.push(cells);
        }
        Ok(outcome)
    }
}

fn invalid(message: &'static str) -> PeopleSqlError {
    PeopleSqlError::Unsupported(message)
}
fn field(query: &SelectQuery, key: Uuid) -> Result<Field, PeopleSqlError> {
    let binding = query
        .binding(key)
        .ok_or_else(|| invalid("unknown people column"))?;
    match binding.column {
        Some(PEOPLE_ID) => Ok(Field::Id),
        Some(PEOPLE_NAME) => Ok(Field::Name),
        Some(PEOPLE_EMAIL) => Ok(Field::Email),
        None if key == row_id_key(query.table()) => Ok(Field::RowId),
        None if key == row_position_key(query.table()) => Ok(Field::Position),
        _ => Err(invalid("unsupported people column")),
    }
}
struct Builder<'a> {
    sql: String,
    parameters: Vec<SqlParameter>,
    attributes: BTreeSet<&'static str>,
    query: &'a SelectQuery,
}
impl Builder<'_> {
    fn item(&mut self, item: &SelectItem) -> Result<(), PeopleSqlError> {
        match item {
            SelectItem::Column(key) => self.sql.push_str(field(self.query, *key)?.sql()),
            SelectItem::Aggregate {
                function: AggregateFunction::Count,
                column,
            } => {
                self.sql.push_str("COUNT(");
                self.sql.push_str(match column {
                    Some(key) => field(self.query, *key)?.sql(),
                    None => "*",
                });
                self.sql.push(')');
            }
            _ => return Err(invalid("unsupported people aggregate")),
        }
        Ok(())
    }
    fn order(&mut self, rows: bool) -> Result<(), PeopleSqlError> {
        let mut written = false;
        for term in &self.query.order_by {
            let key = match term.key {
                OrderKey::Column(key) if rows => field(self.query, key)?.sql().to_owned(),
                OrderKey::Column(_) => "__group".to_owned(),
                OrderKey::Item(index) => format!("c{index}"),
            };
            if written {
                self.sql.push_str(", ");
            }
            written = true;
            self.sql.push_str(&key);
            self.sql
                .push_str(if term.direction == Direction::Descending {
                    " DESC NULLS LAST"
                } else {
                    " ASC NULLS LAST"
                });
        }
        if rows {
            if written {
                self.sql.push_str(", ");
            }
            self.sql.push_str("id ASC");
        } else {
            if written {
                self.sql.push_str(", ");
            }
            self.sql.push_str("__group ASC NULLS LAST");
        }
        Ok(())
    }
    fn parameter(&mut self, value: String) {
        self.sql.push('?');
        self.parameters.push(SqlParameter::Text(value));
    }
    fn literal(&mut self, value: String) {
        self.sql.push('?');
        self.parameters
            .push(SqlParameter::Bytes(value.into_bytes()));
    }
    fn value(&self, field: Field, value: &Value) -> Result<Option<String>, PeopleSqlError> {
        let value = match value {
            Value::Text(value) | Value::Entity(value) => value,
            _ => return Err(invalid("unsupported people literal")),
        };
        if matches!(field, Field::RowId) {
            return Ok(Uuid::parse_str(value).ok().map(|id| id.to_string()));
        }
        Ok(Some(value.clone()))
    }
    fn predicate(&mut self, filter: &Filter) -> Result<(), PeopleSqlError> {
        match filter {
            Filter::And(parts) | Filter::Or(parts) => {
                let and = matches!(filter, Filter::And(_));
                if parts.is_empty() {
                    self.sql.push_str(if and { "1" } else { "0" });
                } else {
                    self.sql.push('(');
                    for (index, part) in parts.iter().enumerate() {
                        if index > 0 {
                            self.sql.push_str(if and { " AND " } else { " OR " });
                        }
                        self.predicate(part)?;
                    }
                    self.sql.push(')');
                }
            }
            Filter::IsNull { column, negated } => {
                self.sql.push_str(field(self.query, *column)?.sql());
                self.sql
                    .push_str(if *negated { " IS NOT NULL" } else { " IS NULL" });
            }
            Filter::Comparison {
                column,
                operator,
                value,
            } => {
                let field = field(self.query, *column)?;
                if let Some(value) = self.value(field, value)? {
                    self.sql.push_str(field.sql());
                    self.sql.push_str(match operator {
                        ComparisonOperator::Equal => " = ",
                        ComparisonOperator::NotEqual => " <> ",
                        ComparisonOperator::Less => " < ",
                        ComparisonOperator::LessOrEqual => " <= ",
                        ComparisonOperator::Greater => " > ",
                        ComparisonOperator::GreaterOrEqual => " >= ",
                    });
                    self.literal(value);
                } else {
                    self.sql.push('0');
                }
            }
            Filter::In {
                column,
                values,
                negated,
            } => {
                let field = field(self.query, *column)?;
                let values = values
                    .iter()
                    .map(|value| self.value(field, value))
                    .collect::<Result<Vec<_>, _>>()?
                    .into_iter()
                    .flatten()
                    .collect::<Vec<_>>();
                if matches!(field, Field::Position) {
                    self.sql.push('0');
                } else if values.is_empty() {
                    self.sql.push_str(if *negated { "1" } else { "0" });
                } else {
                    self.sql.push_str(field.sql());
                    self.sql
                        .push_str(if *negated { " NOT IN (" } else { " IN (" });
                    for (index, value) in values.into_iter().enumerate() {
                        if index > 0 {
                            self.sql.push_str(", ");
                        }
                        self.literal(value);
                    }
                    self.sql.push(')');
                }
            }
            Filter::Has {
                column,
                value,
                negated,
            } => {
                let field = field(self.query, *column)?;
                if matches!(field, Field::Id) {
                    self.sql.push_str("id");
                    self.sql.push_str(if *negated { " <> " } else { " = " });
                    let Some(value) = self.value(field, value)? else {
                        return Err(invalid("invalid identity literal"));
                    };
                    self.literal(value);
                } else {
                    self.sql.push_str(if *negated { "1" } else { "0" });
                }
            }
            Filter::Like {
                column,
                pattern,
                escape,
                negated,
            } => {
                let field = field(self.query, *column)?;
                if matches!(field, Field::Position) {
                    self.sql.push('0');
                } else if pattern.contains('\0') {
                    self.sql.push_str(if *negated { "1" } else { "0" });
                } else {
                    let (pattern, escape) = normalized_like(pattern, *escape);
                    self.attributes.insert(field.lowered());
                    self.sql.push_str(field.lowered());
                    self.sql
                        .push_str(if *negated { " NOT LIKE " } else { " LIKE " });
                    self.parameter(pattern);
                    if let Some(escape) = escape {
                        self.sql.push_str(" ESCAPE ");
                        self.parameter(escape.to_string());
                    }
                }
            }
        }
        Ok(())
    }
}
