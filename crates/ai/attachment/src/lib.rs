//! A lib crate to support AI attachment consumers and providers
#![deny(missing_docs)]

use macro_user_id::user_id::MacroUserIdStr;
use model_entity::Entity;
pub use models::{
    AttachmentContent, AttachmentError, AttachmentPart, Attachments, FormattedParts,
    ResolutionError, TextOrImage,
};
use non_empty::NonEmpty;

mod attachable;
mod attributes;
pub mod fmt;
pub mod image;
mod macros;
mod models;

#[cfg(feature = "provider")]
pub mod provider;

/// Service interface for resolving attachment references into their contents.
pub trait AttachmentService: Send + Sync + 'static {
    /// Resolve a batch of attachment references.
    ///
    /// Each reference is access-checked against `user_id` (where applicable)
    /// and turned into a concrete
    /// [`AttachmentContent`](super::models::AttachmentContent). Individual
    /// failures never fail the batch — they surface as
    /// [`FailedAttachment`](super::models::FailedAttachment) entries in the
    /// returned [`AttachmentContents`](super::models::AttachmentContents).
    fn resolve_attachments<'a>(
        &self,
        user_id: MacroUserIdStr<'_>,
        ids: NonEmpty<&[&'a Entity<'a>]>,
    ) -> impl Future<Output = Attachments<'a>> + Send;
}

/// An attachable is something that can be represented to AI as a [`FormattedAttachment`]
pub trait Attachable {
    /// transform into formatted attachment
    fn into_formatted_parts(self) -> FormattedParts;
}

/// Produce key-value attributes for XML tag rendering via [`fmt::XmlTag`] / [`fmt::ClosedXmlTag`].
pub trait Attributes {
    /// Return attribute pairs for this value.
    fn attributes(&self) -> Vec<fmt::Attr<'_>>;
}
