//! Parameterized SQL for the engine's validated, single-table view plan.

use std::collections::BTreeSet;

use database_sql::{
    catalog::{Column, ColumnKind, Table, TableSource},
    resolve::{
        ComparisonOperator, Direction, Filter, OrderKey, SelectQuery, Value, row_position_key,
    },
};
use models_databases::RowId;
use sqlx::{Postgres, QueryBuilder};
use uuid::Uuid;

use crate::domain::view_rows::ViewRowsError;

type Sql = QueryBuilder<'static, Postgres>;

fn filter_columns(filter: &Filter, columns: &mut BTreeSet<Uuid>) {
    match filter {
        Filter::And(parts) | Filter::Or(parts) => {
            for part in parts {
                filter_columns(part, columns);
            }
        }
        Filter::Comparison { column, .. }
        | Filter::In { column, .. }
        | Filter::Has { column, .. }
        | Filter::IsNull { column, .. }
        | Filter::Like { column, .. } => {
            columns.insert(*column);
        }
    }
}

struct Columns<'a>(Vec<&'a Column>);

impl Columns<'_> {
    fn index(&self, id: Uuid) -> Result<usize, ViewRowsError> {
        self.0
            .iter()
            .position(|column| column.id == id)
            .ok_or(ViewRowsError::InvalidQuery)
    }

    fn reference(&self, sql: &mut Sql, id: Uuid, scalar: bool) -> Result<(), ViewRowsError> {
        let index = self.index(id)?;
        let array = matches!(
            self.0[index].kind,
            ColumnKind::Select { .. } | ColumnKind::Entity { .. }
        );
        if scalar && array {
            sql.push(format!(
                "(CASE WHEN cardinality(v{index}) = 1 THEN v{index}[1] END)"
            ));
        } else {
            sql.push(format!("v{index}"));
        }
        Ok(())
    }
}

/// Only IDs and compiler-generated aliases become SQL identifiers. Every
/// caller-supplied value, option ID and cursor is a bind parameter.
pub(super) fn page(
    table: &Table,
    query: &SelectQuery,
    after: Option<RowId>,
    limit: u16,
) -> Result<Sql, ViewRowsError> {
    if table.source != TableSource::Database
        || query.relations.len() != 1
        || query.relations[0].table != table.id
        || !query.joins.is_empty()
        || query.group_by.is_some()
        || query.distinct
        || !(1..=501).contains(&limit)
    {
        return Err(ViewRowsError::InvalidQuery);
    }
    let position = row_position_key(table.id);
    let mut needed = BTreeSet::new();
    if let Some(filter) = &query.where_ {
        filter_columns(filter, &mut needed);
    }
    for order in &query.order_by {
        let OrderKey::Column(column) = order.key else {
            return Err(ViewRowsError::InvalidQuery);
        };
        if column != position {
            needed.insert(column);
        }
    }
    let columns = Columns(
        needed
            .into_iter()
            .map(|id| {
                table
                    .columns
                    .iter()
                    // Formula values are computed by the engine, not stored properties.
                    .find(|column| column.id == id && column.formula.is_none())
                    .ok_or(ViewRowsError::InvalidQuery)
            })
            .collect::<Result<_, _>>()?,
    );
    let mut sql = Sql::new("WITH cells AS NOT MATERIALIZED (SELECT r.id, r.position");
    for (index, column) in columns.0.iter().enumerate() {
        sql.push(", ");
        cell(&mut sql, index, &column.kind);
        sql.push(format!(" AS v{index}, p{index}.values AS raw{index}"));
    }
    sql.push(" FROM database_rows r");
    for (index, column) in columns.0.iter().enumerate() {
        // Keep both keys indexable: filters may start from properties, whereas
        // an unfiltered ordered page starts from database_rows.
        sql.push(format!(" LEFT JOIN entity_properties p{index} ON p{index}.entity_id = r.id::text AND r.id = CASE WHEN p{index}.entity_type = 'DATABASE_ROW' THEN p{index}.entity_id::uuid END AND p{index}.entity_type = 'DATABASE_ROW' AND p{index}.property_definition_id = "))
            .push_bind(column.id);
    }
    sql.push(" WHERE r.table_id = ")
        .push_bind(table.id.into_uuid());
    sql.push("), candidates AS NOT MATERIALIZED (SELECT cells.*");
    for (index, order) in query.order_by.iter().enumerate() {
        sql.push(", ");
        let OrderKey::Column(column) = order.key else {
            return Err(ViewRowsError::InvalidQuery);
        };
        if column == position {
            sql.push("position");
        } else {
            sort_value(&mut sql, &columns, column)?;
        }
        sql.push(format!(" AS k{index}"));
    }
    sql.push(" FROM cells");
    if let Some(filter) = &query.where_ {
        sql.push(" WHERE ");
        predicate(&mut sql, &columns, filter)?;
    }
    sql.push(") SELECT c.id FROM candidates c");
    if let Some(after) = after {
        sql.push(" CROSS JOIN (SELECT * FROM candidates WHERE id = ")
            .push_bind(after.into_uuid())
            .push(") pivot WHERE ");
        if query.order_by.len() == 1
            && query.order_by[0].key == OrderKey::Column(position)
            && query.order_by[0].direction == Direction::Ascending
        {
            sql.push("(c.k0, c.id) > (pivot.k0, pivot.id)");
        } else {
            seek(&mut sql, query);
        }
    }
    sql.push(" ORDER BY ");
    for (index, order) in query.order_by.iter().enumerate() {
        sql.push(format!(
            "c.k{index} {} NULLS LAST, ",
            direction(order.direction)
        ));
    }
    sql.push("c.id ASC LIMIT ").push_bind(i64::from(limit));
    Ok(sql)
}

