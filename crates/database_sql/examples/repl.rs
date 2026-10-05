//! An interactive tour of the engine over an in-memory table.
//!
//! ```sh
//! cargo run -p database_sql --example repl
//! ```
//!
//! Type SQL; see the plan (what would go to the server as a Soup `propf`
//! filter, what the fold keeps), the result, and the errors an agent gets.
//! `INSERT`, `UPDATE … WHERE …` and `DELETE … WHERE …` change the in-memory
//! rows. `\rows` dumps them; `\catalog` shows the schema.

mod common;

use models_databases::{ColumnId, DatabaseId, OptionId, RowId, TableId};
use std::collections::HashMap;
use std::io::{self, BufRead, Write};
use std::sync::Mutex;

use chrono::{TimeZone, Utc};
use database_sql::catalog::{
    Catalog, Column, ColumnKind, EntityKind, SelectOption, Table, TableSource,
};
use database_sql::fold::{Bin, Cell, Row};
use database_sql::run::{OpsSink, Page, RowSource, run};
use database_sql::split::GqlQuery;
use models_databases::{
    CellValue, CellWrite, DatabaseOp, OpResult, OptionRef, RowChanges, RowsChange, RowsResult,
    TableVersion,
};
use uuid::Uuid;

const CRM: Uuid = Uuid::from_u128(0xdb0);
const DEALS: Uuid = Uuid::from_u128(0xd0);
const NAME: Uuid = Uuid::from_u128(0x01);
const AMOUNT: Uuid = Uuid::from_u128(0x02);
const STAGE: Uuid = Uuid::from_u128(0x03);
const CLOSED_AT: Uuid = Uuid::from_u128(0x04);
const OWNER: Uuid = Uuid::from_u128(0x05);
const TAGS: Uuid = Uuid::from_u128(0x06);
const DONE: Uuid = Uuid::from_u128(0x07);
const LEAD: Uuid = Uuid::from_u128(0x31);
const WON: Uuid = Uuid::from_u128(0x30);
const LOST: Uuid = Uuid::from_u128(0x33);
const VIP: Uuid = Uuid::from_u128(0x32);
const RENEWAL: Uuid = Uuid::from_u128(0x34);

fn catalog() -> Catalog {
    Catalog {
        tables: vec![Table {
            id: TableId::from_uuid(DEALS),
            database_id: DatabaseId::from_uuid(CRM),
            database: "crm".into(),
            name: "deals".into(),
            columns: vec![
                Column {
                    id: NAME,
                    placement: ColumnId::from_uuid(NAME),
                    name: "name".into(),
                    kind: ColumnKind::Text,
                },
                Column {
                    id: AMOUNT,
                    placement: ColumnId::from_uuid(AMOUNT),
                    name: "amount".into(),
                    kind: ColumnKind::Number,
                },
                Column {
                    id: STAGE,
                    placement: ColumnId::from_uuid(STAGE),
                    name: "stage".into(),
                    kind: ColumnKind::Select {
                        multi: false,
                        options: vec![
                            SelectOption {
                                id: OptionId::from_uuid(LEAD),
                                label: "Lead".into(),
                            },
                            SelectOption {
                                id: OptionId::from_uuid(WON),
                                label: "Won".into(),
                            },
                            SelectOption {
                                id: OptionId::from_uuid(LOST),
                                label: "Lost".into(),
                            },
                        ],
                    },
                },
                Column {
                    id: CLOSED_AT,
                    placement: ColumnId::from_uuid(CLOSED_AT),
                    name: "closed at".into(),
                    kind: ColumnKind::Date,
                },
                Column {
                    id: OWNER,
                    placement: ColumnId::from_uuid(OWNER),
                    name: "owner".into(),
                    kind: ColumnKind::Entity {
                        multi: false,
                        target: EntityKind::User,
                    },
                },
                Column {
                    id: TAGS,
                    placement: ColumnId::from_uuid(TAGS),
                    name: "tags".into(),
                    kind: ColumnKind::Select {
                        multi: true,
                        options: vec![
                            SelectOption {
                                id: OptionId::from_uuid(VIP),
                                label: "vip".into(),
                            },
                            SelectOption {
                                id: OptionId::from_uuid(RENEWAL),
                                label: "renewal".into(),
                            },
                        ],
                    },
                },
                Column {
                    id: DONE,
                    placement: ColumnId::from_uuid(DONE),
                    name: "done".into(),
                    kind: ColumnKind::Boolean,
                },
            ],
            source: TableSource::Database,
        }],
    }
}

