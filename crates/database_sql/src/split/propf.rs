//! The wire form of the `propf` expressions the engine pushes down, for the
//! TypeScript export only: the engine builds `filter_ast::Expr` over
//! `item_filters`' `PropertiesLiteral`, which carry no `specta` schema, and
//! [`GqlQuery`](super::GqlQuery) borrows this one in their place. The test
//! round-trips real expressions through it, so the two cannot drift apart.

#[cfg(test)]
mod test;

use models_databases::OptionId;
use serde::{Deserialize, Serialize};
use specta::Type;
use uuid::Uuid;

/// A Soup `propf` expression.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub enum Propf {
    /// Both hold.
    #[serde(rename = "&")]
    And(Box<Propf>, Box<Propf>),
    /// Either holds.
    #[serde(rename = "|")]
    Or(Box<Propf>, Box<Propf>),
    /// The expression does not hold.
    #[serde(rename = "!")]
    Not(Box<Propf>),
    /// One property match.
    #[serde(rename = "l")]
    Literal(PropfLiteral),
}

/// A match on one property. The engine never narrows by entity type, so the
/// `et` field `PropertiesLiteral` can carry is never on the wire.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct PropfLiteral {
    /// The property definition id.
    #[serde(rename = "pd")]
    pub property: Uuid,
    /// The value matched.
    #[serde(rename = "v")]
    pub value: PropfValue,
}

/// The value a property is matched against.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub enum PropfValue {
    /// A select option id.
    #[serde(rename = "so")]
    SelectOption(OptionId),
    /// A referenced entity id.
    #[serde(rename = "er")]
    EntityRef(String),
}
