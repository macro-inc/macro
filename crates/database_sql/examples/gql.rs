//! The engine over the real GraphQL API of a running Macro stack, with your
//! tasks as the table `macro.tasks`.
//!
//! ```sh
//! cargo run -p database_sql --example gql -- --url http://localhost:32015 --token-file token
//! ```
//!
//! The token is a user JWT; locally the passwordless flow hands one out:
//!
//! ```sh
//! code=$(curl -s $AUTH/login/passwordless -H content-type:application/json \
//!   -d '{"email":"you@example.com","redirect_uri":"http://localhost/app"}' | jq -r .code)
//! curl -s "$AUTH/oauth/passwordless/$code?email=you%40example.com&disable_redirect=true" | jq -r .access_token > token
//! ```
//!
//! Reads go through `Query.soup` / `Query.groupSoup` with the plan's `propf`
//! pushed down exactly as the browser will send it; writes go through
//! `setEntityProperty` and `POST /documents/create_task`. Every task property
//! definition the API returns is a column; the task title is the `name`
//! column.

mod common;

use models_databases::{ColumnId, DatabaseId, OptionId, RowId, TableId};
use std::collections::HashMap;
use std::io::{self, BufRead, Write};

use chrono::DateTime;
use clap::Parser;
use database_sql::catalog::{
    Catalog, ColumnKind, ColumnSchema, DataType, DatabaseSchema, EntityKind, OptionSchema,
    OptionValue, PropertyType, Schema, SelectOption, TableSchema, build,
};
use database_sql::fold::{Bin, Cell, Row};
use database_sql::run::{OpsSink, Page, RowSource, run};
use database_sql::split::GqlQuery;
use filter_ast::Expr;
use item_filters::ast::properties::{PropertiesLiteral, PropertyMatchValue};
use models_databases::{
    CellValue, CellWrite, DatabaseOp, OpResult, OptionRef, RowChanges, RowsChange, RowsResult,
    TableVersion,
};
use serde::Deserialize;
use serde_json::{Value as Json, json};
use uuid::Uuid;

const TASKS: Uuid = Uuid::from_u128(0x7a5c);
/// The task title is not a property; it gets a column of its own.
const NAME: Uuid = Uuid::from_u128(0x7a5c_0001);
const NIL: &str = "00000000-0000-0000-0000-000000000000";

const PROPERTY_FIELDS: &str = r#"
fragment SoupPropertyFields on GraphqlProperty {
  propertyDefinitionId
  value {
    __typename
    ... on GraphqlBooleanPropertyValue { boolValue: value }
    ... on GraphqlNumberPropertyValue { numberValue: value }
    ... on GraphqlStringPropertyValue { stringValue: value }
    ... on GraphqlDatePropertyValue { dateValue: value }
    ... on GraphqlSelectOptionPropertyValue { optionIds }
    ... on GraphqlEntityReferencePropertyValue { references { entityId entityType } }
    ... on GraphqlLinkPropertyValue { urls }
  }
}"#;

/// The engine over a running stack's GraphQL API, with your tasks as
/// `macro.tasks`.
#[derive(Parser)]
struct Arguments {
    /// The stack's API base URL.
    #[arg(long, default_value = "http://localhost:32015")]
    url: String,
    /// A file holding a user JWT.
    #[arg(long, default_value = "databases-demo-token")]
    token_file: String,
}