fn seed() -> Vec<Row> {
    let row = |id: u128, cells: Vec<(Uuid, Cell)>| Row {
        id: RowId::from_uuid(Uuid::from_u128(id)),
        position: None,
        cells: cells.into_iter().collect(),
    };
    let date =
        |year, month, day| Cell::Date(Utc.with_ymd_and_hms(year, month, day, 0, 0, 0).unwrap());
    vec![
        row(
            0xa1,
            vec![
                (NAME, Cell::Text("Acme".into())),
                (AMOUNT, Cell::Number(12000.0)),
                (STAGE, Cell::Options(vec![OptionId::from_uuid(WON)])),
                (CLOSED_AT, date(2026, 9, 1)),
                (OWNER, Cell::Entities(vec!["macro|sam@example.com".into()])),
                (TAGS, Cell::Options(vec![OptionId::from_uuid(VIP)])),
                (DONE, Cell::Bool(true)),
            ],
        ),
        row(
            0xa2,
            vec![
                (NAME, Cell::Text("Globex".into())),
                (AMOUNT, Cell::Number(3000.0)),
                (STAGE, Cell::Options(vec![OptionId::from_uuid(LEAD)])),
                (OWNER, Cell::Entities(vec!["macro|sam@example.com".into()])),
            ],
        ),
        row(
            0xa3,
            vec![
                (NAME, Cell::Text("Hooli".into())),
                (STAGE, Cell::Options(vec![OptionId::from_uuid(WON)])),
                (CLOSED_AT, date(2026, 9, 15)),
                (OWNER, Cell::Entities(vec!["macro|ana@example.com".into()])),
                (
                    TAGS,
                    Cell::Options(vec![OptionId::from_uuid(VIP), OptionId::from_uuid(RENEWAL)]),
                ),
            ],
        ),
        row(
            0xa4,
            vec![
                (NAME, Cell::Text("Initech".into())),
                (AMOUNT, Cell::Number(7000.0)),
                (STAGE, Cell::Options(vec![OptionId::from_uuid(LOST)])),
                (DONE, Cell::Bool(false)),
            ],
        ),
        row(
            0xa5,
            vec![
                (NAME, Cell::Text("Umbrella".into())),
                (AMOUNT, Cell::Number(45000.0)),
                (OWNER, Cell::Entities(vec!["macro|ana@example.com".into()])),
            ],
        ),
    ]
}

/// The whole "server": rows in memory. Reads honour the pushed-down filter
/// the way Soup would; writes land as cells.
struct Memory {
    catalog: Catalog,
    rows: Mutex<Vec<Row>>,
}

impl Memory {
    /// Soup semantics for `propf`: `so` and `er` literals test membership,
    /// `not` is a set difference, so empty cells pass a `not`.
    fn matches(
        expr: &filter_ast::Expr<item_filters::ast::properties::PropertiesLiteral>,
        row: &Row,
    ) -> bool {
        use filter_ast::Expr;
        use item_filters::ast::properties::PropertyMatchValue;
        match expr {
            Expr::And(left, right) => Self::matches(left, row) && Self::matches(right, row),
            Expr::Or(left, right) => Self::matches(left, row) || Self::matches(right, row),
            Expr::Not(inner) => !Self::matches(inner, row),
            Expr::Literal(literal) => match (
                row.cells.get(&literal.property_definition_id),
                &literal.value,
            ) {
                (Some(Cell::Options(ids)), PropertyMatchValue::SelectOption(id)) => {
                    ids.contains(&OptionId::from_uuid(*id))
                }
                (Some(Cell::Entities(ids)), PropertyMatchValue::EntityRef(id)) => {
                    ids.iter().any(|candidate| candidate == &id.to_string())
                }
                _ => false,
            },
        }
    }

