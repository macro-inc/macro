use filter_ast::{ExpandFrame, Expr, FoldTree, TryExpandNode};
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{ProjectFilters, ast::ExpandErr};

/// the literal ast types for a project
#[derive(Debug, Serialize, Deserialize, Clone)]
pub enum ProjectLiteral {
    /// the id of the project
    ProjectId(Uuid),
    /// the owner of the project
    Owner(MacroUserIdStr<'static>),
}

impl ExpandFrame<ProjectLiteral> for ProjectFilters {
    type Err = ExpandErr;

    fn expand_ast(input: Self) -> Result<Option<filter_ast::Expr<ProjectLiteral>>, Self::Err> {
        let ProjectFilters {
            project_ids,
            owners,
        } = input;

        let project_ids = project_ids
            .iter()
            .map(|s| Uuid::parse_str(s))
            .try_expand(|r| r.map(ProjectLiteral::ProjectId), Expr::or)?;

        let owners = owners
            .iter()
            .map(|s| MacroUserIdStr::parse_from_str(s).map(CowLike::into_owned))
            .try_expand(|r| r.map(ProjectLiteral::Owner), Expr::or)?;

        Ok([project_ids, owners].into_iter().fold_with(Expr::and))
    }
}
