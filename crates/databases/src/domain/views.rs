//! Personal database views, validated against the database schema and persisted
//! through the owning saved-views storage port.

use std::collections::HashSet;
use std::sync::Arc;

use async_trait::async_trait;
use entity_access::domain::models::{EntityAccessReceipt, ViewAccessLevel};
use models_properties::shared::DataType;
use saved_views::{View, ViewPatch, ViewStorage};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::models::{DatabaseError, TableId, Viewer};
use super::ports::DatabasesService;

#[cfg(test)]
mod test;

/// Layouts the database UI can persist and render.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "ai_tools", derive(schemars::JsonSchema))]
#[serde(rename_all = "snake_case")]
pub enum ViewLayout {
    /// Spreadsheet-style table.
    Table,
    /// Cards grouped by a select, multi-select, or checkbox field.
    Board,
}

/// Supported database filter operations.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[cfg_attr(feature = "ai_tools", derive(schemars::JsonSchema))]
#[serde(rename_all = "snake_case")]
pub enum FilterOperator {
    /// Text or list contains the value.
    Contains,
    /// Text or list does not contain the value.
    NotContains,
    /// Equal to the value.
    Equals,
    /// Unequal to the value.
    NotEquals,
    /// Text begins with the value.
    StartsWith,
    /// No value is present.
    IsEmpty,
    /// A value is present.
    IsNotEmpty,
    /// Numeric/date value is greater than the value.
    Gt,
    /// Numeric/date value is greater than or equal to the value.
    Gte,
    /// Numeric/date value is less than the value.
    Lt,
    /// Numeric/date value is less than or equal to the value.
    Lte,
}

/// One filter, using the stable column placement id.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "ai_tools", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
pub struct ViewFilter {
    /// Column placement id from DescribeDatabase.
    pub column_id: Uuid,
    /// How to compare the column value.
    pub operator: FilterOperator,
    /// Comparison text. Numbers use a finite decimal; dates use YYYY-MM-DD;
    /// checkboxes accept 1/0 or true/false. Empty operators need no value.
    pub value: String,
}

/// Sort direction.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[cfg_attr(feature = "ai_tools", derive(schemars::JsonSchema))]
#[serde(rename_all = "snake_case")]
pub enum SortDirection {
    /// Smallest/earliest first.
    Asc,
    /// Largest/latest first.
    Desc,
}

/// One ordered sort key.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "ai_tools", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
pub struct ViewSort {
    /// Column placement id from DescribeDatabase.
    pub column_id: Uuid,
    /// Ascending or descending.
    pub direction: SortDirection,
}

/// Presentation configuration shared with the database frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "ai_tools", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
pub struct DatabaseViewDefinition {
    /// Table or board; chart layouts are not supported by saved database views.
    pub layout: ViewLayout,
    /// A select, multi-select, or checkbox column id for a board; null for a table.
    #[serde(default)]
    pub group_by: Option<Uuid>,
    /// Lane keys in display order: `empty` or `value:` followed by a JSON label.
    /// Omit for alphabetical order; additional lanes follow alphabetically.
    #[serde(default)]
    pub group_order: Vec<String>,
    /// Filters are combined with AND.
    #[serde(default)]
    pub filters: Vec<ViewFilter>,
    /// Sort priority, first item first.
    #[serde(default)]
    pub sorts: Vec<ViewSort>,
    /// Column ids to hide from this view.
    #[serde(default)]
    pub hidden_columns: Vec<Uuid>,
    /// Display order; unlisted columns follow in schema order.
    #[serde(default)]
    pub column_order: Vec<Uuid>,
    /// Optional local text search, empty for all rows.
    #[serde(default)]
    pub search: String,
}

/// Save a named personal view of an accessible table.
pub struct SaveDatabaseViewCommand {
    /// Table within the database proved by the receipt.
    pub table_id: TableId,
    /// View name displayed in the view menu.
    pub name: String,
    /// The requested layout and row/column presentation.
    pub view: DatabaseViewDefinition,
}