    fn select(&self, query: &GqlQuery) -> Vec<Row> {
        let property_filter = match query {
            GqlQuery::Soup {
                property_filter, ..
            }
            | GqlQuery::GroupSoup {
                property_filter, ..
            } => property_filter,
            GqlQuery::People { .. } => &None,
        };
        self.rows
            .lock()
            .unwrap()
            .iter()
            .filter(|row| {
                property_filter
                    .as_ref()
                    .is_none_or(|expr| Self::matches(expr, row))
            })
            .cloned()
            .collect()
    }
}

/// A read the in-memory table cannot answer.
#[derive(Debug, thiserror::Error)]
#[error("bins need a groupSoup query")]
struct NotGrouped;

/// A write the in-memory table refuses.
#[derive(Debug, thiserror::Error)]
enum Refused {
    #[error("no column {0}")]
    NoColumn(ColumnId),
    #[error("no option {0}")]
    NoOption(String),
    #[error("no row {0}")]
    NoRow(RowId),
    #[error("the REPL's schema is fixed")]
    SchemaFixed,
}

impl RowSource for Memory {
    type Error = NotGrouped;

    async fn page(
        &self,
        query: &GqlQuery,
        _needs: &[Uuid],
        cursor: Option<String>,
        limit: usize,
    ) -> Result<Page, Self::Error> {
        let rows = self.select(query);
        let start: usize = cursor.map_or(0, |cursor| cursor.parse().unwrap_or(0));
        let end = (start + limit).min(rows.len());
        Ok(Page {
            rows: rows[start..end].to_vec(),
            next: (end < rows.len()).then(|| end.to_string()),
        })
    }

    async fn bins(&self, query: &GqlQuery) -> Result<Vec<Bin>, Self::Error> {
        let GqlQuery::GroupSoup { group_by, .. } = query else {
            return Err(NotGrouped);
        };
        let mut bins: Vec<Bin> = Vec::new();
        for row in self.select(query) {
            let key = row.cells.get(group_by).cloned();
            match bins.iter_mut().find(|bin| bin.key == key) {
                Some(bin) => bin.count += 1,
                None => bins.push(Bin { key, count: 1 }),
            }
        }
        Ok(bins)
    }
}

impl Memory {
    /// A written value as the cell it stores; `None` empties the cell.
    fn cell(&self, column: ColumnId, value: CellValue) -> Result<Option<Cell>, Refused> {
        let options = self
            .catalog
            .tables
            .iter()
            .flat_map(|table| &table.columns)
            .find(|candidate| candidate.placement == column)
            .map(|column| match &column.kind {
                ColumnKind::Select { options, .. } => options.clone(),
                _ => Vec::new(),
            })
            .ok_or(Refused::NoColumn(column))?;
        Ok(match value {
            CellValue::Clear => None,
            CellValue::Text(text) => Some(Cell::Text(text)),
            CellValue::Number(number) => Some(Cell::Number(number)),
            CellValue::Boolean(checked) => Some(Cell::Bool(checked)),
            CellValue::Date(date) => Some(Cell::Date(date)),
            CellValue::Link(urls) => Some(Cell::Text(urls.join(" "))),
            CellValue::Options(refs) => Some(Cell::Options(
                refs.into_iter()
                    .map(|option| match option {
                        OptionRef::Id(id) => Ok(id),
                        OptionRef::Label(label) => options
                            .iter()
                            .find(|option| option.label.eq_ignore_ascii_case(&label))
                            .map(|option| option.id)
                            .ok_or(Refused::NoOption(label)),
                    })
                    .collect::<Result<_, _>>()?,
            )),
            CellValue::Entities(refs) => Some(Cell::Entities(
                refs.into_iter()
                    .map(|reference| reference.entity_id)
                    .collect(),
            )),
            CellValue::Rows(rows) => {
                Some(Cell::Entities(rows.iter().map(RowId::to_string).collect()))
            }
        })
    }

    fn write(&self, row: &mut Row, cells: Vec<CellWrite>) -> Result<(), Refused> {
        for write in cells {
            match self.cell(write.column, write.value)? {
                Some(cell) => {
                    row.cells.insert(write.column.into_uuid(), cell);
                }
                None => {
                    row.cells.remove(write.column.as_uuid());
                }
            }
        }
        Ok(())
    }
}

impl OpsSink for Memory {
    type Error = Refused;

