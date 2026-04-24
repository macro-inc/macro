use std::fmt;

use ai::types::ImageData;
use non_empty::NonEmpty;
use thiserror::Error;

/// A typed reference to an attachment source.
#[derive(Debug)]
pub enum AttachmentReference {
    /// A file that lives in DSS (including MD)
    DssFile {
        /// Document ID
        id: String,
    },
    /// An image that lives in static file service
    SfsImage {
        /// image url
        url: String,
    },
    /// An email thread
    EmailThread {
        /// Thread ID
        id: String,
    },
    /// An AI chat
    Chat {
        /// Chat ID
        id: String,
    },
    /// Channels thread
    Channel {
        /// Channel ID
        id: String,
    },
}

impl AttachmentReference {
    /// The entity ID for this reference, if it has one.
    pub fn id(&self) -> Option<&str> {
        match self {
            Self::DssFile { id }
            | Self::EmailThread { id }
            | Self::Chat { id }
            | Self::Channel { id } => Some(id),
            Self::SfsImage { .. } => None,
        }
    }
    /// Convert this reference into XML attribute pairs.
    pub fn as_attributes(&self) -> Vec<(&'static str, &str)> {
        let mut attrs = vec![];
        if let Some(id) = self.id() {
            attrs.push(("id", id));
        }
        match self {
            AttachmentReference::Channel { .. } => attrs.push(("kind", "channel")),
            AttachmentReference::Chat { .. } => attrs.push(("kind", "chat")),
            AttachmentReference::DssFile { .. } => attrs.push(("kind", "file")),
            AttachmentReference::EmailThread { .. } => attrs.push(("kind", "email-thread")),
            AttachmentReference::SfsImage { .. } => attrs.push(("kind", "static-image")),
        }

        attrs
    }
}

/// Errors that can occur while resolving attachments.
#[derive(Debug, Error)]
pub enum AttachmentError {
    /// The caller does not have read access to the referenced document.
    #[error("no read access to document {id}")]
    PermissionDenied {
        /// The id of the document the user lacks access to.
        id: String,
    },
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
}

/// An attachment or attachment part that failed to resolve with its id
#[derive(Debug)]
pub struct ResolutionError {
    /// Id of attachment that failed to resolve
    pub id: String,
    /// Reason
    pub error: AttachmentError,
}

impl ResolutionError {
    /// Create a new resolution error.
    pub fn new(id: String, error: AttachmentError) -> Self {
        Self { id, error }
    }
}

/// Rich representation of attachment content
pub enum AttachmentPart {
    /// An image that failed to resolve
    ImageError(ResolutionError),
    /// Attachment text
    Content(String),
    /// Attachment image data.
    Image(ImageData),
    /// A resolved child attachment
    Child(Box<Result<AttachmentContent, ResolutionError>>),
    /// A reference to a child attachment
    ChildReference(AttachmentReference),
    /// KV metadata
    Metadata {
        /// key
        key: String,
        /// value
        value: String,
    },
}

// manual impl to prevent excessive logging
impl std::fmt::Debug for AttachmentPart {
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
pub struct AttachmentContent {
    /// name + kind
    pub reference: AttachmentReference,
    /// name
    pub name: Option<String>,
    /// content
    pub content: NonEmpty<Vec<AttachmentPart>>,
}

crate::non_empty_collection! {
    /// The full attachment represented as an ordered collection of parts.
    ///
    /// Produced by [`Attachable`](super::ports::Attachable) implementations.
    /// Guaranteed to contain at least one part via [`NonEmpty`].
    #[derive(Debug)]
    pub struct Attachments(Result<AttachmentContent, ResolutionError>);
}

/// The primitive form of attachment data sent to AI providers
pub enum TextOrImage {
    /// All non-image dats is represented as text
    Text(String),
    /// Images may be links or base64
    Image(ImageData),
}

crate::non_empty_collection! {
    /// A collection of attachment data constructed from one or more attachments
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
