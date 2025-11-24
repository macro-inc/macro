use crate::{DocumentFilters, ast::ExpandErr};
use filter_ast::{ExpandFrame, Expr, FoldTree, TryExpandNode};
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use model_file_type::FileType;
use serde::{Deserialize, Serialize};
use std::str::FromStr;
use uuid::Uuid;

/// the literal type that can appear in the item filer ast
#[derive(Debug, Serialize, Deserialize, Clone)]
pub enum DocumentLiteral {
    /// this node value filters by [FileType]
    FileType(FileType),
    /// this node value filters by document [Uuid]
    Id(Uuid),
    /// this node value filters by project [Uuid]
    ProjectId(Uuid),
    /// this node value filters by document owner
    Owner(MacroUserIdStr<'static>),
}

impl ExpandFrame<DocumentLiteral> for DocumentFilters {
    type Err = ExpandErr;
    fn expand_ast(
        filter_request: DocumentFilters,
    ) -> Result<Option<Expr<DocumentLiteral>>, ExpandErr> {
        let DocumentFilters {
            file_types,
            document_ids,
            project_ids,
            owners,
        } = filter_request;

        let file_types_node = file_types
            .iter()
            .map(|s| FileType::from_str(s))
            .try_expand(|r| r.map(DocumentLiteral::FileType), Expr::or)?;

        let document_id_nodes = document_ids
            .iter()
            .map(|s| Uuid::parse_str(s))
            .try_expand(|r| r.map(DocumentLiteral::Id), Expr::or)?;

        let project_ids = project_ids
            .iter()
            .map(|s| Uuid::parse_str(s))
            .try_expand(|r| r.map(DocumentLiteral::ProjectId), Expr::or)?;

        let owners = owners
            .iter()
            .map(|s| MacroUserIdStr::parse_from_str(s).map(CowLike::into_owned))
            .try_expand(|r| r.map(DocumentLiteral::Owner), Expr::or)?;

        Ok([file_types_node, document_id_nodes, project_ids, owners]
            .into_iter()
            .fold_with(Expr::and))
    }
}
