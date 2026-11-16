//! Notion data sources in Macro database terms: the column each property
//! becomes and the cell each value becomes.
//!
//! Ids derive from a caller-chosen namespace (the Macro database) and the
//! Notion property, so planning the same data source again names the same
//! columns and options.

use std::collections::{HashMap, HashSet};

use chrono::{DateTime, NaiveDate, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use models_databases::{
    CellValue, CellWrite, ColumnChange, ColumnId, ColumnKind, DatabaseOp, EntityKind, EntityRef,
    NewColumn, NewOption, OptionId, OptionRef, TableId,
};
use uuid::Uuid;

use super::model::{
    NotionDataSource, NotionId, NotionPage, NotionPropertyKind, NotionPropertySchema, NotionValue,
};

#[cfg(test)]
mod test;

/// Longest column or option name a Macro database accepts.
pub const MAX_NAME: usize = 200;

/// Notion users matched to Macro team members, by Notion user id.
pub type PeopleMap = HashMap<NotionId, Person>;

/// A Notion user as Macro knows them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Person {
    /// Their email, when Notion shared it.
    pub email: Option<String>,
    /// Their Macro account, when the email matched a team member.
    pub macro_user: Option<MacroUserIdStr<'static>>,
}

/// The Macro columns a data source's properties become.
#[derive(Debug, Clone, PartialEq)]
pub struct ColumnPlan {
    /// The title column's name, when the data source has a title property.
    pub title: Option<String>,
    /// The other columns, in schema order.
    pub columns: Vec<PlannedColumn>,
}

impl ColumnPlan {
    /// The columns `source` becomes in the database `namespace` names.
    pub fn new(source: &NotionDataSource, namespace: Uuid) -> Self {
        let names = ColumnNames::new(&source.properties);
        let title = source
            .properties
            .iter()
            .find(|property| property.kind == NotionPropertyKind::Title)
            .map(|property| names.of(property));
        let columns = source
            .properties
            .iter()
            .filter_map(|property| planned_column(property, &names, namespace))
            .collect();
        Self { title, columns }
    }

    /// Rename `title_column` to the title property's name, then create every
    /// planned column after it, in order.
    pub fn column_ops(&self, table: TableId, title_column: ColumnId) -> Vec<DatabaseOp> {
        let mut ops = Vec::with_capacity(self.columns.len() + 1);
        if let Some(title) = &self.title {
            ops.push(DatabaseOp::Column {
                table,
                column: title_column,
                change: ColumnChange::Rename {
                    name: title.clone(),
                    previous_name: None,
                },
            });
        }
        let mut after = title_column;
        for column in &self.columns {
            ops.push(DatabaseOp::Column {
                table,
                column: column.id,
                change: ColumnChange::Create {
                    definition: column.definition(),
                    after: Some(after),
                },
            });
            after = column.id;
        }
        ops
    }

    /// The cells `row` fills: its title in `title_column`, then each planned
    /// column it has a usable value for.
    pub fn row_cells(
        &self,
        row: &NotionPage,
        title_column: ColumnId,
        people: &PeopleMap,
    ) -> Vec<CellWrite> {
        let mut cells = Vec::with_capacity(self.columns.len() + 1);
        if !row.title.trim().is_empty() {
            cells.push(CellWrite {
                column: title_column,
                value: CellValue::Text(row.title.trim().to_string()),
            });
        }
        for column in &self.columns {
            if let Some(value) = row
                .properties
                .get(&column.property)
                .and_then(|value| cell(value, column, people))
            {
                cells.push(CellWrite {
                    column: column.id,
                    value,
                });
            }
        }
        cells
    }
}

/// A Macro column planned for a Notion property.
#[derive(Debug, Clone, PartialEq)]
pub struct PlannedColumn {
    /// The column id, minted before the column is created.
    pub id: ColumnId,
    /// The Notion property it holds, by name.
    pub property: String,
    /// The column name.
    pub name: String,
    /// How the column stores values.
    pub shape: ColumnShape,
}

impl PlannedColumn {
    /// The column as Macro creates it.
    pub fn definition(&self) -> NewColumn {
        NewColumn::New {
            name: self.name.clone(),
            kind: self.shape.kind(),
            options: self.shape.options(),
            infer_type: false,
        }
    }
}

/// How a planned column stores values.
#[derive(Debug, Clone, PartialEq)]
pub enum ColumnShape {
    /// Plain text; also where values Macro has no type for are snapshotted.
    Text,
    /// A number.
    Number,
    /// A checkbox.
    Boolean,
    /// A date.
    Date,
    /// URLs.
    Link,
    /// Options declared up front.
    Select {
        /// Whether a cell holds several options.
        multi: bool,
        /// The options, by label.
        options: Vec<(OptionId, String)>,
    },
    /// Macro users.
    People {
        /// Whether a cell holds several people.
        multi: bool,
    },
}

