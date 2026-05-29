use filter_ast::{ExpandFrame, Expr, FoldTree, TryExpandNode};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{ForeignEntityFilters, ast::ExpandErr};

/// The possible literal values in a foreign entity filter AST.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub enum ForeignEntityLiteral {
    /// Filter by the internal foreign entity record ID.
    #[serde(rename = "id")]
    Id(Uuid),
    /// Filter by the external entity identifier.
    #[serde(rename = "feid")]
    ForeignEntityId(String),
    /// Filter by the external source name.
    #[serde(rename = "fes")]
    ForeignEntitySource(String),
}

impl ExpandFrame<ForeignEntityLiteral> for ForeignEntityFilters {
    type Err = ExpandErr;

    fn expand_ast(
        filter_request: ForeignEntityFilters,
    ) -> Result<Option<Expr<ForeignEntityLiteral>>, Self::Err> {
        let ForeignEntityFilters {
            ids,
            foreign_entity_ids,
            foreign_entity_sources,
        } = filter_request;

        let ids = ids
            .iter()
            .map(|s| Uuid::parse_str(s))
            .try_expand(|r| r.map(ForeignEntityLiteral::Id), Expr::or)?;

        let foreign_entity_ids = foreign_entity_ids
            .into_iter()
            .expand(ForeignEntityLiteral::ForeignEntityId, Expr::or);

        let foreign_entity_sources = foreign_entity_sources
            .into_iter()
            .expand(ForeignEntityLiteral::ForeignEntitySource, Expr::or);

        Ok([ids, foreign_entity_ids, foreign_entity_sources]
            .into_iter()
            .fold_with(Expr::and))
    }
}
