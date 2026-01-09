//! AI formatting for entity properties.
//!
//! Provides XML-like formatting for key-value properties to be included
//! in AI document context.

use crate::util::{Date, Indent};

use models_properties::EntityType;
use models_properties::service::entity_property_with_definition::EntityPropertyWithDefinition;
use models_properties::service::property_value::PropertyValue;
use std::fmt;

/// A single property key-value pair.
#[derive(Debug, Clone)]
pub struct Property {
    pub(crate) key: String,
    pub(crate) value: String,
}

impl Property {
    pub fn from_property(property: EntityPropertyWithDefinition) -> Self {
        property
            .value
            .as_ref()
            .and_then(|v| format_property_value(v, &property.options))
            .map(|s| Self {
                key: property.definition.display_name.clone(),
                value: s,
            })
            .unwrap_or_else(|| Self {
                key: property.definition.display_name,
                value: "null".into(),
            })
    }
}

impl fmt::Display for Property {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "<property key=\"{}\">{}</property>",
            self.key, self.value
        )
    }
}

/// A collection of properties for an entity.
#[derive(Debug, Clone, Default)]
pub struct Properties {
    pub(crate) kind: String,
    pub(crate) items: Vec<Property>,
}

impl Properties {
    pub fn from_properties(
        kind: EntityType,
        properties: Vec<EntityPropertyWithDefinition>,
    ) -> Self {
        Self {
            kind: kind.to_string(),
            items: properties
                .into_iter()
                .map(Property::from_property)
                .collect(),
        }
    }

    pub fn is_empty(&self) -> bool {
        self.items.is_empty()
    }
}

impl fmt::Display for Properties {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.items.is_empty() {
            return Ok(());
        }

        writeln!(f, "<properties entity_kind=\"{}\">", self.kind)?;
        for prop in &self.items {
            writeln!(f, "{}", Indent(4, prop))?;
        }
        write!(f, "</properties>")
    }
}

/// Format a property value as a human-readable string.
fn format_property_value(
    value: &PropertyValue,
    options: &Option<Vec<models_properties::service::property_option::PropertyOption>>,
) -> Option<String> {
    match value {
        PropertyValue::Bool(b) => Some(if *b { "Yes" } else { "No" }.to_string()),
        PropertyValue::Num(n) => Some(n.to_string()),
        PropertyValue::Str(s) => Some(s.clone()),
        PropertyValue::Date(d) => Some(Date(d.to_owned()).to_string()),
        PropertyValue::SelectOption(ids) => {
            // Look up option display values
            let opts = options.as_ref()?;
            let values: Vec<String> = ids
                .iter()
                .filter_map(|id| {
                    opts.iter().find(|o| &o.id == id).map(|o| {
                        match &o.value {
                        models_properties::service::property_option::PropertyOptionValue::String(
                            s,
                        ) => s.clone(),
                        models_properties::service::property_option::PropertyOptionValue::Number(
                            n,
                        ) => n.to_string(),
                    }
                    })
                })
                .collect();

            if values.is_empty() {
                None
            } else {
                Some(values.join(", "))
            }
        }
        PropertyValue::EntityRef(refs) => {
            if refs.is_empty() {
                None
            } else {
                let ids: Vec<String> = refs
                    .iter()
                    .map(|r| format!("{}:{}", r.entity_type, r.entity_id))
                    .collect();
                Some(ids.join(", "))
            }
        }
        PropertyValue::Link(urls) => {
            if urls.is_empty() {
                None
            } else {
                Some(urls.join(", "))
            }
        }
    }
}
