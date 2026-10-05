//! How the examples print cells, results and plans.

use database_sql::catalog::{Catalog, ColumnKind};
use database_sql::fold::Cell;
use database_sql::resolve::{Query, compile};
use database_sql::run::{Outcome, OutcomeKind};
use database_sql::split::{GqlQuery, split};
use models_databases::OptionId;

/// A cell as a person would read it: option labels, not ids.
pub fn show(catalog: &Catalog, value: Option<&Cell>) -> String {
    let label = |id: &OptionId| {
        catalog
            .tables
            .iter()
            .flat_map(|table| &table.columns)
            .find_map(|column| match &column.kind {
                ColumnKind::Select { options, .. } => options
                    .iter()
                    .find(|option| option.id == *id)
                    .map(|option| option.label.clone()),
                _ => None,
            })
            .unwrap_or_else(|| id.to_string())
    };
    match value {
        None => "—".into(),
        Some(Cell::Text(text)) => text.clone(),
        Some(Cell::Number(number)) => {
            if number.fract() == 0.0 {
                format!("{}", *number as i64)
            } else {
                format!("{number}")
            }
        }
        Some(Cell::Bool(checked)) => if *checked { "☑" } else { "☐" }.into(),
        Some(Cell::Date(date)) => date.format("%Y-%m-%d").to_string(),
        Some(Cell::Options(ids)) => ids.iter().map(label).collect::<Vec<_>>().join(", "),
        Some(Cell::Entities(ids)) => ids.join(", "),
        Some(Cell::Row(id)) => id.to_string(),
    }
}

/// The result as a table, or the write summary.
pub fn print_outcome(catalog: &Catalog, outcome: &Outcome) {
    if outcome.columns.is_empty() {
        println!(
            "  {} row(s) changed{}",
            outcome.changes_applied,
            if outcome.inserted_row_ids.is_empty() {
                String::new()
            } else {
                format!(
                    ", inserted {}",
                    outcome
                        .inserted_row_ids
                        .iter()
                        .map(|id| id.to_string())
                        .collect::<Vec<_>>()
                        .join(", ")
                )
            }
        );
        return;
    }
    let mut widths: Vec<usize> = outcome
        .columns
        .iter()
        .map(|column| column.name.chars().count())
        .collect();
    let rows: Vec<Vec<String>> = outcome
        .rows
        .iter()
        .map(|row| {
            row.iter()
                .enumerate()
                .map(|(i, value)| {
                    let text = show(catalog, value.as_ref());
                    widths[i] = widths[i].max(text.chars().count());
                    text
                })
                .collect()
        })
        .collect();
    let line = |cells: Vec<String>| {
        cells
            .iter()
            .enumerate()
            .map(|(i, text)| format!("{text:<width$}", width = widths[i]))
            .collect::<Vec<_>>()
            .join("  ")
    };
    println!(
        "  {}",
        line(outcome.columns.iter().map(|c| c.name.clone()).collect())
    );
    println!(
        "  {}",
        line(
            outcome
                .columns
                .iter()
                .map(|c| match c.kind {
                    OutcomeKind::Text => "text",
                    OutcomeKind::Number => "number",
                    OutcomeKind::Boolean => "checkbox",
                    OutcomeKind::Date => "date",
                    OutcomeKind::Select => "select",
                    OutcomeKind::Entity => "entity",
                    OutcomeKind::Row => "row",
                }
                .into())
                .collect()
        )
    );
    for (i, row) in rows.into_iter().enumerate() {
        let id = outcome
            .row_ids
            .get(i)
            .map(|id| format!("   {id}"))
            .unwrap_or_default();
        println!("  {}{id}", line(row));
    }
    println!(
        "  ({} row(s){})",
        outcome.rows.len(),
        if outcome.truncated { ", truncated" } else { "" }
    );
}

/// What the statement would send to the server and keep for the fold.
pub fn print_plan(catalog: &Catalog, sql: &str) {
    let select = match compile(catalog, sql) {
        Ok(Query::Select(select)) => select,
        Ok(Query::Update(update)) => update.read,
        Ok(Query::Delete(delete)) => delete.read,
        _ => return,
    };
    let plan = split(catalog, select);
    let property_filter = |property_filter: &Option<_>| {
        property_filter
            .as_ref()
            .map(|expr| serde_json::to_string(expr).unwrap())
            .unwrap_or_else(|| "none".into())
    };
    for relation in &plan.relations {
        let alias = &relation.relation.alias;
        match &relation.query {
            GqlQuery::Soup {
                property_filter: filter,
                ..
            } => {
                println!(
                    "  gql [{alias}]: soup, property_filter = {}",
                    property_filter(filter)
                )
            }
            GqlQuery::GroupSoup {
                property_filter: filter,
                ..
            } => println!(
                "  gql [{alias}]: groupSoup (bins only, no rows fetched), property_filter = {}",
                property_filter(filter)
            ),
            GqlQuery::People { .. } => println!("  gql [{alias}]: people"),
        }
    }
    for join in &plan.joins {
        println!(
            "  join: {:?} {} on {:?}",
            join.kind, plan.relations[join.relation].relation.alias, join.on
        );
    }
    println!(
        "  residual: {}",
        plan.residual
            .as_ref()
            .map(|filter| format!("{filter:?}"))
            .unwrap_or_else(|| "none".into())
    );
}

/// A failed statement, with every cause beneath it.
pub fn print_failure(error: &dyn std::error::Error) {
    println!("  error: {error}");
    let mut cause = error.source();
    while let Some(error) = cause {
        println!("    because: {error}");
        cause = error.source();
    }
}
