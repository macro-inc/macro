//! This module defines stricter typing for the filters found in lib.
//! This is used to construct a strictly typed ast for the input filters, allowing consumers to have a logical represenation of the required operations

use crate::{
    ChatFilters, DocumentFilters, EntityFilters, ProjectFilters,
    ast::{
        chat::{ChatLiteral, ChatRole},
        project::ProjectLiteral,
    },
};
use document::DocumentLiteral;
use filter_ast::{ExpandFrame, Expr};
use non_empty::IsEmpty;
use serde::{Deserialize, Serialize};
use std::{marker::PhantomData, sync::Arc};
use thiserror::Error;

/// contains the ast literal value for channels
pub mod channel;
/// contains the ast literal value for chat
pub mod chat;
/// contains the ast literal value for documents
pub mod document;
/// contains the ast literal value for emails
pub mod email;
/// contains the ast literal value for projects
pub mod project;

#[cfg(test)]
mod tests;

/// encountered an unknown file type
#[derive(Debug, Error)]
#[error("Found unknown value {0} when attempting to parse {t}", t = std::any::type_name::<T>())]
pub struct UnknownValue<T>(String, PhantomData<T>);

trait ParseFromStr: Sized {
    fn parse_from_str<T: AsRef<str>>(s: T) -> Result<Self, UnknownValue<Self>>;
}

/// the types of errors that can occur when expanding [DocumentFilters] into an ast
#[derive(Debug, Error)]
pub enum ExpandErr {
    /// unknown file type
    #[error(transparent)]
    FileTypeErr(#[from] model_file_type::ValueError<model_file_type::FileType>),
    /// unknown chat type
    #[error(transparent)]
    ChatRoleErr(#[from] UnknownValue<ChatRole>),
    /// invalid uuid
    #[error("Invalid uuid string: {0}")]
    Uuid(#[from] uuid::Error),
    /// invalid macro user id
    #[error(transparent)]
    MacroIdErr(#[from] macro_user_id::user_id::ParseErr),
}

/// Describes a bundle of filters that should be applied across different entity types
#[derive(Debug, Serialize, Deserialize)]
#[non_exhaustive]
pub struct EntityFilterInner {
    /// the filters that should be applied to the document entity
    #[serde(default)]
    pub document_filter: Option<Expr<DocumentLiteral>>,
    /// the filters that should be applied to the project entity
    #[serde(default)]
    pub project_filter: Option<Expr<ProjectLiteral>>,
    /// the filters that should be applied to the chat entity
    #[serde(default)]
    pub chat_filter: Option<Expr<ChatLiteral>>,
}

/// wrapper over [EntityFilterInner] which gives us cheaper clones
#[derive(Debug, Serialize, Deserialize, Clone)]
#[non_exhaustive]
pub struct EntityFilterAst {
    /// we wrap the inner type in an arc to avoid large allocations when cloning boxed values
    pub inner: Arc<EntityFilterInner>,
}

impl EntityFilterAst {
    /// expand the input [EntityFilters] into an ast representation
    pub fn new_from_filters(entity_filter: EntityFilters) -> Result<Option<Self>, ExpandErr> {
        if entity_filter.is_empty() {
            return Ok(None);
        }
        Ok(Some(Self {
            inner: Arc::new(EntityFilterInner {
                document_filter: DocumentFilters::expand_ast(entity_filter.document_filters)?,
                project_filter: ProjectFilters::expand_ast(entity_filter.project_filters)?,
                chat_filter: ChatFilters::expand_ast(entity_filter.chat_filters)?,
            }),
        }))
    }
}

impl IsEmpty for EntityFilterAst {
    fn is_empty(&self) -> bool {
        let EntityFilterInner {
            document_filter,
            project_filter,
            chat_filter,
        } = &*self.inner;
        document_filter.is_none() && project_filter.is_none() && chat_filter.is_none()
    }
}
