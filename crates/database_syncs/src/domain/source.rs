//! A source read in table terms: the columns it wants and each row's
//! values, by field. Column and option ids derive from the sync, so every
//! run (and a retried create) names the same ones.

use call::domain::imports::ImportedCallRecord;
use import_notion::domain::macro_cells::{
    ColumnNames, PeopleMap, PlannedColumn, cell, derived_id, is_web_url, planned_column,
};
use import_notion::domain::model::{NotionDataSource, NotionPage, NotionPropertyKind};
use models_databases::{CellValue, ColumnId, ColumnKind, EntityKind, EntityRef, TableId};

use crate::domain::columns::WantedColumn;
use crate::domain::models::{GranolaField, SyncField, SyncId};

/// One source row's values, by field.
#[derive(Debug, Clone, PartialEq)]
pub struct SourceItem {
    /// The source's id for the row.
    pub external_id: String,
    /// Its values; a field left out has none.
    pub values: Vec<(SyncField, CellValue)>,
}

/// The table a sync writes, under an id derived from the sync.
pub fn table_id(sync_id: SyncId) -> TableId {
    TableId::from_uuid(derived_id(sync_id, "table"))
}

/// The name of a synced Granola table.
pub const GRANOLA_TABLE_NAME: &str = "Granola meetings";

/// The columns a Granola table wants, title first.
pub fn granola_columns(sync_id: SyncId) -> Vec<WantedColumn> {
    [
        (GranolaField::Title, "Title", ColumnKind::Text),
        (GranolaField::Date, "Date", ColumnKind::Date),
        (GranolaField::Attendees, "Attendees", ColumnKind::Text),
        (GranolaField::Summary, "Summary", ColumnKind::Text),
        (GranolaField::Link, "Granola link", ColumnKind::Link),
        (
            GranolaField::Call,
            "Call",
            ColumnKind::Entity {
                target: EntityKind::CallRecord,
                multi: false,
            },
        ),
    ]
    .into_iter()
    .map(|(field, name, kind)| WantedColumn {
        field: SyncField::Granola { field },
        id: ColumnId::from_uuid(derived_id(
            sync_id,
            &format!("column/granola/{}", field.as_ref()),
        )),
        name: name.to_string(),
        kind,
        options: Vec::new(),
    })
    .collect()
}

/// A Granola meeting's values.
pub fn granola_item(record: &ImportedCallRecord) -> SourceItem {
    let field = |field| SyncField::Granola { field };
    let mut values = Vec::new();

    if let Some(title) = non_empty(record.title.as_deref()) {
        values.push((field(GranolaField::Title), CellValue::Text(title)));
    }
    if let Some(started_at) = record.started_at {
        values.push((field(GranolaField::Date), CellValue::Date(started_at)));
    }
    if let Some(attendees) = non_empty(Some(&record.attendees.join(", "))) {
        values.push((field(GranolaField::Attendees), CellValue::Text(attendees)));
    }
    if let Some(summary) = non_empty(record.summary.as_deref()) {
        values.push((field(GranolaField::Summary), CellValue::Text(summary)));
    }
    if let Some(url) = record.external_url.as_deref().filter(|url| is_web_url(url)) {
        values.push((
            field(GranolaField::Link),
            CellValue::Link(vec![url.to_string()]),
        ));
    }
    values.push((
        field(GranolaField::Call),
        CellValue::Entities(vec![EntityRef {
            entity_type: EntityKind::CallRecord,
            entity_id: record.id.to_string(),
        }]),
    ));

    SourceItem {
        external_id: record.external_id.as_ref().to_string(),
        values,
    }
}

fn non_empty(text: Option<&str>) -> Option<String> {
    let trimmed = text?.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

/// A Notion data source's columns: its title, then every property Macro
/// has a column type for, in schema order.
#[derive(Debug, Clone, PartialEq)]
pub struct NotionColumns {
    /// The title property's id.
    title: Option<String>,
    /// The other properties' columns, by property id.
    properties: Vec<(String, PlannedColumn)>,
    /// Every column, as the table wants it.
    wanted: Vec<WantedColumn>,
}

impl NotionColumns {
    /// The columns `source` wants in the sync's table.
    pub fn new(sync_id: SyncId, source: &NotionDataSource) -> Self {
        let names = ColumnNames::new(&source.properties);
        let mut title = None;
        let mut properties = Vec::new();
        let mut wanted = Vec::new();

        for property in &source.properties {
            let field = SyncField::Notion {
                property_id: property.id.clone(),
            };
            if property.kind == NotionPropertyKind::Title {
                title = Some(property.id.clone());
                // Title first, like the table's first column.
                wanted.insert(
                    0,
                    WantedColumn {
                        field,
                        id: ColumnId::from_uuid(derived_id(
                            sync_id,
                            &format!("column/{}", property.id),
                        )),
                        name: names.of(property),
                        kind: ColumnKind::Text,
                        options: Vec::new(),
                    },
                );
                continue;
            }

            let Some(planned) = planned_column(property, &names, sync_id) else {
                continue;
            };
            wanted.push(WantedColumn {
                field,
                id: planned.id,
                name: planned.name.clone(),
                kind: planned.shape.kind(),
                options: planned.shape.options(),
            });
            properties.push((property.id.clone(), planned));
        }

        Self {
            title,
            properties,
            wanted,
        }
    }

    /// The columns, title first.
    pub fn wanted(&self) -> &[WantedColumn] {
        &self.wanted
    }

    /// A row's values. People columns name the Macro users `people` matched.
    pub fn item(&self, page: &NotionPage, people: &PeopleMap) -> SourceItem {
        let mut values = Vec::new();

        if let Some(title_property) = &self.title
            && let Some(title) = non_empty(Some(&page.title))
        {
            values.push((
                SyncField::Notion {
                    property_id: title_property.clone(),
                },
                CellValue::Text(title),
            ));
        }
        for (property_id, planned) in &self.properties {
            let Some(value) = page
                .properties
                .get(&planned.property)
                .and_then(|value| cell(value, planned, people))
            else {
                continue;
            };
            values.push((
                SyncField::Notion {
                    property_id: property_id.clone(),
                },
                value,
            ));
        }

        SourceItem {
            external_id: page.id.as_str().to_string(),
            values,
        }
    }
}
