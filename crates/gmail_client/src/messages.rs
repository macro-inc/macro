use std::cmp::min;

use anyhow::Context;
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use mail_builder::headers::address::Address;
use models_email::email::service::address::ContactInfo;
use models_email::email::service::message;
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
        .map_err(GmailApiHttpError::Transport)?;

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
        .map_err(GmailApiHttpError::Transport)?;

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
        .map_err(GmailApiHttpError::Transport)?;

    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    if !response.status().is_success() {
        return Err(unsuccessful_response(response).await);
    }

    let message: MinimalMessageResource = decode_json_response(response).await?;
    Ok(Some(message.label_ids))
}

/// sends a message
#[tracing::instrument(skip(client, access_token, message), fields(link_id=%message.link_id), err)]
pub(crate) async fn send_message(
    client: &GmailClient,
    access_token: &str,
    message: &mut message::MessageToSend,
    from_contact: &ContactInfo,
    parent_message_id: Option<String>,
    references: Option<Vec<String>>,
) -> anyhow::Result<()> {
    let url = format!("{}/users/me/messages/send", client.base_url);

    let mut builder = mail_builder::MessageBuilder::new()
        .from(contact_to_address(from_contact))
        .to(contacts_to_address_list(&message.to))
        .cc(contacts_to_address_list(&message.cc))
        .bcc(contacts_to_address_list(&message.bcc))
        .subject(&message.subject);

    // Set threading headers, if existing
    if let Some(parent_message_id) = parent_message_id {
        builder = builder.in_reply_to(parent_message_id);
    }

    if let Some(references) = references {
        builder = builder.references(references);
    }

    if let Some(text_body) = &message.body_text {
        builder = builder.text_body(text_body);
    }

    if let Some(html_body) = &message.body_html {
        builder = builder.html_body(html_body);
    }

    if let Some(attachments) = message.attachments.take() {
        for att in attachments {
            builder = builder.attachment(att.content_type, att.file_name, att.data);
        }
    }

    let email_bytes = builder.write_to_vec().context("building message error")?;

    let base64_email_content = URL_SAFE_NO_PAD.encode(email_bytes);

    let payload = SendMessagePayload {
        raw: base64_email_content,
        thread_id: message.provider_thread_id.clone(),
    };

    let http_client = client.inner.clone();

    let response = http_client
        .post(&url)
        .bearer_auth(access_token)
        .json(&payload)
        .send()
        .await
        .with_context(|| {
            format!(
                "Failed to send request to Gmail API (send message) for link_id: {}",
                message.link_id
            )
        })?;

    let status = response.status();
    let body_text = response
        .text()
        .await
        .context("Failed to get response body")?;
    if !status.is_success() {
        anyhow::bail!(
            "Gmail API returned an error status: {} (send message): {}",
            status,
            body_text
        );
    }

    let message_response: SentMessageResource = serde_json::from_str(&body_text)
        .context("Failed to parse JSON response from Gmail API (get attachment)")?;

    message.provider_id = Some(message_response.id);
    message.provider_thread_id = Some(message_response.thread_id);

    Ok(())
}

fn contact_to_address(contact: &ContactInfo) -> Address<'_> {
    match &contact.name {
        Some(name) => Address::new_address(Some(name.as_str()), contact.email.as_str()),
        None => Address::new_address(None::<&str>, contact.email.as_str()),
    }
}

fn contacts_to_address_list(contacts: &Option<Vec<ContactInfo>>) -> Address<'_> {
    let contacts = contacts.as_ref();
    if contacts.is_none_or(|c| c.is_empty()) {
        return Address::new_list(Vec::new());
    }

    let addresses: Vec<Address> = contacts.unwrap().iter().map(contact_to_address).collect();

    Address::new_list(addresses)
}
