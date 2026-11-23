//! Conservative translation: approximations can broaden, never narrow, rows.
use chrono::{DateTime, Duration, NaiveDate, Utc};
use models_databases::{ColumnKind, views::*};
use serde_json::Value;

use super::model::*;

pub(super) fn translate(
    value: &Value,
    lookup: &ColumnLookup<'_>,
    losses: &mut Vec<ViewLoss>,
) -> Option<FilterGroup> {
    let node = node(value, lookup, losses, "filter", 0)?;
    Some(match node {
        FilterNode::Group(group) => group,
        condition => FilterGroup {
            conjunction: Conjunction::And,
            conditions: vec![condition],
        },
    })
}

fn node(
    value: &Value,
    lookup: &ColumnLookup<'_>,
    losses: &mut Vec<ViewLoss>,
    path: &str,
    depth: u8,
) -> Option<FilterNode> {
    let Some(object) = value.as_object() else {
        loss(
            losses,
            ViewLossKind::Filter,
            path,
            "Filter must be an object; predicate omitted; view may include additional rows",
        );
        return None;
    };
    if depth >= 32 {
        loss(
            losses,
            ViewLossKind::Filter,
            path,
            "Filter nesting exceeds translation limit; predicate omitted; view may include additional rows",
        );
        return None;
    }
    if object.contains_key("and") || object.contains_key("or") {
        let (key, conjunction) = if object.contains_key("and") {
            ("and", Conjunction::And)
        } else {
            ("or", Conjunction::Or)
        };
        let Some(children) = object.get(key).and_then(Value::as_array).filter(|_| {
            object
                .keys()
                .all(|field| field == key || metadata_field(field))
        }) else {
            loss(
                losses,
                ViewLossKind::Filter,
                path,
                "Malformed compound filter; predicate omitted; view may include additional rows",
            );
            return None;
        };
        // Dropping an AND clause broadens the result. An incomplete OR must
        // be omitted in full, since keeping its other branches would narrow it.
        let mut valid = true;
        let mut conditions = Vec::new();
        for (index, child) in children.iter().enumerate() {
            let before = losses.len();
            match node(
                child,
                lookup,
                losses,
                &format!("{path}.{key}[{index}]"),
                depth + 1,
            ) {
                Some(condition) => conditions.push(condition),
                None => valid = false,
            }
            if losses[before..]
                .iter()
                .any(|loss| loss.kind != ViewLossKind::FilterIncludesBlankStatus)
            {
                valid = false;
            }
        }
        if children.is_empty() {
            loss(
                losses,
                ViewLossKind::Filter,
                path,
                "Empty compound filter has no portable meaning; predicate omitted; view may include additional rows",
            );
            valid = false;
        }
        return (!conditions.is_empty() && (valid || conjunction == Conjunction::And)).then_some(
            FilterNode::Group(FilterGroup {
                conjunction,
                conditions,
            }),
        );
    }
    let before = losses.len();
    let translated = condition(value, lookup, losses, path);
    if translated.is_none() && losses.len() == before {
        loss(
            losses,
            ViewLossKind::Filter,
            path,
            "Unsupported predicate, value, or unmapped column/option; predicate omitted; view may include additional rows",
        );
    }
    translated
}

