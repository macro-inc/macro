//! Viewer-scoped directory records, distinct from public user profiles.

use super::page::ContactCursor;
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

/// Stable identity of one viewer's directory entry for a person.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct ContactId(Uuid);

impl ContactId {
    /// Derive an identity from the viewer and target, never from mutable names.
    pub fn for_viewer(viewer: &MacroUserIdStr<'_>, user: &MacroUserIdStr<'_>) -> Self {
        let namespace = Uuid::new_v5(&Uuid::NAMESPACE_OID, viewer.as_ref().as_bytes());
        Self(Uuid::new_v5(&namespace, user.as_ref().as_bytes()))
    }

    /// The globally scoped normalized-record identifier.
    pub fn as_uuid(self) -> Uuid {
        self.0
    }
}

/// Structured name resolved by the name owner, with profile-over-address-book precedence.
pub struct ContactName {
    /// Person whose name was resolved.
    pub user_id: MacroUserIdStr<'static>,
    /// First name, when known.
    pub first_name: Option<String>,
    /// Last name, when known.
    pub last_name: Option<String>,
}

impl ContactName {
    /// Match the existing display-name behavior, omitting empty and legacy N/A parts.
    pub fn display_name(&self) -> Option<String> {
        let name = [self.first_name.as_deref(), self.last_name.as_deref()]
            .into_iter()
            .flatten()
            .filter(|part| !part.is_empty() && *part != "N/A")
            .collect::<Vec<_>>()
            .join(" ");
        (!name.is_empty()).then_some(name)
    }
}

/// One authorized directory entry with a viewer-specific resolved name.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Contact {
    /// Identity of this viewer/person relationship, not the target user identity.
    pub id: ContactId,
    /// Target user identifier; its email may belong to a non-Macro contact.
    pub user_id: MacroUserIdStr<'static>,
    /// Resolved name. None lets each surface apply its existing email fallback.
    pub name: Option<String>,
}

/// A bounded, enriched contact page in contact-ID order.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ContactPage {
    /// Authorized directory entries, including self at its sorted position.
    pub contacts: Vec<Contact>,
    /// Source continuation, preserved even if a page has no valid entries.
    pub next_cursor: Option<ContactCursor>,
}
