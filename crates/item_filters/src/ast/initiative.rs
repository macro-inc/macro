use chrono::{DateTime, Utc};
use filter_ast::{ExpandFrame, Expr, FoldTree, TryExpandNode};
use model_owner::Owner;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{InitiativeFilters, ast::ExpandErr};

/// The possible literal values in an initiative filter AST.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub enum InitiativeLiteral {
    /// Opt this query into initiatives at all.
    ///
    /// Like reminders, initiatives are **off by default** — a query that
    /// says nothing about them gets none, so adding them to Soup did not
    /// change what pre-existing Soup views return. Asking for specific ids
    /// or owners also counts as opting in.
    #[serde(rename = "inc")]
    Include,
    /// Case-insensitive substring of the initiative name.
    NameContains(String),
    /// Inclusive upper due-date bound.
    DueBefore(DateTime<Utc>),
    /// Inclusive lower due-date bound.
    DueAfter(DateTime<Utc>),
    /// Filter by initiative id.
    #[serde(rename = "id")]
    Id(Uuid),
    /// Filter by the initiative's owner.
    #[serde(rename = "o")]
    Owner(Owner),
}

impl ExpandFrame<InitiativeLiteral> for InitiativeFilters {
    type Err = ExpandErr;

    fn expand_ast(
        filter_request: InitiativeFilters,
    ) -> Result<Option<Expr<InitiativeLiteral>>, Self::Err> {
        let InitiativeFilters {
            include,
            initiative_ids,
            owners,
            name,
            due_before,
            due_after,
        } = filter_request;

        let include = include.then_some(Expr::val(InitiativeLiteral::Include));

        let ids = initiative_ids
            .iter()
            .map(|s| Uuid::parse_str(s))
            .try_expand(|r| r.map(InitiativeLiteral::Id), Expr::or)?;

        let owners = owners
            .iter()
            .map(|owner| Owner::from_principal_str(owner))
            .try_expand(|r| r.map(InitiativeLiteral::Owner), Expr::or)?;

        Ok([
            include,
            ids,
            owners,
            name.map(|v| Expr::val(InitiativeLiteral::NameContains(v))),
            due_before.map(|v| Expr::val(InitiativeLiteral::DueBefore(v))),
            due_after.map(|v| Expr::val(InitiativeLiteral::DueAfter(v))),
        ]
        .into_iter()
        .fold_with(Expr::and))
    }
}

/// Whether this expression explicitly requests initiatives. A missing filter or
/// a solely negative expression preserves the default exclusion.
pub fn initiatives_requested(filter: Option<&Expr<InitiativeLiteral>>) -> bool {
    match filter {
        Some(Expr::Literal(_)) => true,
        Some(Expr::And(a, b) | Expr::Or(a, b)) => {
            initiatives_requested(Some(a)) || initiatives_requested(Some(b))
        }
        Some(Expr::Not(_)) | None => false,
    }
}