/// Why the API did not answer.
#[derive(Debug, thiserror::Error)]
enum ApiError {
    #[error(transparent)]
    Http(#[from] reqwest::Error),
    #[error("the API answered with errors: {0}")]
    Graphql(Json),
    #[error("{status}: {body}")]
    Status {
        status: reqwest::StatusCode,
        body: Json,
    },
    #[error("unexpected response: {0}")]
    Shape(#[from] serde_json::Error),
    #[error("option {0} has neither a text nor a number value")]
    OptionValue(Uuid),
}

/// Why a read did not land.
#[derive(Debug, thiserror::Error)]
enum ReadError {
    #[error(transparent)]
    Api(#[from] ApiError),
    #[error("a page needs a soup query")]
    NotSoup,
    #[error("bins need a groupSoup query")]
    NotGrouped,
}

/// Why a write did not land.
#[derive(Debug, thiserror::Error)]
enum WriteError {
    #[error(transparent)]
    Api(#[from] ApiError),
    #[error("no option {0}")]
    NoOption(String),
    #[error("tasks have no relation columns")]
    RelationColumn,
    #[error("the task title is renamed in the app, not by SQL")]
    TitleRename,
    #[error("INSERT into macro.tasks needs a name")]
    NameMissing,
    #[error("create_task answered without an id: {0}")]
    NoTaskId(Json),
    #[error("deleting tasks is not wired here; trash it in the app")]
    DeleteNotWired,
    #[error("only row writes are wired here; change the schema in the app")]
    SchemaNotWired,
}

/// One property definition as `propertyDefinitions` lists it.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Definition {
    id: Uuid,
    display_name: String,
    data_type: DataType,
    is_multi_select: bool,
    specific_entity_type: Option<EntityKind>,
    is_metadata: bool,
    options: Vec<DefinitionOption>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DefinitionOption {
    id: Uuid,
    display_order: i32,
    value: DefinitionOptionValue,
}

/// `s` for a text option, `n` for a numeric one, as the query aliases them.
#[derive(Deserialize)]
struct DefinitionOptionValue {
    s: Option<String>,
    n: Option<f64>,
}

struct Api {
    base: String,
    token: String,
    http: reqwest::Client,
    /// Per definition: multi-valued, and the entity type references take.
    definitions: HashMap<Uuid, (bool, String)>,
    /// The catalog writes resolve option labels against.
    catalog: Catalog,
}

impl Api {
    async fn gql(&self, query: &str, variables: Json) -> Result<Json, ApiError> {
        let response = self
            .http
            .post(format!("{}/items/soup/graphql", self.base))
            .bearer_auth(&self.token)
            .json(&json!({ "query": query, "variables": variables }))
            .send()
            .await?;
        let status = response.status();
        let body: Json = response.json().await?;
        if let Some(errors) = body.get("errors") {
            return Err(ApiError::Graphql(errors.clone()));
        }
        if !status.is_success() {
            return Err(ApiError::Status { status, body });
        }
        Ok(body["data"].clone())
    }

    /// Every task property definition as a column, plus the title, built
    /// into a catalog the way the server builds one.
    async fn catalog(&mut self) -> Result<Catalog, ApiError> {
        let data = self
            .gql(
                r#"query { user { propertyDefinitions(scope: ALL, forEntityType: TASK) {
                     id displayName dataType isMultiSelect specificEntityType isMetadata
                     options { id displayOrder value { __typename
                       ... on GraphqlStringPropertyOptionValue { s: value }
                       ... on GraphqlNumberPropertyOptionValue { n: value } } }
                   } } }"#,
                json!({}),
            )
            .await?;
        let definitions: Vec<Definition> =
            serde_json::from_value(data["user"]["propertyDefinitions"].clone())?;
        let mut columns = vec![ColumnSchema {
            id: ColumnId::from_uuid(NAME),
            definition: NAME,
            name: "name".into(),
            property: PropertyType {
                data_type: DataType::String,
                multi: false,
                entity_type: None,
                relation: false,
            },
            options: Vec::new(),
        }];
        for definition in definitions
            .into_iter()
            .filter(|definition| !definition.is_metadata)
        {
            let entity_type = definition.specific_entity_type.unwrap_or(EntityKind::User);
            self.definitions.insert(
                definition.id,
                (
                    definition.is_multi_select,
                    entity_type.sql_name().to_owned(),
                ),
            );
            let options = definition
                .options
                .into_iter()
                .map(|option| {
                    let value = match (option.value.s, option.value.n) {
                        (Some(text), _) => OptionValue::String(text),
                        (None, Some(number)) => OptionValue::Number(number),
                        (None, None) => return Err(ApiError::OptionValue(option.id)),
                    };
                    Ok(OptionSchema {
                        id: OptionId::from_uuid(option.id),
                        value,
                        order: option.display_order,
                    })
                })
                .collect::<Result<_, _>>()?;
            columns.push(ColumnSchema {
                id: ColumnId::from_uuid(definition.id),
                definition: definition.id,
                name: definition.display_name,
                property: PropertyType {
                    data_type: definition.data_type,
                    multi: definition.is_multi_select,
                    entity_type: definition.specific_entity_type,
                    relation: false,
                },
                options,
            });
        }
        let schema = Schema {
            databases: vec![DatabaseSchema {
                id: DatabaseId::from_uuid(TASKS),
                name: "macro".into(),
                tables: vec![TableSchema {
                    id: TableId::from_uuid(TASKS),
                    name: "tasks".into(),
                    columns,
                }],
            }],
            platform: Vec::new(),
        };
        Ok(build(&schema, Some(DatabaseId::from_uuid(TASKS))))
    }
}

/// The Soup `propf` input, from the plan's expression.
fn property_filter_input(expr: &Expr<PropertiesLiteral>) -> Json {
    match expr {
        Expr::And(left, right) => {
            json!({ "and": { "left": property_filter_input(left), "right": property_filter_input(right) } })
        }
        Expr::Or(left, right) => {
            json!({ "or": { "left": property_filter_input(left), "right": property_filter_input(right) } })
        }
        Expr::Not(inner) => json!({ "not": property_filter_input(inner) }),
        Expr::Literal(literal) => {
            let value = match &literal.value {
                PropertyMatchValue::SelectOption(id) => json!({ "selectOption": id }),
                PropertyMatchValue::EntityRef(id) => json!({ "entityRef": id.to_string() }),
            };
            json!({ "literal": { "propertyDefinitionId": literal.property_definition_id, "value": value } })
        }
    }
}

/// Tasks only: every other Soup entity type is excluded with an impossible
/// id, the way the Tasks view does it.
fn filters(property_filter: &Option<Expr<PropertiesLiteral>>) -> Json {
    let mut filters = json!({
        "documentFilter": { "literal": { "subType": "TASK" } },
        "projectFilter": { "literal": { "projectId": NIL } },
        "chatFilter": { "literal": { "chatId": NIL } },
        "emailFilter": { "tree": { "literal": { "threadId": NIL } } },
        "channelFilter": { "literal": { "channelId": NIL } },
        "channelThreadFilter": { "literal": { "threadId": NIL } },
        "callFilter": { "literal": { "callId": NIL } },
        "crmCompanyFilter": { "literal": { "id": NIL } },
        "foreignEntityFilter": { "literal": { "id": NIL } },
        "calendarEventFilter": { "literal": { "id": NIL } },
    });
    if let Some(expr) = property_filter {
        filters["propertiesFilter"] = property_filter_input(expr);
    }
    filters
}

/// A Soup item's properties as cells.
fn row_from_item(item: &Json) -> Row {
    let id = item["id"]
        .as_str()
        .and_then(|id| id.parse().ok())
        .unwrap_or_else(|| {
            Uuid::new_v5(
                &Uuid::NAMESPACE_OID,
                item["id"].as_str().unwrap_or("").as_bytes(),
            )
        });
    let mut cells = HashMap::new();
    if let Some(name) = item["documentName"].as_str() {
        cells.insert(NAME, Cell::Text(name.to_owned()));
    }
    for property in item["properties"].as_array().unwrap_or(&vec![]) {
        let Some(definition) = property["propertyDefinitionId"]
            .as_str()
            .and_then(|id| id.parse::<Uuid>().ok())
        else {
            continue;
        };
        let value = &property["value"];
        let cell = match value["__typename"].as_str().unwrap_or("") {
            "GraphqlBooleanPropertyValue" => value["boolValue"].as_bool().map(Cell::Bool),
            "GraphqlNumberPropertyValue" => value["numberValue"].as_f64().map(Cell::Number),
            "GraphqlStringPropertyValue" => value["stringValue"]
                .as_str()
                .map(|s| Cell::Text(s.to_owned())),
            "GraphqlDatePropertyValue" => value["dateValue"]
                .as_str()
                .and_then(|date| DateTime::parse_from_rfc3339(date).ok())
                .map(|d| Cell::Date(d.to_utc())),
            "GraphqlSelectOptionPropertyValue" => Some(Cell::Options(
                value["optionIds"]
                    .as_array()
                    .unwrap_or(&vec![])
                    .iter()
                    .filter_map(|id| id.as_str().and_then(|id| id.parse().ok()))
                    .collect(),
            )),
            "GraphqlEntityReferencePropertyValue" => Some(Cell::Entities(
                value["references"]
                    .as_array()
                    .unwrap_or(&vec![])
                    .iter()
                    .filter_map(|reference| reference["entityId"].as_str().map(str::to_owned))
                    .collect(),
            )),
            "GraphqlLinkPropertyValue" => value["urls"]
                .as_array()
                .and_then(|urls| urls.first())
                .and_then(|url| url.as_str())
                .map(|url| Cell::Text(url.to_owned())),
            _ => None,
        };
        if let Some(cell) = cell {
            cells.insert(definition, cell);
        }
    }
    Row {
        id: RowId::from_uuid(id),
        position: None,
        cells,
    }
}

impl RowSource for Api {
    type Error = ReadError;

