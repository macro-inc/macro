//! Bounded reads of the viewer's contact graph, including the viewer themselves.

use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};

/// Maximum number of contact IDs in one page.
pub const MAX_CONTACT_PAGE_SIZE: u16 = 500;

/// A nonzero page size validated before a repository can use it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ContactPageSize(u16);

impl ContactPageSize {
    /// Default page size for directory hydration.
    pub const DEFAULT: Self = Self(100);

    /// Largest permitted source batch.
    pub const MAX: Self = Self(MAX_CONTACT_PAGE_SIZE);

    /// Reject zero and oversized requests rather than silently clamping them.
    pub fn new(value: u16) -> Option<Self> {
        (1..=MAX_CONTACT_PAGE_SIZE)
            .contains(&value)
            .then_some(Self(value))
    }

    /// Maximum number of source rows to include in this page.
    pub fn get(self) -> u16 {
        self.0
    }
}

/// An exclusive keyset position in the contact-ID ordering, not a contact identity.
///
/// Any PostgreSQL text position is valid: a legacy malformed ID can still advance
/// past that row without exposing it as a contact. NUL is rejected because it is
/// not valid in PostgreSQL text. The viewer is supplied separately
/// on every read; a cursor never authorizes another viewer's contacts.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ContactCursor(String);

impl ContactCursor {
    /// Validate a position decoded by a transport's cursor codec.
    pub fn from_position(position: String) -> Option<Self> {
        (!position.contains('\0')).then_some(Self(position))
    }

    /// The position to compare against the repository's contact-ID ordering.
    pub fn position(&self) -> &str {
        &self.0
    }
}

/// One valid user ID together with its original storage position. Keep the raw
/// position even when parsing canonicalizes a legacy ID's case.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ContactIdEntry {
    /// Canonical user identifier.
    pub user_id: MacroUserIdStr<'static>,
    /// Exclusive position immediately after this source row.
    pub cursor: ContactCursor,
}

impl ContactIdEntry {
    /// Parse a stored ID without losing its original continuation position.
    pub fn parse(position: String) -> Option<Self> {
        let user_id = MacroUserIdStr::try_from(position.as_str())
            .ok()?
            .into_owned();
        let cursor = ContactCursor::from_position(position)?;
        Some(Self { user_id, cursor })
    }
}

/// One bounded directory page in contact-ID order.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ContactIdPage {
    /// Valid contact IDs in this page, including self at its sorted position.
    pub contacts: Vec<ContactIdEntry>,
    /// Continue after this position. Only `None` proves exhaustion: filtering a
    /// malformed legacy ID can leave a short or empty page with a continuation.
    pub next_cursor: Option<ContactCursor>,
}

#[cfg(test)]
mod test;
