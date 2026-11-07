use std::fmt;

use crate::image::ImageData;
use model_entity::{Entity, EntityType};
use non_empty::NonEmpty;
use thiserror::Error;

/// Errors that can occur while resolving attachments.
#[derive(Debug, Error)]
pub enum AttachmentError {
    /// The caller does not have access to the referenced entity.
    #[error(transparent)]
    PermissionDenied(Box<dyn std::error::Error + Send + Sync>),
    /// The referenced document has no file type recorded.
    #[error("unknown file type")]
    UnknownFileType,
    /// The referenced document's file type is not supported as an attachment.
    #[error("unsupported file type: {0}")]
    UnsupportedFileType(String),
    /// Resolved with no content
    #[error("no content")]
    NoContent,
    /// An internal error occurred while resolving the attachment.
    #[error(transparent)]
    Internal(#[from] anyhow::Error),
    /// the wrong attachment service was used to resolve the attachment
    #[error("this service {0} does not provide this entity kind {1}")]
    RoutingError(String, EntityType),
}

/// An attachment that failed to resolve.
#[derive(Debug)]
pub struct ResolutionError {
    /// The entity that could not be resolved.
    pub reference: Entity<'static>,
    /// Reason for the failure.
    pub error: AttachmentError,
}

impl ResolutionError {
    /// Create a new resolution error.
    pub fn new(reference: Entity<'static>, error: AttachmentError) -> Self {
        Self { reference, error }
    }
}

/// Rich representation of attachment content
pub enum AttachmentPart<'a> {
    /// An image that failed to resolve
    ImageError(ResolutionError),
    /// Attachment text
    Content(String),
    /// Attachment image data.
    Image(ImageData),
    /// A resolved child attachment
    Child(Box<Result<AttachmentContent<'static>, ResolutionError>>),
    /// A reference to a child attachment
    ChildReference(Entity<'a>),
    /// KV metadata
    Metadata {
        /// key
        key: String,
        /// value
        value: String,
    },
}

// manual impl to prevent excessive logging
impl<'a> std::fmt::Debug for AttachmentPart<'a> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Content(s) => write!(f, "Content([{} chars])", s.chars().count()),
            Self::ImageError(e) => e.fmt(f),
            Self::Child(c) => c.fmt(f),
            Self::ChildReference(r) => r.fmt(f),
            Self::Image(i) => i.fmt(f),
            Self::Metadata { key, value } => write!(f, "{}: {}", key, value),
        }
    }
}

/// A resolved attachment
#[derive(Debug)]
pub struct AttachmentContent<'a> {
    /// name + kind
    pub reference: Entity<'a>,
    /// name
    pub name: Option<String>,
    /// content
    pub content: NonEmpty<Vec<AttachmentPart<'static>>>,
}

crate::non_empty_collection! {
    /// The full attachment represented as an ordered collection of parts.
    ///
    /// Produced by [`Attachable`](super::ports::Attachable) implementations.
    /// Guaranteed to contain at least one part via [`NonEmpty`].
    #[derive(Debug)]
    pub struct Attachments<'a>(Result<AttachmentContent<'a>, ResolutionError>);
}

/// The primitive form of attachment data sent to AI providers
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub enum TextOrImage {
    /// All non-image dats is represented as text
    Text(String),
    /// Images may be links or base64
    Image(ImageData),
}

crate::non_empty_collection! {
    /// A collection of attachment data constructed from one or more attachments
    #[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
    pub struct FormattedParts(TextOrImage);
}

impl FormattedParts {
    /// Merge adjacent text parts into single parts.
    pub fn compact(self) -> Self {
        let (mut all, last) =
            self.0
                .into_inner()
                .into_iter()
                .fold((Vec::new(), None), |(mut acc, prev), current| {
                    if let TextOrImage::Image(c) = current {
                        if let Some(p) = prev {
                            acc.push(p)
                        }
                        acc.push(TextOrImage::Image(c));
                        (acc, None)
                    } else if let TextOrImage::Text(ref c) = current
                        && let Some(TextOrImage::Text(p)) = prev
                    {
                        (acc, Some(TextOrImage::Text(format!("{}\n{}", p, c))))
                    } else {
                        (acc, Some(current))
                    }
                });

        if let Some(last) = last {
            all.push(last)
        }
        Self(NonEmpty::new(all).expect("compaction should always be non-empty"))
    }
}