fn condition(
    value: &Value,
    lookup: &ColumnLookup<'_>,
    losses: &mut Vec<ViewLoss>,
    path: &str,
) -> Option<FilterNode> {
    let object = value.as_object()?;
    let binding = lookup(object.get("property")?.as_str()?)?;
    if binding.snapshot {
        return None;
    }
    let mut predicates = object
        .iter()
        .filter(|(key, _)| key.as_str() != "property" && !metadata_field(key));
    let (kind, predicate) = predicates.next()?;
    if predicates.next().is_some() {
        return None;
    }
    let compatible = match kind.as_str() {
        "title" | "rich_text" | "email" | "phone_number" => binding.kind == ColumnKind::Text,
        "url" => binding.kind == ColumnKind::Link,
        "number" => binding.kind == ColumnKind::Number,
        "checkbox" => binding.kind == ColumnKind::Boolean,
        "date" | "created_time" | "last_edited_time" => {
            matches!(binding.kind, ColumnKind::Date | ColumnKind::DateRange)
        }
        "select" | "status" => binding.kind == ColumnKind::Select { multi: false },
        "multi_select" => binding.kind == ColumnKind::Select { multi: true },
        _ => false,
    };
    if !compatible {
        return None;
    }
    let mut operators = predicate
        .as_object()?
        .iter()
        .filter(|(key, _)| !metadata_field(key));
    let (operator, value) = operators.next()?;
    if operators.next().is_some() {
        return None;
    }
    let text = matches!(
        kind.as_str(),
        "title" | "rich_text" | "email" | "phone_number" | "url"
    );
    // Text import trims cell values and turns whitespace-only values into null.
    // Inequality cannot distinguish values collapsed by that normalization.
    if text
        && (operator == "does_not_equal"
            || operator == "is_not_empty" && value == &Value::Bool(true))
    {
        loss(
            losses,
            ViewLossKind::Filter,
            path,
            "Imported text is trimmed; inequality and nonempty tests may hide source values, so the predicate is omitted",
        );
        return None;
    }
    let positive_text = matches!(
        operator.as_str(),
        "equals" | "contains" | "starts_with" | "ends_with"
    );
    let normalized = if text && (positive_text || operator == "does_not_contain") {
        let original = value.as_str()?;
        let trimmed = original.trim();
        if positive_text && trimmed.is_empty() || !positive_text && trimmed != original {
            loss(
                losses,
                ViewLossKind::Filter,
                path,
                "Text literal cannot safely match trimmed imported values; predicate omitted; view may include additional rows",
            );
            return None;
        }
        if trimmed != original {
            loss(
                losses,
                ViewLossKind::Filter,
                path,
                "Text literal trimmed to match imported values; view may include additional rows",
            );
        }
        Some(Value::String(trimmed.to_string()))
    } else {
        None
    };
    let value = normalized.as_ref().unwrap_or(value);
    // Imported option labels can collapse after case folding or truncation.
    // A negative test on the shared id would also hide another source option.
    if matches!(kind.as_str(), "select" | "status" | "multi_select")
        && matches!(operator.as_str(), "does_not_equal" | "does_not_contain")
        && let Some(option) = value.as_str().and_then(|label| binding.options.get(label))
        && binding
            .options
            .values()
            .filter(|known| *known == option)
            .count()
            > 1
    {
        return None;
    }
    let test = match operator.as_str() {
        "is_empty" if value == &Value::Bool(true) => FilterTest::Presence {
            operator: PresenceOperator::IsEmpty,
        },
        "is_not_empty" if value == &Value::Bool(true) => FilterTest::Presence {
            operator: PresenceOperator::IsNotEmpty,
        },
        _ => match kind.as_str() {
            "title" | "rich_text" | "email" | "phone_number" | "url" => FilterTest::Text {
                operator: match operator.as_str() {
                    "equals" => TextOperator::Is,
                    "does_not_equal" => TextOperator::IsNot,
                    "contains" => TextOperator::Contains,
                    "does_not_contain" => TextOperator::DoesNotContain,
                    "starts_with" => TextOperator::StartsWith,
                    "ends_with" => TextOperator::EndsWith,
                    _ => return None,
                },
                value: value.as_str()?.to_owned(),
            },
            "number" => FilterTest::Number {
                operator: match operator.as_str() {
                    "equals" => NumberOperator::Is,
                    "does_not_equal" => NumberOperator::IsNot,
                    "greater_than" => NumberOperator::GreaterThan,
                    "greater_than_or_equal_to" => NumberOperator::GreaterThanOrEqual,
                    "less_than" => NumberOperator::LessThan,
                    "less_than_or_equal_to" => NumberOperator::LessThanOrEqual,
                    _ => return None,
                },
                value: value.as_f64().filter(|n| n.is_finite())?,
            },
            "checkbox" => FilterTest::Checkbox {
                checked: match operator.as_str() {
                    "equals" => value.as_bool()?,
                    "does_not_equal" => !value.as_bool()?,
                    _ => return None,
                },
            },
            "select" | "status" | "multi_select" => FilterTest::Options {
                operator: match (kind.as_str(), operator.as_str()) {
                    ("multi_select", "contains") => SetOperator::HasAny,
                    ("multi_select", "does_not_contain") => SetOperator::HasNone,
                    ("select" | "status", "equals") => SetOperator::IsAnyOf,
                    ("select" | "status", "does_not_equal") => SetOperator::IsNoneOf,
                    _ => return None,
                },
                options: vec![*binding.options.get(value.as_str()?)?],
            },
            "date" | "created_time" | "last_edited_time" if binding.kind == ColumnKind::Date => {
                return date(binding.column, operator, value.as_str()?);
            }
            _ => return None,
        },
    };
    if kind == "status" && operator == "does_not_equal" {
        // Macro's negative set test includes blank cells. Notion does not
        // specify the blank case for this operator, so keep the superset.
        loss(
            losses,
            ViewLossKind::FilterIncludesBlankStatus,
            path,
            "Status exclusion keeps blank cells because Notion does not specify their behavior",
        );
    }
    Some(FilterNode::Condition(FilterCondition {
        column: binding.column,
        test,
    }))
}

fn date(column: models_databases::ColumnId, operator: &str, raw: &str) -> Option<FilterNode> {
    let day = NaiveDate::parse_from_str(raw, "%Y-%m-%d").ok();
    let instant = if let Some(day) = day {
        day.and_hms_opt(0, 0, 0)?.and_utc()
    } else {
        DateTime::parse_from_rfc3339(raw).ok()?.with_timezone(&Utc)
    };
    let next = instant.checked_add_signed(Duration::days(1))?;
    let test = |operator, value| {
        FilterNode::Condition(FilterCondition {
            column,
            test: FilterTest::Date { operator, value },
        })
    };
    Some(match (operator, day.is_some()) {
        ("equals", true) => FilterNode::Group(FilterGroup {
            conjunction: Conjunction::And,
            conditions: vec![
                test(DateOperator::OnOrAfter, instant),
                test(DateOperator::Before, next),
            ],
        }),
        ("before", _) => test(DateOperator::Before, instant),
        ("after", true) => test(DateOperator::OnOrAfter, next),
        ("on_or_before", true) => test(DateOperator::Before, next),
        ("after", false) => test(DateOperator::After, instant),
        ("on_or_before", false) => test(DateOperator::OnOrBefore, instant),
        ("on_or_after", _) => test(DateOperator::OnOrAfter, instant),
        // Notion timestamp equality has millisecond granularity, whereas Macro
        // stores microseconds. Relative dates also require Notion's timezone.
        _ => return None,
    })
}
