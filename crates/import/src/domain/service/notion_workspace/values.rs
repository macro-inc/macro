//! Notion values in Macro's terms: document properties, database cells and
//! task fields.

use std::collections::HashMap;

use chrono::{DateTime, NaiveDate, Utc};
use import_notion::domain::model::{
    NotionId, NotionPage, NotionPropertyKind, NotionPropertySchema, NotionValue,
};
use macro_user_id::user_id::MacroUserIdStr;
use models_databases::{
    CellValue, ColumnId, ColumnKind, EntityKind, EntityRef, OptionId, OptionRef,
};
use uuid::Uuid;

use crate::domain::models::NotionTaskFields;
use crate::domain::ports::{
    ImportedDocumentProperties, ImportedDocumentProperty, ImportedDocumentPropertyValue,
    ImportedTaskProperties,
};

use super::super::{is_tag_property_name, map_linear_priority, map_linear_status};

#[cfg(test)]
mod test;

/// Longest column or option name a Macro database accepts.
const MAX_NAME: usize = 200;

/// Notion users matched to Macro team members, by Notion user id.
pub(super) type PeopleMap = HashMap<NotionId, Person>;

/// A Notion user as the import knows them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct Person {
    /// Their email, when Notion shared it.
    pub email: Option<String>,
    /// Their Macro account, when the email matched a team member.
    pub macro_user: Option<MacroUserIdStr<'static>>,
}

/// A Macro column planned for a Notion property.
#[derive(Debug, Clone, PartialEq)]
pub(super) struct PlannedColumn {
    /// The column id, minted before the column is created.
    pub id: ColumnId,
    /// The Notion property it holds.
    pub property: String,
    /// The column name.
    pub name: String,
    /// How the column stores values.
    pub shape: ColumnShape,
}

/// How a planned column stores values.
#[derive(Debug, Clone, PartialEq)]
pub(super) enum ColumnShape {
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
}

/// The column a Notion property becomes, or `None` for the title (which
/// fills the table's title column), relations (added once every table
/// exists), and types with nothing to keep.
/// The column `property` becomes in `database`. Its ids derive from the
/// database and the property, so a resumed write names the same columns.
pub(super) fn planned_column(
    property: &NotionPropertySchema,
    names: &ColumnNames,
    database: Uuid,
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
                    database,
                    &property.id,
                    options.iter().map(|option| option.name.as_str()),
                ),
            }
        }
        NotionPropertyKind::MultiSelect { options } => ColumnShape::Select {
            multi: true,
            options: planned_options(
                database,
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
        id: ColumnId::from_uuid(derived_id(database, &format!("column/{}", property.id))),
        property: property.name.clone(),
        name: names.of(property),
        shape,
    })
}

/// The column name each property of one data source gets, by property id.
/// Macro refuses an empty column name, so a blank one becomes "Untitled" (or
/// "Untitled 2", ...), distinct from the data source's other names. It
/// depends on the schema alone, so a resumed write picks the same names.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct ColumnNames(HashMap<String, String>);

impl ColumnNames {
    const UNTITLED: &str = "Untitled";

