//! A pipeline's columns as people name them, and their values as text: what
//! a written value becomes in a cell, and what a stored cell reads as.

#[cfg(test)]
mod test;

use std::cmp::Ordering;

use chrono::{DateTime, NaiveDate, Utc};
use databases::domain::{
    catalog,
    models::{ColumnDetail, ColumnId},
};
use macro_user_id::user_id::MacroUserIdStr;
use models_databases::{CellValue, ColumnKind, EntityKind, EntityRef, OptionId, OptionRef};
use models_properties::{DataType, service::property_value::PropertyValue};

use super::super::pipelines::{Pipeline, PipelineRecordType};

/// What a field holds.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FieldKind {
    /// The company or contact the entry tracks.
    Record(PipelineRecordType),
    /// Free text.
    Text,
    /// A number.
    Number,
    /// True or false.
    Checkbox,
    /// A date-time.
    Date,
    /// URLs.
    Link,
    /// Labels from the field's options, such as a stage.
    Select,
    /// Colored tags.
    Tags,
    /// Macro users.
    Person,
    /// Other Macro items, by id.
    Entity(EntityKind),
    /// Rows of another table; pipelines write these only through the app.
    Relation,
    /// Computed from the entry's other fields; nothing writes it.
    Formula,
}

/// One column of a pipeline, named as the user sees it.
#[derive(Debug, Clone, PartialEq)]
pub struct PipelineField {
    /// The column.
    pub id: ColumnId,
    /// Its display name.
    pub name: String,
    /// What it holds.
    pub kind: FieldKind,
    /// Whether a cell holds several values.
    pub multiple: bool,
    /// A select or tag field's options in their order, with their labels.
    pub options: Vec<(OptionId, String)>,
    /// Whether every entry must have a value.
    pub required: bool,
    /// Whether the viewer may write it.
    pub writable: bool,
}

impl PipelineField {
    /// The field `column` of `pipeline`.
    pub(crate) fn new(column: &ColumnDetail, pipeline: &Pipeline) -> Self {
        let kind = if column.column.id == pipeline.primary_column_id {
            FieldKind::Record(pipeline.record_type)
        } else if column.column.formula().is_some() {
            FieldKind::Formula
        } else if column.column.is_relation() {
            FieldKind::Relation
        } else {
            match column.definition.definition.data_type {
                DataType::String => FieldKind::Text,
                DataType::Number => FieldKind::Number,
                DataType::Boolean => FieldKind::Checkbox,
                DataType::Date => FieldKind::Date,
                DataType::Link => FieldKind::Link,
                DataType::SelectString | DataType::SelectNumber => FieldKind::Select,
                DataType::Tag => FieldKind::Tags,
                DataType::Entity => match column.entity_type().and_then(catalog::entity_kind) {
                    Some(EntityKind::User) => FieldKind::Person,
                    Some(kind) => FieldKind::Entity(kind),
                    None => FieldKind::Relation,
                },
            }
        };
        Self {
            id: column.column.id,
            name: column.name().to_owned(),
            kind,
            multiple: column.is_multi_valued(),
            options: catalog::option_labels(&column.definition),
            required: !column.column.nullable,
            writable: column.writable && kind != FieldKind::Formula,
        }
    }

    /// Whether this is the field naming the entry's company or contact.
    pub fn is_record(&self) -> bool {
        matches!(self.kind, FieldKind::Record(_))
    }

    /// The option labelled `label`, ignoring case.
    pub(crate) fn option(&self, label: &str) -> Result<OptionId, String> {
        let label = label.trim();
        self.options
            .iter()
            .find(|(_, candidate)| candidate.eq_ignore_ascii_case(label))
            .map(|(id, _)| *id)
            .ok_or_else(|| {
                let labels: Vec<&str> = self.options.iter().map(|(_, l)| l.as_str()).collect();
                format!(
                    "\"{}\" has no option \"{label}\". Its options are: {}. Add one by editing \
                     the pipeline.",
                    self.name,
                    labels.join(", ")
                )
            })
    }

    /// The label of option `id`, or the id when the option is gone.
    fn label(&self, id: OptionId) -> String {
        self.options
            .iter()
            .find(|(candidate, _)| *candidate == id)
            .map_or_else(|| id.to_string(), |(_, label)| label.clone())
    }

