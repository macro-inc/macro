use chrono::{DateTime, Utc};
use uuid::Uuid;
/// An incoming email addressed to a team's configured Support address.
#[derive(Debug)]
pub struct SupportMail {
    /// Stable email message identity.
    pub id: Uuid,
    /// Owning email thread identity.
    pub thread_id: Uuid,
    /// Sender email address.
    pub email: String,
    /// Sender display name.
    pub name: String,
    /// Subject line.
    pub subject: String,
    /// Plain message body, preferring extracted text.
    pub content: String,
    /// Intake cursor time.
    pub created_at: DateTime<Utc>,
}
