use crate::error::{decode_json_response, unsuccessful_response};
use crate::{GmailApiHttpError, GmailClient};
use models_email::gmail::contacts::{ConnectionsResponse, OtherContactsResponse, PersonResource};

const PERSON_FIELDS: &str = "names,emailAddresses,photos";

/// Gets the user's own connection as a raw People API resource.
#[tracing::instrument(skip(client, access_token), err)]
pub(crate) async fn get_self_connection(
    client: &GmailClient,
    access_token: &str,
) -> Result<PersonResource, GmailApiHttpError> {
    let response = client
        .inner
        .get(format!("{}/people/me", client.contacts_url))
        .bearer_auth(access_token)
        .query(&[("personFields", PERSON_FIELDS)])
        .send()
        .await
        .map_err(GmailApiHttpError::transport)?;

    if !response.status().is_success() {
        return Err(unsuccessful_response(response).await);
    }

    decode_json_response(response).await
}

/// Fetches all pages of the user's contacts and returns raw People resources.
#[tracing::instrument(skip(client, access_token, sync_token), err)]
pub(crate) async fn list_connections(
    client: &GmailClient,
    access_token: &str,
    sync_token: Option<&str>,
) -> Result<(Vec<PersonResource>, String), GmailApiHttpError> {
    let mut people = Vec::new();
    let mut page_token: Option<String> = None;
    let mut next_sync_token: Option<String> = None;

    loop {
        let mut request = client
            .inner
            .get(format!("{}/people/me/connections", client.contacts_url))
            .bearer_auth(access_token)
            .query(&[
                ("personFields", PERSON_FIELDS),
                ("requestSyncToken", "true"),
            ]);
        if let Some(token) = sync_token {
            request = request.query(&[("syncToken", token)]);
        } else {
            request = request.query(&[("pageSize", "1000")]);
        }
        if let Some(token) = page_token.as_deref() {
            request = request.query(&[("pageToken", token)]);
        }

        let response = request.send().await.map_err(GmailApiHttpError::transport)?;
        if !response.status().is_success() {
            return Err(unsuccessful_response(response).await);
        }

        let page: ConnectionsResponse = decode_json_response(response).await?;
        people.extend(page.connections);
        if page.next_sync_token.is_some() {
            next_sync_token = page.next_sync_token;
        }
        page_token = page.next_page_token;

        if page_token.is_none() {
            break;
        }
    }

    let next_sync_token = next_sync_token.ok_or_else(|| {
        GmailApiHttpError::InvalidResponse(
            "People API did not return a nextSyncToken for connections".to_string(),
        )
    })?;
    Ok((people, next_sync_token))
}

/// Fetches all pages of "Other Contacts" and returns raw People resources.
#[tracing::instrument(skip(client, access_token, sync_token), err)]
pub(crate) async fn list_other_contacts(
    client: &GmailClient,
    access_token: &str,
    sync_token: Option<&str>,
) -> Result<(Vec<PersonResource>, String), GmailApiHttpError> {
    let mut people = Vec::new();
    let mut page_token: Option<String> = None;
    let mut next_sync_token: Option<String> = None;

    loop {
        let mut request = client
            .inner
            .get(format!("{}/otherContacts", client.contacts_url))
            .bearer_auth(access_token)
            .query(&[
                ("readMask", PERSON_FIELDS),
                ("sources", "READ_SOURCE_TYPE_CONTACT"),
                ("sources", "READ_SOURCE_TYPE_PROFILE"),
                ("requestSyncToken", "true"),
            ]);
        if let Some(token) = sync_token {
            request = request.query(&[("syncToken", token)]);
        } else {
            request = request.query(&[("pageSize", "1000")]);
        }
        if let Some(token) = page_token.as_deref() {
            request = request.query(&[("pageToken", token)]);
        }

        let response = request.send().await.map_err(GmailApiHttpError::transport)?;
        if !response.status().is_success() {
            return Err(unsuccessful_response(response).await);
        }

        let page: OtherContactsResponse = decode_json_response(response).await?;
        people.extend(page.other_contacts);
        if page.next_sync_token.is_some() {
            next_sync_token = page.next_sync_token;
        }
        page_token = page.next_page_token;

        if page_token.is_none() {
            break;
        }
    }

    let next_sync_token = next_sync_token.ok_or_else(|| {
        GmailApiHttpError::InvalidResponse(
            "People API did not return a nextSyncToken for other contacts".to_string(),
        )
    })?;
    Ok((people, next_sync_token))
}

#[cfg(test)]
mod test;
