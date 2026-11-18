//! Gmail contact capability implementation.

use models_email::service::contact::Contact;
use uuid::Uuid;

use crate::domain::models::{AccessToken, ContactPage, EmailApiError};
use crate::domain::ports::MailboxContactsClient;

use super::convert::map_person_to_contact;
use super::{GmailApiClientRepository, map_contacts_error, map_gmail_error};

impl MailboxContactsClient for GmailApiClientRepository {
    async fn get_self_contact(
        &self,
        access_token: &AccessToken,
        link_id: Uuid,
    ) -> Result<Contact, EmailApiError> {
        let person = self
            .client
            .get_self_contact(access_token.expose_secret())
            .await
            .map_err(map_gmail_error)?;
        Ok(map_person_to_contact(link_id, person))
    }

    async fn list_contacts_page(
        &self,
        access_token: &AccessToken,
        link_id: Uuid,
        sync_token: Option<&str>,
        page_token: Option<&str>,
    ) -> Result<ContactPage, EmailApiError> {
        let page = self
            .client
            .get_contacts_page(access_token.expose_secret(), sync_token, page_token)
            .await
            .map_err(map_contacts_error)?;
        Ok(contact_page(
            link_id,
            page.connections,
            page.next_sync_token,
            page.next_page_token,
        ))
    }

    async fn list_other_contacts_page(
        &self,
        access_token: &AccessToken,
        link_id: Uuid,
        sync_token: Option<&str>,
        page_token: Option<&str>,
    ) -> Result<ContactPage, EmailApiError> {
        let page = self
            .client
            .get_other_contacts_page(access_token.expose_secret(), sync_token, page_token)
            .await
            .map_err(map_contacts_error)?;
        Ok(contact_page(
            link_id,
            page.other_contacts,
            page.next_sync_token,
            page.next_page_token,
        ))
    }
}

fn contact_page(
    link_id: Uuid,
    people: Vec<models_email::gmail::contacts::PersonResource>,
    next_sync_token: Option<String>,
    next_page_token: Option<String>,
) -> ContactPage {
    ContactPage {
        contacts: people
            .into_iter()
            .map(|person| map_person_to_contact(link_id, person))
            .collect(),
        next_sync_token,
        next_page_token,
    }
}
