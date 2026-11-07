use macro_user_id::email::EmailStr;

use crate::domain::{
    models::{ContactInfo, EmailErr, Link},
    senders::SendAsAddress,
};

use super::EmailServiceImpl;

impl<T, U, E, CS, Eam, B> EmailServiceImpl<T, U, E, CS, Eam, B> {
    /// Base-address sends do not depend on the settings API. Never substitute the
    /// primary address when an explicitly requested alias is invalid/unavailable.
    pub(super) async fn resolve_sender(
        &self,
        link: &Link,
        requested: Option<&EmailStr<'_>>,
        refresh: bool,
    ) -> Result<ContactInfo, EmailErr> {
        let primary = link.email_address.0.as_ref();
        let Some(requested) =
            requested.filter(|email| !email.0.as_ref().eq_ignore_ascii_case(primary))
        else {
            return Ok(ContactInfo {
                email: primary.to_owned(),
                name: None,
                photo_url: None,
            });
        };
        let senders = self.sender_provider.send_as(link, refresh).await?;
        let sender = senders
            .into_iter()
            .find(|sender| {
                sender.verified
                    && sender
                        .email_address
                        .0
                        .as_ref()
                        .eq_ignore_ascii_case(requested.0.as_ref())
            })
            .ok_or(EmailErr::InvalidSender)?;
        Ok(ContactInfo {
            email: sender.email_address.0.as_ref().to_owned(),
            name: sender.display_name,
            photo_url: None,
        })
    }
}

/// Only verified provider identities may appear as alternate senders.
pub(super) fn verified_senders(senders: Vec<SendAsAddress>) -> Vec<SendAsAddress> {
    senders
        .into_iter()
        .filter(|sender| sender.verified)
        .collect()
}

#[cfg(test)]
mod test;
