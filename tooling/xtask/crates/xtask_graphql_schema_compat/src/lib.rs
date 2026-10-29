//! Finds GraphQL schema changes that would break deployed clients.
//!
//! Web tabs, desktop OTA bundles, and the bundle embedded in each App Store
//! build keep sending the documents they were built with for weeks after a
//! deploy. The server rejects a whole document that names a removed type,
//! field, argument, input field, or enum value, or that no longer fits a
//! changed type. A removal is allowed only once the base schema marked the
//! element `Remove after YYYY-MM-DD` and that date has passed. Fields,
//! arguments, input fields, and enum values carry the marker in their
//! `@deprecated` reason; types, which GraphQL cannot deprecate, in their
//! description. A new or moved date must be at least [`MIN_DEPRECATION_DAYS`]
//! away.

use std::collections::BTreeMap;

use anyhow::{Result, anyhow};
use apollo_compiler::{
    Name, Node, Schema,
    ast::{DirectiveList, FieldDefinition, InputValueDefinition},
    collections::{IndexMap, IndexSet},
    schema::{Component, ComponentName, ExtendedType},
};
use chrono::{Days, NaiveDate};

#[cfg(test)]
mod test;

/// How long deployed clients get between a removal date being set and the
/// removal. Covers the gap between App Store releases, whose embedded bundle
/// runs on first launch until the bundle updater replaces it.
pub const MIN_DEPRECATION_DAYS: u64 = 30;

/// Prefix of the removal marker, matched case-insensitively.
const MARKER: &str = "remove after ";

/// Parses an SDL document without validating it; the server built it.
pub fn parse_schema(sdl: &str, path: &str) -> Result<Schema> {
    Schema::parse(sdl, path).map_err(|error| anyhow!("parsing {path}: {}", error.errors))
}

/// Every change from `base` to `new` that a client built against `base` could
/// hit, plus removal dates set too close to `today`. Empty when compatible.
pub fn incompatible_changes(base: &Schema, new: &Schema, today: NaiveDate) -> Vec<String> {
    let base_dates = removal_dates(base);
    let removable = |coordinate: &str| {
        base_dates
            .get(coordinate)
            .is_some_and(|date| *date <= today)
    };
    let mut problems = Vec::new();

    for (name, base_type) in &base.types {
        if base_type.is_built_in() || removable(name) {
            continue;
        }
        let Some(new_type) = new.types.get(name) else {
            problems.push(format!("type `{name}` was removed"));
            continue;
        };
        match (base_type, new_type) {
            (ExtendedType::Object(base_object), ExtendedType::Object(new_object)) => {
                compare_fields(
                    name,
                    &base_object.fields,
                    &new_object.fields,
                    &removable,
                    &mut problems,
                );
                compare_interfaces(
                    name,
                    &base_object.implements_interfaces,
                    &new_object.implements_interfaces,
                    &removable,
                    &mut problems,
                );
            }
            (ExtendedType::Interface(base_interface), ExtendedType::Interface(new_interface)) => {
                compare_fields(
                    name,
                    &base_interface.fields,
                    &new_interface.fields,
                    &removable,
                    &mut problems,
                );
                compare_interfaces(
                    name,
                    &base_interface.implements_interfaces,
                    &new_interface.implements_interfaces,
                    &removable,
                    &mut problems,
                );
            }
            (ExtendedType::Union(base_union), ExtendedType::Union(new_union)) => {
                for member in &base_union.members {
                    if !new_union.members.contains(member) && !removable(&member.name) {
                        problems.push(format!("`{}` was removed from union `{name}`", member.name));
                    }
                }
            }
            (ExtendedType::Enum(base_enum), ExtendedType::Enum(new_enum)) => {
                for value in base_enum.values.keys() {
                    let coordinate = format!("{name}.{value}");
                    if !new_enum.values.contains_key(value) && !removable(&coordinate) {
                        problems.push(format!("enum value `{coordinate}` was removed"));
                    }
                }
            }
            (ExtendedType::InputObject(base_input), ExtendedType::InputObject(new_input)) => {
                compare_input_values(
                    base_input.fields.values().map(|field| &field.node),
                    new_input.fields.values().map(|field| &field.node),
                    "input field",
                    |field| format!("{name}.{field}"),
                    &removable,
                    &mut problems,
                );
            }
            (ExtendedType::Scalar(_), ExtendedType::Scalar(_)) => {}
            _ => problems.push(format!("type `{name}` changed kind")),
        }
    }

    let roots = |schema: &Schema| {
        let definition = &schema.schema_definition;
        [
            &definition.query,
            &definition.mutation,
            &definition.subscription,
        ]
        .map(|root| root.as_ref().map(|root| root.name.clone()))
    };
    if roots(base) != roots(new) {
        problems.push("root operation types changed".to_owned());
    }

    let earliest = today + Days::new(MIN_DEPRECATION_DAYS);
    for (coordinate, date) in removal_dates(new) {
        if base_dates.get(&coordinate) != Some(&date) && date < earliest {
            problems.push(format!(
                "`{coordinate}` is marked `Remove after {date}`; a new removal date must be on or after {earliest} ({MIN_DEPRECATION_DAYS} days out)"
            ));
        }
    }

    problems
}

