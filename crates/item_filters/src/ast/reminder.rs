use filter_ast::{ExpandFrame, Expr, FoldTree, TryExpandNode};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{ReminderFilters, ast::ExpandErr};

/// The possible literal values in a reminder filter AST.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub enum ReminderLiteral {
    /// Opt this query into reminders at all.
    ///
    /// Unlike every other Soup entity type, reminders are **off by default** —
    /// a query that says nothing about them gets none. Views that want them ask
    /// explicitly, so adding reminders did not change what existing Soup views
    /// return. Asking for specific ids or entities also counts as opting in.
    #[serde(rename = "inc")]
    Include,
    /// Filter by reminder id.
    #[serde(rename = "id")]
    Id(Uuid),
    /// Filter to reminders attached to this entity, as `"{type}:{id}"`.
    #[serde(rename = "ent")]
    Entity(String),
    /// Filter by whether the reminder has already fired.
    #[serde(rename = "comp")]
    Completed(bool),
}

impl ExpandFrame<ReminderLiteral> for ReminderFilters {
    type Err = ExpandErr;

    fn expand_ast(
        filter_request: ReminderFilters,
    ) -> Result<Option<Expr<ReminderLiteral>>, Self::Err> {
        let ReminderFilters {
            include,
            ids,
            entities,
            completed,
        } = filter_request;

        let include = include.then_some(Expr::val(ReminderLiteral::Include));

        let ids = ids
            .iter()
            .map(|s| Uuid::parse_str(s))
            .try_expand(|r| r.map(ReminderLiteral::Id), Expr::or)?;

        let entities = entities
            .into_iter()
            .expand(ReminderLiteral::Entity, Expr::or);

        let completed = completed.map(|c| Expr::val(ReminderLiteral::Completed(c)));

        Ok([include, ids, entities, completed]
            .into_iter()
            .fold_with(Expr::and))
    }
}