impl ColumnShape {
    /// The Macro column kind.
    pub fn kind(&self) -> ColumnKind {
        match self {
            Self::Text => ColumnKind::Text,
            Self::Number => ColumnKind::Number,
            Self::Boolean => ColumnKind::Boolean,
            Self::Date => ColumnKind::Date,
            Self::Link => ColumnKind::Link,
            Self::Select { multi, .. } => ColumnKind::Select { multi: *multi },
            Self::People { multi } => ColumnKind::Entity {
                target: EntityKind::User,
                multi: *multi,
            },
        }
    }

    /// The options a select column is created with; none for other shapes.
    pub fn options(&self) -> Vec<NewOption> {
        match self {
            Self::Select { options, .. } => options
                .iter()
                .map(|(id, label)| NewOption {
                    id: *id,
                    label: label.clone(),
                })
                .collect(),
            Self::Text
            | Self::Number
            | Self::Boolean
            | Self::Date
            | Self::Link
            | Self::People { .. } => Vec::new(),
        }
    }
}

/// The column `property` becomes in the database `namespace` names, or
/// `None` for the title (which fills the table's title column), relations
/// (added once every table exists), and types with nothing to keep. Its ids
/// derive from the namespace and the property, so planning again names the
/// same columns.
pub fn planned_column(
    property: &NotionPropertySchema,
    names: &ColumnNames,
    namespace: Uuid,
) -> Option<PlannedColumn> {
    let shape = match &property.kind {
        NotionPropertyKind::Title
        | NotionPropertyKind::Relation { .. }
        | NotionPropertyKind::Unsupported { .. } => return None,
        NotionPropertyKind::RichText
        | NotionPropertyKind::Email
        | NotionPropertyKind::PhoneNumber
        | NotionPropertyKind::Formula
        | NotionPropertyKind::Rollup
        | NotionPropertyKind::UniqueId { .. }
        | NotionPropertyKind::Files => ColumnShape::Text,
        NotionPropertyKind::Number => ColumnShape::Number,
        NotionPropertyKind::Checkbox => ColumnShape::Boolean,
        NotionPropertyKind::Date
        | NotionPropertyKind::CreatedTime
        | NotionPropertyKind::LastEditedTime => ColumnShape::Date,
        NotionPropertyKind::Url => ColumnShape::Link,
        NotionPropertyKind::Select { options } | NotionPropertyKind::Status { options } => {
            ColumnShape::Select {
                multi: false,
                options: planned_options(
                    namespace,
                    &property.id,
                    options.iter().map(|option| option.name.as_str()),
                ),
            }
        }
        NotionPropertyKind::MultiSelect { options } => ColumnShape::Select {
            multi: true,
            options: planned_options(
                namespace,
                &property.id,
                options.iter().map(|option| option.name.as_str()),
            ),
        },
        NotionPropertyKind::People => ColumnShape::People { multi: true },
        NotionPropertyKind::CreatedBy | NotionPropertyKind::LastEditedBy => {
            ColumnShape::People { multi: false }
        }
    };
    Some(PlannedColumn {
        id: ColumnId::from_uuid(derived_id(namespace, &format!("column/{}", property.id))),
        property: property.name.clone(),
        name: names.of(property),
        shape,
    })
}

/// The column name each property of one data source gets, by property id.
/// Macro refuses an empty column name, so a blank one becomes "Untitled" (or
/// "Untitled 2", ...), distinct from the data source's other names. It
/// depends on the schema alone, so planning again picks the same names.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ColumnNames(HashMap<String, String>);

impl ColumnNames {
    const UNTITLED: &str = "Untitled";

    /// Names for every property of one data source.
    pub fn new(properties: &[NotionPropertySchema]) -> Self {
        let mut taken: HashSet<String> = properties
            .iter()
            .map(|property| capped_name(&property.name).to_lowercase())
            .collect();
        let names = properties
            .iter()
            .map(|property| {
                let mut name = capped_name(&property.name);
                if name.is_empty() {
                    name = std::iter::once(Self::UNTITLED.to_string())
                        .chain((2..).map(|index| format!("{} {index}", Self::UNTITLED)))
                        .find(|candidate| !taken.contains(&candidate.to_lowercase()))
                        .unwrap_or_else(|| Self::UNTITLED.to_string());
                    taken.insert(name.to_lowercase());
                }
                (property.id.clone(), name)
            })
            .collect();
        Self(names)
    }

    /// `property`'s column name.
    pub fn of(&self, property: &NotionPropertySchema) -> String {
        self.0
            .get(&property.id)
            .cloned()
            .unwrap_or_else(|| capped_name(&property.name))
    }
}

/// Options with usable, distinct labels, ids minted.
fn planned_options<'a>(
    namespace: Uuid,
    property: &str,
    labels: impl Iterator<Item = &'a str>,
) -> Vec<(OptionId, String)> {
    let mut seen = HashSet::new();
    labels
        .map(capped_name)
        .filter(|label| !label.is_empty() && seen.insert(label.to_lowercase()))
        .map(|label| {
            let id = derived_id(namespace, &format!("option/{property}/{label}"));
            (OptionId::from_uuid(id), label)
        })
        .collect()
}

