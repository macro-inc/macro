use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::PropertyFilter;
use crate::ast::ExpandErr;
use filter_ast::{ExpandFrame, Expr, FoldTree, TryExpandNode};

/// Describes how to match against a property value in the entity_properties table.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub enum PropertyMatchValue {
    /// Match a select option by its UUID. Uses the `?` jsonb operator on `values->'value'`.
    #[serde(rename = "so")]
    SelectOption(Uuid),
    /// Match an entity reference by entity_id. Uses the `@>` jsonb operator on `values->'value'`.
    #[serde(rename = "er")]
    EntityRef(String),
}

/// A single property-based filter condition for the AST.
///
/// When converted to SQL, this generates an EXISTS subquery against the
/// `entity_properties` table, checking that the given property has a matching value.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PropertiesLiteral {
    /// The property definition UUID to filter on.
    #[serde(rename = "pd")]
    pub property_definition_id: Uuid,
    /// The entity type for the property lookup (e.g., "TASK", "DOCUMENT", "PROJECT").
    /// When None, matches across all entity types.
    #[serde(default, rename = "et", skip_serializing_if = "Option::is_none")]
    pub entity_type: Option<String>,
    /// The value to match against.
    #[serde(rename = "v")]
    pub value: PropertyMatchValue,
}

impl ExpandFrame<PropertiesLiteral> for Vec<PropertyFilter> {
    type Err = ExpandErr;
    fn expand_ast(
        filters: Vec<PropertyFilter>,
    ) -> Result<Option<Expr<PropertiesLiteral>>, ExpandErr> {
        let nodes: Vec<Option<Expr<PropertiesLiteral>>> = filters
            .into_iter()
            .map(|pf| {
                let prop_def_id = Uuid::parse_str(&pf.property_definition_id)?;

                let option_nodes = pf
                    .option_ids
                    .iter()
                    .map(|s| Uuid::parse_str(s))
                    .try_expand(
                        |r| {
                            r.map(|uuid| PropertiesLiteral {
                                property_definition_id: prop_def_id,
                                entity_type: pf.entity_type.clone(),
                                value: PropertyMatchValue::SelectOption(uuid),
                            })
                        },
                        Expr::or,
                    )?;

                let entity_ref_nodes = pf.entity_ids.iter().cloned().expand(
                    |id| PropertiesLiteral {
                        property_definition_id: prop_def_id,
                        entity_type: pf.entity_type.clone(),
                        value: PropertyMatchValue::EntityRef(id),
                    },
                    Expr::or,
                );

                Ok([option_nodes, entity_ref_nodes]
                    .into_iter()
                    .fold_with(Expr::or))
            })
            .collect::<Result<_, ExpandErr>>()?;

        Ok(nodes.into_iter().fold_with(Expr::and))
    }
}
