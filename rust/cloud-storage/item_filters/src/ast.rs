//! This module defines stricter typing for the filters found in lib.
//! This is used to construct a strictly typed ast for the input filters, allowing consumers to have a logical represenation of the required operations

use crate::{DocumentFilters, EntityFilters};
use filter_ast::{ExpandFrame, ExpandNode, Expr};
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use non_empty::IsEmpty;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use uuid::Uuid;

#[cfg(test)]
mod tests;

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

/// encountered an unknown file type
#[derive(Debug, Error)]
#[error("Unknown file type: {0}")]
pub struct UnknownFileType(String);

impl FileType {
    /// parse the file type from the input
    pub fn parse_from_str<T: AsRef<str>>(s: T) -> Result<FileType, UnknownFileType> {
        match s.as_ref() {
            "pdf" => Ok(FileType::Pdf),
            "md" => Ok(FileType::Md),
            "txt" => Ok(FileType::Txt),
            "html" => Ok(FileType::Html),
            _ => Err(UnknownFileType(s.as_ref().to_string())),
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

/// the types of errors that can occur when expanding [DocumentFilters] into an ast
#[derive(Debug, Error)]
pub enum ExpandErr {
    /// unknown file type
    #[error(transparent)]
    FileTypeErr(#[from] UnknownFileType),
    /// invalid uuid
    #[error("Invalid uuid string: {0}")]
    Uuid(#[from] uuid::Error),
    /// invalid macro user id
    #[error(transparent)]
    MacroIdErr(#[from] macro_user_id::user_id::ParseErr),
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
            .expand(|r| r.map(DocumentLiteral::FileType), Expr::or)?;

        let document_id_nodes = document_ids
            .iter()
            .map(|s| Uuid::parse_str(s))
            .expand(|r| r.map(DocumentLiteral::Id), Expr::or)?;

        let project_ids = project_ids
            .iter()
            .map(|s| Uuid::parse_str(s))
            .expand(|r| r.map(DocumentLiteral::ProjectId), Expr::or)?;

        let owners = owners
            .iter()
            .map(|s| MacroUserIdStr::parse_from_str(s).map(CowLike::into_owned))
            .expand(|r| r.map(DocumentLiteral::Owner), Expr::or)?;

        Ok([file_types_node, document_id_nodes, project_ids, owners]
            .into_iter()
            .fold(None, |acc, cur| match (acc, cur) {
                (Some(acc), Some(cur)) => Some(Expr::and(acc, cur)),
                (None, Some(next)) | (Some(next), None) => Some(next),
                (None, None) => None,
            }))
    }
}

/// Describes a bundle of filters that should be applied across different entity types
#[derive(Default, Debug, Serialize, Deserialize)]
pub struct EntityFilterAst {
    /// the filters that should be applied to the document entity
    #[serde(default)]
    pub document_filter: Option<Expr<DocumentLiteral>>,
}

impl EntityFilterAst {
    /// expand the input [EntityFilters] into an ast representation
    pub fn new_from_filters(entity_filter: EntityFilters) -> Result<Self, ExpandErr> {
        if entity_filter.is_empty() {
            return Ok(Self::default());
        }
        Ok(Self {
            document_filter: DocumentFilters::expand_ast(entity_filter.document_filters)?,
        })
    }
}

impl IsEmpty for EntityFilterAst {
    fn is_empty(&self) -> bool {
        let EntityFilterAst { document_filter } = self;
        document_filter.is_none()
    }
}
