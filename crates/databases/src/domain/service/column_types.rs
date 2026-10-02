//! Converting a column's cells to another type, one cell at a time, after
//! the cast rule has said the change can work at all.

use super::*;
use crate::domain::catalog::PropertyType;
use crate::domain::models::{ConversionRefusal, Misfit, MisfitGroup, RowId};
use models_properties::service::property_definition_with_options::PropertyDefinitionWithOptions;
use models_properties::service::property_value::PropertyValue;

/// The most characters of a value quoted in a refusal.
const MAX_EXAMPLE_LEN: usize = 40;
/// The most values quoted per kind of misfit.
const MAX_EXAMPLES: usize = 3;

#[derive(Debug)]
pub(super) enum ConvertedCell {
    Value(PropertyValue),
    Options(Vec<String>),
}

/// Converts the cells of one column to one target type.
pub(super) struct Converter<'a> {
    source: &'a PropertyDefinitionWithOptions,
    target: PropertyType,
    /// The converted cells, in the order they were pushed.
    pub cells: Vec<(RowId, ConvertedCell)>,
    /// Every option label the new column needs, first spelling first.
    pub labels: Vec<String>,
    /// Each cell that did not fit, with its value as text.
    misfits: Vec<(Misfit, String)>,
}

impl<'a> Converter<'a> {
    /// A converter to `target`. When both types take options, the source's
    /// options come along, used or not, as long as they fit.
    pub fn new(source: &'a PropertyDefinitionWithOptions, target: PropertyType) -> Self {
        let mut converter = Converter {
            source,
            target,
            cells: Vec::new(),
            labels: Vec::new(),
            misfits: Vec::new(),
        };
        if takes_options(source.definition.data_type) && takes_options(target.data_type) {
            for (_, label) in catalog::option_labels(source) {
                if let Ok(label) = converter.label(PropertyValue::Str(label)) {
                    converter.adopt(vec![label]);
                }
            }
        }
        converter
    }

    /// Convert one row's cell, or note why it does not fit.
    pub fn push(&mut self, row: RowId, value: &PropertyValue) {
        if is_empty(value) {
            return;
        }
        match self.convert(value) {
            Ok(cell) => {
                if let ConvertedCell::Options(labels) = &cell {
                    self.adopt(labels.clone());
                }
                self.cells.push((row, cell));
            }
            Err(misfit) => self.misfits.push((misfit, self.example(value))),
        }
    }

    /// How many cells did not fit.
    pub fn failures(&self) -> usize {
        self.misfits.len()
    }

    /// Up to three quoted values per kind of misfit, in the order they came.
    pub fn examples(&self) -> Vec<String> {
        self.groups()
            .into_iter()
            .flat_map(|group| group.examples)
            .collect()
    }

    /// `3 values aren't numbers`, for a menu; `None` when every cell fit.
    pub fn summary(&self) -> Option<String> {
        let groups = self.groups();
        (!groups.is_empty()).then(|| {
            groups
                .iter()
                .map(MisfitGroup::summary)
                .collect::<Vec<_>>()
                .join(", ")
        })
    }

    /// Why the change is refused; `None` when every cell fit.
    pub fn refusal(&self, column: &str) -> Option<ConversionRefusal> {
        let groups = self.groups();
        (!groups.is_empty()).then(|| ConversionRefusal {
            column: column.to_owned(),
            groups,
        })
    }

    /// The misfits by kind, in the order each kind first came: its count and
    /// up to three examples.
    fn groups(&self) -> Vec<MisfitGroup> {
        let mut groups: Vec<MisfitGroup> = Vec::new();
        for (misfit, example) in &self.misfits {
            let index = match groups.iter().position(|group| group.misfit == *misfit) {
                Some(index) => index,
                None => {
                    groups.push(MisfitGroup {
                        misfit: *misfit,
                        count: 0,
                        examples: Vec::new(),
                    });
                    groups.len() - 1
                }
            };
            let group = &mut groups[index];
            group.count += 1;
            if group.examples.len() < MAX_EXAMPLES {
                group.examples.push(example.clone());
            }
        }
        groups
    }

