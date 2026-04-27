//! impls for Attributes
use crate::Attributes;
use crate::fmt::Attr;
use model_entity::Entity;
use std::borrow::Cow;

impl Attributes for Entity<'_> {
    fn attributes(&self) -> Vec<Attr<'_>> {
        vec![
            (
                Cow::Borrowed("kind"),
                Cow::Borrowed(self.entity_type.as_ref()),
            ),
            (Cow::Borrowed("id"), Cow::Borrowed(&self.entity_id)),
        ]
    }
}
