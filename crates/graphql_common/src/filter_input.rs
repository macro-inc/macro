use std::sync::Arc;

use async_graphql::ID;
use filter_ast::Expr;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use uuid::Uuid;

/// Conversion from a GraphQL filter input tree into a domain filter
/// expression over literal type `T`.
pub trait IntoFilterExpr<T>: Sized {
    /// Convert this input into a `filter_ast` expression tree.
    fn into_expr(self) -> async_graphql::Result<Expr<T>>;
}

/// Convert an optional GraphQL filter input into an optional shared
/// expression tree.
pub fn optional_tree<I, T>(input: Option<I>) -> async_graphql::Result<Option<Arc<Expr<T>>>>
where
    I: IntoFilterExpr<T>,
{
    input.map(|expr| expr.into_expr().map(Arc::new)).transpose()
}

/// Parse a string field into a [`Uuid`], reporting the field name on error.
pub fn parse_uuid(value: String, field: &str) -> async_graphql::Result<Uuid> {
    Uuid::parse_str(&value)
        .map_err(|err| async_graphql::Error::new(format!("invalid {field} UUID `{value}`: {err}")))
}

/// Parse a GraphQL [`ID`] field into a [`Uuid`], reporting the field name on
/// error.
pub fn parse_id(id: ID, field: &str) -> async_graphql::Result<Uuid> {
    parse_uuid(id.to_string(), field)
}

/// Parse a string field into an owned [`MacroUserIdStr`], reporting the field
/// name on error.
pub fn parse_macro_user_id(
    value: String,
    field: &str,
) -> async_graphql::Result<MacroUserIdStr<'static>> {
    MacroUserIdStr::parse_from_str(&value)
        .map(CowLike::into_owned)
        .map_err(|err| async_graphql::Error::new(format!("invalid {field} `{value}`: {err}")))
}

/// Generate a recursive GraphQL filter-expression input (`And`/`Or`/`Not`/
/// `Literal`) plus its binary node struct, and an [`IntoFilterExpr`] impl
/// converting it into a `filter_ast` expression over the target literal.
///
/// The generated types deliberately carry no doc comments: doc comments on
/// GraphQL input types are emitted as SDL descriptions, and the exported
/// `schema.graphql` must not change.
#[macro_export]
macro_rules! filter_expr_input {
    ($name:ident, $binary_name:ident, $literal:ty, $target:ty, $type_name:literal) => {
        #[allow(missing_docs)]
        #[derive(async_graphql::InputObject)]
        pub struct $binary_name {
            pub left: Box<$name>,
            pub right: Box<$name>,
        }

        #[allow(missing_docs)]
        #[derive(async_graphql::OneofObject)]
        pub enum $name {
            And($binary_name),
            Or($binary_name),
            Not(Box<$name>),
            Literal($literal),
        }

        impl $crate::IntoFilterExpr<$target> for $name {
            fn into_expr(self) -> async_graphql::Result<$crate::filter_ast::Expr<$target>> {
                match self {
                    Self::And(exprs) => Ok($crate::filter_ast::Expr::and(
                        exprs.left.into_expr()?,
                        exprs.right.into_expr()?,
                    )),
                    Self::Or(exprs) => Ok($crate::filter_ast::Expr::or(
                        exprs.left.into_expr()?,
                        exprs.right.into_expr()?,
                    )),
                    Self::Not(expr) => expr.into_expr().map($crate::filter_ast::Expr::is_not),
                    Self::Literal(literal) => literal.into_expr(),
                }
            }
        }
    };
}
