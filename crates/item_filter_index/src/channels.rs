//! Channel predicates for the existing flat Soup projection profile.

use super::*;

fn mentions_participation(expr: &Expr<ChannelLiteral>) -> bool {
    match expr {
        Expr::Literal(ChannelLiteral::IsParticipant(_)) => true,
        Expr::Literal(_) => false,
        Expr::And(a, b) | Expr::Or(a, b) => mentions_participation(a) || mentions_participation(b),
        Expr::Not(expr) => mentions_participation(expr),
    }
}

/// Conservative evaluation with the viewer's participation fixed to false.
/// Other facts are unknown; an omitted SQL clause is distinct from TRUE.
#[derive(Clone, Copy)]
enum NonParticipantMatch {
    Omitted,
    Always,
    Never,
    Possible,
}

fn non_participant_match(expr: &Expr<ChannelLiteral>) -> NonParticipantMatch {
    use NonParticipantMatch::{Always, Never, Omitted, Possible};
    match expr {
        Expr::Literal(ChannelLiteral::IsParticipant(true) | ChannelLiteral::Importance(false)) => {
            Never
        }
        Expr::Literal(ChannelLiteral::IsParticipant(false)) => Always,
        Expr::Literal(ChannelLiteral::Importance(true)) => Omitted,
        Expr::Literal(_) => Possible,
        Expr::Not(expr) => match non_participant_match(expr) {
            Always => Never,
            Never => Always,
            value @ (Omitted | Possible) => value,
        },
        Expr::And(a, b) | Expr::Or(a, b) => {
            let (a, b) = (non_participant_match(a), non_participant_match(b));
            // Match the server folder: omitted clauses disappear from both
            // AND and OR, and stay omitted under NOT.
            if let (Omitted, value) | (value, Omitted) = (a, b) {
                return value;
            }
            if matches!(expr, Expr::And(..)) {
                match (a, b) {
                    (Never, _) | (_, Never) => Never,
                    (Always, Always) => Always,
                    _ => Possible,
                }
            } else {
                match (a, b) {
                    (Always, _) | (_, Always) => Always,
                    (Never, Never) => Never,
                    _ => Possible,
                }
            }
        }
    }
}

fn requires_participation(expr: &Expr<ChannelLiteral>) -> bool {
    matches!(non_participant_match(expr), NonParticipantMatch::Never)
}

fn excluded(expr: Option<&Expr<ChannelLiteral>>) -> bool {
    expr.is_some_and(|expr| {
        proves_none(
            expr,
            |literal| matches!(literal, ChannelLiteral::ChannelId(id) if id.is_nil()),
        )
    })
}

pub(super) fn check(expr: Option<&Expr<ChannelLiteral>>) -> Result<(), UnsupportedReason> {
    if excluded(expr) {
        return Ok(());
    }
    if !supported_expr(expr, |literal| {
        matches!(
            literal,
            ChannelLiteral::ChannelId(_)
                | ChannelLiteral::OrganizationId(_)
                | ChannelLiteral::TeamId(_)
                | ChannelLiteral::ChannelType(_)
                | ChannelLiteral::Importance(_)
                | ChannelLiteral::IsParticipant(_)
        ) || matches!(literal, ChannelLiteral::NotificationState(state) if active_notification_state(state))
    }) {
        return Err(UnsupportedReason::Literal("channel"));
    }
    // Mentioning participation widens the server candidate universe to team
    // channels the viewer has not joined. Existing channel fields do not prove
    // that independent team grant, so only participant-scoped requests qualify.
    if expr.is_some_and(|expr| mentions_participation(expr) && !requires_participation(expr)) {
        return Err(UnsupportedReason::Literal("channel-participation-scope"));
    }
    Ok(())
}

/// SQL predicates have separate true/false sets: NULL belongs to neither.
/// Importance(true) is omitted by the server's channel AST folder, including
/// inside OR/NOT; it is not a SQL TRUE literal.
struct SqlPredicate {
    positive: PredicateExpr,
    negative: PredicateExpr,
}

fn fold(expr: &Expr<ChannelLiteral>) -> Result<Option<SqlPredicate>, CompileError> {
    let boolean = |positive: PredicateExpr| SqlPredicate {
        negative: PredicateExpr::Not(Box::new(positive.clone())),
        positive,
    };
    Ok(Some(match expr {
        Expr::Literal(ChannelLiteral::Importance(true)) => return Ok(None),
        Expr::Literal(literal) => {
            let (positive, nullable) = match literal {
                ChannelLiteral::ChannelId(id) => (exact_uuid(vocabulary::id(), id), None),
                ChannelLiteral::TeamId(id) => (
                    exact_uuid(vocabulary::channel_team(), id),
                    Some(vocabulary::channel_team()),
                ),
                ChannelLiteral::OrganizationId(id) => (
                    PredicateExpr::Exact {
                        attribute: vocabulary::channel_organization(),
                        value: ExactValue::new(id.to_be_bytes())?,
                    },
                    Some(vocabulary::channel_organization()),
                ),
                ChannelLiteral::ChannelType(kind) => (
                    exact_utf8(vocabulary::channel_type(), kind.to_string())?,
                    None,
                ),
                ChannelLiteral::IsParticipant(value) => (
                    PredicateExpr::Exact {
                        attribute: vocabulary::channel_participant(),
                        value: ExactValue::new([u8::from(*value)])?,
                    },
                    None,
                ),
                ChannelLiteral::Importance(false) => (PredicateExpr::None, None),
                ChannelLiteral::NotificationState(state) => (notification_state_expr(state), None),
                _ => unreachable!("channel eligibility checked"),
            };
            let mut result = boolean(positive);
            if let Some(attribute) = nullable {
                result.negative = PredicateExpr::And(
                    Box::new(PredicateExpr::ExactExists { attribute }),
                    Box::new(result.negative),
                );
            }
            result
        }
        Expr::Not(expr) => {
            let Some(value) = fold(expr)? else {
                return Ok(None);
            };
            SqlPredicate {
                positive: value.negative,
                negative: value.positive,
            }
        }
        Expr::And(a, b) | Expr::Or(a, b) => {
            let (a, b) = match (fold(a)?, fold(b)?) {
                (None, value) | (value, None) => return Ok(value),
                (Some(a), Some(b)) => (a, b),
            };
            if matches!(expr, Expr::And(..)) {
                SqlPredicate {
                    positive: PredicateExpr::And(Box::new(a.positive), Box::new(b.positive)),
                    negative: PredicateExpr::Or(Box::new(a.negative), Box::new(b.negative)),
                }
            } else {
                SqlPredicate {
                    positive: PredicateExpr::Or(Box::new(a.positive), Box::new(b.positive)),
                    negative: PredicateExpr::And(Box::new(a.negative), Box::new(b.negative)),
                }
            }
        }
    }))
}

pub(super) fn compile(
    expr: Option<&Expr<ChannelLiteral>>,
) -> Result<PartitionPredicate, CompileError> {
    if excluded(expr) {
        return Ok(PartitionPredicate {
            partition: vocabulary::channel_partition(),
            predicate: PredicateExpr::None,
        });
    }
    let predicate = expr
        .map(fold)
        .transpose()?
        .flatten()
        .map_or(PredicateExpr::All, |value| value.positive);
    Ok(PartitionPredicate {
        partition: vocabulary::channel_partition(),
        predicate: PredicateExpr::And(
            Box::new(predicate),
            Box::new(PredicateExpr::Exact {
                attribute: vocabulary::channel_participant(),
                value: ExactValue::new([1])?,
            }),
        ),
    })
}
