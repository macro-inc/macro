use filter_ast::{ExpandFrame, Expr, FoldTree, TryExpandNode};
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    ProjectFilters,
    ast::{ExpandErr, date::DateLiteral},
};

/// the literal ast types for a project
#[derive(Debug, Serialize, Deserialize, Clone)]
pub enum ProjectLiteral {
    /// matches projects whose parent is this id (i.e. children of this project)
    #[serde(rename = "pid")]
    ProjectId(Uuid),
    /// matches the project with this id itself (not its children)
    #[serde(rename = "pids")]
    ProjectIdSelf(Uuid),
    /// the owner of the project
    #[serde(rename = "o")]
    Owner(MacroUserIdStr<'static>),
    /// this node value filters by project importance. false short-circuits to match nothing.
    #[serde(rename = "imp")]
    Importance(bool),
    /// this node value filters by notification done state for projects.
    #[serde(rename = "nd")]
    NotificationDone(bool),
    /// this node value filters by notification seen state for projects.
    #[serde(rename = "ns")]
    NotificationSeen(bool),
    /// this node value filters by project createdAt timestamp
    #[serde(rename = "ca")]
    CreatedAt(DateLiteral),
    /// this node value filters by project updatedAt timestamp
    #[serde(rename = "ua")]
    UpdatedAt(DateLiteral),
}

impl ExpandFrame<ProjectLiteral> for ProjectFilters {
    type Err = ExpandErr;

    fn expand_ast(input: Self) -> Result<Option<filter_ast::Expr<ProjectLiteral>>, Self::Err> {
        let ProjectFilters {
            project_ids,
            include_root,
            owners,
            importance,
            notification_filters,
        } = input;

        let project_ids = project_ids
            .iter()
            .map(|s| Uuid::parse_str(s))
            .collect::<Result<Vec<_>, _>>()?
            .into_iter()
            .map(|id| {
                let children = Expr::Literal(ProjectLiteral::ProjectId(id));
                if include_root {
                    Expr::or(Expr::Literal(ProjectLiteral::ProjectIdSelf(id)), children)
                } else {
                    children
                }
            })
            .reduce(Expr::or);

        let owners = owners
            .iter()
            .map(|s| MacroUserIdStr::parse_from_str(s).map(CowLike::into_owned))
            .try_expand(|r| r.map(ProjectLiteral::Owner), Expr::or)?;

        let importance_node = importance.map(|imp| Expr::Literal(ProjectLiteral::Importance(imp)));
        let notification_done_node = notification_filters
            .done
            .map(|done| Expr::Literal(ProjectLiteral::NotificationDone(done)));
        let notification_seen_node = notification_filters
            .seen
            .map(|seen| Expr::Literal(ProjectLiteral::NotificationSeen(seen)));

        Ok([
            project_ids,
            owners,
            importance_node,
            notification_done_node,
            notification_seen_node,
        ]
        .into_iter()
        .fold_with(Expr::and))
    }
}
