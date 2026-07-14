//! impls for Attachable

#[cfg(test)]
mod test;

use std::borrow::Cow;

use crate::fmt::{ClosedXmlTag, XmlTag};
use crate::models::*;
use crate::{Attachable, Attributes};
use model_entity::Entity;
use non_empty::NonEmpty;

impl Attachable for Attachments<'_> {
    fn into_formatted_parts(self) -> FormattedParts {
        let parts = self
            .into_parts()
            .into_inner()
            .into_iter()
            .map(|result| match result {
                Ok(content) => content.into_formatted_parts(),
                Err(e) => e.into_formatted_parts(),
            })
            .fold(vec![], |mut acc, current| {
                acc.append(&mut current.into_parts().into_inner());
                acc
            });

        FormattedParts::new(NonEmpty::new(parts).expect("attachments is non-empty"))
    }
}

impl Attachable for ResolutionError {
    fn into_formatted_parts(self) -> FormattedParts {
        XmlTag {
            name: "attachment",
            attrs: self.reference.attributes(),
            body: self.error,
        }
        .into_formatted_parts()
    }
}

impl Attachable for AttachmentPart<'_> {
    fn into_formatted_parts(self) -> FormattedParts {
        match self {
            AttachmentPart::Content(text) => FormattedParts::one(TextOrImage::Text(text)),
            AttachmentPart::Image(data) => FormattedParts::one(TextOrImage::Image(data)),
            AttachmentPart::ImageError(e) => e.into_formatted_parts(),
            AttachmentPart::Metadata { key, value } => ClosedXmlTag {
                name: "metadata",
                attrs: vec![
                    (Cow::Borrowed("key"), Cow::Owned(key)),
                    (Cow::Borrowed("value"), Cow::Owned(value)),
                ],
            }
            .into_formatted_parts(),
            AttachmentPart::Child(child) => match *child {
                Ok(content) => content.into_formatted_parts(),
                Err(e) => e.into_formatted_parts(),
            },
            AttachmentPart::ChildReference(reference) => reference.into_formatted_parts(),
        }
    }
}

impl Attachable for NonEmpty<Vec<AttachmentPart<'_>>> {
    fn into_formatted_parts(self) -> FormattedParts {
        let parts = self
            .into_inner()
            .into_iter()
            .map(Attachable::into_formatted_parts)
            .fold(vec![], |mut acc, current| {
                acc.append(&mut current.into_parts().into_inner());
                acc
            });

        FormattedParts::new(NonEmpty::new(parts).expect("attachments is non empty"))
    }
}

impl Attachable for AttachmentContent<'_> {
    fn into_formatted_parts(self) -> FormattedParts {
        XmlTag {
            attrs: self.reference.attributes(),
            name: "attachment",
            body: self.content,
        }
        .into_formatted_parts()
    }
}

impl Attachable for Entity<'_> {
    fn into_formatted_parts(self) -> FormattedParts {
        ClosedXmlTag {
            name: "attachment_reference",
            attrs: self.attributes(),
        }
        .into_formatted_parts()
    }
}

impl Attachable for AttachmentError {
    fn into_formatted_parts(self) -> FormattedParts {
        FormattedParts::one(TextOrImage::Text(self.to_string()))
    }
}
