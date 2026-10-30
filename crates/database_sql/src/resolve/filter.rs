//! Typing literals against columns and checking each condition form against
//! the column's kind.

use chrono::{DateTime, NaiveDate, Utc};
use models_databases::{DateRange, OptionId};

use crate::catalog::{Column, ColumnKind, EntityKind, SelectOption};
use crate::parse::{ComparisonOperator, Condition, Literal};

use super::names::Scope;
use super::{Filter, ResolveError, Value};

pub fn resolve(scope: &mut Scope<'_>, cond: Condition) -> Result<Filter, ResolveError> {
    match cond {
        Condition::And(parts) => parts
            .into_iter()
            .map(|part| resolve(scope, part))
            .collect::<Result<_, _>>()
            .map(Filter::And),
        Condition::Or(parts) => parts
            .into_iter()
            .map(|part| resolve(scope, part))
            .collect::<Result<_, _>>()
            .map(Filter::Or),
        Condition::Comparison {
            column,
            operator,
            value,
        } => {
            let bound = scope.column(&column)?;
            let column = &bound.column;
            if column.kind.is_multi() {
                return Err(ResolveError::EqualityOnMultiValued {
                    column: column.name.clone(),
                });
            }
            if value == Literal::Null {
                return Err(ResolveError::CompareToNull {
                    column: column.name.clone(),
                });
            }
            check_operator(column, operator)?;
            Ok(Filter::Comparison {
                column: bound.key,
                operator,
                value: typed(column, value)?,
            })
        }
        Condition::In {
            column,
            values,
            negated,
        } => {
            let bound = scope.column(&column)?;
            let column = &bound.column;
            if column.kind.is_multi() {
                return Err(ResolveError::EqualityOnMultiValued {
                    column: column.name.clone(),
                });
            }
            let values = values
                .into_iter()
                .map(|value| {
                    if value == Literal::Null {
                        return Err(ResolveError::CompareToNull {
                            column: column.name.clone(),
                        });
                    }
                    typed(column, value)
                })
                .collect::<Result<_, _>>()?;
            Ok(Filter::In {
                column: bound.key,
                values,
                negated,
            })
        }
        Condition::Has {
            column,
            value,
            negated,
        } => {
            let bound = scope.column(&column)?;
            let column = &bound.column;
            if !column.kind.is_multi() {
                return Err(ResolveError::HasOnSingleValued {
                    column: column.name.clone(),
                });
            }
            Ok(Filter::Has {
                column: bound.key,
                value: typed(column, value)?,
                negated,
            })
        }
        Condition::IsNull { column, negated } => {
            let bound = scope.column(&column)?;
            Ok(Filter::IsNull {
                column: bound.key,
                negated,
            })
        }
        Condition::Like {
            column,
            pattern,
            escape,
            negated,
        } => {
            let bound = scope.column(&column)?;
            let column = &bound.column;
            match column.kind {
                ColumnKind::Text | ColumnKind::Link => Ok(Filter::Like {
                    column: bound.key,
                    pattern,
                    escape,
                    negated,
                }),
                _ => Err(ResolveError::OperatorNotSupported {
                    column: column.name.clone(),
                    op: "LIKE",
                    supported: "LIKE only applies to text columns",
                }),
            }
        }
    }
}

/// Which operators a column's kind defines.
fn check_operator(column: &Column, operator: ComparisonOperator) -> Result<(), ResolveError> {
    let ordered = matches!(
        operator,
        ComparisonOperator::Less
            | ComparisonOperator::LessOrEqual
            | ComparisonOperator::Greater
            | ComparisonOperator::GreaterOrEqual
    );
    let supported = match column.kind {
        ColumnKind::Text
        | ColumnKind::Link
        | ColumnKind::Number
        | ColumnKind::Date
        | ColumnKind::DateRange => {
            return Ok(());
        }
        ColumnKind::Boolean => "checkbox columns support = and !=",
        ColumnKind::Select { .. } => "select columns support =, != and IN",
        ColumnKind::Entity { .. } => "entity columns support =, != and IN",
    };
    if ordered {
        return Err(ResolveError::OperatorNotSupported {
            column: column.name.clone(),
            op: operator.symbol(),
            supported,
        });
    }
    Ok(())
}

const DATE_HINT: &str = "compare it to an ISO date like '2026-09-01' or '2026-09-01T09:00:00Z'";
const RANGE_COMPARISON_HINT: &str = "compare it to an ISO date like '2026-09-01': = contains it, \
                                     < ends before it, > starts after it";
const RANGE_HINT: &str =
    "write an ISO interval like '2026-09-01/2026-09-05', or one date for a single day";

/// Type a literal a column is compared to. Lists belong to writes. A date
/// range compares to a date: whether it contains it, ends before it or
/// starts after it.
pub fn typed(column: &Column, lit: Literal) -> Result<Value, ResolveError> {
    if matches!(lit, Literal::List(_)) {
        return Err(ResolveError::ListInComparison {
            column: column.name.clone(),
        });
    }
    if column.kind == ColumnKind::DateRange {
        return match lit {
            Literal::Text(text) => parse_date(&text).map(Value::Date),
            _ => None,
        }
        .ok_or_else(|| ResolveError::TypeMismatch {
            column: column.name.clone(),
            expected: "date",
            hint: RANGE_COMPARISON_HINT,
        });
    }
    typed_one(column, lit)
}

