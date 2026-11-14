//! Bound id sets for the expanded document filter.
//!
//! A resolved CRM association constrains documents to an OR over every
//! associated id, and its negation to an AND over every excluded id; either
//! can name thousands of documents. Rendered one equality per id, the SQL
//! text grows with the set. Instead, each run of two or more ids of the same
//! polarity becomes one `d.id = ANY($n::text[])` over a bound array, so the
//! SQL keeps a fixed size and the indexed column stays uncast.
//! Document ids are never NULL and neither are the bound elements, so `= ANY`
//! and its negation agree with the equalities they replace.

use filter_ast::{Expr, ExprFrame};
use item_filters::ast::document::DocumentLiteral;
use recursion::CollapsibleExt;
use uuid::Uuid;

#[cfg(test)]
mod test;

/// The id arrays a query binds after its fixed positional parameters.
#[derive(Debug)]
pub(in crate::outbound::pg_soup_repo) struct DocumentIdArrays {
    first_slot: usize,
    arrays: Vec<Vec<String>>,
}

impl DocumentIdArrays {
    /// Number the arrays from `$first_slot`, the slot after the query's
    /// fixed binds.
    pub(in crate::outbound::pg_soup_repo) fn starting_at(first_slot: usize) -> Self {
        Self {
            first_slot,
            arrays: Vec::new(),
        }
    }

    /// The arrays to bind, in slot order.
    pub(in crate::outbound::pg_soup_repo) fn into_binds(self) -> Vec<Vec<String>> {
        self.arrays
    }

    fn bind(&mut self, ids: &[Uuid]) -> String {
        let slot = self.first_slot + self.arrays.len();
        self.arrays.push(ids.iter().map(Uuid::to_string).collect());
        format!("d.id = ANY(${slot}::text[])")
    }
}

/// A rendered subtree, with an id run kept open so its parent can extend it.
enum Fragment {
    /// The document is one of these ids.
    AnyOf(Vec<Uuid>),
    /// The document is none of these ids.
    NoneOf(Vec<Uuid>),
    Sql(String),
}

/// Renders `expr`, whose negations must already sit on its literals, binding
/// its id runs into `arrays`. `literal_sql` renders every other literal and
/// any lone id.
pub(super) fn render(
    expr: &Expr<DocumentLiteral>,
    arrays: &mut DocumentIdArrays,
    literal_sql: impl Fn(DocumentLiteral) -> String,
) -> String {
    let mut sql = |fragment: Fragment| match fragment {
        Fragment::AnyOf(ids) => any_of(&ids, arrays, &literal_sql),
        Fragment::NoneOf(ids) => format!("(NOT {})", any_of(&ids, arrays, &literal_sql)),
        Fragment::Sql(sql) => sql,
    };
    let root = expr.collapse_frames(|frame| match frame {
        ExprFrame::Literal(DocumentLiteral::Id(id)) => Fragment::AnyOf(vec![id]),
        ExprFrame::Literal(literal) => Fragment::Sql(literal_sql(literal)),
        ExprFrame::Or(Fragment::AnyOf(mut a), Fragment::AnyOf(b)) => {
            a.extend(b);
            Fragment::AnyOf(a)
        }
        ExprFrame::And(Fragment::NoneOf(mut a), Fragment::NoneOf(b)) => {
            a.extend(b);
            Fragment::NoneOf(a)
        }
        ExprFrame::Not(Fragment::AnyOf(ids)) => Fragment::NoneOf(ids),
        ExprFrame::And(a, b) => Fragment::Sql(format!("({} AND {})", sql(a), sql(b))),
        ExprFrame::Or(a, b) => Fragment::Sql(format!("({} OR {})", sql(a), sql(b))),
        ExprFrame::Not(a) => Fragment::Sql(format!("(NOT {})", sql(a))),
    });
    sql(root)
}

fn any_of(
    ids: &[Uuid],
    arrays: &mut DocumentIdArrays,
    literal_sql: &impl Fn(DocumentLiteral) -> String,
) -> String {
    match ids {
        [id] => literal_sql(DocumentLiteral::Id(*id)),
        ids => arrays.bind(ids),
    }
}
