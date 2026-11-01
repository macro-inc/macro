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

/// Gets one page of the user's contacts as raw People resources.
///
/// Failures log at WARN: expired sync tokens and links granted without the
/// contacts scopes are routine, and the contacts sync recovers or skips them.
#[tracing::instrument(
    skip(client, access_token, sync_token, page_token),
    err(level = "warn")
)]
pub(crate) async fn get_connections_page(
    client: &GmailClient,
    access_token: &str,
    sync_token: Option<&str>,
    page_token: Option<&str>,
) -> Result<ConnectionsResponse, GmailApiHttpError> {
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
    if let Some(token) = page_token {
        request = request.query(&[("pageToken", token)]);
    }

    let response = request.send().await.map_err(GmailApiHttpError::transport)?;
    if !response.status().is_success() {
        return Err(unsuccessful_response(response).await);
    }

    decode_json_response(response).await
}

/// Gets one page of "Other Contacts" as raw People resources.
///
/// Failures log at WARN for the same reasons as [`get_connections_page`].
#[tracing::instrument(
    skip(client, access_token, sync_token, page_token),
    err(level = "warn")
)]
pub(crate) async fn get_other_contacts_page(
    client: &GmailClient,
    access_token: &str,
    sync_token: Option<&str>,
    page_token: Option<&str>,
) -> Result<OtherContactsResponse, GmailApiHttpError> {
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
    if let Some(token) = page_token {
        request = request.query(&[("pageToken", token)]);
    }

    let response = request.send().await.map_err(GmailApiHttpError::transport)?;
    if !response.status().is_success() {
        return Err(unsuccessful_response(response).await);
    }

    decode_json_response(response).await
}

#[cfg(test)]
mod test;
