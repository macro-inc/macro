use uuid::Uuid;

#[derive(Debug, Clone)]
#[non_exhaustive]
pub struct Contact {
    pub id: Uuid,
    pub(crate) thread_id: Uuid,
    pub link_id: Uuid,
    pub name: Option<String>,
    pub email_address: Option<String>,
    pub sfs_photo_url: Option<String>,
}

/// Contact information for a message sender or recipient.
#[derive(Debug, Clone)]
pub struct ContactInfo {
    /// Email address of the contact.
    pub email: String,
    /// Display name of the contact.
    pub name: Option<String>,
    /// Profile photo URL of the contact.
    pub photo_url: Option<String>,
}

/// The type of recipient for a message.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RecipientType {
    /// To recipient.
    To,
    /// Cc recipient.
    Cc,
    /// Bcc recipient.
    Bcc,
}