    async fn page(
        &self,
        query: &GqlQuery,
        _needs: &[Uuid],
        cursor: Option<String>,
        limit: usize,
    ) -> Result<Page, Self::Error> {
        let GqlQuery::Soup {
            property_filter, ..
        } = query
        else {
            return Err(ReadError::NotSoup);
        };
        let input = match cursor {
            Some(cursor) => {
                json!({ "continuation": { "cursor": cursor, "expand": true, "sortDirection": "DESC" } })
            }
            None => json!({ "initial": {
                "limit": limit.min(500), "expand": true, "sortMethod": "UPDATED_AT", "sortDirection": "DESC",
                "filters": filters(property_filter),
            } }),
        };
        let data = self
            .gql(
                &format!(
                    r#"query TaskSoup($input: SoupInput!) {{ user {{ soup(input: $input) {{
                         items {{ __typename id ... on GraphqlSoupDocument {{ documentName: name properties {{ ...SoupPropertyFields }} }} }}
                         nextCursor }} }} }} {PROPERTY_FIELDS}"#
                ),
                json!({ "input": input }),
            )
            .await?;
        let soup = &data["user"]["soup"];
        Ok(Page {
            rows: soup["items"]
                .as_array()
                .unwrap_or(&vec![])
                .iter()
                .map(row_from_item)
                .collect(),
            next: soup["nextCursor"].as_str().map(str::to_owned),
        })
    }

    async fn bins(&self, query: &GqlQuery) -> Result<Vec<Bin>, Self::Error> {
        let GqlQuery::GroupSoup {
            property_filter,
            group_by,
            ..
        } = query
        else {
            return Err(ReadError::NotGrouped);
        };
        let data = self
            .gql(
                r#"query GroupSoup($input: GroupedSoupInput!) { user { groupSoup(input: $input) {
                     bins { key totalCount } } } }"#,
                json!({ "input": { "initial": {
                    "groupBy": { "field": "PROPERTY", "propertyDefinitionId": group_by },
                    "limit": 1, "sortMethod": "UPDATED_AT", "filters": filters(property_filter),
                } } }),
            )
            .await?;
        Ok(data["user"]["groupSoup"]["bins"]
            .as_array()
            .unwrap_or(&vec![])
            .iter()
            .map(|bin| {
                let key = bin["key"].as_str().unwrap_or("");
                let key = if key.is_empty() {
                    None
                } else if let Ok(id) = key.parse::<Uuid>() {
                    // Select bins are keyed by option id; entity bins by the
                    // entity id, which is never a bare UUID for users.
                    Some(Cell::Options(vec![OptionId::from_uuid(id)]))
                } else {
                    Some(Cell::Entities(vec![key.to_owned()]))
                };
                Bin {
                    key,
                    count: bin["totalCount"].as_u64().unwrap_or(0),
                }
            })
            .collect())
    }
}