/// Type a literal being stored in a cell: a list for a multi-valued column
/// (or one element for a single-valued one), a bare value otherwise; a
/// multi-valued column accepts a bare value as a one-element list.
pub fn typed_cell(column: &Column, lit: Literal) -> Result<Value, ResolveError> {
    let elements = match lit {
        Literal::List(elements) => elements,
        single => vec![single],
    };
    match &column.kind {
        ColumnKind::Entity {
            multi: true,
            target,
        } => elements
            .into_iter()
            .map(|element| typed_entity(column, *target, element))
            .collect::<Result<_, _>>()
            .map(Value::Entities),
        ColumnKind::Select {
            multi: true,
            options,
        } => elements
            .into_iter()
            .map(|element| typed_option(column, options, element))
            .collect::<Result<_, _>>()
            .map(Value::Options),
        _ => {
            let count = elements.len();
            match <[Literal; 1]>::try_from(elements) {
                Ok([single]) => typed_one(column, single),
                Err(_) => Err(ResolveError::ListOnSingleValued {
                    column: column.name.clone(),
                    count,
                }),
            }
        }
    }
}

fn typed_one(column: &Column, lit: Literal) -> Result<Value, ResolveError> {
    let mismatch = |expected, hint| ResolveError::TypeMismatch {
        column: column.name.clone(),
        expected,
        hint,
    };
    match (&column.kind, lit) {
        (ColumnKind::Text | ColumnKind::Link, Literal::Text(text)) => Ok(Value::Text(text)),
        (ColumnKind::Text, _) => Err(mismatch("text", "compare it to quoted 'text'")),
        (ColumnKind::Link, _) => Err(mismatch("link", "compare it to a quoted 'URL'")),
        (ColumnKind::Number, Literal::Number(n)) => Ok(Value::Number(n)),
        (ColumnKind::Number, _) => Err(mismatch("number", "compare it to a number")),
        (ColumnKind::Boolean, Literal::Boolean(b)) => Ok(Value::Bool(b)),
        (ColumnKind::Boolean, _) => Err(mismatch("checkbox", "compare it to TRUE or FALSE")),
        (ColumnKind::Date, Literal::Text(text)) => parse_date(&text)
            .map(Value::Date)
            .ok_or_else(|| mismatch("date", DATE_HINT)),
        (ColumnKind::Date, _) => Err(mismatch("date", DATE_HINT)),
        (ColumnKind::DateRange, Literal::Text(text)) => parse_range(&text)
            .map(Value::DateRange)
            .ok_or_else(|| mismatch("date range", RANGE_HINT)),
        (ColumnKind::DateRange, _) => Err(mismatch("date range", RANGE_HINT)),
        (ColumnKind::Select { options, .. }, lit) => {
            typed_option(column, options, lit).map(Value::Option)
        }
        (ColumnKind::Entity { target, .. }, lit) => {
            typed_entity(column, *target, lit).map(Value::Entity)
        }
    }
}

fn typed_option(
    column: &Column,
    options: &[SelectOption],
    lit: Literal,
) -> Result<OptionId, ResolveError> {
    let Literal::Text(label) = lit else {
        return Err(ResolveError::TypeMismatch {
            column: column.name.clone(),
            expected: "select",
            hint: "compare it to a quoted option label",
        });
    };
    options
        .iter()
        .find(|option| option.label.eq_ignore_ascii_case(&label))
        .map(|option| option.id)
        .ok_or_else(|| ResolveError::UnknownOption {
            column: column.name.clone(),
            label,
            options: options.iter().map(|option| option.label.clone()).collect(),
        })
}

fn typed_entity(column: &Column, target: EntityKind, lit: Literal) -> Result<String, ResolveError> {
    match (target, lit) {
        (EntityKind::Row, Literal::Text(id)) => match id.parse::<models_databases::RowId>() {
            Ok(_) => Ok(id),
            Err(_) => Err(ResolveError::RowIdNotAnId { written: id }),
        },
        (_, Literal::Text(id)) if is_entity_id(&id) => Ok(id),
        _ => Err(ResolveError::TypeMismatch {
            column: column.name.clone(),
            expected: "entity",
            hint: "give an id like 'macro|sam@example.com', not a name",
        }),
    }
}

/// Macro entity ids are either a UUID or `<kind>|<rest>` (`macro|sam@example.com`,
/// `bot|<uuid>`). A bare name is what an agent writes when it has not looked
/// the person up.
fn is_entity_id(text: &str) -> bool {
    uuid::Uuid::parse_str(text).is_ok()
        || text
            .split_once('|')
            .is_some_and(|(kind, rest)| !kind.is_empty() && !rest.is_empty())
}

/// `2026-09-01/2026-09-05`, an ISO interval of two dates or date-times
/// ending no earlier than it starts, or one date for the range of that
/// instant.
fn parse_range(text: &str) -> Option<DateRange> {
    DateRange::parse_interval(text, parse_date).or_else(|| {
        let date = parse_date(text)?;
        Some(DateRange {
            start: date,
            end: date,
        })
    })
}

/// `2026-09-01` (midnight UTC) or any RFC 3339 date-time.
fn parse_date(text: &str) -> Option<DateTime<Utc>> {
    if let Ok(datetime) = DateTime::parse_from_rfc3339(text) {
        return Some(datetime.with_timezone(&Utc));
    }
    NaiveDate::parse_from_str(text, "%Y-%m-%d")
        .ok()
        .and_then(|date| date.and_hms_opt(0, 0, 0))
        .map(|datetime| datetime.and_utc())
}
