use filter_ast::{ExpandFrame, Expr, FoldTree, TryExpandNode};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{AgentSessionFilters, ast::ExpandErr};

/// The possible literal values in an agent session filter AST.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub enum AgentSessionLiteral {
    /// Opt this query into agent sessions at all.
    ///
    /// Like reminders, agent sessions are **off by default** — a query that
    /// says nothing about them gets none. Views that want them ask
    /// explicitly, so adding agent sessions did not change what existing Soup
    /// views return. Asking for specific ids also counts as opting in.
    #[serde(rename = "inc")]
    Include,
    /// Filter by agent session id.
    #[serde(rename = "id")]
    Id(Uuid),
    /// Filter to sessions owned by this user.
    #[serde(rename = "o")]
    Owner(String),
}

impl ExpandFrame<AgentSessionLiteral> for AgentSessionFilters {
    type Err = ExpandErr;

    fn expand_ast(
        filter_request: AgentSessionFilters,
    ) -> Result<Option<Expr<AgentSessionLiteral>>, Self::Err> {
        let AgentSessionFilters {
            include,
            ids,
            owner,
        } = filter_request;

        let include = include.then_some(Expr::val(AgentSessionLiteral::Include));

        let ids = ids
            .iter()
            .map(|s| Uuid::parse_str(s))
            .try_expand(|r| r.map(AgentSessionLiteral::Id), Expr::or)?;

        let owner = owner.map(|o| Expr::val(AgentSessionLiteral::Owner(o)));

        Ok([include, ids, owner].into_iter().fold_with(Expr::and))
    }
}
