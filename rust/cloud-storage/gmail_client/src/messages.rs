use crate::GmailClient;
use crate::parse::map_message_resource_to_service;
use anyhow::Context;
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use mail_builder::headers::address::Address;
use models_email::email::service::address::ContactInfo;
use models_email::email::service::message;
use models_email::gmail::{
    MessageResource, MinimalMessageResource, SendMessagePayload, SentMessageResource,
};
use uuid::Uuid;

#[tracing::instrument(skip(client, access_token))]
pub(crate) async fn get_message(
    client: &GmailClient,
    access_token: &str,
    message_provider_id: &str,
    link_id: Uuid,
) -> anyhow::Result<Option<message::Message>> {
    let url = format!(
        "{}/users/me/messages/{}",
        client.base_url, message_provider_id
    );

    let http_client = client.inner.clone();

    let response = http_client
        .get(&url)
        .bearer_auth(access_token)
        .send()
        .await
        .with_context(|| format!("Failed to send request to Gmail API (get message) for message_provider_id: {}, link_id: {}",
                                 message_provider_id, link_id))?;

    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }

    let response = response
        .error_for_status()
        .with_context(|| format!("Gmail API returned an error status (get message) for message_provider_id: {}, link_id: {}",
                                 message_provider_id, link_id))?;

    let message_response = response
        .json::<MessageResource>()
        .await
        .with_context(|| format!("Failed to parse JSON response from Gmail API (get message) for message_provider_id: {}, link_id: {}",
                                 message_provider_id, link_id))?;

    let message = map_message_resource_to_service(message_response, link_id)
        .with_context(|| format!("Failed to map Gmail message response to service message for message_provider_id: {}, link_id: {}",
                                 message_provider_id, link_id))?;

    Ok(Some(message))
}

// gets a message without the body using ?format=minimal in the gmail api call
#[tracing::instrument(skip(client, access_token))]
pub(crate) async fn get_message_thread_id(
    client: &GmailClient,
    access_token: &str,
    message_provider_id: &str,
    link_id: Uuid,
) -> anyhow::Result<Option<String>> {
    let url = format!(
        "{}/users/me/messages/{}?format=minimal",
        client.base_url, message_provider_id
    );

    let http_client = client.inner.clone();

    let response = http_client
        .get(&url)
        .bearer_auth(access_token)
        .send()
        .await
        .with_context(|| format!("Failed to send request to Gmail API (get message) for message_provider_id: {}, link_id: {}",
                                 message_provider_id, link_id))?;

    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }

    let response = response
        .error_for_status()
        .with_context(|| format!("Gmail API returned an error status (get message) for message_provider_id: {}, link_id: {}",
                                 message_provider_id, link_id))?;

    let message_response = response
        .json::<MinimalMessageResource>()
        .await
        .with_context(|| format!("Failed to parse JSON response from Gmail API (get message) for message_provider_id: {}, link_id: {}", message_provider_id, link_id))?;

    Ok(Some(message_response.thread_id))
}

// gets a message without the body using ?format=minimal in the gmail api call
#[tracing::instrument(skip(client, access_token))]
pub(crate) async fn get_message_label_ids(
    client: &GmailClient,
    access_token: &str,
    message_provider_id: &str,
    link_id: Uuid,
) -> anyhow::Result<Option<Vec<String>>> {
    let url = format!(
        "{}/users/me/messages/{}?format=minimal",
        client.base_url, message_provider_id
    );

    let http_client = client.inner.clone();

    let response = http_client
        .get(&url)
        .bearer_auth(access_token)
        .send()
        .await
        .with_context(|| format!("Failed to send request to Gmail API (get message) for message_provider_id: {}, link_id: {}",
                                 message_provider_id, link_id))?;

    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }

    let response = response
        .error_for_status()
        .with_context(|| format!("Gmail API returned an error status (get message) for message_provider_id: {}, link_id: {}",
                                 message_provider_id, link_id))?;

    let message_response = response
        .json::<MinimalMessageResource>()
        .await
        .with_context(|| format!("Failed to parse JSON response from Gmail API (get message) for message_provider_id: {}, link_id: {}", message_provider_id, link_id))?;

    Ok(Some(message_response.label_ids))
}

/// sends a message
#[tracing::instrument(skip(client, access_token, message), fields(link_id=%message.link_id))]
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

    let email_string = builder
        .write_to_string()
        .context("building message error")?;
    let base64_email_content = URL_SAFE_NO_PAD.encode(email_string.as_bytes());

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
        return Err(anyhow::anyhow!(
            "Gmail API returned an error status: {} (send message): {}",
            status,
            body_text
        ));
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
