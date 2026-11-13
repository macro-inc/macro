//! What the `send_*` scenarios share: reading a message as the provider
//! holds it on the wire (its HTML, headers and attachments), and the small
//! steps a composer takes (an HTML body, a reply, a signature).
//!
//! The scenarios assert on what a recipient's mail client would be given, so
//! they read the provider's own API with the mailbox's access token rather
//! than Macro's view of the message.

#![expect(
    dead_code,
    reason = "each send_* test binary uses its own part of the shared helpers"
)]

use base64::Engine;
use base64::engine::general_purpose::{STANDARD, URL_SAFE, URL_SAFE_NO_PAD};
use email_e2e::{Inbox, Provider, ProviderMessage, Report, Stack, eventually};
use rootcause::prelude::*;
use serde_json::{Value, json};

/// A message as the provider would hand it to a mail client.
#[derive(Clone, Debug, Default)]
pub struct Wire {
    /// The subject.
    pub subject: String,
    /// The HTML body.
    pub html: String,
    /// The plain-text body, when the provider keeps one (Gmail).
    pub text: String,
    /// The message's headers, names in lower case.
    pub headers: Vec<(String, String)>,
    /// Its attachments, inline ones included.
    pub attachments: Vec<WireAttachment>,
}

/// An attachment of a [`Wire`] message.
#[derive(Clone, Debug, Default)]
pub struct WireAttachment {
    /// The file name.
    pub filename: String,
    /// The content type, without parameters.
    pub mime_type: String,
    /// The `Content-ID`, without angle brackets.
    pub content_id: Option<String>,
    /// The content.
    pub bytes: Vec<u8>,
}

impl Wire {
    /// The value of a header, by its name in any case.
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(header, _)| header.eq_ignore_ascii_case(name))
            .map(|(_, value)| value.as_str())
    }

    /// How often `needle` occurs in the HTML body.
    pub fn html_count(&self, needle: &str) -> usize {
        self.html.matches(needle).count()
    }
}

/// An HTML body the way the API takes it: base64, URL-safe, unpadded.
pub fn html(body: &str) -> String {
    URL_SAFE_NO_PAD.encode(body)
}

/// Reads a message from the provider's API as the mailbox's owner.
pub async fn wire(stack: &Stack, inbox: &Inbox, provider_id: &str) -> Result<Wire, Report> {
    match inbox.provider() {
        Provider::Gmail => gmail_wire(stack, inbox, provider_id).await,
        Provider::Outlook => outlook_wire(stack, inbox, provider_id).await,
    }
}

/// Waits for a message with this subject in the mailbox at the provider and
/// reads it from the provider's API.
pub async fn wait_for_wire(
    stack: &Stack,
    inbox: &Inbox,
    subject: &str,
) -> Result<(ProviderMessage, Wire), Report> {
    let message = inbox
        .wait_for_provider_message(&format!("a message named {subject:?}"), |message| {
            message.subject == subject && !is_draft_at_provider(message)
        })
        .await?;
    let wire = wire(stack, inbox, &message.id).await?;
    Ok((message, wire))
}

/// Whether the provider holds the message as a draft.
pub fn is_draft_at_provider(message: &ProviderMessage) -> bool {
    message
        .labels
        .iter()
        .any(|label| label == "DRAFT" || label.eq_ignore_ascii_case("drafts"))
}

/// The mailbox's messages at the provider with this subject that are not
/// drafts: what was really delivered or sent.
pub fn provider_copies(inbox: &Inbox, subject: &str) -> Result<Vec<ProviderMessage>, Report> {
    Ok(inbox
        .provider_messages()?
        .into_iter()
        .filter(|message| message.subject == subject && !is_draft_at_provider(message))
        .collect())
}

/// The mailbox's drafts at the provider.
pub fn provider_drafts(inbox: &Inbox) -> Result<Vec<ProviderMessage>, Report> {
    Ok(inbox
        .provider_messages()?
        .into_iter()
        .filter(is_draft_at_provider)
        .collect())
}

