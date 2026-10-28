//! The property conditions of a call filter, in conjunctive normal form.
//!
//! Soup folds a properties filter (tags, entity references) into the call
//! filter with its `AND`/`OR`/`NOT` structure intact. The call query is static
//! SQL, so the conditions are flattened into clauses it can evaluate exactly:
//! a call matches when every clause has at least one term it satisfies.

use filter_ast::Expr;
use item_filters::ast::{LiteralTree, call::CallLiteral, properties::PropertyMatchValue};
use uuid::Uuid;

#[cfg(test)]
mod test;

/// Clauses beyond which a filter is too large to expand; the property
/// conditions are then dropped with a warning rather than expanded.
const MAX_CLAUSES: usize = 256;

/// One property condition.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum PropertyCondition {
    /// Any of the call's property values contains this tag option. Tags are
    /// matched without their definition, like the search service does.
    Tag(String),
    /// The call's `definition` property references `entity_id`.
    EntityRef { definition: Uuid, entity_id: String },
}

/// A condition, or its negation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct PropertyTerm {
    pub condition: PropertyCondition,
    pub negated: bool,
}

/// Property conditions as bound to the call query: one row per term, with
/// the clause it belongs to.
#[derive(Debug, Default, PartialEq, Eq)]
pub(super) struct PropertyClauseParams {
    pub clause_count: i32,
    pub clause_indices: Vec<i32>,
    pub negated: Vec<bool>,
    /// `None` for tags.
    pub definition_ids: Vec<Option<Uuid>>,
    pub values: Vec<String>,
}

/// A filter's property part. Non-property literals are evaluated by the
/// other call filters, so here they are unconstrained (`Any`).
enum Formula {
    Any,
    Term(PropertyTerm),
    And(Box<Formula>, Box<Formula>),
    Or(Box<Formula>, Box<Formula>),
}

/// The property conditions of `filter` in conjunctive normal form.
pub(super) fn property_clauses(filter: &LiteralTree<CallLiteral>) -> Vec<Vec<PropertyTerm>> {
    let Some(expr) = filter else {
        return Vec::new();
    };
    match clauses(&formula(expr, false)) {
        Some(clauses) => clauses,
        None => {
            tracing::warn!(
                max = MAX_CLAUSES,
                "call property filter is too large to evaluate; ignoring its property conditions"
            );
            Vec::new()
        }
    }
}

/// Flatten clauses into the call query's parameters.
pub(super) fn clause_params(clauses: &[Vec<PropertyTerm>]) -> PropertyClauseParams {
    let mut params = PropertyClauseParams {
        clause_count: i32::try_from(clauses.len()).unwrap_or(i32::MAX),
        ..PropertyClauseParams::default()
    };
    for (index, clause) in clauses.iter().enumerate() {
        for term in clause {
            params
                .clause_indices
                .push(i32::try_from(index).unwrap_or(i32::MAX));
            params.negated.push(term.negated);
            let (definition, value) = match &term.condition {
                PropertyCondition::Tag(option_id) => (None, option_id.clone()),
                PropertyCondition::EntityRef {
                    definition,
                    entity_id,
                } => (Some(*definition), entity_id.clone()),
            };
            params.definition_ids.push(definition);
            params.values.push(value);
        }
    }
    params
}

/// The property formula of `expr`, with negations pushed onto terms.
fn formula(expr: &Expr<CallLiteral>, negated: bool) -> Formula {
    match expr {
        Expr::Literal(CallLiteral::Property(literal)) => {
            let condition = match &literal.value {
                PropertyMatchValue::SelectOption(option_id) => {
                    PropertyCondition::Tag(option_id.to_string())
                }
                PropertyMatchValue::EntityRef(entity_id) => PropertyCondition::EntityRef {
                    definition: literal.property_definition_id,
                    entity_id: entity_id.to_string(),
                },
            };
            Formula::Term(PropertyTerm { condition, negated })
        }
        Expr::Literal(_) => Formula::Any,
        Expr::Not(inner) => formula(inner, !negated),
        // De Morgan: a negated AND is an OR of negations, and vice versa.
        Expr::And(a, b) if !negated => and(formula(a, false), formula(b, false)),
        Expr::Or(a, b) if negated => and(formula(a, true), formula(b, true)),
        Expr::Or(a, b) | Expr::And(a, b) => or(formula(a, negated), formula(b, negated)),
    }
}

fn and(a: Formula, b: Formula) -> Formula {
    match (a, b) {
        (Formula::Any, other) | (other, Formula::Any) => other,
        (a, b) => Formula::And(Box::new(a), Box::new(b)),
    }
}

fn or(a: Formula, b: Formula) -> Formula {
    match (a, b) {
        (Formula::Any, _) | (_, Formula::Any) => Formula::Any,
        (a, b) => Formula::Or(Box::new(a), Box::new(b)),
    }
}

/// Conjunctive normal form, or `None` when it exceeds [`MAX_CLAUSES`].
fn clauses(formula: &Formula) -> Option<Vec<Vec<PropertyTerm>>> {
    match formula {
        Formula::Any => Some(Vec::new()),
        Formula::Term(term) => Some(vec![vec![term.clone()]]),
        Formula::And(a, b) => {
            let mut all = clauses(a)?;
            all.extend(clauses(b)?);
            (all.len() <= MAX_CLAUSES).then_some(all)
        }
        Formula::Or(a, b) => {
            let (a, b) = (clauses(a)?, clauses(b)?);
            if a.len().saturating_mul(b.len()) > MAX_CLAUSES {
                return None;
            }
            Some(
                a.iter()
                    .flat_map(|left| {
                        b.iter()
                            .map(move |right| left.iter().chain(right).cloned().collect())
                    })
                    .collect(),
            )
        }
    }
}
