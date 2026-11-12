//! Notion values in Macro's terms: document properties and task fields.
//! Database columns and cells are `import_notion::domain::macro_cells`.

use import_notion::domain::macro_cells::{PeopleMap, date, is_web_url, text};
use import_notion::domain::model::{NotionPage, NotionValue};

use crate::domain::models::NotionTaskFields;
use crate::domain::ports::{
    ImportedDocumentProperties, ImportedDocumentProperty, ImportedDocumentPropertyValue,
    ImportedTaskProperties,
};

use super::super::{is_tag_property_name, map_linear_priority, map_linear_status};

#[cfg(test)]
mod test;

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
