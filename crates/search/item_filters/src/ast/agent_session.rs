use filter_ast::{ExpandFrame, Expr, FoldTree, TryExpandNode};
use model_owner::Owner;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{AgentSessionFilters, ast::ExpandErr};

/// The possible literal values in an agent session filter AST.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub enum AgentSessionLiteral {
    /// Opt this query into agent sessions at all.
    ///
    /// Agent sessions are **off by default** — a query that
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
    Owner(Owner),
    /// Filter by who started the session.
    #[serde(rename = "src")]
    Source(AgentSessionSource),
    /// Filter by whether the session is listed.
    #[serde(rename = "vis")]
    Visibility(AgentSessionVisibility),
}

/// Who started an agent session. The string form is the
/// `agent_session.source` column's.
#[derive(
    Debug,
    Default,
    Serialize,
    Deserialize,
    Clone,
    Copy,
    PartialEq,
    Eq,
    strum::EnumString,
    strum::IntoStaticStr,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub enum AgentSessionSource {
    /// A person, directly or through something they did.
    #[default]
    User,
    /// Another agent, which dispatched the session on its owner's behalf.
    Agent,
    /// A routine's unattended run.
    Routine,
}

/// Where an agent session is shown. The string form is the
/// `agent_session.visibility` column's.
#[derive(
    Debug,
    Default,
    Serialize,
    Deserialize,
    Clone,
    Copy,
    PartialEq,
    Eq,
    strum::EnumString,
    strum::IntoStaticStr,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub enum AgentSessionVisibility {
    /// Shown wherever the owner's sessions are.
    #[default]
    Listed,
    /// Left out of Home and the default Agents list, but a filter can still
    /// ask for it; a routine's setting decides it for each of its runs.
    Unlisted,
    /// Out of every list and search; only a query naming the session's id
    /// returns it.
    Hidden,
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
            .map(|owner| Owner::from_principal_str(owner))
            .try_expand(|r| r.map(AgentSessionLiteral::Owner), Expr::or)?;

        Ok([include, ids, owners].into_iter().fold_with(Expr::and))
    }
}
