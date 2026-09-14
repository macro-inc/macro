use filter_ast::{ExpandFrame, Expr, FoldTree, TryExpandNode};
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{AgentSessionFilters, ast::ExpandErr};

/// The possible literal values in an agent session filter AST.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub enum AgentSessionLiteral {
    /// Opt this query into agent sessions at all.
    ///
    /// Like reminders, agent sessions are **off by default** — a query that
    /// says nothing about them gets none, so adding them to Soup did not
    /// change what pre-existing Soup views return. Asking for specific ids
    /// or owners also counts as opting in.
    #[serde(rename = "inc")]
    Include,
    /// Filter by agent session id.
    #[serde(rename = "id")]
    Id(Uuid),
    /// Filter by the session's owner.
    #[serde(rename = "o")]
    Owner(MacroUserIdStr<'static>),
}

impl ExpandFrame<AgentSessionLiteral> for AgentSessionFilters {
    type Err = ExpandErr;

    fn expand_ast(
        filter_request: AgentSessionFilters,
    ) -> Result<Option<Expr<AgentSessionLiteral>>, Self::Err> {
        let AgentSessionFilters {
            include,
            ids,
            owners,
        } = filter_request;

        let include = include.then_some(Expr::val(AgentSessionLiteral::Include));

        let ids = ids
            .iter()
            .map(|s| Uuid::parse_str(s))
            .try_expand(|r| r.map(AgentSessionLiteral::Id), Expr::or)?;

        let owners = owners
            .iter()
            .map(|owner| MacroUserIdStr::parse_from_str(owner).map(CowLike::into_owned))
            .try_expand(|r| r.map(AgentSessionLiteral::Owner), Expr::or)?;

        Ok([include, ids, owners].into_iter().fold_with(Expr::and))
    }
}
