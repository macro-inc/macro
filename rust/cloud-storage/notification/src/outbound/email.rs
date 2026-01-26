//! Email notification adapter.

use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;

use crate::domain::models::Notification;
use crate::domain::ports::EmailSender;

/// Email notification adapter.
///
/// This adapter sends email notifications through the configured email service.
pub struct EmailAdapter<E> {
    email_service: E,
}

impl<E> EmailAdapter<E> {
    /// Create a new email adapter.
    pub fn new(email_service: E) -> Self {
        Self { email_service }
    }
}

/// Trait for email service operations.
///
/// This allows the adapter to work with different email service implementations.
pub trait EmailServiceOps {
    /// Queue an email notification to be sent.
    ///
    /// The email service is responsible for looking up the user's email address
    /// and formatting the notification appropriately.
    fn queue_email<'a>(
        &self,
        recipient: MacroUserIdStr<'a>,
        notification_type: &str,
        payload: &[u8],
    ) -> impl std::future::Future<Output = Result<(), Report>> + Send;
}

impl<E: EmailServiceOps + Send + Sync> EmailSender for EmailAdapter<E> {
    async fn send_email<T: Notification + Send + Sync>(
        &self,
        notification: &T,
        recipient: MacroUserIdStr<'_>,
    ) -> Result<(), Report> {
        // Serialize the notification payload
        let payload = serde_json::to_vec(notification).map_err(Report::new)?;

        self.email_service
            .queue_email(recipient, T::TYPE_NAME, &payload)
            .await
    }
}