    async fn apply(
        &self,
        _database: DatabaseId,
        ops: Vec<DatabaseOp>,
    ) -> Result<Vec<OpResult>, Self::Error> {
        let mut stored = self.rows.lock().unwrap();
        let mut results = Vec::new();
        for op in ops {
            let DatabaseOp::Rows { table, change } = op else {
                return Err(Refused::SchemaFixed);
            };
            let change = match change {
                RowsChange::Insert { rows } => {
                    let mut inserted = Vec::new();
                    for cells in rows {
                        let mut row = Row {
                            id: RowId::from_uuid(Uuid::now_v7()),
                            position: None,
                            cells: HashMap::new(),
                        };
                        self.write(&mut row, cells)?;
                        inserted.push(row.id);
                        stored.push(row);
                    }
                    RowsResult::Inserted { rows: inserted }
                }
                RowsChange::Update { changes } => {
                    let changes: Vec<(RowId, Vec<CellWrite>)> = match changes {
                        RowChanges::Uniform { rows, cells } => {
                            rows.into_iter().map(|row| (row, cells.clone())).collect()
                        }
                        RowChanges::PerRow { rows } => rows
                            .into_iter()
                            .map(|change| (change.row, change.cells))
                            .collect(),
                    };
                    let affected = changes.len();
                    for (id, cells) in changes {
                        let row = stored
                            .iter_mut()
                            .find(|row| row.id == id)
                            .ok_or(Refused::NoRow(id))?;
                        self.write(row, cells)?;
                    }
                    RowsResult::Updated {
                        affected: affected as u32,
                    }
                }
                RowsChange::Delete { rows } => {
                    stored.retain(|row| !rows.contains(&row.id));
                    RowsResult::Deleted {
                        affected: rows.len() as u32,
                    }
                }
            };
            results.push(OpResult::Rows {
                table,
                table_version: TableVersion(0),
                change,
            });
        }
        Ok(results)
    }
}

fn main() {
    let catalog = catalog();
    let memory = Memory {
        catalog: catalog.clone(),
        rows: Mutex::new(seed()),
    };
    println!(
        "database_sql repl — table crm.deals(name, amount, stage, \"closed at\", owner, tags, done)"
    );
    println!(
        "try: SELECT name, amount FROM crm.deals WHERE stage = 'Won' AND amount > 5000 ORDER BY amount DESC"
    );
    println!("     SELECT stage, COUNT(*) FROM crm.deals GROUP BY stage");
    println!(
        "     SELECT owner, SUM(amount) FROM crm.deals WHERE tags HAS 'vip' OR amount > 10000 GROUP BY owner"
    );
    println!("     INSERT INTO crm.deals (name, stage, amount) VALUES ('Vandelay', 'Lead', 900)");
    println!("     \\rows  \\catalog  \\q");
    let stdin = io::stdin();
    loop {
        print!("sql> ");
        io::stdout().flush().unwrap();
        let mut line = String::new();
        if stdin.lock().read_line(&mut line).unwrap() == 0 {
            break;
        }
        let sql = line.trim();
        match sql {
            "" => continue,
            "\\q" => break,
            "\\catalog" => {
                for table in &catalog.tables {
                    println!("  {}.{}", table.database, table.name);
                    for column in &table.columns {
                        println!("    {:<12} {:?}", column.name, column.kind);
                    }
                }
                continue;
            }
            "\\rows" => {
                for row in memory.rows.lock().unwrap().iter() {
                    let cells: HashMap<&Uuid, &Cell> = row.cells.iter().collect();
                    let mut named: Vec<String> = catalog.tables[0]
                        .columns
                        .iter()
                        .filter_map(|column| {
                            cells.get(&column.id).map(|cell| {
                                format!("{}={}", column.name, common::show(&catalog, Some(cell)))
                            })
                        })
                        .collect();
                    named.insert(0, row.id.to_string());
                    println!("  {}", named.join("  "));
                }
                continue;
            }
            _ => {}
        }
        common::print_plan(&catalog, sql);
        match pollster::block_on(run(&catalog, sql, &memory, &memory)) {
            Ok(outcome) => common::print_outcome(&catalog, &outcome),
            Err(error) => common::print_failure(&error),
        }
    }
}