    /// Keep the labels a converted cell needs.
    fn adopt(&mut self, labels: Vec<String>) {
        for label in labels {
            if !self.labels.contains(&label) {
                self.labels.push(label);
            }
        }
    }

    /// The converted cell. A cell with several values going to a
    /// single-valued type does not fit: keeping one would drop the others.
    fn convert(&self, value: &PropertyValue) -> Result<ConvertedCell, Misfit> {
        if let PropertyValue::EntityRef(references) = value {
            return self.convert_references(references);
        }
        let values = self.values(value)?;
        if values.len() > 1 && !self.target_is_multi() {
            return Err(Misfit::SeveralValues);
        }
        let cell = if takes_options(self.target.data_type) {
            ConvertedCell::Options(
                values
                    .into_iter()
                    .map(|value| self.label(value))
                    .collect::<Result<_, _>>()?,
            )
        } else if self.target.data_type == DataType::Link {
            ConvertedCell::Value(PropertyValue::Link(
                values.into_iter().map(url).collect::<Result<_, _>>()?,
            ))
        } else {
            let value = values.into_iter().next().ok_or(Misfit::NotOption)?;
            ConvertedCell::Value(self.scalar(value)?)
        };
        Ok(cell)
    }

    fn convert_references(
        &self,
        references: &[models_properties::shared::EntityReference],
    ) -> Result<ConvertedCell, Misfit> {
        if self.target.data_type != DataType::Entity
            || references
                .iter()
                .any(|reference| Some(reference.entity_type) != self.target.specific_entity_type)
        {
            return Err(Misfit::OtherReference);
        }
        if references.len() > 1 && !self.target.is_multi_select {
            return Err(Misfit::SeveralValues);
        }
        Ok(ConvertedCell::Value(PropertyValue::EntityRef(
            references.to_vec(),
        )))
    }

    fn target_is_multi(&self) -> bool {
        self.target.is_multi_select
            && matches!(
                self.target.data_type,
                DataType::SelectString | DataType::SelectNumber | DataType::Tag | DataType::Link
            )
    }

    /// A cell's values one by one: an option cell's labels, a link cell's
    /// URLs, or the one value.
    fn values(&self, value: &PropertyValue) -> Result<Vec<PropertyValue>, Misfit> {
        Ok(match value {
            PropertyValue::SelectOption(ids) => ids
                .iter()
                .map(|id| {
                    let option = self
                        .source
                        .property_options
                        .iter()
                        .find(|option| option.id == *id)
                        .ok_or(Misfit::NotOption)?;
                    Ok(match &option.value {
                        PropertyOptionValue::String(value) => PropertyValue::Str(value.clone()),
                        PropertyOptionValue::Number(value) => PropertyValue::Num(*value),
                    })
                })
                .collect::<Result<_, Misfit>>()?,
            PropertyValue::Link(urls) => urls.iter().cloned().map(PropertyValue::Str).collect(),
            value => vec![value.clone()],
        })
    }

    /// A value as an option label of the target.
    fn label(&self, value: PropertyValue) -> Result<String, Misfit> {
        let label = if self.target.data_type == DataType::SelectNumber {
            number(value).map_err(|_| Misfit::NotOption)?.to_string()
        } else {
            text(value).ok_or(Misfit::NotOption)?
        };
        if label.trim() != label || label.is_empty() || label.chars().count() > MAX_OPTION_LABEL_LEN
        {
            return Err(Misfit::NotOption);
        }
        let taken = self.labels.iter().any(|existing| {
            existing != &label
                && option_label_key(self.target.data_type, existing)
                    == option_label_key(self.target.data_type, &label)
        });
        if taken {
            return Err(Misfit::OptionInOtherCase);
        }
        Ok(label)
    }