/// A persisted personal view acknowledgment.
#[derive(Debug, Serialize)]
#[cfg_attr(feature = "ai_tools", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
pub struct SavedDatabaseView {
    /// Id in the user's saved-view collection.
    pub view_id: Uuid,
    /// Database containing the source table.
    pub database_id: Uuid,
    /// Source table id.
    pub table_id: Uuid,
    /// Trimmed persisted name.
    pub name: String,
    /// The exact frontend-compatible saved configuration.
    pub config: serde_json::Value,
    /// True for a new view; false when updating the same name on this table.
    pub created: bool,
}

/// Domain capability for personal database views.
#[async_trait]
pub trait DatabaseViewService: Send + Sync + 'static {
    /// Validate a personal view and save it only for the acting user.
    async fn save_view(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
        viewer: Viewer,
        command: SaveDatabaseViewCommand,
    ) -> Result<SavedDatabaseView, DatabaseError>;
}

/// Composes schema/access facts from the databases service with saved-view storage.
pub struct DatabaseViewsServiceImpl<S, V> {
    databases: Arc<S>,
    views: V,
}

impl<S, V> DatabaseViewsServiceImpl<S, V> {
    /// Construct the personal-view use case from owning domain ports.
    pub fn new(databases: Arc<S>, views: V) -> Self {
        Self { databases, views }
    }
}

fn invalid(message: impl Into<String>) -> DatabaseError {
    DatabaseError::InvalidSchemaOperation(message.into())
}

fn storage_error<E: std::error::Error + Send + Sync + 'static>(error: E) -> DatabaseError {
    DatabaseError::Repo(rootcause::Report::new(error).into_dynamic())
}

fn valid_group_key(key: &str) -> bool {
    if key == "empty" {
        return true;
    }
    let Some(value) = key.strip_prefix("value:") else {
        return false;
    };
    matches!(
        serde_json::from_str::<serde_json::Value>(value),
        Ok(serde_json::Value::String(_) | serde_json::Value::Number(_))
    )
}

fn filter_value(data_type: DataType, filter: &ViewFilter) -> Result<String, DatabaseError> {
    if matches!(
        filter.operator,
        FilterOperator::IsEmpty | FilterOperator::IsNotEmpty
    ) {
        return Ok(String::new());
    }
    let value = filter.value.trim();
    if value.is_empty() {
        return Err(invalid(
            "This filter needs a value; use is_empty for empty cells.",
        ));
    }
    match data_type {
        DataType::Number => {
            if !value.parse::<f64>().is_ok_and(f64::is_finite) {
                return Err(invalid("A number filter needs a finite numeric value."));
            }
            Ok(value.to_string())
        }
        DataType::Boolean => match value.to_ascii_lowercase().as_str() {
            "true" | "1" => Ok("1".into()),
            "false" | "0" => Ok("0".into()),
            _ => Err(invalid("A checkbox filter needs true/false or 1/0.")),
        },
        DataType::Date => {
            let date = chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d")
                .or_else(|_| {
                    chrono::DateTime::parse_from_rfc3339(value).map(|date| date.date_naive())
                })
                .map_err(|_| invalid("A date filter needs a valid YYYY-MM-DD date."))?;
            Ok(date.format("%Y-%m-%d").to_string())
        }
        _ => Ok(filter.value.clone()),
    }
}