async fn provider_get(stack: &Stack, inbox: &Inbox, path: &str) -> Result<Value, Report> {
    let (base, token) = match inbox.provider() {
        Provider::Gmail => (
            stack.gmail().gmail_url(),
            stack.gmail().access_token(inbox.email())?,
        ),
        Provider::Outlook => (
            stack.outlook().graph_url(),
            stack.outlook().access_token(inbox.email())?,
        ),
    };
    let response = reqwest::Client::new()
        .get(format!("{base}{path}"))
        .bearer_auth(token)
        .send()
        .await
        .context(format!("the provider did not answer GET {path}"))?;
    let status = response.status();
    let text = response.text().await?;
    if !status.is_success() {
        bail!("the provider answered {status} for GET {path}: {text}");
    }
    Ok(serde_json::from_str(&text)?)
}

async fn gmail_wire(stack: &Stack, inbox: &Inbox, id: &str) -> Result<Wire, Report> {
    let message = provider_get(
        stack,
        inbox,
        &format!("/users/me/messages/{id}?format=full"),
    )
    .await?;
    let mut wire = Wire::default();
    let payload = &message["payload"];
    wire.headers = headers_of(payload);
    wire.subject = wire.header("subject").unwrap_or_default().to_owned();

    let mut parts = vec![payload.clone()];
    while let Some(part) = parts.pop() {
        if let Some(children) = part["parts"].as_array() {
            parts.extend(children.iter().rev().cloned());
            continue;
        }
        let mime_type = part["mimeType"].as_str().unwrap_or_default().to_owned();
        let filename = part["filename"].as_str().unwrap_or_default().to_owned();
        let part_headers = headers_of(&part);
        let content_id = part_headers
            .iter()
            .find(|(name, _)| name == "content-id")
            .map(|(_, value)| value.trim_matches(['<', '>']).to_owned());
        let bytes = match (
            part["body"]["data"].as_str(),
            part["body"]["attachmentId"].as_str(),
        ) {
            (Some(data), _) => decode_url_safe(data)?,
            (None, Some(attachment)) => {
                let fetched = provider_get(
                    stack,
                    inbox,
                    &format!("/users/me/messages/{id}/attachments/{attachment}"),
                )
                .await?;
                decode_url_safe(fetched["data"].as_str().unwrap_or_default())?
            }
            (None, None) => Vec::new(),
        };
        if filename.is_empty() && content_id.is_none() {
            let body = String::from_utf8_lossy(&bytes).into_owned();
            match mime_type.as_str() {
                "text/html" => wire.html.push_str(&body),
                "text/plain" => wire.text.push_str(&body),
                _ => {}
            }
        } else {
            wire.attachments.push(WireAttachment {
                filename,
                mime_type,
                content_id,
                bytes,
            });
        }
    }
    Ok(wire)
}

fn headers_of(part: &Value) -> Vec<(String, String)> {
    part["headers"]
        .as_array()
        .map(|headers| {
            headers
                .iter()
                .map(|header| {
                    (
                        header["name"]
                            .as_str()
                            .unwrap_or_default()
                            .to_ascii_lowercase(),
                        header["value"].as_str().unwrap_or_default().to_owned(),
                    )
                })
                .collect()
        })
        .unwrap_or_default()
}

fn decode_url_safe(data: &str) -> Result<Vec<u8>, Report> {
    let trimmed = data.trim_end_matches('=');
    URL_SAFE_NO_PAD
        .decode(trimmed)
        .or_else(|_| URL_SAFE.decode(data))
        .or_else(|_| STANDARD.decode(data))
        .context("the provider returned a body that is not base64")
        .map_err(Report::from)
}