    /// One value as a text, number, checkbox or date cell.
    fn scalar(&self, value: PropertyValue) -> Result<PropertyValue, Misfit> {
        match self.target.data_type {
            DataType::String => text(value).map(PropertyValue::Str).ok_or(Misfit::NotText),
            DataType::Number => number(value).map(PropertyValue::Num),
            DataType::Boolean => match value {
                PropertyValue::Bool(value) => Ok(PropertyValue::Bool(value)),
                PropertyValue::Str(value) if value == "true" || value == "false" => {
                    Ok(PropertyValue::Bool(value == "true"))
                }
                _ => Err(Misfit::NotCheckbox),
            },
            DataType::Date => match value {
                PropertyValue::Date(value) => Ok(PropertyValue::Date(value)),
                PropertyValue::Str(value) => date(&value).map(PropertyValue::Date),
                _ => Err(Misfit::NotDate),
            },
            DataType::Entity => Err(Misfit::OtherReference),
            DataType::Link | DataType::SelectString | DataType::SelectNumber | DataType::Tag => {
                unreachable!("options and links are converted by convert")
            }
        }
    }

    /// A cell's value as a refusal quotes it.
    fn example(&self, value: &PropertyValue) -> String {
        let text = match value {
            PropertyValue::EntityRef(references) => references
                .iter()
                .map(|reference| reference.entity_id.clone())
                .collect::<Vec<_>>()
                .join(", "),
            value => self
                .values(value)
                .unwrap_or_default()
                .into_iter()
                .filter_map(text)
                .collect::<Vec<_>>()
                .join(", "),
        };
        match text.char_indices().nth(MAX_EXAMPLE_LEN) {
            Some((end, _)) => format!("{}…", &text[..end]),
            None => text,
        }
    }
}

/// Whether a stored value is an empty cell.
pub(super) fn is_empty(value: &PropertyValue) -> bool {
    matches!(value, PropertyValue::Str(value) if value.is_empty())
        || matches!(value, PropertyValue::SelectOption(value) if value.is_empty())
        || matches!(value, PropertyValue::EntityRef(value) if value.is_empty())
        || matches!(value, PropertyValue::Link(value) if value.is_empty())
}

/// A number, written exactly: no padding, rounding or leading zeros.
fn number(value: PropertyValue) -> Result<f64, Misfit> {
    match value {
        PropertyValue::Num(value) if value.is_finite() => Ok(value),
        PropertyValue::Str(value) => value
            .parse::<f64>()
            .ok()
            .filter(|number| number.is_finite() && number.to_string() == value)
            .ok_or(Misfit::NotNumber),
        _ => Err(Misfit::NotNumber),
    }
}

/// A value as text. A date the grid shows as a calendar day (midnight
/// UTC) reads `YYYY-MM-DD`; one with a time keeps it.
fn text(value: PropertyValue) -> Option<String> {
    match value {
        PropertyValue::Str(value) => Some(value),
        PropertyValue::Num(value) if value.is_finite() => Some(value.to_string()),
        PropertyValue::Bool(value) => Some(value.to_string()),
        PropertyValue::Date(value) if value.time() == chrono::NaiveTime::MIN => {
            Some(value.date_naive().to_string())
        }
        PropertyValue::Date(value) => Some(value.to_rfc3339()),
        _ => None,
    }
}

/// `YYYY-MM-DD` or a complete ISO date and time.
fn date(value: &str) -> Result<chrono::DateTime<Utc>, Misfit> {
    chrono::DateTime::parse_from_rfc3339(value)
        .map(|date| date.with_timezone(&Utc))
        .ok()
        .or_else(|| {
            chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d")
                .ok()
                .filter(|date| date.to_string() == value)
                .and_then(|date| date.and_hms_opt(0, 0, 0))
                .map(|date| date.and_utc())
        })
        .ok_or(Misfit::NotDate)
}

/// A complete http or https URL.
fn url(value: PropertyValue) -> Result<String, Misfit> {
    let text = text(value).ok_or(Misfit::NotUrl)?;
    if is_complete_url(&text) {
        Ok(text)
    } else {
        Err(Misfit::NotUrl)
    }
}

/// Whether text is a complete http or https URL, as a link cell holds.
pub(super) fn is_complete_url(text: &str) -> bool {
    url::Url::parse(text)
        .is_ok_and(|url| matches!(url.scheme(), "http" | "https") && url.host_str().is_some())
}
