use predicate_index::{ExactValue, PredicateExpr, Token};

/// Recognize an OR tree over one exact attribute without distributing Boolean
/// expressions. Its set union is one indexed IN lookup, not a CTE per value.
pub(super) fn exact_alternatives(expr: &PredicateExpr) -> Option<(&Token, Vec<&ExactValue>)> {
    let mut pending = vec![expr];
    let mut attribute = None;
    let mut values = Vec::new();
    while let Some(expr) = pending.pop() {
        match expr {
            PredicateExpr::Or(left, right) => {
                pending.push(right);
                pending.push(left);
            }
            PredicateExpr::Exact {
                attribute: next,
                value,
            } => {
                if attribute.is_some_and(|attribute| attribute != next) {
                    return None;
                }
                attribute = Some(next);
                values.push(value);
            }
            _ => return None,
        }
    }
    Some((attribute?, values))
}
