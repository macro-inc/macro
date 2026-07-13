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
    /// Filter to entities whose metadata participant list contains the requesting user.
    #[serde(rename = "me")]
    IncludesMe,
    /// Filter by the requesting user's notification done state for this foreign entity.
    #[serde(rename = "nd")]
    NotificationDone(bool),
    /// Filter by the requesting user's notification seen state for this foreign entity.
    #[serde(rename = "ns")]
    NotificationSeen(bool),
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
            includes_me,
            notification_filters,
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

        let includes_me = includes_me.then_some(Expr::Literal(ForeignEntityLiteral::IncludesMe));

        let notification_done = notification_filters
            .done
            .map(|done| Expr::Literal(ForeignEntityLiteral::NotificationDone(done)));
        let notification_seen = notification_filters
            .seen
            .map(|seen| Expr::Literal(ForeignEntityLiteral::NotificationSeen(seen)));

        Ok([
            ids,
            foreign_entity_ids,
            foreign_entity_sources,
            includes_me,
            notification_done,
            notification_seen,
        ]
        .into_iter()
        .fold_with(Expr::and))
    }
}