/// A stable id for `name` within `namespace` (UUIDv5), so writing the same
/// object again names the same thing: Macro refuses an id already in use
/// instead of creating a duplicate.
pub fn derived_id(namespace: Uuid, name: &str) -> Uuid {
    Uuid::new_v5(&namespace, name.as_bytes())
}

/// A name trimmed to what Macro accepts.
pub fn capped_name(name: &str) -> String {
    name.trim().chars().take(MAX_NAME).collect()
}

/// The cell a value becomes in `column`, or `None` to leave it empty.
pub fn cell(value: &NotionValue, column: &PlannedColumn, people: &PeopleMap) -> Option<CellValue> {
    match &column.shape {
        ColumnShape::Text => text(value).map(CellValue::Text),
        ColumnShape::Number => number(value).map(CellValue::Number),
        ColumnShape::Boolean => match value {
            NotionValue::Checkbox(checked) => Some(CellValue::Boolean(*checked)),
            _ => None,
        },
        ColumnShape::Date => date(value).map(CellValue::Date),
        ColumnShape::Link => match value {
            NotionValue::Url(url) if is_web_url(url) => Some(CellValue::Link(vec![url.clone()])),
            _ => None,
        },
        ColumnShape::Select { multi, options } => {
            let labels: Vec<&str> = match value {
                NotionValue::Option(label) => vec![label.as_str()],
                NotionValue::Options(labels) => labels.iter().map(String::as_str).collect(),
                _ => Vec::new(),
            };
            let refs: Vec<OptionRef> = labels
                .into_iter()
                .filter_map(|label| {
                    let label = capped_name(label);
                    options
                        .iter()
                        .find(|(_, known)| known.eq_ignore_ascii_case(&label))
                        .map(|(id, _)| OptionRef::Id(*id))
                })
                .take(if *multi { usize::MAX } else { 1 })
                .collect();
            (!refs.is_empty()).then_some(CellValue::Options(refs))
        }
        ColumnShape::People { multi } => {
            let ids: Vec<&NotionId> = match value {
                NotionValue::People(ids) => ids.iter().collect(),
                _ => Vec::new(),
            };
            let users: Vec<EntityRef> = ids
                .into_iter()
                .filter_map(|id| people.get(id)?.macro_user.clone())
                .map(|user| EntityRef {
                    entity_type: EntityKind::User,
                    entity_id: user.as_ref().to_string(),
                })
                .take(if *multi { usize::MAX } else { 1 })
                .collect();
            (!users.is_empty()).then_some(CellValue::Entities(users))
        }
    }
}

/// A value as text: what a text column snapshots, and what a task body lists.
pub fn text(value: &NotionValue) -> Option<String> {
    let rendered = match value {
        NotionValue::Text(text)
        | NotionValue::Option(text)
        | NotionValue::Url(text)
        | NotionValue::Email(text)
        | NotionValue::Phone(text)
        | NotionValue::Timestamp(text)
        | NotionValue::UniqueId(text) => text.clone(),
        NotionValue::Number(number) => format_number(*number),
        NotionValue::Options(labels) => labels.join(", "),
        NotionValue::Date { start, end } => match end {
            Some(end) => format!("{start} → {end}"),
            None => start.clone(),
        },
        NotionValue::Checkbox(checked) => if *checked { "Yes" } else { "No" }.to_string(),
        NotionValue::Files(files) => files
            .iter()
            .map(|file| file.name.as_str())
            .collect::<Vec<_>>()
            .join(", "),
        NotionValue::List(values) => values
            .iter()
            .filter_map(text)
            .collect::<Vec<_>>()
            .join(", "),
        NotionValue::People(_) | NotionValue::Relation(_) | NotionValue::Empty => String::new(),
    };
    let trimmed = rendered.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

fn number(value: &NotionValue) -> Option<f64> {
    match value {
        NotionValue::Number(number) if number.is_finite() => Some(*number),
        NotionValue::List(values) => values.iter().find_map(number),
        _ => None,
    }
}

/// A Notion date or timestamp as a UTC instant; a bare date is midnight UTC.
pub fn date(value: &NotionValue) -> Option<DateTime<Utc>> {
    let raw = match value {
        NotionValue::Date { start, .. } => start.as_str(),
        NotionValue::Timestamp(timestamp) => timestamp.as_str(),
        NotionValue::List(values) => return values.iter().find_map(date),
        _ => return None,
    };
    parse_instant(raw)
}

fn parse_instant(raw: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(raw)
        .map(|instant| instant.with_timezone(&Utc))
        .ok()
        .or_else(|| {
            NaiveDate::parse_from_str(raw, "%Y-%m-%d")
                .ok()?
                .and_hms_opt(0, 0, 0)
                .map(|midnight| midnight.and_utc())
        })
}

fn format_number(number: f64) -> String {
    if number.fract() == 0.0 && number.abs() < 1e15 {
        format!("{number:.0}")
    } else {
        number.to_string()
    }
}

/// Whether `value` is an http(s) URL, the only links Macro keeps.
pub fn is_web_url(value: &str) -> bool {
    value.starts_with("https://") || value.starts_with("http://")
}