impl Api {
    /// The option ids a column's written options name.
    fn option_ids(
        &self,
        column: Uuid,
        options: Vec<OptionRef>,
    ) -> Result<Vec<OptionId>, WriteError> {
        let labels: Vec<SelectOption> = self
            .catalog
            .tables
            .iter()
            .flat_map(|table| &table.columns)
            .find(|candidate| candidate.placement == ColumnId::from_uuid(column))
            .map(|column| match &column.kind {
                ColumnKind::Select { options, .. } => options.clone(),
                _ => Vec::new(),
            })
            .unwrap_or_default();
        options
            .into_iter()
            .map(|option| match option {
                OptionRef::Id(id) => Ok(id),
                OptionRef::Label(label) => labels
                    .iter()
                    .find(|option| option.label.eq_ignore_ascii_case(&label))
                    .map(|option| option.id)
                    .ok_or(WriteError::NoOption(label)),
            })
            .collect()
    }

    /// The `setEntityProperty` value input for one cell.
    fn property_input(&self, column: Uuid, value: CellValue) -> Result<Json, WriteError> {
        let (multi, entity_type) = self
            .definitions
            .get(&column)
            .cloned()
            .unwrap_or((false, "USER".into()));
        Ok(match value {
            CellValue::Clear => Json::Null,
            CellValue::Text(text) => json!({ "string": text }),
            CellValue::Link(urls) => json!({ "string": urls.join(" ") }),
            CellValue::Number(number) => json!({ "number": number }),
            CellValue::Boolean(checked) => json!({ "boolean": checked }),
            CellValue::Date(date) => json!({ "date": date.to_rfc3339() }),
            CellValue::Options(options) => {
                let ids = self.option_ids(column, options)?;
                if multi {
                    json!({ "multiSelectOption": ids })
                } else {
                    json!({ "selectOption": ids.first() })
                }
            }
            CellValue::Entities(references) => {
                let references: Vec<Json> = references
                    .iter()
                    .map(|reference| json!({ "entityType": entity_type, "entityId": reference.entity_id }))
                    .collect();
                if multi {
                    json!({ "multiEntityReference": references })
                } else {
                    json!({ "entityReference": references.first() })
                }
            }
            CellValue::Rows(_) => {
                return Err(WriteError::RelationColumn);
            }
        })
    }

