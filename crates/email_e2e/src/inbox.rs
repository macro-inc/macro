//! A linked inbox, seen from both sides: through the email API as its user
//! sees it, and at the provider as the mailbox really is.

use std::time::Duration;

use axum::body::Bytes;
use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use reqwest::Method;
use rootcause::prelude::*;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::api::ApiResponse;
use crate::user::User;
use crate::wait::{DEFAULT_TIMEOUT, eventually};

/// The link status the API reports once the first sync is complete.
const UP_TO_DATE: &str = "UP_TO_DATE";
/// The most messages of a thread one request reads.
const THREAD_PAGE: u8 = 100;
/// The most previews one request reads.
const PREVIEW_PAGE: u16 = 500;

/// What the send helpers read of an attempt.
const SEND_ATTEMPT_FIELDS: &str = "attemptId status sendTime threadId message { \
    id threadId linkId providerId replyingToId subject isDraft isSent draftGeneration \
    scheduledSendTime bodyText bodyHtmlSanitized to { email } cc { email } bcc { email } \
    attachmentsDraft { id fileName } }";

/// A mail provider.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Provider {
    /// Gmail, served by `gmail_emulator`.
    Gmail,
    /// Outlook, served by `outlook_emulator`.
    Outlook,
}

impl Provider {
    /// Both providers, for a scenario that runs on each.
    pub const ALL: [Provider; 2] = [Provider::Gmail, Provider::Outlook];

    /// The provider's name in the API and the database.
    pub fn as_str(self) -> &'static str {
        match self {
            Provider::Gmail => "GMAIL",
            Provider::Outlook => "OUTLOOK",
        }
    }
}

#[derive(Clone)]
pub(crate) enum ProviderHandle {
    Gmail(gmail_emulator::GmailEmulator),
    Outlook(outlook_emulator::OutlookEmulator),
}

/// A message to put in a mailbox at the provider, as if someone had sent it.
/// For anything it cannot say, use the emulator's own `NewMessage` through
/// [`crate::Stack::gmail`] or [`crate::Stack::outlook`].
#[derive(Clone, Debug, Default)]
pub struct Mail {
    /// The sender, as a header value: `Ada <ada@example.com>`.
    pub from: String,
    /// The recipients, as a header value. The mailbox itself when absent.
    pub to: Option<String>,
    /// The `Cc` header value.
    pub cc: Option<String>,
    /// The subject.
    pub subject: String,
    /// The plain-text body.
    pub text: String,
    /// The HTML body.
    pub html: Option<String>,
    /// The `Message-ID`, without angle brackets. Generated when absent.
    pub message_id: Option<String>,
    /// The `Message-ID` this message replies to, which puts it in that
    /// message's thread.
    pub in_reply_to: Option<String>,
    /// Attachments.
    pub attachments: Vec<MailAttachment>,
}

/// An attachment of a [`Mail`].
#[derive(Clone, Debug)]
pub struct MailAttachment {
    /// The file name.
    pub filename: String,
    /// The content type.
    pub mime_type: String,
    /// The content.
    pub bytes: Vec<u8>,
}

impl Mail {
    /// A plain-text message.
    pub fn new(from: &str, subject: &str, text: &str) -> Self {
        Self {
            from: from.to_owned(),
            subject: subject.to_owned(),
            text: text.to_owned(),
            ..Self::default()
        }
    }

    /// The same message with an attachment added.
    pub fn with_attachment(mut self, filename: &str, mime_type: &str, bytes: &[u8]) -> Self {
        self.attachments.push(MailAttachment {
            filename: filename.to_owned(),
            mime_type: mime_type.to_owned(),
            bytes: bytes.to_vec(),
        });
        self
    }

    /// The same message as a reply to the message with this `Message-ID`.
    pub fn in_reply_to(mut self, message_id: &str) -> Self {
        self.in_reply_to = Some(message_id.to_owned());
        self
    }
}

/// A message as the provider holds it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProviderMessage {
    /// The provider's message id.
    pub id: String,
    /// The provider's thread (Gmail) or conversation (Outlook) id.
    pub thread_id: String,
    /// The subject.
    pub subject: String,
    /// The sender, as the provider reports it.
    pub from: Option<String>,
    /// Whether it is read.
    pub read: bool,
    /// Whether it is starred (Gmail) or flagged (Outlook).
    pub starred: bool,
    /// Whether it is in the inbox.
    pub in_inbox: bool,
    /// Gmail's label ids, or Outlook's folder name followed by its
    /// categories.
    pub labels: Vec<String>,
}

