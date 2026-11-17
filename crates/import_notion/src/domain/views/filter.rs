//! Conservative translation: approximations can broaden, never narrow, rows.
use chrono::{DateTime, Duration, NaiveDate, Utc};
use models_databases::{ColumnKind, views::*};
use serde_json::Value;

use super::model::*;

pub(super) fn translate(
    value: &Value,
    columns: &[ViewColumnBinding],
    losses: &mut Vec<ViewLoss>,
) -> Option<FilterGroup> {
    let node = node(value, columns, losses, "filter", 0)?;
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
    columns: &[ViewColumnBinding],
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
        let Some(children) = object
            .get(key)
            .and_then(Value::as_array)
            .filter(|_| object.len() == 1)
        else {
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
                columns,
                losses,
                &format!("{path}.{key}[{index}]"),
                depth + 1,
            ) {
                Some(condition) => conditions.push(condition),
                None => valid = false,
            }
            if losses.len() != before {
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
    let translated = condition(value, columns);
    if translated.is_none() {
        loss(
            losses,
            ViewLossKind::Filter,
            path,
            "Unsupported predicate, value, or unmapped column/option; predicate omitted; view may include additional rows",
        );
    }
    translated
}

fn condition(value: &Value, columns: &[ViewColumnBinding]) -> Option<FilterNode> {
    let object = value.as_object()?;
    if object.len() != 2 {
        return None;
    }
    let binding = column(columns, object.get("property")?.as_str()?)?;
    if binding.snapshot {
        return None;
    }
    let (kind, predicate) = object.iter().find(|(key, _)| key.as_str() != "property")?;
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
    let predicate = predicate.as_object()?;
    if predicate.len() != 1 {
        return None;
    }
    let (operator, value) = predicate.iter().next()?;
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
