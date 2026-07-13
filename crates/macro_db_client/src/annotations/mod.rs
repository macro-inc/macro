use serde::Serialize;
use thiserror::Error;

pub mod create_anchor;
pub mod create_comment;
pub mod delete_anchor;
pub mod delete_comment;
pub mod delete_thread;
pub mod edit_anchor;
pub mod edit_comment;
pub mod get;

#[derive(Error, Debug)]
pub enum CommentError {
    #[error("Comment not found")]
    CommentNotFound,
    #[error("Thread not found")]
    ThreadNotFound,
    #[error("Anchor not found")]
    AnchorNotFound,
    #[error("Invalid permissions")]
    InvalidPermissions,
    #[error("{0}")]
    NotAllowed(String),
}

#[derive(sqlx::Type, Debug, Serialize, Clone)]
#[sqlx(type_name = "anchor_table_name", rename_all = "PascalCase")]
pub enum AnchorTableName {
    PdfPlaceableCommentAnchor,
    PdfHighlightAnchor,
}
