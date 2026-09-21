//! Document predicates preserve SQL NULL behavior for the raw file-type column.

use super::{CompileError, DocumentLiteral, Expr, PredicateExpr, vocabulary};

pub(super) fn compile(
    expr: Option<&Expr<DocumentLiteral>>,
    literal: impl Fn(&DocumentLiteral) -> Result<PredicateExpr, CompileError> + Copy,
) -> Result<PredicateExpr, CompileError> {
    match expr {
        Some(expr) => compile_inner(expr, false, literal),
        None => Ok(PredicateExpr::All),
    }
}

fn compile_inner(
    expr: &Expr<DocumentLiteral>,
    negated: bool,
    literal: impl Fn(&DocumentLiteral) -> Result<PredicateExpr, CompileError> + Copy,
) -> Result<PredicateExpr, CompileError> {
    Ok(match expr {
        Expr::Literal(value) => {
            let predicate = literal(value)?;
            if !negated {
                predicate
            } else if matches!(value, DocumentLiteral::FileType(_)) {
                // SQL NULL makes both fileType = x and NOT(fileType = x)
                // UNKNOWN, so neither matches a WHERE clause. An absent fact
                // already fails equality; negated equality also needs presence.
                PredicateExpr::And(
                    Box::new(PredicateExpr::ExactExists {
                        attribute: vocabulary::file_type(),
                    }),
                    Box::new(PredicateExpr::Not(Box::new(predicate))),
                )
            } else {
                PredicateExpr::Not(Box::new(predicate))
            }
        }
        Expr::Not(inner) => compile_inner(inner, !negated, literal)?,
        Expr::And(left, right) | Expr::Or(left, right) => {
            let left = Box::new(compile_inner(left, negated, literal)?);
            let right = Box::new(compile_inner(right, negated, literal)?);
            // Push NOT to the leaves using De Morgan's laws. Guarding the whole
            // tree would incorrectly reject NULL rows matched by another OR arm;
            // complementing a compiled subtree would incorrectly include NULLs.
            if matches!(expr, Expr::And(..)) != negated {
                PredicateExpr::And(left, right)
            } else {
                PredicateExpr::Or(left, right)
            }
        }
    })
}