    /// Where option `label` sits in the field's order; unknown labels last.
    fn position(&self, label: &str) -> usize {
        self.options
            .iter()
            .position(|(_, candidate)| candidate == label)
            .unwrap_or(usize::MAX)
    }
}

/// A value for a field, as text: the field's type says how it is read.
#[derive(Debug, Clone, PartialEq)]
pub enum FieldInput {
    /// No value: write an empty cell, or match one.
    Clear,
    /// One value.
    One(String),
    /// Several values, for a field holding several.
    Many(Vec<String>),
}

impl FieldInput {
    fn values(&self) -> Vec<&str> {
        match self {
            FieldInput::Clear => Vec::new(),
            FieldInput::One(value) => vec![value.as_str()],
            FieldInput::Many(values) => values.iter().map(String::as_str).collect(),
        }
    }
}

/// A stored value, read back in the field's own terms.
#[derive(Debug, Clone, PartialEq)]
pub enum FieldValue {
    /// Free text.
    Text(String),
    /// A number.
    Number(f64),
    /// True or false.
    Checkbox(bool),
    /// A date-time.
    Date(DateTime<Utc>),
    /// Option labels, in the cell's order.
    Labels(Vec<String>),
    /// URLs.
    Links(Vec<String>),
    /// Macro ids: users, records or other items.
    References(Vec<String>),
}

/// The cell `input` writes into `field`, for `viewer` ("me").
pub(crate) fn cell_value(
    field: &PipelineField,
    input: &FieldInput,
    viewer: &MacroUserIdStr<'_>,
) -> Result<CellValue, String> {
    let name = &field.name;
    match field.kind {
        FieldKind::Record(_) => {
            return Err(format!(
                "\"{name}\" is the record the entry tracks. To track another record, remove \
                 this entry and add that record."
            ));
        }
        FieldKind::Formula => return Err(format!("\"{name}\" is computed; nothing writes it.")),
        FieldKind::Relation => {
            return Err(format!(
                "\"{name}\" links rows of another table; change it in the app."
            ));
        }
        _ => {}
    }
    if !field.writable {
        return Err(format!("The user cannot change \"{name}\"."));
    }
    let values = input.values();
    let Some(first) = values.first().copied() else {
        return Ok(CellValue::Clear);
    };
    if values.len() > 1 && !field.multiple {
        return Err(format!("\"{name}\" holds one value; give exactly one."));
    }
    Ok(match field.kind {
        FieldKind::Text => CellValue::Text(first.to_owned()),
        FieldKind::Number => CellValue::Number(number(name, first)?),
        FieldKind::Checkbox => CellValue::Boolean(checkbox(name, first)?),
        FieldKind::Date => CellValue::Date(date(name, first)?),
        FieldKind::Link => CellValue::Link(values.iter().map(|v| v.trim().to_owned()).collect()),
        FieldKind::Select | FieldKind::Tags => CellValue::Options(
            values
                .iter()
                .map(|label| field.option(label).map(OptionRef::Id))
                .collect::<Result<_, _>>()?,
        ),
        FieldKind::Person => CellValue::Entities(
            values
                .iter()
                .map(|value| {
                    person(name, value, viewer).map(|id| EntityRef {
                        entity_type: EntityKind::User,
                        entity_id: id,
                    })
                })
                .collect::<Result<_, _>>()?,
        ),
        FieldKind::Entity(kind) => CellValue::Entities(
            values
                .iter()
                .map(|id| EntityRef {
                    entity_type: kind,
                    entity_id: id.trim().to_owned(),
                })
                .collect(),
        ),
        FieldKind::Record(_) | FieldKind::Relation | FieldKind::Formula => {
            unreachable!("refused above")
        }
    })
}

/// What a stored cell reads as; `None` for an empty one.
pub(crate) fn field_value(field: &PipelineField, value: &PropertyValue) -> Option<FieldValue> {
    match value {
        PropertyValue::Bool(checked) => Some(FieldValue::Checkbox(*checked)),
        PropertyValue::Num(number) => Some(FieldValue::Number(*number)),
        PropertyValue::Str(text) => Some(FieldValue::Text(text.clone())),
        PropertyValue::Date(date) => Some(FieldValue::Date(*date)),
        PropertyValue::SelectOption(ids) if !ids.is_empty() => Some(FieldValue::Labels(
            ids.iter()
                .map(|id| field.label(OptionId::from_uuid(*id)))
                .collect(),
        )),
        PropertyValue::EntityRef(references) if !references.is_empty() => {
            Some(FieldValue::References(
                references
                    .iter()
                    .map(|reference| reference.entity_id.clone())
                    .collect(),
            ))
        }
        PropertyValue::Link(urls) if !urls.is_empty() => Some(FieldValue::Links(urls.clone())),
        PropertyValue::SelectOption(_) | PropertyValue::EntityRef(_) | PropertyValue::Link(_) => {
            None
        }
    }
}