    pub fn new(properties: &[NotionPropertySchema]) -> Self {
        let mut taken: std::collections::HashSet<String> = properties
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
    database: Uuid,
    property: &str,
    labels: impl Iterator<Item = &'a str>,
) -> Vec<(OptionId, String)> {
    let mut seen = std::collections::HashSet::new();
    labels
        .map(capped_name)
        .filter(|label| !label.is_empty() && seen.insert(label.to_lowercase()))
        .map(|label| {
            let id = derived_id(database, &format!("option/{property}/{label}"));
            (OptionId::from_uuid(id), label)
        })
        .collect()
}

/// A stable id for `name` within `namespace` (UUIDv5), so writing the same
/// object again names the same thing: Macro refuses an id already in use
/// instead of creating a duplicate.
pub(super) fn derived_id(namespace: Uuid, name: &str) -> Uuid {
    Uuid::new_v5(&namespace, name.as_bytes())
}

/// A name trimmed to what Macro accepts.
pub(super) fn capped_name(name: &str) -> String {
    name.trim().chars().take(MAX_NAME).collect()
}

/// The cell a value becomes in `column`, or `None` to leave it empty.
pub(super) fn cell(
    value: &NotionValue,
    column: &PlannedColumn,
    people: &PeopleMap,
) -> Option<CellValue> {
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
pub(super) fn text(value: &NotionValue) -> Option<String> {
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
pub(super) fn date(value: &NotionValue) -> Option<DateTime<Utc>> {
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

fn is_web_url(value: &str) -> bool {
    value.starts_with("https://") || value.starts_with("http://")
}

/// The properties a standalone page carries over to its document.
pub(super) fn document_properties(page: &NotionPage) -> ImportedDocumentProperties {
    let mut imported = ImportedDocumentProperties::default();
    for (name, value) in &page.properties {
        let name = name.trim();
        if name.is_empty() || name.len() > 100 {
            continue;
        }
        if is_tag_property_name(name) {
            match value {
                NotionValue::Options(labels) => imported.tags.extend(labels.iter().cloned()),
                NotionValue::Option(label) | NotionValue::Text(label) => {
                    imported.tags.push(label.clone())
                }
                _ => {}
            }
            continue;
        }
        let converted = match value {
            NotionValue::Checkbox(checked) => {
                Some(ImportedDocumentPropertyValue::Boolean { value: *checked })
            }
            NotionValue::Number(number) if number.is_finite() => {
                Some(ImportedDocumentPropertyValue::Number { value: *number })
            }
            NotionValue::Date { start, .. } => Some(ImportedDocumentPropertyValue::Date {
                value: start.clone(),
            }),
            NotionValue::Option(label) => Some(ImportedDocumentPropertyValue::Select {
                values: vec![label.clone()],
                multi: false,
            }),
            NotionValue::Options(labels) if !labels.is_empty() => {
                Some(ImportedDocumentPropertyValue::Select {
                    values: labels.clone(),
                    multi: true,
                })
            }
            NotionValue::Url(url) if is_web_url(url) => Some(ImportedDocumentPropertyValue::Link {
                urls: vec![url.clone()],
                multi: false,
            }),
            NotionValue::Text(_)
            | NotionValue::Email(_)
            | NotionValue::Phone(_)
            | NotionValue::UniqueId(_) => {
                text(value).map(|value| ImportedDocumentPropertyValue::String { value })
            }
            _ => None,
        };
        if let Some(value) = converted {
            imported.values.push(ImportedDocumentProperty {
                name: name.to_string(),
                value,
            });
        }
    }
    imported.tags.retain(|tag| !tag.trim().is_empty());
    imported.tags.sort();
    imported.tags.dedup();
    imported
}

/// A task list row's task fields, read from the columns `fields` names.
pub(super) fn task_properties(
    row: &NotionPage,
    fields: &NotionTaskFields,
    people: &PeopleMap,
) -> ImportedTaskProperties {
    let field = |name: &Option<String>| name.as_ref().and_then(|name| row.properties.get(name));
    ImportedTaskProperties {
        status: field(&fields.status)
            .and_then(text)
            .and_then(|label| map_task_status(&label))
            .map(String::from),
        priority: field(&fields.priority)
            .and_then(text)
            .and_then(|label| map_linear_priority(&label))
            .map(String::from),
        due_date: field(&fields.due)
            .and_then(date)
            .map(|due| due.format("%Y-%m-%d").to_string()),
        assignee_email: field(&fields.assignee).and_then(|value| match value {
            NotionValue::People(ids) => ids
                .iter()
                .find_map(|id| people.get(id).and_then(|person| person.email.clone())),
            NotionValue::Email(email) => Some(email.clone()),
            _ => None,
        }),
    }
}

/// A Notion status label in Macro's status vocabulary.
fn map_task_status(label: &str) -> Option<&'static str> {
    map_linear_status(label).or_else(|| {
        let label = label.trim().to_ascii_lowercase();
        if label.contains("progress") || label.contains("doing") {
            Some("In Progress")
        } else if label.contains("review") {
            Some("In Review")
        } else if label.contains("done") || label.contains("complete") || label.contains("shipped")
        {
            Some("Completed")
        } else if label.contains("cancel") || label.contains("archived") {
            Some("Canceled")
        } else if label.contains("not started") || label.contains("to do") || label.contains("todo")
        {
            Some("Not Started")
        } else {
            None
        }
    })
}

/// A task body: the row's own content, then the properties the task fields
/// did not take, so nothing in the row is lost.
pub(super) fn task_body(
    row: &NotionPage,
    content: &str,
    fields: &NotionTaskFields,
    people: &PeopleMap,
) -> String {
    let used = [
        &fields.status,
        &fields.priority,
        &fields.due,
        &fields.assignee,
    ];
    let lines: Vec<String> = row
        .properties
        .iter()
        .filter(|(name, _)| {
            !used
                .iter()
                .any(|field| field.as_deref() == Some(name.as_str()))
        })
        .filter_map(|(name, value)| {
            let rendered = match value {
                NotionValue::People(ids) => {
                    let names: Vec<String> = ids
                        .iter()
                        .filter_map(|id| people.get(id).and_then(|person| person.email.clone()))
                        .collect();
                    (!names.is_empty()).then(|| names.join(", "))
                }
                other => text(other),
            }?;
            Some(format!("- **{name}:** {rendered}"))
        })
        .collect();
    let content = content.trim();
    match (content.is_empty(), lines.is_empty()) {
        (_, true) => content.to_string(),
        (true, false) => lines.join("\n"),
        (false, false) => format!("{content}\n\n---\n\n{}", lines.join("\n")),
    }
}
