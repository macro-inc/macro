use super::*;
use models_properties::service::property_definition_with_options::PropertyDefinitionWithOptions;
use models_properties::service::property_value::PropertyValue;

#[derive(Debug)]
pub(super) enum ConvertedCell {
    Value(PropertyValue),
    Options(Vec<String>),
}

fn invalid(message: &str) -> DatabaseError {
    DatabaseError::InvalidSchemaOperation(message.into())
}

fn number(value: PropertyValue) -> Result<f64, DatabaseError> {
    match value {
        PropertyValue::Num(value) if value.is_finite() => Ok(value),
        PropertyValue::Str(value) => value.parse::<f64>().ok()
            .filter(|number| number.is_finite() && number.to_string() == value)
            .ok_or_else(|| invalid("Some text cannot become a number without changing it. Use plain numbers without padding, rounding, or leading zeros.")),
        _ => Err(invalid("These values cannot be converted to numbers without losing information.")),
    }
}

fn text(value: PropertyValue) -> Result<String, DatabaseError> {
    match value {
        PropertyValue::Str(value) => Ok(value),
        PropertyValue::Num(value) if value.is_finite() => Ok(value.to_string()),
        PropertyValue::Bool(value) => Ok(value.to_string()),
        PropertyValue::Date(value) => Ok(value.to_rfc3339()),
        _ => Err(invalid(
            "These values cannot be converted to text without losing information.",
        )),
    }
}

/// Values are validated before definitions or row cells are changed. A failed
/// conversion leaves the whole column intact; arrays are never flattened.
pub(super) fn convert_cell(
    value: &PropertyValue,
    source: &PropertyDefinitionWithOptions,
    target: &ChangeColumnType,
) -> Result<Option<ConvertedCell>, DatabaseError> {
    if matches!(value, PropertyValue::Str(value) if value.is_empty())
        || matches!(value, PropertyValue::SelectOption(value) if value.is_empty())
        || matches!(value, PropertyValue::EntityRef(value) if value.is_empty())
        || matches!(value, PropertyValue::Link(value) if value.is_empty())
    {
        return Ok(None);
    }
    if target.relation.is_some() {
        return Err(invalid(
            "Clear this column before changing it to a relation. Existing text is not a record identity.",
        ));
    }
    if let PropertyValue::EntityRef(values) = value {
        if target.data_type == DataType::Entity
            && values
                .iter()
                .all(|value| Some(value.entity_type) == target.specific_entity_type)
            && (target.is_multi_select || values.len() <= 1)
        {
            return Ok(Some(ConvertedCell::Value(value.clone())));
        }
        return Err(invalid(
            "Clear existing mentions before changing their type. Record identities cannot be cast to another type.",
        ));
    }
    let values = match value {
        PropertyValue::SelectOption(ids) => ids.iter().map(|id| {
            let option = source.property_options.iter().find(|option| option.id == *id)
                .ok_or_else(|| invalid("An existing option is unavailable. Restore it before changing the column type."))?;
            Ok(match &option.value {
                PropertyOptionValue::String(value) => PropertyValue::Str(value.clone()),
                PropertyOptionValue::Number(value) => PropertyValue::Num(*value),
            })
        }).collect::<Result<Vec<_>, DatabaseError>>()?,
        PropertyValue::Link(values) => values.iter().cloned().map(PropertyValue::Str).collect(),
        value => vec![value.clone()],
    };
    if values.len() > 1
        && (!target.is_multi_select
            || !matches!(
                target.data_type,
                DataType::SelectString | DataType::SelectNumber | DataType::Tag | DataType::Link
            ))
    {
        return Err(invalid(
            "Some cells contain multiple values. Keep a multiple-value type or remove the extra values first.",
        ));
    }
    if takes_options(target.data_type) {
        let labels = values
            .into_iter()
            .map(|value| {
                if target.data_type == DataType::SelectNumber {
                    number(value).map(|number| number.to_string())
                } else {
                    text(value)
                }
            })
            .collect::<Result<Vec<_>, _>>()?;
        if labels.iter().any(|label| label.trim() != label) {
            return Err(invalid(
                "Some values have leading or trailing spaces. Clean them up before converting to choices.",
            ));
        }
        validate_option_labels(target.data_type, &labels, &[])?;
        return Ok(Some(ConvertedCell::Options(labels)));
    }
    if target.data_type == DataType::Link {
        let urls = values
            .into_iter()
            .map(text)
            .collect::<Result<Vec<_>, _>>()?;
        if urls.iter().any(|value| {
            url::Url::parse(value).ok().is_none_or(|url| {
                !matches!(url.scheme(), "http" | "https") || url.host_str().is_none()
            })
        }) {
            return Err(invalid(
                "Every value must be a complete http or https URL to become a link.",
            ));
        }
        return Ok(Some(ConvertedCell::Value(PropertyValue::Link(urls))));
    }
    let Some(value) = values.into_iter().next() else {
        return Ok(None);
    };
    let value = match target.data_type {
        DataType::String => PropertyValue::Str(text(value)?),
        DataType::Number => PropertyValue::Num(number(value)?),
        DataType::Boolean => match value {
            PropertyValue::Bool(value) => PropertyValue::Bool(value),
            PropertyValue::Str(value) if value == "true" || value == "false" => {
                PropertyValue::Bool(value == "true")
            }
            _ => {
                return Err(invalid(
                    "Checkboxes accept only true or false. Other values remain unchanged.",
                ));
            }
        },
        DataType::Date => match value {
            PropertyValue::Date(value) => PropertyValue::Date(value),
            PropertyValue::Str(value) => {
                let parsed = chrono::DateTime::parse_from_rfc3339(&value)
                    .map(|date| date.with_timezone(&Utc))
                    .ok()
                    .or_else(|| {
                        chrono::NaiveDate::parse_from_str(&value, "%Y-%m-%d")
                            .ok()
                            .filter(|date| date.to_string() == value)
                            .and_then(|date| date.and_hms_opt(0, 0, 0))
                            .map(|date| date.and_utc())
                    });
                PropertyValue::Date(parsed.ok_or_else(|| {
                    invalid("Dates must use YYYY-MM-DD or a complete ISO date and time.")
                })?)
            }
            _ => {
                return Err(invalid(
                    "These values cannot become dates without guessing.",
                ));
            }
        },
        _ => return Err(invalid("Clear this column before choosing this type.")),
    };
    Ok(Some(ConvertedCell::Value(value)))
}
