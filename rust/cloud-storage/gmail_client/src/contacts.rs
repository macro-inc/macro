use crate::GmailClient;
use crate::parse::map_person_to_contact;
use anyhow::Context;
use models_email::gmail::contacts::{ConnectionsResponse, OtherContactsResponse, PersonResource};
use models_email::service::contact::{Contact, ContactList};
use uuid::Uuid;

/// Get the user's own connection
#[tracing::instrument(skip(client, access_token))]
pub(crate) async fn get_self_connection(
    client: &GmailClient,
    access_token: &str,
    link_id: Uuid,
) -> anyhow::Result<Contact> {
    let http_client = client.inner.clone();

    let url = format!(
        "{}/people/me?personFields=names,emailAddresses,photos",
        client.contacts_url
    );

    let response = http_client
        .get(&url)
        .bearer_auth(access_token)
        .send()
        .await
        .context("Failed to send request to People API (list connections)")?;

    let response = response
        .error_for_status()
        .context("People API returned an error status (list connections)")?;

    let connection_response = response
        .json::<PersonResource>()
        .await
        .context("Failed to parse JSON response from People API (list connections)")?;

    let new_contact = map_person_to_contact(link_id, connection_response);

    Ok(new_contact)
}

/// Fetches contacts from the People API.
/// If a sync_token is provided, it fetches only the changes since the last sync.
/// Otherwise, it performs a full sync of all contacts.
#[tracing::instrument(skip(client, access_token, sync_token))]
pub(crate) async fn list_connections(
    client: &GmailClient,
    access_token: &str,
    link_id: Uuid,
    sync_token: Option<&str>,
) -> anyhow::Result<ContactList> {
    let mut all_contacts: Vec<Contact> = Vec::new();
    let mut next_page_token: Option<String> = None;
    let mut final_sync_token: Option<String> = None;

    let http_client = client.inner.clone();

    // Determine the base URL based on whether this is a full or incremental sync.
    let base_url = if let Some(token) = sync_token {
        // Incremental sync: Use syncToken, omit pageSize
        format!(
            "{}/people/me/connections?personFields=names,emailAddresses,photos&requestSyncToken=true&syncToken={}",
            client.contacts_url, token
        )
    } else {
        // Full sync: Use pageSize
        format!(
            "{}/people/me/connections?personFields=names,emailAddresses,photos&pageSize=1000&requestSyncToken=true",
            client.contacts_url
        )
    };

    loop {
        let mut url = base_url.clone();
        if let Some(token) = &next_page_token {
            url.push_str(&format!("&pageToken={}", token));
        }

        let response = http_client
            .get(&url)
            .bearer_auth(access_token)
            .send()
            .await
            .context("Failed to send request to People API (list connections)")?;

        let response = response
            .error_for_status()
            .context("People API returned an error status (list connections)")?;

        let connection_response = response
            .json::<ConnectionsResponse>()
            .await
            .context("Failed to parse JSON response from People API (list connections)")?;

        let new_contacts = connection_response
            .connections
            .into_iter()
            .map(|person| map_person_to_contact(link_id, person));

        all_contacts.extend(new_contacts);

        // Keep the latest sync token returned by the API.
        if let Some(sync_token) = connection_response.next_sync_token {
            final_sync_token = Some(sync_token);
        }

        // Handle pagination.
        if let Some(page_token) = connection_response.next_page_token {
            next_page_token = Some(page_token);
        } else {
            break;
        }
    }

    let next_sync_token = final_sync_token.context("People API did not return a nextSyncToken")?;

    Ok(ContactList {
        contacts: all_contacts,
        next_sync_token,
    })
}

/// Fetches "Other Contacts" from the People API.
/// If a sync_token is provided, it fetches only the changes since the last sync.
/// Otherwise, it performs a full sync of all "Other Contacts".
#[tracing::instrument(skip(client, access_token, sync_token))]
pub(crate) async fn list_other_contacts(
    client: &GmailClient,
    access_token: &str,
    link_id: Uuid,
    sync_token: Option<&str>,
) -> anyhow::Result<ContactList> {
    let mut all_contacts: Vec<Contact> = Vec::new();
    let mut next_page_token: Option<String> = None;
    let mut final_sync_token: Option<String> = None;

    let http_client = client.inner.clone();

    // Determine the base URL based on whether this is a full or incremental sync.
    let base_url = if let Some(token) = sync_token {
        // Incremental sync: Use syncToken, omit pageSize
        format!(
            "{}/otherContacts?readMask=names,emailAddresses,photos&requestSyncToken=true&syncToken={}",
            client.contacts_url, token
        )
    } else {
        // Full sync: Use pageSize
        format!(
            "{}/otherContacts?readMask=names,emailAddresses,photos&pageSize=1000&requestSyncToken=true",
            client.contacts_url
        )
    };

    loop {
        let mut url = base_url.clone();
        if let Some(token) = &next_page_token {
            url.push_str(&format!("&pageToken={}", token));
        }

        let response = http_client
            .get(&url)
            .bearer_auth(access_token)
            .send()
            .await
            .context("Failed to send request to People API (list other contacts)")?;

        let response = response
            .error_for_status()
            .context("People API returned an error status (list other contacts)")?;

        let other_contacts_response = response
            .json::<OtherContactsResponse>()
            .await
            .context("Failed to parse JSON response from People API (list other contacts)")?;

        let new_contacts = other_contacts_response
            .other_contacts
            .into_iter()
            .map(|person| map_person_to_contact(link_id, person));

        all_contacts.extend(new_contacts);

        // Keep the latest sync token returned by the API.
        if let Some(sync_token) = other_contacts_response.next_sync_token {
            final_sync_token = Some(sync_token);
        }

        // Handle pagination.
        if let Some(page_token) = other_contacts_response.next_page_token {
            next_page_token = Some(page_token);
        } else {
            break;
        }
    }

    let next_sync_token = final_sync_token.context("People API did not return a nextSyncToken")?;

    Ok(ContactList {
        contacts: all_contacts,
        next_sync_token,
    })
}
