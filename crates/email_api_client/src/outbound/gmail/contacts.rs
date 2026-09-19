//! Gmail contact capability implementation.

use models_email::service::contact::{Contact, ContactList};
use uuid::Uuid;

use crate::domain::models::{AccessToken, EmailApiError};
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

    async fn list_contacts(
        &self,
        access_token: &AccessToken,
        link_id: Uuid,
        sync_token: Option<&str>,
    ) -> Result<ContactList, EmailApiError> {
        let (people, next_sync_token) = self
            .client
            .get_contacts(access_token.expose_secret(), sync_token)
            .await
            .map_err(map_contacts_error)?;
        Ok(contact_list(link_id, people, next_sync_token))
    }

    async fn list_other_contacts(
        &self,
        access_token: &AccessToken,
        link_id: Uuid,
        sync_token: Option<&str>,
    ) -> Result<ContactList, EmailApiError> {
        let (people, next_sync_token) = self
            .client
            .get_other_contacts(access_token.expose_secret(), sync_token)
            .await
            .map_err(map_contacts_error)?;
        Ok(contact_list(link_id, people, next_sync_token))
    }
}

fn contact_list(
    link_id: Uuid,
    people: Vec<models_email::gmail::contacts::PersonResource>,
    next_sync_token: String,
) -> ContactList {
    ContactList {
        contacts: people
            .into_iter()
            .map(|person| map_person_to_contact(link_id, person))
            .collect(),
        next_sync_token,
    }
}