async fn outlook_wire(stack: &Stack, inbox: &Inbox, id: &str) -> Result<Wire, Report> {
    let message = provider_get(
        stack,
        inbox,
        &format!("/me/messages/{id}?$select=subject,body,internetMessageHeaders,ccRecipients,bccRecipients"),
    )
    .await?;
    let mut wire = Wire {
        subject: message["subject"].as_str().unwrap_or_default().to_owned(),
        ..Wire::default()
    };
    let content = message["body"]["content"].as_str().unwrap_or_default();
    if message["body"]["contentType"]
        .as_str()
        .is_some_and(|kind| kind.eq_ignore_ascii_case("html"))
    {
        wire.html = content.to_owned();
    } else {
        wire.text = content.to_owned();
    }
    wire.headers = message["internetMessageHeaders"]
        .as_array()
        .map(|headers| {
            headers
                .iter()
                .map(|header| {
                    (
                        header["name"]
                            .as_str()
                            .unwrap_or_default()
                            .to_ascii_lowercase(),
                        header["value"].as_str().unwrap_or_default().to_owned(),
                    )
                })
                .collect()
        })
        .unwrap_or_default();
    // Graph gives the copied recipients as properties, not as headers.
    for (name, property) in [("cc", "ccRecipients"), ("bcc", "bccRecipients")] {
        let addresses: Vec<&str> = message[property]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|recipient| recipient["emailAddress"]["address"].as_str())
            .collect();
        if !addresses.is_empty() {
            wire.headers.push((name.to_owned(), addresses.join(", ")));
        }
    }

    let attachments = provider_get(stack, inbox, &format!("/me/messages/{id}/attachments")).await?;
    for attachment in attachments["value"].as_array().into_iter().flatten() {
        wire.attachments.push(WireAttachment {
            filename: attachment["name"].as_str().unwrap_or_default().to_owned(),
            mime_type: attachment["contentType"]
                .as_str()
                .unwrap_or_default()
                .to_owned(),
            content_id: attachment["contentId"]
                .as_str()
                .filter(|id| !id.is_empty())
                .map(|id| id.trim_matches(['<', '>']).to_owned()),
            bytes: STANDARD
                .decode(attachment["contentBytes"].as_str().unwrap_or_default())
                .unwrap_or_default(),
        });
    }
    Ok(wire)
}

/// Sets the inbox's signature, as the settings page does.
pub async fn set_signature(
    inbox: &Inbox,
    signature: &str,
    on_replies_and_forwards: bool,
) -> Result<(), Report> {
    inbox
        .patch(
            "/email/settings",
            Some(&json!({ "settings": {
                "signature": signature,
                "signature_on_replies_forwards": on_replies_and_forwards,
            }})),
        )
        .await?
        .ok()?;
    Ok(())
}

/// The first message of the thread a preview names: its id, for a reply.
pub async fn first_message(inbox: &Inbox, preview: &Value) -> Result<Value, Report> {
    let thread = inbox
        .thread(preview["id"].as_str().unwrap_or_default())
        .await?;
    let message = thread["messages"][0].clone();
    if !message["db_id"].is_string() {
        bail!("the thread has no first message: {thread}");
    }
    Ok(message)
}

/// The message with this id as the thread view shows it, or null when the
/// thread no longer lists it.
pub async fn message_in_thread(
    inbox: &Inbox,
    thread_id: &str,
    message_id: &str,
) -> Result<Value, Report> {
    let read = inbox
        .get(&format!("/email/threads/{thread_id}?limit=100"))
        .await?;
    // A thread that no longer exists answers like one the user may not read.
    if read.status == 404 || read.status == 401 {
        return Ok(Value::Null);
    }
    let thread = read.ok()?;
    Ok(thread["thread"]["messages"]
        .as_array()
        .and_then(|messages| {
            messages
                .iter()
                .find(|message| message["db_id"] == message_id)
        })
        .cloned()
        .unwrap_or(Value::Null))
}

/// Waits until a draft the scenario saved exists at the provider: the
/// draft's own subject among the mailbox's drafts.
pub async fn wait_for_provider_draft(
    inbox: &Inbox,
    subject: &str,
) -> Result<ProviderMessage, Report> {
    inbox
        .wait_for_provider_message(&format!("the draft {subject:?}"), |message| {
            message.subject == subject && is_draft_at_provider(message)
        })
        .await
}

/// Waits until the mailbox holds no draft at the provider.
pub async fn wait_for_no_provider_draft(inbox: &Inbox) -> Result<(), Report> {
    eventually(
        "the provider to hold no draft",
        email_e2e::DEFAULT_TIMEOUT,
        async || Ok(provider_drafts(inbox)?.is_empty().then_some(())),
    )
    .await
}
