//! Explicit edits to a contact's existing optional fields.

/// One field to replace, leaving the contact's identity and other data intact.
#[derive(Debug)]
pub enum ContactFieldUpdate {
    /// A validated, normalized email address, or no address.
    Email(Option<String>),
    /// A company in the contact's owning team, or no company.
    Company(Option<uuid::Uuid>),
}