    async fn set(&self, task: RowId, column: ColumnId, value: CellValue) -> Result<(), WriteError> {
        if column == ColumnId::from_uuid(NAME) {
            return Err(WriteError::TitleRename);
        }
        let value = self.property_input(column.into_uuid(), value)?;
        self.gql(
            r#"mutation Set($input: SetEntityPropertyInput!) { setEntityProperty(input: $input) { id } }"#,
            json!({ "input": {
                "entityType": "DOCUMENT", "entityId": task, "propertyDefinitionId": column,
                "value": value,
            } }),
        )
        .await?;
        Ok(())
    }

    async fn create(&self, cells: Vec<CellWrite>) -> Result<RowId, WriteError> {
        let name = cells
            .iter()
            .find_map(|cell| match &cell.value {
                CellValue::Text(text) if cell.column == ColumnId::from_uuid(NAME) => {
                    Some(text.clone())
                }
                _ => None,
            })
            .ok_or(WriteError::NameMissing)?;
        let response = self
            .http
            .post(format!("{}/documents/create_task", self.base))
            .bearer_auth(&self.token)
            .json(&json!({ "taskName": name, "markdown": null, "shareWithTeam": true }))
            .send()
            .await
            .map_err(ApiError::from)?;
        let status = response.status();
        let body: Json = response.json().await.map_err(ApiError::from)?;
        if !status.is_success() {
            return Err(ApiError::Status { status, body }.into());
        }
        let task: RowId = body["documentId"]
            .as_str()
            .and_then(|id| id.parse().ok())
            .ok_or_else(|| WriteError::NoTaskId(body.clone()))?;
        for cell in cells {
            if cell.column != ColumnId::from_uuid(NAME) {
                self.set(task, cell.column, cell.value).await?;
            }
        }
        Ok(task)
    }
}

impl OpsSink for Api {
    type Error = WriteError;

    async fn apply(
        &self,
        _database: DatabaseId,
        ops: Vec<DatabaseOp>,
    ) -> Result<Vec<OpResult>, Self::Error> {
        let mut results = Vec::new();
        for op in ops {
            let DatabaseOp::Rows { table, change } = op else {
                return Err(WriteError::SchemaNotWired);
            };
            let change = match change {
                RowsChange::Insert { rows } => {
                    let mut inserted = Vec::new();
                    for cells in rows {
                        inserted.push(self.create(cells).await?);
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
                    for (task, cells) in changes {
                        for cell in cells {
                            self.set(task, cell.column, cell.value).await?;
                        }
                    }
                    RowsResult::Updated {
                        affected: affected as u32,
                    }
                }
                RowsChange::Delete { .. } => {
                    return Err(WriteError::DeleteNotWired);
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

#[tokio::main]
async fn main() {
    let arguments = Arguments::parse();
    let token = match std::fs::read_to_string(&arguments.token_file) {
        Ok(token) => token.trim().to_owned(),
        Err(error) => {
            eprintln!(
                "could not read the token file {}: {error}",
                arguments.token_file
            );
            std::process::exit(1);
        }
    };
    let mut api = Api {
        base: arguments.url,
        token,
        http: reqwest::Client::new(),
        definitions: HashMap::new(),
        catalog: Catalog::default(),
    };
    let catalog = match api.catalog().await {
        Ok(catalog) => catalog,
        Err(error) => {
            eprintln!("could not load the catalog: {error}");
            std::process::exit(1);
        }
    };
    api.catalog = catalog.clone();
    println!("database_sql over {} — table macro.tasks", api.base);
    println!(
        "columns: {}",
        catalog.tables[0]
            .columns
            .iter()
            .map(|column| format!("\"{}\"", column.name))
            .collect::<Vec<_>>()
            .join(", ")
    );
    println!(
        "try: SELECT name, Status, Priority, \"Due Date\" FROM macro.tasks WHERE Status = 'In Progress' ORDER BY \"Due Date\""
    );
    println!("     \\catalog  \\q");

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
                for column in &catalog.tables[0].columns {
                    println!("  {:<24} {:?}", column.name, column.kind);
                }
                continue;
            }
            _ => {}
        }
        common::print_plan(&catalog, sql);
        match run(&catalog, sql, &api, &api).await {
            Ok(outcome) => common::print_outcome(&catalog, &outcome),
            Err(error) => common::print_failure(&error),
        }
    }
}