/// Output fields of an object or interface: removed fields, return types a
/// client can no longer rely on, and argument changes.
fn compare_fields(
    type_name: &str,
    base_fields: &IndexMap<Name, Component<FieldDefinition>>,
    new_fields: &IndexMap<Name, Component<FieldDefinition>>,
    removable: &impl Fn(&str) -> bool,
    problems: &mut Vec<String>,
) {
    for (field_name, base_field) in base_fields {
        let coordinate = format!("{type_name}.{field_name}");
        let Some(new_field) = new_fields.get(field_name) else {
            if !removable(&coordinate) {
                problems.push(format!("field `{coordinate}` was removed"));
            }
            continue;
        };
        if !new_field.ty.is_assignable_to(&base_field.ty) {
            problems.push(format!(
                "field `{coordinate}` changed type from `{}` to `{}`",
                base_field.ty, new_field.ty
            ));
        }
        compare_input_values(
            base_field.arguments.iter(),
            new_field.arguments.iter(),
            "argument",
            |argument| format!("{coordinate}({argument}:)"),
            removable,
            problems,
        );
    }
}

/// Arguments or input fields: removed values, types that reject what clients
/// already send, and values that became required.
fn compare_input_values<'a>(
    base_values: impl Iterator<Item = &'a Node<InputValueDefinition>>,
    new_values: impl Iterator<Item = &'a Node<InputValueDefinition>>,
    kind: &str,
    coordinate: impl Fn(&str) -> String,
    removable: &impl Fn(&str) -> bool,
    problems: &mut Vec<String>,
) {
    let base_values: BTreeMap<&str, &InputValueDefinition> = base_values
        .map(|value| (value.name.as_str(), value.as_ref()))
        .collect();
    let new_values: BTreeMap<&str, &InputValueDefinition> = new_values
        .map(|value| (value.name.as_str(), value.as_ref()))
        .collect();

    for (name, base_value) in &base_values {
        let coordinate = coordinate(name);
        let Some(new_value) = new_values.get(name) else {
            if !removable(&coordinate) {
                problems.push(format!("{kind} `{coordinate}` was removed"));
            }
            continue;
        };
        if !base_value.ty.is_assignable_to(&new_value.ty) {
            problems.push(format!(
                "{kind} `{coordinate}` changed type from `{}` to `{}`",
                base_value.ty, new_value.ty
            ));
        } else if !is_required(base_value) && is_required(new_value) {
            problems.push(format!("{kind} `{coordinate}` became required"));
        }
    }
    for (name, new_value) in &new_values {
        if !base_values.contains_key(name) && is_required(new_value) {
            problems.push(format!("required {kind} `{}` was added", coordinate(name)));
        }
    }
}

/// Interfaces a type stopped implementing, which invalidates fragments spread
/// on the interface inside the type's selections.
fn compare_interfaces(
    type_name: &str,
    base_interfaces: &IndexSet<ComponentName>,
    new_interfaces: &IndexSet<ComponentName>,
    removable: &impl Fn(&str) -> bool,
    problems: &mut Vec<String>,
) {
    for interface in base_interfaces {
        if !new_interfaces.contains(interface) && !removable(&interface.name) {
            problems.push(format!(
                "`{type_name}` no longer implements `{}`",
                interface.name
            ));
        }
    }
}

/// A value a client must send: non-null with no default.
fn is_required(value: &InputValueDefinition) -> bool {
    value.ty.is_non_null() && value.default_value.is_none()
}

/// Every removal marker in a schema, keyed by schema coordinate.
fn removal_dates(schema: &Schema) -> BTreeMap<String, NaiveDate> {
    let mut dates = BTreeMap::new();
    for (name, ty) in &schema.types {
        if ty.is_built_in() {
            continue;
        }
        let type_date = ty.description().and_then(|text| marker_date(text));
        dates.extend(type_date.map(|date| (name.to_string(), date)));
        let fields = match ty {
            ExtendedType::Object(object) => Some(&object.fields),
            ExtendedType::Interface(interface) => Some(&interface.fields),
            _ => None,
        };
        for (field_name, field) in fields.into_iter().flatten() {
            let coordinate = format!("{name}.{field_name}");
            for argument in &field.arguments {
                let date = deprecation_date(&argument.directives);
                dates.extend(date.map(|date| (format!("{coordinate}({}:)", argument.name), date)));
            }
            dates.extend(deprecation_date(&field.directives).map(|date| (coordinate, date)));
        }
        match ty {
            ExtendedType::Enum(enum_type) => {
                for (value_name, value) in &enum_type.values {
                    let date = deprecation_date(&value.directives);
                    dates.extend(date.map(|date| (format!("{name}.{value_name}"), date)));
                }
            }
            ExtendedType::InputObject(input) => {
                for (field_name, field) in &input.fields {
                    let date = deprecation_date(&field.directives);
                    dates.extend(date.map(|date| (format!("{name}.{field_name}"), date)));
                }
            }
            ExtendedType::Scalar(_)
            | ExtendedType::Object(_)
            | ExtendedType::Interface(_)
            | ExtendedType::Union(_) => {}
        }
    }
    dates
}

/// The removal date in an element's `@deprecated` reason.
fn deprecation_date(directives: &DirectiveList) -> Option<NaiveDate> {
    directives
        .get("deprecated")?
        .specified_argument_by_name("reason")?
        .as_str()
        .and_then(marker_date)
}

/// The date following `Remove after` in `text`. Descriptions wrap, so any
/// whitespace run counts as one space.
fn marker_date(text: &str) -> Option<NaiveDate> {
    let text = text
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_ascii_lowercase();
    let start = text.find(MARKER)? + MARKER.len();
    NaiveDate::parse_from_str(text.get(start..start + 10)?, "%Y-%m-%d").ok()
}