/// Whether `cell` holds `wanted`, or any of several wanted values.
///
/// Text and links match a case-insensitive substring; dates match the
/// calendar day; everything else matches exactly.
pub(crate) fn matches(
    field: &PipelineField,
    cell: Option<&PropertyValue>,
    wanted: &FieldInput,
    viewer: &MacroUserIdStr<'_>,
) -> Result<bool, String> {
    let name = &field.name;
    if matches!(field.kind, FieldKind::Formula | FieldKind::Relation) {
        return Err(format!("Entries cannot be filtered by \"{name}\"."));
    }
    let value = cell.and_then(|cell| field_value(field, cell));
    let wanted = wanted.values();
    if wanted.is_empty() {
        return Ok(value.is_none());
    }
    for candidate in wanted {
        let hit = match field.kind {
            FieldKind::Select | FieldKind::Tags => {
                let label = field.label(field.option(candidate)?);
                matches!(&value, Some(FieldValue::Labels(labels)) if labels.contains(&label))
            }
            FieldKind::Person => {
                let id = person(name, candidate, viewer)?;
                references(&value).any(|reference| reference.eq_ignore_ascii_case(&id))
            }
            FieldKind::Record(_) | FieldKind::Entity(_) => {
                references(&value).any(|reference| reference == candidate.trim())
            }
            FieldKind::Text => {
                matches!(&value, Some(FieldValue::Text(text)) if contains(text, candidate))
            }
            FieldKind::Link => {
                matches!(&value, Some(FieldValue::Links(urls)) if urls.iter().any(|url| contains(url, candidate)))
            }
            FieldKind::Number => {
                let wanted = number(name, candidate)?;
                matches!(value, Some(FieldValue::Number(n)) if (n - wanted).abs() < f64::EPSILON)
            }
            FieldKind::Checkbox => {
                let wanted = checkbox(name, candidate)?;
                matches!(value, Some(FieldValue::Checkbox(true))) == wanted
            }
            FieldKind::Date => {
                let wanted = date(name, candidate)?.date_naive();
                matches!(value, Some(FieldValue::Date(d)) if d.date_naive() == wanted)
            }
            FieldKind::Formula | FieldKind::Relation => unreachable!("refused above"),
        };
        if hit {
            return Ok(true);
        }
    }
    Ok(false)
}

/// How two stored values of `field` order: options in the field's order,
/// numbers and dates by value, text ignoring case. Empty cells sort last.
pub(crate) fn compare(
    field: &PipelineField,
    left: Option<&FieldValue>,
    right: Option<&FieldValue>,
    descending: bool,
) -> Ordering {
    let (left, right) = match (left, right) {
        (None, None) => return Ordering::Equal,
        (None, Some(_)) => return Ordering::Greater,
        (Some(_), None) => return Ordering::Less,
        (Some(left), Some(right)) => (left, right),
    };
    let order = match (left, right) {
        (FieldValue::Number(left), FieldValue::Number(right)) => left.total_cmp(right),
        (FieldValue::Date(left), FieldValue::Date(right)) => left.cmp(right),
        (FieldValue::Checkbox(left), FieldValue::Checkbox(right)) => left.cmp(right),
        (FieldValue::Labels(left), FieldValue::Labels(right)) => {
            let first =
                |labels: &[String]| labels.first().map_or(usize::MAX, |l| field.position(l));
            first(left).cmp(&first(right))
        }
        _ => text(left).to_lowercase().cmp(&text(right).to_lowercase()),
    };
    if descending { order.reverse() } else { order }
}

