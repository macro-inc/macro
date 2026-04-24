//! impls for Attachable

use crate::Attachable;
use crate::fmt::{ClosedXmlTag, XmlTag};
use crate::models::*;
use non_empty::NonEmpty;

impl Attachable for Attachments {
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
            name: "unavailable_attachment",
            attrs: &[("id", self.id.as_str())],
            body: self.error,
        }
        .into_formatted_parts()
    }
}

impl Attachable for AttachmentPart {
    fn into_formatted_parts(self) -> FormattedParts {
        match self {
            AttachmentPart::Content(text) => FormattedParts::one(TextOrImage::Text(text)),
            AttachmentPart::Image(data) => FormattedParts::one(TextOrImage::Image(data)),
            AttachmentPart::ImageError(e) => e.into_formatted_parts(),
            AttachmentPart::Metadata { key, value } => ClosedXmlTag {
                name: "metadata",
                attrs: &[("key", &key), ("value", &value)],
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

impl Attachable for NonEmpty<Vec<AttachmentPart>> {
    fn into_formatted_parts(self) -> FormattedParts {
        let parts = self
            .into_inner()
            .into_iter()
            .map(Attachable::into_formatted_parts)
            .fold(vec![], |mut acc, current| {
                acc.append(&mut current.into_parts().into_inner());
                acc
            });

        FormattedParts::new(NonEmpty::new(parts).expect("this will not be empty"))
    }
}

impl Attachable for AttachmentContent {
    fn into_formatted_parts(self) -> FormattedParts {
        let attributes = self.reference.as_attributes();
        let tag = XmlTag {
            attrs: attributes.as_slice(),
            name: "attachment",
            body: self.content,
        };
        tag.into_formatted_parts()
    }
}

impl Attachable for AttachmentReference {
    fn into_formatted_parts(self) -> FormattedParts {
        let attrs = self.as_attributes();
        ClosedXmlTag {
            name: "attachment_reference",
            attrs: &attrs,
        }
        .into_formatted_parts()
    }
}

impl Attachable for AttachmentError {
    fn into_formatted_parts(self) -> FormattedParts {
        FormattedParts::one(TextOrImage::Text(self.to_string()))
    }
}