/// An inbox a user linked.
#[derive(Clone)]
pub struct Inbox {
    user: User,
    provider: ProviderHandle,
    email: String,
    link_id: Uuid,
}

impl Inbox {
    pub(crate) fn new(user: User, provider: ProviderHandle, email: String, link_id: Uuid) -> Self {
        Self {
            user,
            provider,
            email,
            link_id,
        }
    }

    /// The inbox's provider.
    pub fn provider(&self) -> Provider {
        match self.provider {
            ProviderHandle::Gmail(_) => Provider::Gmail,
            ProviderHandle::Outlook(_) => Provider::Outlook,
        }
    }

    /// The mailbox address.
    pub fn email(&self) -> &str {
        &self.email
    }

    /// The inbox's id in Macro (`email_links.id`).
    pub fn link_id(&self) -> Uuid {
        self.link_id
    }

    /// The user who linked it.
    pub fn user(&self) -> &User {
        &self.user
    }

    // -- the API, on this inbox --

    /// `GET path` as the inbox's user, on this inbox.
    pub async fn get(&self, path: &str) -> Result<ApiResponse, Report> {
        self.request(Method::GET, path, None).await
    }

    /// `POST path` as the inbox's user, on this inbox.
    pub async fn post(&self, path: &str, body: Option<&Value>) -> Result<ApiResponse, Report> {
        self.request(Method::POST, path, body).await
    }

    /// `PUT path` as the inbox's user, on this inbox.
    pub async fn put(&self, path: &str, body: Option<&Value>) -> Result<ApiResponse, Report> {
        self.request(Method::PUT, path, body).await
    }

    /// `PATCH path` as the inbox's user, on this inbox.
    pub async fn patch(&self, path: &str, body: Option<&Value>) -> Result<ApiResponse, Report> {
        self.request(Method::PATCH, path, body).await
    }

    /// `DELETE path` as the inbox's user, on this inbox.
    pub async fn delete(&self, path: &str, body: Option<&Value>) -> Result<ApiResponse, Report> {
        self.request(Method::DELETE, path, body).await
    }

    /// Any request as the inbox's user with the `X-Email-Link-Id` header
    /// naming this inbox.
    pub async fn request(
        &self,
        method: Method,
        path: &str,
        body: Option<&Value>,
    ) -> Result<ApiResponse, Report> {
        self.user
            .request(method, path, Some(self.link_id), body)
            .await
    }

    /// The inbox as `GET /email/links` reports it, or null once it is gone.
    pub async fn link(&self) -> Result<Value, Report> {
        let links = self.user.get("/email/links").await?.ok()?;
        let link_id = self.link_id.to_string();
        let link = links["links"]
            .as_array()
            .and_then(|links| links.iter().find(|link| link["id"] == link_id.as_str()))
            .cloned()
            .unwrap_or(Value::Null);
        Ok(link)
    }

    /// Waits until the API reports the inbox as up to date: its first
    /// backfill (Gmail) or import (Outlook) is complete. For Outlook it also
    /// waits for the service's Graph subscription, so that mail delivered
    /// next is announced by a change notification rather than found by the
    /// two-minute poll.
    pub async fn wait_until_synced(&self) -> Result<(), Report> {
        self.wait_for_link("the inbox to be up to date", |link| {
            link["sync_status"] == UP_TO_DATE
        })
        .await?;
        if let ProviderHandle::Outlook(outlook) = &self.provider {
            eventually(
                "the service to subscribe to the mailbox's changes",
                DEFAULT_TIMEOUT,
                async || {
                    let subscribed = outlook
                        .subscriptions()
                        .iter()
                        .any(|subscription| subscription.mailbox == self.email);
                    Ok(subscribed.then_some(()))
                },
            )
            .await?;
        }
        Ok(())
    }

