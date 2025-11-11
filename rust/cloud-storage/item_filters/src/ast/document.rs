use std::marker::PhantomData;

use filter_ast::{ExpandFrame, Expr, FoldTree, TryExpandNode};
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    DocumentFilters,
    ast::{ExpandErr, ParseFromStr, UnknownValue},
};

/// the types of documents we can filter by
#[derive(Debug, Serialize, Deserialize)]
pub enum FileType {
    /// the document is a pdf
    Pdf,
    /// the document is markdown
    Md,
    /// the document is plaintext
    Txt,
    /// the document is html
    Html,
}

impl ParseFromStr for FileType {
    fn parse_from_str<T: AsRef<str>>(s: T) -> Result<Self, UnknownValue<Self>> {
        match s.as_ref() {
            "pdf" => Ok(FileType::Pdf),
            "md" => Ok(FileType::Md),
            "txt" => Ok(FileType::Txt),
            "html" => Ok(FileType::Html),
            _ => Err(UnknownValue(s.as_ref().to_string(), PhantomData)),
        }
    }
}

/// the literal type that can appear in the item filer ast
#[derive(Debug, Serialize, Deserialize)]
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
            .map(FileType::parse_from_str)
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