/// A stored value as one line of text.
pub(crate) fn text(value: &FieldValue) -> String {
    match value {
        FieldValue::Text(text) => text.clone(),
        FieldValue::Number(number) => number.to_string(),
        FieldValue::Checkbox(checked) => checked.to_string(),
        FieldValue::Date(date) => date.to_rfc3339(),
        FieldValue::Labels(values) | FieldValue::Links(values) | FieldValue::References(values) => {
            values.join(", ")
        }
    }
}

/// The type of a field to add.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NewFieldKind {
    /// Free text.
    Text,
    /// A number.
    Number,
    /// True or false.
    Checkbox,
    /// A date.
    Date,
    /// A URL.
    Link,
    /// One label from a list, such as a stage or priority.
    Select,
    /// Several labels from a list.
    MultiSelect,
    /// One Macro user.
    Person,
    /// Several Macro users.
    People,
}

impl NewFieldKind {
    /// The column type it adds.
    pub(crate) fn column_kind(self) -> ColumnKind {
        match self {
            NewFieldKind::Text => ColumnKind::Text,
            NewFieldKind::Number => ColumnKind::Number,
            NewFieldKind::Checkbox => ColumnKind::Boolean,
            NewFieldKind::Date => ColumnKind::Date,
            NewFieldKind::Link => ColumnKind::Link,
            NewFieldKind::Select => ColumnKind::Select { multi: false },
            NewFieldKind::MultiSelect => ColumnKind::Select { multi: true },
            NewFieldKind::Person => ColumnKind::Entity {
                target: EntityKind::User,
                multi: false,
            },
            NewFieldKind::People => ColumnKind::Entity {
                target: EntityKind::User,
                multi: true,
            },
        }
    }

    /// Whether the field takes options.
    pub(crate) fn takes_options(self) -> bool {
        matches!(self, NewFieldKind::Select | NewFieldKind::MultiSelect)
    }
}

fn references(value: &Option<FieldValue>) -> impl Iterator<Item = &String> {
    match value {
        Some(FieldValue::References(ids)) => ids.iter(),
        _ => [].iter(),
    }
}

fn contains(haystack: &str, needle: &str) -> bool {
    haystack
        .to_lowercase()
        .contains(&needle.trim().to_lowercase())
}

fn number(field: &str, value: &str) -> Result<f64, String> {
    let cleaned: String = value
        .trim()
        .trim_start_matches(['$', '€', '£'])
        .chars()
        .filter(|c| *c != ',' && !c.is_whitespace())
        .collect();
    cleaned
        .parse::<f64>()
        .ok()
        .filter(|number| number.is_finite())
        .ok_or_else(|| format!("\"{field}\" takes a number, not \"{value}\"."))
}

fn checkbox(field: &str, value: &str) -> Result<bool, String> {
    match value.trim().to_lowercase().as_str() {
        "true" | "yes" | "checked" => Ok(true),
        "false" | "no" | "unchecked" => Ok(false),
        _ => Err(format!("\"{field}\" takes true or false, not \"{value}\".")),
    }
}

fn date(field: &str, value: &str) -> Result<DateTime<Utc>, String> {
    let value = value.trim();
    DateTime::parse_from_rfc3339(value)
        .map(|date| date.with_timezone(&Utc))
        .or_else(|_| {
            NaiveDate::parse_from_str(value, "%Y-%m-%d").map(|date| {
                date.and_hms_opt(0, 0, 0)
                    .expect("midnight exists")
                    .and_utc()
            })
        })
        .map_err(|_| {
            format!(
                "\"{field}\" takes a date like 2026-10-12 or an ISO date-time, not \"{value}\"."
            )
        })
}

/// A person's Macro user id: `me`, an email address, or the id itself.
fn person(field: &str, value: &str, viewer: &MacroUserIdStr<'_>) -> Result<String, String> {
    let value = value.trim();
    if value.eq_ignore_ascii_case("me") {
        return Ok(viewer.as_ref().to_owned());
    }
    let id = if value.to_lowercase().starts_with("macro|") {
        value.to_lowercase()
    } else if value.contains('@') {
        format!("macro|{}", value.to_lowercase())
    } else {
        String::new()
    };
    MacroUserIdStr::parse_from_str(&id)
        .map(|_| id.clone())
        .map_err(|_| {
            format!(
                "\"{field}\" takes a person: \"me\", an email address, or a Macro user id like \
                 macro|sam@example.com, not \"{value}\"."
            )
        })
}