fn direction(direction: Direction) -> &'static str {
    match direction {
        Direction::Ascending => "ASC",
        Direction::Descending => "DESC",
    }
}

/// Lexicographic continuation with empty values last in either direction.
fn seek(sql: &mut Sql, query: &SelectQuery) {
    sql.push("(");
    for at in 0..=query.order_by.len() {
        if at > 0 {
            sql.push(" OR ");
        }
        sql.push("(");
        for prefix in 0..at {
            sql.push(format!(
                "c.k{prefix} IS NOT DISTINCT FROM pivot.k{prefix} AND "
            ));
        }
        if let Some(order) = query.order_by.get(at) {
            let operator = match order.direction {
                Direction::Ascending => ">",
                Direction::Descending => "<",
            };
            sql.push(format!(
                "(c.k{at} {operator} pivot.k{at} OR (c.k{at} IS NULL AND pivot.k{at} IS NOT NULL))"
            ));
        } else {
            sql.push("c.id > pivot.id");
        }
        sql.push(")");
    }
    sql.push(")");
}

fn cell(sql: &mut Sql, index: usize, kind: &ColumnKind) {
    let property = format!("p{index}.values");
    let (tag, value) = match kind {
        ColumnKind::Text => ("String", format!("({property}->>'value') COLLATE \"C\"")),
        ColumnKind::Number => (
            "Number",
            format!("({property}->>'value')::double precision"),
        ),
        ColumnKind::Boolean => ("Boolean", format!("({property}->>'value')::boolean")),
        ColumnKind::Date => ("Date", date_value(&format!("({property}->>'value')"))),
        ColumnKind::Link => (
            "Link",
            format!(
                "COALESCE((SELECT string_agg(value, ' ' ORDER BY ordinal) FROM jsonb_array_elements_text({property}->'value') WITH ORDINALITY AS links(value, ordinal)), '') COLLATE \"C\""
            ),
        ),
        ColumnKind::Select { .. } => (
            "SelectOption",
            format!(
                "NULLIF(ARRAY(SELECT value FROM jsonb_array_elements_text({property}->'value') WITH ORDINALITY AS options(value, ordinal) ORDER BY ordinal), '{{}}'::text[]) COLLATE \"C\""
            ),
        ),
        ColumnKind::Entity { .. } => (
            "EntityReference",
            format!(
                "NULLIF(ARRAY(SELECT value->>'entity_id' FROM jsonb_array_elements({property}->'value') WITH ORDINALITY AS refs(value, ordinal) ORDER BY ordinal), '{{}}'::text[]) COLLATE \"C\""
            ),
        ),
    };
    sql.push(format!(
        "CASE WHEN {property}->>'type' = '{tag}' THEN {value} END"
    ));
}

// Properties serialize DateTime<Utc> as RFC3339 UTC. Keep the fractional
// seconds separate: PostgreSQL timestamps round to microseconds, but the
// view engine compares every stored nanosecond.
fn date_value(text: &str) -> String {
    format!(
        "(extract(epoch FROM (split_part(rtrim({text}, 'Z'), '.', 1) || 'Z')::timestamptz) + COALESCE(('0.' || substring({text} FROM '[.]([0-9]+)'))::numeric, 0))"
    )
}

fn sort_value(sql: &mut Sql, columns: &Columns<'_>, id: Uuid) -> Result<(), ViewRowsError> {
    let index = columns.index(id)?;
    match &columns.0[index].kind {
        ColumnKind::Text | ColumnKind::Link => {
            sql.push(format!(
                "lower(v{index} COLLATE \"und-x-icu\") COLLATE \"C\""
            ));
        }
        ColumnKind::Select { options, .. } => {
            sql.push(format!(
                "CASE WHEN v{index} IS NOT NULL THEN ARRAY(SELECT COALESCE(array_position("
            ));
            sql.push_bind(
                options
                    .iter()
                    .map(|option| option.id.to_string())
                    .collect::<Vec<_>>(),
            );
            sql.push(format!("::text[], value), 2147483647) FROM unnest(v{index}) WITH ORDINALITY AS members(value, ordinal) ORDER BY ordinal) END"));
        }
        _ => {
            sql.push(format!("v{index}"));
        }
    }
    Ok(())
}

