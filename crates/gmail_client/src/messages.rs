use std::cmp::min;

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use models_email::gmail::{
    ListMessagesResponse, MessageResource, MinimalMessageResource, SendMessagePayload,
    SentMessageResource,
};

use crate::error::{decode_json_response, unsuccessful_response};
use crate::{GmailApiHttpError, GmailClient};

#[cfg(test)]
mod test;

// 500 is the max allowed by the gmail api
pub const LIST_MESSAGES_BATCH_SIZE: u32 = 500;

/// Lists message provider ids up to the requested number (capped at 500 by the
/// Gmail API), most recent first. `label_ids` restricts the result to messages
/// carrying all of the given Gmail label ids; an empty slice applies no filter.
#[tracing::instrument(skip(client, access_token), err)]
pub(crate) async fn list_messages(
    client: &GmailClient,
    access_token: &str,
    num_messages: u32,
    label_ids: &[&str],
) -> Result<Vec<String>, GmailApiHttpError> {
    if num_messages == 0 {
        return Ok(Vec::new());
    }

    let batch_size = min(num_messages, LIST_MESSAGES_BATCH_SIZE);
    let url = format!("{}/users/me/messages", client.base_url);
    let mut query_params = vec![("maxResults", batch_size.to_string())];

    for label_id in label_ids {
        query_params.push(("labelIds", label_id.to_string()));
    }

    let response = client
        .inner
        .get(url)
        .bearer_auth(access_token)
        .query(&query_params)
        .send()
        .await
        .map_err(GmailApiHttpError::transport)?;

    if !response.status().is_success() {
        return Err(unsuccessful_response(response).await);
    }

    let gmail_response: ListMessagesResponse = decode_json_response(response).await?;
    Ok(gmail_response
        .messages
        .unwrap_or_default()
        .into_iter()
        .map(|message| message.id)
        .collect())
}

/// Finds a unique sent message, including messages moved into spam or trash.
/// Ambiguous or incomplete search responses must never count as proof of absence.
#[tracing::instrument(skip(client, access_token, message_id), err)]
pub(crate) async fn find_sent_message(
    client: &GmailClient,
    access_token: &str,
    message_id: &str,
) -> Result<Option<SentMessageResource>, GmailApiHttpError> {
    let response = client
        .inner
        .get(format!("{}/users/me/messages", client.base_url))
        .bearer_auth(access_token)
        .query(&[
            ("q", format!("rfc822msgid:<{message_id}>")),
            ("labelIds", "SENT".to_string()),
            ("includeSpamTrash", "true".to_string()),
            ("maxResults", "2".to_string()),
        ])
        .send()
        .await
        .map_err(GmailApiHttpError::transport)?;
    if !response.status().is_success() {
        return Err(unsuccessful_response(response).await);
    }
    let matches: SentMessageMatches = decode_json_response(response).await?;
    let mut messages = matches.messages.unwrap_or_default();
    if messages.len() > 1 || matches.next_page_token.is_some() {
        return Err(GmailApiHttpError::InvalidResponse(
            "multiple sent messages match the delivery identifier".to_string(),
        ));
    }
    if messages
        .iter()
        .any(|message| message.id.is_empty() || message.thread_id.is_empty())
    {
        return Err(GmailApiHttpError::InvalidResponse(
            "sent message match omitted provider identifiers".to_string(),
        ));
    }
    Ok(messages.pop())
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SentMessageMatches {
    messages: Option<Vec<SentMessageResource>>,
    next_page_token: Option<String>,
}

#[tracing::instrument(skip(client, access_token), err)]
pub(crate) async fn get_message(
    client: &GmailClient,
    access_token: &str,
    message_provider_id: &str,
) -> Result<Option<MessageResource>, GmailApiHttpError> {
    let url = format!(
        "{}/users/me/messages/{}",
        client.base_url, message_provider_id
    );
    let response = client
        .inner
        .get(url)
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(GmailApiHttpError::transport)?;

    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    if !response.status().is_success() {
        return Err(unsuccessful_response(response).await);
    }

    decode_json_response(response).await.map(Some)
}

// Gets a message without the body using `format=minimal`.
#[tracing::instrument(skip(client, access_token), err)]
pub(crate) async fn get_message_label_ids(
    client: &GmailClient,
    access_token: &str,
    message_provider_id: &str,
) -> Result<Option<Vec<String>>, GmailApiHttpError> {
    let url = format!(
        "{}/users/me/messages/{}",
        client.base_url, message_provider_id
    );
    let response = client
        .inner
        .get(url)
        .bearer_auth(access_token)
        .query(&[("format", "minimal")])
        .send()
        .await
        .map_err(GmailApiHttpError::transport)?;

    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    if !response.status().is_success() {
        return Err(unsuccessful_response(response).await);
    }

    let message: MinimalMessageResource = decode_json_response(response).await?;
    Ok(Some(message.label_ids))
}

/// Sends prepared MIME bytes through the Gmail API.
#[tracing::instrument(skip(client, access_token, mime), err)]
pub(crate) async fn send_message(
    client: &GmailClient,
    access_token: &str,
    mime: &[u8],
    thread_id: Option<&str>,
) -> Result<SentMessageResource, GmailApiHttpError> {
    let url = format!("{}/users/me/messages/send", client.base_url);
    let payload = SendMessagePayload {
        raw: URL_SAFE_NO_PAD.encode(mime),
        thread_id: thread_id.map(str::to_owned),
    };

    let response = client
        .send_client
        .post(url)
        .bearer_auth(access_token)
        .json(&payload)
        .send()
        .await
        .map_err(GmailApiHttpError::transport)?;

    if !response.status().is_success() {
        return Err(unsuccessful_response(response).await);
    }

    decode_json_response(response).await
}
