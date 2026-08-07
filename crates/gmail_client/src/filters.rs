use crate::error::{decode_json_response, unsuccessful_response};
use crate::{GmailApiHttpError, GmailClient};
use models_email::gmail::filters::{Filter, ListFiltersResponse};

/// Creates a Gmail filter from the supplied wire request.
#[tracing::instrument(skip(client, access_token), err)]
pub(crate) async fn create_filter(
    client: &GmailClient,
    access_token: &str,
    filter: Filter,
) -> Result<Filter, GmailApiHttpError> {
    let response = client
        .inner
        .post(format!("{}/users/me/settings/filters", client.base_url))
        .bearer_auth(access_token)
        .json(&filter)
        .send()
        .await
        .map_err(GmailApiHttpError::transport)?;

    if !response.status().is_success() {
        return Err(unsuccessful_response(response).await);
    }

    decode_json_response(response).await
}

/// Lists all raw Gmail filters for the user.
#[tracing::instrument(skip(client, access_token), err)]
pub(crate) async fn list_filters(
    client: &GmailClient,
    access_token: &str,
) -> Result<Vec<Filter>, GmailApiHttpError> {
    let response = client
        .inner
        .get(format!("{}/users/me/settings/filters", client.base_url))
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(GmailApiHttpError::transport)?;

    if !response.status().is_success() {
        return Err(unsuccessful_response(response).await);
    }

    let response = decode_json_response::<ListFiltersResponse>(response).await?;
    Ok(response.filter)
}

/// Deletes a Gmail filter by provider ID.
#[tracing::instrument(skip(client, access_token), err)]
pub(crate) async fn delete_filter(
    client: &GmailClient,
    access_token: &str,
    filter_id: &str,
) -> Result<(), GmailApiHttpError> {
    let response = client
        .inner
        .delete(format!(
            "{}/users/me/settings/filters/{filter_id}",
            client.base_url
        ))
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(GmailApiHttpError::transport)?;

    if !response.status().is_success() {
        return Err(unsuccessful_response(response).await);
    }

    Ok(())
}

#[cfg(test)]
mod test;