fn literal(sql: &mut Sql, value: &Value) -> Result<(), ViewRowsError> {
    match value {
        Value::Text(value) | Value::Entity(value) => {
            sql.push_bind(value.clone());
        }
        Value::Number(value) => {
            sql.push_bind(*value);
        }
        Value::Bool(value) => {
            sql.push_bind(*value);
        }
        Value::Date(value) => {
            sql.push("(")
                .push_bind(value.timestamp())
                .push("::numeric + ")
                .push_bind(i64::from(value.timestamp_subsec_nanos()))
                .push("::numeric / 1000000000)");
        }
        Value::Option(value) => {
            sql.push_bind(value.to_string());
        }
        Value::Options(_) | Value::Entities(_) => return Err(ViewRowsError::InvalidQuery),
    }
    Ok(())
}

fn predicate(sql: &mut Sql, columns: &Columns<'_>, filter: &Filter) -> Result<(), ViewRowsError> {
    sql.push("(");
    // The typed expressions below retain scalar/list and empty-cell semantics.
    // Expose positive membership separately so the property GIN index can prune
    // candidates before PostgreSQL expands JSON arrays.
    match filter {
        Filter::Has {
            column,
            value,
            negated: false,
        } => {
            membership_index(sql, columns, *column, std::slice::from_ref(value))?;
        }
        Filter::In {
            column,
            values,
            negated: false,
        } => {
            membership_index(sql, columns, *column, values)?;
        }
        _ => {}
    }
    match filter {
        Filter::And(parts) | Filter::Or(parts) => {
            if parts.is_empty() {
                sql.push(if matches!(filter, Filter::And(_)) {
                    "TRUE"
                } else {
                    "FALSE"
                });
            }
            for (index, part) in parts.iter().enumerate() {
                if index > 0 {
                    sql.push(if matches!(filter, Filter::And(_)) {
                        " AND "
                    } else {
                        " OR "
                    });
                }
                predicate(sql, columns, part)?;
            }
        }
        Filter::Comparison {
            column,
            operator,
            value,
        } => {
            columns.reference(sql, *column, true)?;
            sql.push(match operator {
                ComparisonOperator::Equal => " = ",
                ComparisonOperator::NotEqual => " <> ",
                ComparisonOperator::Less => " < ",
                ComparisonOperator::LessOrEqual => " <= ",
                ComparisonOperator::Greater => " > ",
                ComparisonOperator::GreaterOrEqual => " >= ",
            });
            literal(sql, value)?;
        }
        Filter::In {
            column,
            values,
            negated,
        } => {
            if values.is_empty() {
                return Err(ViewRowsError::InvalidQuery);
            }
            columns.reference(sql, *column, true)?;
            sql.push(if *negated { " NOT IN (" } else { " IN (" });
            for (index, value) in values.iter().enumerate() {
                if index > 0 {
                    sql.push(", ");
                }
                literal(sql, value)?;
            }
            sql.push(")");
        }
        Filter::Has {
            column,
            value,
            negated,
        } => {
            sql.push(if *negated {
                "NOT COALESCE("
            } else {
                "COALESCE("
            });
            literal(sql, value)?;
            sql.push(" = ANY(");
            columns.reference(sql, *column, false)?;
            sql.push("), FALSE)");
        }
        Filter::IsNull { column, negated } => {
            columns.reference(sql, *column, false)?;
            sql.push(if *negated { " IS NOT NULL" } else { " IS NULL" });
        }
        Filter::Like {
            column,
            pattern,
            escape,
            negated,
        } => {
            sql.push("lower(");
            columns.reference(sql, *column, true)?;
            sql.push(" COLLATE \"und-x-icu\") COLLATE \"C\"");
            sql.push(if *negated { " NOT LIKE " } else { " LIKE " });
            sql.push_bind(pattern.to_lowercase());
            sql.push(" ESCAPE ")
                .push_bind(escape.map(|value| value.to_string()).unwrap_or_default());
        }
    }
    sql.push(")");
    Ok(())
}

fn membership_index(
    sql: &mut Sql,
    columns: &Columns<'_>,
    column: Uuid,
    values: &[Value],
) -> Result<(), ViewRowsError> {
    let index = columns.index(column)?;
    let needles = values
        .iter()
        .map(|value| match (&columns.0[index].kind, value) {
            (ColumnKind::Select { .. }, Value::Option(option)) => Some(serde_json::json!({
                "type": "SelectOption", "value": [option.to_string()]
            })),
            (ColumnKind::Entity { .. }, Value::Entity(entity)) => Some(serde_json::json!({
                "type": "EntityReference", "value": [{"entity_id": entity}]
            })),
            _ => None,
        })
        .collect::<Option<Vec<_>>>();
    if let Some(needles) = needles.filter(|values| !values.is_empty()) {
        sql.push("(");
        for (at, needle) in needles.into_iter().enumerate() {
            if at > 0 {
                sql.push(" OR ");
            }
            sql.push(format!("raw{index} @> ")).push_bind(needle);
        }
        sql.push(") AND ");
    }
    Ok(())
}
