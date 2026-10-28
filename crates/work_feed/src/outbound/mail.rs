//! Email archive through the email domain service.

use std::sync::Arc;

use email::domain::ports::EmailService;
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use uuid::Uuid;

use crate::domain::ports::WorkFeedMail;

/// Archives threads through [`EmailService`].
pub struct EmailWorkFeedMail<E> {
    email: Arc<E>,
}

impl<E> EmailWorkFeedMail<E> {
    /// Create the adapter over the email service.
    pub fn new(email: Arc<E>) -> Self {
        Self { email }
    }
}

impl<E> WorkFeedMail for EmailWorkFeedMail<E>
where
    E: EmailService,
{
    async fn set_archived(
        &self,
        user: MacroUserIdStr<'static>,
        thread_id: Uuid,
        archived: bool,
    ) -> Result<(), Report> {
        self.email
            .set_thread_archived(user, thread_id, archived)
            .await
            .map_err(|error| rootcause::report!("failed to set thread archive state: {error}"))
    }
}