    /// Waits until the inbox, as `GET /email/links` reports it, satisfies
    /// `condition`, and returns it.
    pub async fn wait_for_link(
        &self,
        what: &str,
        condition: impl Fn(&Value) -> bool,
    ) -> Result<Value, Report> {
        wait_seeing(what, async || {
            let link = self.link().await?;
            let seen = link.to_string();
            Ok((condition(&link).then_some(link), seen))
        })
        .await
    }

    /// This inbox's thread previews in a view (`inbox`, `sent`, `drafts`,
    /// `starred`, `all`, `spam`, `trash`, …), as the thread list shows them.
    pub async fn previews(&self, view: &str) -> Result<Vec<Value>, Report> {
        let link_id = self.link_id.to_string();
        let mut previews = Vec::new();
        let mut cursor: Option<String> = None;
        // The list is of all the user's inboxes, so this one's threads may be
        // on any page.
        loop {
            let after = cursor
                .as_deref()
                .map(|cursor| format!("&cursor={}", urlencoding::encode(cursor)))
                .unwrap_or_default();
            let listed = self
                .user
                .get(&format!(
                    "/email/threads/previews/cursor/{view}?limit={PREVIEW_PAGE}{after}"
                ))
                .await?
                .ok()?;
            previews.extend(
                listed["items"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter(|item| item["linkId"] == link_id.as_str())
                    .cloned(),
            );
            cursor = listed["next_cursor"].as_str().map(str::to_owned);
            if cursor.is_none() {
                return Ok(previews);
            }
        }
    }

    /// Waits until a thread with this subject shows in a view, and returns
    /// its preview. The thread's id is the preview's `id`.
    pub async fn wait_for_preview(&self, view: &str, subject: &str) -> Result<Value, Report> {
        self.wait_for_preview_where(view, &format!("a thread named {subject:?}"), |preview| {
            preview["name"] == subject
        })
        .await
    }

    /// Waits until a preview in a view satisfies `condition`, and returns it.
    pub async fn wait_for_preview_where(
        &self,
        view: &str,
        what: &str,
        condition: impl Fn(&Value) -> bool,
    ) -> Result<Value, Report> {
        let what = format!("{what} in the {view} view of {}", self.email);
        wait_seeing(&what, async || {
            let previews = self.previews(view).await?;
            let seen = Value::Array(previews.clone()).to_string();
            Ok((
                previews.into_iter().find(|preview| condition(preview)),
                seen,
            ))
        })
        .await
    }

    /// A thread with its messages, as `GET /email/threads/{id}` answers it
    /// (the `thread` object).
    pub async fn thread(&self, thread_id: &str) -> Result<Value, Report> {
        let read = self
            .user
            .get(&format!("/email/threads/{thread_id}?limit={THREAD_PAGE}"))
            .await?
            .ok()?;
        Ok(read["thread"].clone())
    }

    /// Waits until a thread satisfies `condition`, and returns it.
    pub async fn wait_for_thread(
        &self,
        thread_id: &str,
        what: &str,
        condition: impl Fn(&Value) -> bool,
    ) -> Result<Value, Report> {
        wait_seeing(what, async || {
            let thread = self.thread(thread_id).await?;
            let seen = thread.to_string();
            Ok((condition(&thread).then_some(thread), seen))
        })
        .await
    }

    /// Sends a message from this inbox: `POST /email/messages` with
    /// `message` as the draft input (`subject`, `to`, `body_text`, …), and
    /// returns the stored message. Delivery follows the undo window.
    pub async fn send(&self, message: &Value) -> Result<Value, Report> {
        let sent = self
            .post("/email/messages", Some(&json!({ "message": message })))
            .await?
            .ok()?;
        Ok(sent["message"].clone())
    }

    /// Saves a draft in this inbox: `POST /email/drafts` with `draft` as the
    /// draft input, and returns the stored draft. Pass `db_id` and the
    /// current `draft_generation` to update one.
    pub async fn save_draft(&self, draft: &Value) -> Result<Value, Report> {
        let saved = self
            .post("/email/drafts", Some(&json!({ "draft": draft })))
            .await?
            .ok()?;
        Ok(saved["draft"].clone())
    }

    /// Attaches a file to a draft the way the composer does: asks for an
    /// upload address, uploads the bytes to object storage and confirms the
    /// upload. Returns the attachment's id.
    pub async fn attach_to_draft(
        &self,
        draft_id: &str,
        draft_generation: i64,
        filename: &str,
        bytes: &[u8],
    ) -> Result<String, Report> {
        let digest = Sha256::digest(bytes);
        let added = self
            .post(
                &format!(
                    "/email/drafts/{draft_id}/attachments?draft_generation={draft_generation}"
                ),
                Some(&json!({
                    "file_name": filename,
                    "sha": hex::encode(digest),
                    "size": bytes.len(),
                })),
            )
            .await?
            .ok()?;
        let (Some(attachment_id), Some(upload_url), Some(content_type)) = (
            added["attachment_id"].as_str(),
            added["upload_url"].as_str(),
            added["content_type"].as_str(),
        ) else {
            bail!("adding a draft attachment answered {added}");
        };

        let uploaded = self
            .user
            .http()
            .put(upload_url)
            .header("content-type", content_type)
            .header("x-amz-checksum-sha256", STANDARD.encode(digest))
            .body(bytes.to_vec())
            .send()
            .await
            .context("could not upload the attachment")?;
        if !uploaded.status().is_success() {
            bail!(
                "object storage refused the upload with {}",
                uploaded.status()
            );
        }

        self.post(
            &format!(
                "/email/drafts/{draft_id}/attachments/{attachment_id}/complete?draft_generation={draft_generation}"
            ),
            None,
        )
        .await?
        .ok()?;
        Ok(attachment_id.to_owned())
    }

    /// Downloads a received attachment the way the app does: asks the API
    /// for its link and fetches the bytes from the CDN.
    pub async fn download_attachment(&self, attachment_id: &str) -> Result<Bytes, Report> {
        let read = self
            .user
            .get(&format!("/email/attachments/{attachment_id}"))
            .await?
            .ok()?;
        let Some(url) = read["attachment"]["data_url"].as_str() else {
            bail!("the attachment has no download link: {read}");
        };
        let fetched = self
            .user
            .http()
            .get(url)
            .send()
            .await
            .context("could not fetch the attachment from the CDN")?;
        if !fetched.status().is_success() {
            bail!("the CDN answered {} for the attachment", fetched.status());
        }
        Ok(fetched.bytes().await?)
    }

    // -- the GraphQL send path (a stack with `document_storage`) --

    /// Sends the way the web composer does: the `sendEmailAttempt` mutation
    /// with `attempt_id` as the Send action's own id and `message` as the
    /// draft input (`draftId`, `subject`, `to`, `bodyText`, …; the inbox is
    /// filled in). `extra` holds the rest of the input when the scenario has
    /// any (`attachmentIds`, `restoreBodyText`, `signatureHtml`, …). Returns
    /// the attempt: `status`, `sendTime`, `threadId` and `message`.
    /// Repeating a call with the same `attempt_id` replays the same Send.
    pub async fn send_attempt(
        &self,
        attempt_id: Uuid,
        message: &Value,
        extra: &Value,
    ) -> Result<Value, Report> {
        let mut message = message.clone();
        if let Some(fields) = message.as_object_mut() {
            fields
                .entry("linkId")
                .or_insert_with(|| json!(self.link_id));
        }
        let mut input = json!({
            "attempt": self.attempt_input(attempt_id),
            "message": message,
            "attachmentIds": [],
            "forwardedAttachmentIds": [],
        });
        if let (Some(input), Some(extra)) = (input.as_object_mut(), extra.as_object()) {
            input.extend(extra.clone());
        }
        let query = format!(
            "mutation($input: SendEmailAttemptInput!) {{ \
             sendEmailAttempt(input: $input) {{ attempt {{ {SEND_ATTEMPT_FIELDS} }} }} }}"
        );
        let data = self
            .user
            .graphql(&query, &json!({ "input": input }))
            .await?;
        Ok(data["sendEmailAttempt"]["attempt"].clone())
    }

    /// Undoes a Send within its window: the `cancelEmailSend` mutation.
    /// Returns the attempt, whose `message` is the draft given back.
    pub async fn cancel_send(&self, attempt_id: Uuid) -> Result<Value, Report> {
        let query = format!(
            "mutation($input: EmailSendAttemptInput!) {{ \
             cancelEmailSend(input: $input) {{ attempt {{ {SEND_ATTEMPT_FIELDS} }} }} }}"
        );
        let variables = json!({ "input": self.attempt_input(attempt_id) });
        let data = self.user.graphql(&query, &variables).await?;
        Ok(data["cancelEmailSend"]["attempt"].clone())
    }

    /// Reads a Send's attempt the way the app follows it, or `Null` when the
    /// server knows none under that id.
    pub async fn send_attempt_state(&self, attempt_id: Uuid) -> Result<Value, Report> {
        let query = format!(
            "query($input: EmailSendAttemptInput!) {{ \
             user {{ id emailSendAttempt(input: $input) {{ {SEND_ATTEMPT_FIELDS} }} }} }}"
        );
        let variables = json!({ "input": self.attempt_input(attempt_id) });
        let data = self.user.graphql(&query, &variables).await?;
        Ok(data["user"]["emailSendAttempt"].clone())
    }

    /// Waits until a Send's attempt reports `status` (`SENT`, `FAILED`, …)
    /// and returns the attempt.
    pub async fn wait_for_send_attempt(
        &self,
        attempt_id: Uuid,
        status: &str,
    ) -> Result<Value, Report> {
        eventually(
            &format!("send attempt {attempt_id} to be {status}"),
            DEFAULT_TIMEOUT,
            async || {
                let attempt = self.send_attempt_state(attempt_id).await?;
                Ok((attempt["status"] == status).then_some(attempt))
            },
        )
        .await
    }

    fn attempt_input(&self, attempt_id: Uuid) -> Value {
        json!({ "attemptId": attempt_id, "linkId": self.link_id })
    }

    // -- the provider's side --

    /// Puts a message in the mailbox at the provider, as if it had just
    /// arrived, and returns it. The provider then notifies Macro as it
    /// would: Gmail pushes, Outlook calls the subscription.
    pub fn deliver(&self, mail: &Mail) -> Result<ProviderMessage, Report> {
        let id = match &self.provider {
            ProviderHandle::Gmail(gmail) => gmail.deliver(&self.email, &mail.for_gmail())?.id,
            ProviderHandle::Outlook(outlook) => {
                outlook.deliver(&self.email, &mail.for_outlook())?.id
            }
        };
        self.provider_message(&id)?
            .ok_or_else(|| report!("the provider lost the message it just stored"))
    }

    /// Every message in the mailbox at the provider.
    pub fn provider_messages(&self) -> Result<Vec<ProviderMessage>, Report> {
        match &self.provider {
            ProviderHandle::Gmail(gmail) => Ok(gmail
                .messages(&self.email)?
                .into_iter()
                .map(|message| ProviderMessage {
                    read: !message.labels.iter().any(|label| label == "UNREAD"),
                    starred: message.labels.iter().any(|label| label == "STARRED"),
                    in_inbox: message.labels.iter().any(|label| label == "INBOX"),
                    id: message.id,
                    thread_id: message.thread_id,
                    subject: message.subject.unwrap_or_default(),
                    from: message.from,
                    labels: message.labels,
                })
                .collect()),
            ProviderHandle::Outlook(outlook) => Ok(outlook
                .messages(&self.email)?
                .into_iter()
                .map(|message| ProviderMessage {
                    read: message.is_read,
                    starred: message.flagged,
                    in_inbox: message.folder.eq_ignore_ascii_case("inbox"),
                    id: message.id,
                    thread_id: message.conversation_id,
                    subject: message.subject,
                    from: message.from,
                    labels: std::iter::once(message.folder)
                        .chain(message.categories)
                        .collect(),
                })
                .collect()),
        }
    }

    /// One message at the provider, when the mailbox still holds it.
    pub fn provider_message(&self, id: &str) -> Result<Option<ProviderMessage>, Report> {
        Ok(self
            .provider_messages()?
            .into_iter()
            .find(|message| message.id == id))
    }

    /// Waits until a message at the provider satisfies `condition`, and
    /// returns it: how a scenario sees that a change made in Macro reached
    /// the provider, or that a sent message arrived.
    pub async fn wait_for_provider_message(
        &self,
        what: &str,
        condition: impl Fn(&ProviderMessage) -> bool,
    ) -> Result<ProviderMessage, Report> {
        let what = format!("{what} in {} at the provider", self.email);
        wait_seeing(&what, async || {
            let messages = self.provider_messages()?;
            let seen = format!("{messages:?}");
            Ok((
                messages.into_iter().find(|message| condition(message)),
                seen,
            ))
        })
        .await
    }

    /// Marks a message read or unread at the provider, as the mailbox's
    /// owner would in the provider's own client.
    pub fn set_read_at_provider(&self, message_id: &str, read: bool) -> Result<(), Report> {
        match &self.provider {
            ProviderHandle::Gmail(gmail) => {
                let unread = ["UNREAD".to_owned()];
                let (add, remove): (&[String], &[String]) =
                    if read { (&[], &unread) } else { (&unread, &[]) };
                gmail.modify_labels(&self.email, message_id, add, remove)?;
            }
            ProviderHandle::Outlook(outlook) => {
                outlook.update_message(
                    &self.email,
                    message_id,
                    &outlook_emulator::MessageChange {
                        read: Some(read),
                        ..Default::default()
                    },
                )?;
            }
        }
        Ok(())
    }

    /// Moves the provider's clock forward, past the lifetime of every access
    /// token it has issued: the next call with a cached token is refused.
    pub fn expire_access_tokens(&self) {
        let past_any_token = Duration::from_secs(2 * 60 * 60);
        match &self.provider {
            ProviderHandle::Gmail(gmail) => gmail.advance_clock(past_any_token),
            ProviderHandle::Outlook(outlook) => outlook.advance_clock(past_any_token),
        }
    }

    /// Revokes the user's grant at the provider, as removing Macro's access
    /// in the provider's account settings does.
    pub fn revoke_grant(&self) -> Result<(), Report> {
        match &self.provider {
            ProviderHandle::Gmail(gmail) => gmail.revoke_grant(&self.email)?,
            ProviderHandle::Outlook(outlook) => outlook.revoke_grant(&self.email)?,
        }
        Ok(())
    }
}

/// [`eventually`] with the default limit, for a condition that also
/// describes what it last looked at: a wait that times out says what was
/// there instead of what it waited for.
async fn wait_seeing<T>(
    what: &str,
    mut look: impl AsyncFnMut() -> Result<(Option<T>, String), Report>,
) -> Result<T, Report> {
    let mut last_seen = String::new();
    let waited = eventually(what, DEFAULT_TIMEOUT, async || {
        let (found, seen) = look().await?;
        last_seen = seen;
        Ok(found)
    })
    .await;
    waited.map_err(|report| report.attach(format!("last seen: {last_seen}")))
}

impl Mail {
    /// The message as the Gmail emulator takes it.
    pub(crate) fn for_gmail(&self) -> gmail_emulator::NewMessage {
        gmail_emulator::NewMessage {
            from: Some(self.from.clone()),
            to: self.to.clone(),
            cc: self.cc.clone(),
            subject: Some(self.subject.clone()),
            text: Some(self.text.clone()),
            html: self.html.clone(),
            message_id: self.message_id.clone(),
            in_reply_to: self.in_reply_to.clone(),
            attachments: self
                .attachments
                .iter()
                .map(|attachment| gmail_emulator::NewAttachment {
                    filename: attachment.filename.clone(),
                    mime_type: Some(attachment.mime_type.clone()),
                    base64: Some(STANDARD.encode(&attachment.bytes)),
                    ..Default::default()
                })
                .collect(),
            ..Default::default()
        }
    }

    /// The message as the Outlook emulator takes it.
    pub(crate) fn for_outlook(&self) -> outlook_emulator::NewMessage {
        outlook_emulator::NewMessage {
            from: Some(self.from.clone()),
            to: self.to.clone(),
            cc: self.cc.clone(),
            subject: Some(self.subject.clone()),
            text: Some(self.text.clone()),
            html: self.html.clone(),
            message_id: self.message_id.clone(),
            in_reply_to: self.in_reply_to.clone(),
            attachments: self
                .attachments
                .iter()
                .map(|attachment| outlook_emulator::NewAttachment {
                    filename: attachment.filename.clone(),
                    mime_type: Some(attachment.mime_type.clone()),
                    base64: Some(STANDARD.encode(&attachment.bytes)),
                    ..Default::default()
                })
                .collect(),
            ..Default::default()
        }
    }
}