#[async_trait]
impl<S, V> DatabaseViewService for DatabaseViewsServiceImpl<S, V>
where
    S: DatabasesService,
    V: ViewStorage + Send + Sync + 'static,
    V::Err: std::error::Error + Send + Sync + 'static,
{
    async fn save_view(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
        viewer: Viewer,
        command: SaveDatabaseViewCommand,
    ) -> Result<SavedDatabaseView, DatabaseError> {
        let name = command.name.trim();
        if name.is_empty() || name.chars().count() > 200 {
            return Err(invalid("A view name must contain 1 to 200 characters."));
        }
        let user_id = viewer.user_id.to_string();
        let database = self.databases.get_database(receipt, viewer).await?;
        let table = database
            .tables
            .iter()
            .find(|table| table.table.id == command.table_id)
            .ok_or(DatabaseError::NotFound)?;
        let columns = table
            .columns
            .iter()
            .map(|column| (column.column.id, column))
            .collect::<std::collections::HashMap<_, _>>();
        let view = &command.view;
        for id in view
            .filters
            .iter()
            .map(|filter| filter.column_id)
            .chain(view.sorts.iter().map(|sort| sort.column_id))
            .chain(view.hidden_columns.iter().copied())
            .chain(view.column_order.iter().copied())
            .chain(view.group_by)
        {
            if !columns.contains_key(&id) {
                return Err(invalid(format!(
                    "Column {id} does not belong to this table. Call DescribeDatabase again."
                )));
            }
        }
        if view.column_order.iter().collect::<HashSet<_>>().len() != view.column_order.len() {
            return Err(invalid("Column order must not repeat a column."));
        }
        if view.group_order.len() > 1000
            || view.group_order.iter().collect::<HashSet<_>>().len() != view.group_order.len()
            || view.group_order.iter().any(|key| !valid_group_key(key))
        {
            return Err(invalid("Lane order must contain distinct valid lane keys."));
        }
        if view.layout == ViewLayout::Board {
            let group = view
                .group_by
                .and_then(|id| columns.get(&id))
                .ok_or_else(|| invalid("A board needs a groupBy column from this table."))?;
            let definition = &group.definition.definition;
            if !matches!(
                definition.data_type,
                DataType::SelectString | DataType::SelectNumber | DataType::Boolean
            ) {
                return Err(invalid(
                    "A board can group by a select, multi-select, or checkbox column.",
                ));
            }
        }
        let mut filters = Vec::with_capacity(view.filters.len());
        for filter in &view.filters {
            let definition = &columns[&filter.column_id].definition.definition;
            let numeric = matches!(definition.data_type, DataType::Number | DataType::Date);
            let categorical = matches!(
                definition.data_type,
                DataType::Boolean | DataType::SelectString | DataType::SelectNumber
            );
            let valid = match filter.operator {
                FilterOperator::Gt
                | FilterOperator::Gte
                | FilterOperator::Lt
                | FilterOperator::Lte => numeric,
                FilterOperator::Contains
                | FilterOperator::NotContains
                | FilterOperator::StartsWith => !numeric && !categorical,
                _ => true,
            };
            if !valid {
                return Err(invalid(format!(
                    "That filter operation is not supported by column {}.",
                    filter.column_id
                )));
            }
            let value = filter_value(definition.data_type, filter)?;
            filters.push(serde_json::json!({
                "id": Uuid::now_v7(), "columnId": filter.column_id,
                "operator": filter.operator, "value": value,
            }));
        }
        let config = serde_json::json!({
            "kind": "database-view", "version": 1,
            "databaseId": database.database.id, "tableId": command.table_id,
            "view": { "layout": view.layout, "groupBy": view.group_by, "groupOrder": view.group_order,
                "filters": filters, "sorts": view.sorts, "hiddenColumns": view.hidden_columns,
                "columnOrder": view.column_order, "search": view.search },
        });
        let existing = self
            .views
            .get_views_for_user(&user_id)
            .await
            .map_err(storage_error)?
            .into_iter()
            .find(|view| {
                view.user_id == user_id
                    && view.name.trim().eq_ignore_ascii_case(name)
                    && view.config["kind"] == "database-view"
                    && view.config["databaseId"] == database.database.id.to_string()
                    && view.config["tableId"] == command.table_id.to_string()
            });
        let created = existing.is_none();
        let view_id = if let Some(existing) = existing {
            self.views
                .patch_view(
                    existing.id,
                    ViewPatch {
                        name: Some(name.to_string()),
                        config: Some(config.clone()),
                    },
                )
                .await
                .map_err(storage_error)?;
            existing.id
        } else {
            let saved = View::new(user_id, name.to_string(), config.clone());
            self.views
                .create_view(&saved)
                .await
                .map_err(storage_error)?;
            saved.id
        };
        Ok(SavedDatabaseView {
            view_id,
            database_id: database.database.id,
            table_id: command.table_id,
            name: name.to_string(),
            config,
            created,
        })
    }
}
