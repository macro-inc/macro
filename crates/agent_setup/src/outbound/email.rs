//! [`SetupInbox`] over the email service: the person's own inboxes.

use std::sync::Arc;

use async_trait::async_trait;
use email::domain::{models::UserProvider, ports::EmailService};
use macro_user_id::user_id::MacroUserIdStr;

use crate::domain::{
    catalog::MailProvider,
    ports::{Inbox, Result, SetupError, SetupInbox},
};

/// The person's inboxes, from the email service.
pub struct EmailSetupInbox<T> {
    service: Arc<T>,
}

impl<T> EmailSetupInbox<T> {
    /// An adapter over the email service.
    pub fn new(service: Arc<T>) -> Self {
        Self { service }
    }
}

#[async_trait]
impl<T: EmailService> SetupInbox for EmailSetupInbox<T> {
    async fn inboxes(&self, user: &MacroUserIdStr<'static>) -> Result<Vec<Inbox>> {
        let links = self
            .service
            .get_inboxes_for_macro_id(user.clone())
            .await
            .map_err(|error| {
                SetupError::Internal(rootcause::report!("listing inboxes: {error:?}"))
            })?;
        Ok(links
            .into_iter()
            .filter(|link| link.macro_id.to_string() == user.as_ref())
            .map(|link| Inbox {
                address: link.email_address.0.as_ref().to_owned(),
                provider: match link.provider {
                    UserProvider::Gmail => MailProvider::Gmail,
                    UserProvider::Outlook => MailProvider::Outlook,
                },
            })
            .collect())
    }
}
