//! Correlated drafts and attachment transfers. This adapter never retries writes.

use std::collections::HashSet;

use base64::{Engine, engine::general_purpose::STANDARD};
use chrono::{DateTime, Utc};
use models_email::email::service::address::ContactInfo;
use reqwest::{Method, Response, StatusCode};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use url::Url;
use uuid::Uuid;

use super::{OutlookApiClientRepository, transport::invalid_response, wire::Page};
use crate::domain::{models::*, ports::MailboxDraftClient};

#[cfg(test)]
mod test;

// An application-owned named MAPI property persists when a draft becomes sent.
pub(super) const CORRELATION_PROPERTY: &str =
    "String {2f537ed4-4b85-4bbb-b231-b7f36d3769e2} Name MacroDraftId";
const REVISION_PROPERTY: &str =
    "String {2f537ed4-4b85-4bbb-b231-b7f36d3769e2} Name MacroDraftRevision";
const DRAFT_SELECT: &str =
    "id,conversationId,isDraft,subject,body,from,toRecipients,ccRecipients,bccRecipients,replyTo";
const SMALL_ATTACHMENT_LIMIT: usize = 3_000_000;
const MAX_ATTACHMENT_SIZE: usize = 150_000_000;
const UPLOAD_BLOCK: u64 = 320 * 1024;
const MAX_RANGE_SIZE: usize = 4_000_000;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Draft {
    id: String,
    conversation_id: String,
    #[serde(rename = "@odata.etag")]
    etag: Option<String>,
    is_draft: bool,
    #[serde(default)]
    single_value_extended_properties: Vec<super::wire::ExtendedProperty>,
    #[serde(flatten)]
    content: serde_json::Map<String, Value>,
}

impl TryFrom<Draft> for ProviderDraft {
    type Error = EmailApiError;

    fn try_from(value: Draft) -> Result<Self, Self::Error> {
        Ok(Self {
            content_fingerprint: content_fingerprint(&value.content),
            id: ProviderId::new(value.id)?,
            conversation_id: ProviderId::new(value.conversation_id)?,
            // changeKey is not an HTTP entity tag. Never manufacture If-Match.
            version: value.etag,
            is_draft: value.is_draft,
            app_revision: value
                .single_value_extended_properties
                .iter()
                .find(|property| property.id == REVISION_PROPERTY)
                .and_then(|property| property.value.parse().ok()),
        })
    }
}

// Compare provider-normalized bodies to prior provider snapshots. Comparing to
// the submitted HTML would confuse Microsoft normalization with a user edit.
fn content_fingerprint(content: &serde_json::Map<String, Value>) -> Option<String> {
    let required = [
        "subject",
        "body",
        "toRecipients",
        "ccRecipients",
        "bccRecipients",
    ];
    if required.iter().any(|key| !content.contains_key(*key)) {
        return None;
    }
    let fields = required
        .into_iter()
        .chain(["from", "replyTo"])
        .map(|key| (key, content.get(key).cloned().unwrap_or(Value::Null)))
        .collect::<std::collections::BTreeMap<_, _>>();
    fn canonical(value: Value) -> Value {
        match value {
            Value::Object(object) => {
                let sorted = object
                    .into_iter()
                    .collect::<std::collections::BTreeMap<_, _>>();
                Value::Object(
                    sorted
                        .into_iter()
                        .map(|(key, value)| (key, canonical(value)))
                        .collect(),
                )
            }
            Value::Array(values) => Value::Array(values.into_iter().map(canonical).collect()),
            other => other,
        }
    }
    let bytes = serde_json::to_vec(&canonical(serde_json::to_value(fields).ok()?)).ok()?;
    Some(format!("{:x}", Sha256::digest(bytes)))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Attachment {
    id: String,
    name: String,
    size: u64,
    content_id: Option<String>,
    #[serde(default)]
    is_inline: bool,
}

impl TryFrom<Attachment> for DraftAttachment {
    type Error = EmailApiError;

    fn try_from(value: Attachment) -> Result<Self, Self::Error> {
        Ok(Self {
            id: ProviderId::new(value.id)?,
            name: value.name,
            size: value.size,
            content_id: value.content_id,
            inline: value.is_inline,
        })
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Upload {
    upload_url: Option<String>,
    expiration_date_time: DateTime<Utc>,
    next_expected_ranges: Vec<String>,
}

impl OutlookApiClientRepository {
    fn upload_url(&self, value: &UploadUrl) -> Result<Url, EmailApiError> {
        let url = Url::parse(value.expose()).map_err(|_| invalid_response())?;
        let allowed = url.scheme() == "https"
            && url.port_or_known_default() == Some(443)
            && matches!(
                url.host_str(),
                Some("outlook.office.com" | "outlook.office365.com" | "graph.microsoft.com")
            );
        #[cfg(test)]
        let allowed = allowed || url.origin() == self.root.origin();
        if !allowed
            || !url.username().is_empty()
            || url.password().is_some()
            || url.fragment().is_some()
        {
            return Err(EmailApiError::Permanent {
                message: "invalid Microsoft attachment upload origin".into(),
            });
        }
        Ok(url)
    }

    fn upload_checkpoint(
        &self,
        upload: Upload,
        previous_url: Option<&UploadUrl>,
    ) -> Result<AttachmentUploadSession, EmailApiError> {
        let url = upload
            .upload_url
            .map(UploadUrl::new)
            .or_else(|| previous_url.cloned())
            .ok_or_else(invalid_response)?;
        self.upload_url(&url)?;
        // Outlook requires sequential ranges. Multiple holes are not silently skipped.
        let [range] = upload.next_expected_ranges.as_slice() else {
            return Err(invalid_response());
        };
        let start = range
            .split_once('-')
            .map_or(range.as_str(), |(start, _)| start);
        let next_offset = start.parse().map_err(|_| invalid_response())?;
        Ok(AttachmentUploadSession {
            url,
            expires_at: upload.expiration_date_time,
            next_offset,
        })
    }
}

impl MailboxDraftClient for OutlookApiClientRepository {
    async fn get_draft(
        &self,
        token: &AccessToken,
        id: &ProviderId,
    ) -> Result<Option<ProviderDraft>, EmailApiError> {
        let mut url = self.endpoint(&["me", "messages", id.as_str()])?;
        url.query_pairs_mut()
            .append_pair("$select", DRAFT_SELECT)
            .append_pair(
                "$expand",
                &format!("singleValueExtendedProperties($filter=id eq '{REVISION_PROPERTY}')"),
            );
        match self.get::<Draft>(token, url).await {
            Ok(draft) => Ok(Some(draft.try_into()?)),
            Err(EmailApiError::NotFound) => Ok(None),
            Err(error) => Err(error),
        }
    }
    async fn find_drafts(
        &self,
        token: &AccessToken,
        correlation: Uuid,
    ) -> Result<Vec<ProviderDraft>, EmailApiError> {
        let mut url = self.endpoint(&["me", "messages"])?;
        url.query_pairs_mut()
            .append_pair("$select", DRAFT_SELECT)
            .append_pair("$expand", &format!("singleValueExtendedProperties($filter=id eq '{REVISION_PROPERTY}')"))
            .append_pair("$filter", &format!("singleValueExtendedProperties/Any(ep: ep/id eq '{CORRELATION_PROPERTY}' and ep/value eq '{correlation}')"));
        let mut drafts = Vec::new();
        let mut seen = HashSet::new();
        loop {
            if !seen.insert(url.to_string()) {
                return Err(invalid_response());
            }
            let page: Page<Draft> = self.get(token, url).await?;
            for draft in page.value {
                drafts.push(draft.try_into()?);
            }
            let Some(next) = page.next else {
                return Ok(drafts);
            };
            url = self.continuation(&StreamToken::new(next))?;
        }
    }

    async fn create_draft(
        &self,
        token: &AccessToken,
        request: &DraftRequest,
    ) -> Result<ProviderDraft, EmailApiError> {
        let (url, body) = if let Some(parent) = &request.reply_to {
            (
                self.endpoint(&["me", "messages", parent.as_str(), "createReply"])?,
                json!({"message":draft_body(request)?}),
            )
        } else {
            (self.endpoint(&["me", "messages"])?, draft_body(request)?)
        };
        let response = self.request(token, Method::POST, url, Some(&body)).await?;
        written_json::<Draft>(response)
            .await?
            .try_into()
            .map_err(uncertain_write)
    }

    async fn update_draft(
        &self,
        token: &AccessToken,
        id: &ProviderId,
        request: &DraftRequest,
        expected_version: &str,
    ) -> Result<ProviderDraft, EmailApiError> {
        if expected_version.is_empty() {
            return Err(EmailApiError::Conflict);
        }
        let response = self
            .conditional_request(
                token,
                Method::PATCH,
                self.endpoint(&["me", "messages", id.as_str()])?,
                Some(&draft_body(request)?),
                Some(expected_version),
            )
            .await?;
        written_json::<Draft>(response)
            .await?
            .try_into()
            .map_err(uncertain_write)
    }

    async fn delete_draft(
        &self,
        token: &AccessToken,
        id: &ProviderId,
        expected_version: &str,
    ) -> Result<(), EmailApiError> {
        if expected_version.is_empty() {
            return Err(EmailApiError::Conflict);
        }
        match self
            .conditional_request(
                token,
                Method::DELETE,
                self.endpoint(&["me", "messages", id.as_str()])?,
                None,
                Some(expected_version),
            )
            .await
        {
            Ok(_) | Err(EmailApiError::NotFound) => Ok(()),
            Err(error) => Err(error),
        }
    }

    async fn draft_attachments(
        &self,
        token: &AccessToken,
        id: &ProviderId,
    ) -> Result<Vec<DraftAttachment>, EmailApiError> {
        let mut url = self.endpoint(&["me", "messages", id.as_str(), "attachments"])?;
        url.query_pairs_mut().append_pair(
            "$select",
            "id,name,size,microsoft.graph.fileAttachment/contentId,isInline",
        );
        let mut attachments = Vec::new();
        let mut seen = HashSet::new();
        loop {
            if !seen.insert(url.to_string()) {
                return Err(invalid_response());
            }
            let page: Page<Attachment> = self.get(token, url).await?;
            for attachment in page.value {
                attachments.push(attachment.try_into()?);
            }
            let Some(next) = page.next else {
                return Ok(attachments);
            };
            url = self.continuation(&StreamToken::new(next))?;
        }
    }

    async fn add_attachment(
        &self,
        token: &AccessToken,
        draft: &ProviderId,
        attachment: AttachmentContent<'_>,
    ) -> Result<DraftAttachment, EmailApiError> {
        if attachment.data.len() >= SMALL_ATTACHMENT_LIMIT {
            return Err(EmailApiError::Permanent {
                message: "attachment requires a resumable upload".into(),
            });
        }
        let body = json!({
            "@odata.type": "#microsoft.graph.fileAttachment",
            "name": attachment.name, "contentType": attachment.content_type,
            "contentId": attachment.content_id, "isInline": attachment.inline,
            "contentBytes": STANDARD.encode(attachment.data)
        });
        let response = self
            .request(
                token,
                Method::POST,
                self.endpoint(&["me", "messages", draft.as_str(), "attachments"])?,
                Some(&body),
            )
            .await?;
        written_json::<Attachment>(response)
            .await?
            .try_into()
            .map_err(uncertain_write)
    }

    async fn delete_attachment(
        &self,
        token: &AccessToken,
        draft: &ProviderId,
        attachment: &ProviderId,
    ) -> Result<(), EmailApiError> {
        match self
            .request(
                token,
                Method::DELETE,
                self.endpoint(&[
                    "me",
                    "messages",
                    draft.as_str(),
                    "attachments",
                    attachment.as_str(),
                ])?,
                None,
            )
            .await
        {
            Ok(_) | Err(EmailApiError::NotFound) => Ok(()),
            Err(error) => Err(error),
        }
    }

    async fn create_upload(
        &self,
        token: &AccessToken,
        draft: &ProviderId,
        attachment: AttachmentContent<'_>,
    ) -> Result<AttachmentUploadSession, EmailApiError> {
        if !(SMALL_ATTACHMENT_LIMIT..=MAX_ATTACHMENT_SIZE).contains(&attachment.data.len()) {
            return Err(EmailApiError::Permanent {
                message: "attachment is outside the resumable upload size range".into(),
            });
        }
        let body = json!({"AttachmentItem": {
            "attachmentType": "file", "name": attachment.name,
            "size": attachment.data.len(), "contentType": attachment.content_type,
            "contentId": attachment.content_id, "isInline": attachment.inline
        }});
        let response = self
            .request(
                token,
                Method::POST,
                self.endpoint(&[
                    "me",
                    "messages",
                    draft.as_str(),
                    "attachments",
                    "createUploadSession",
                ])?,
                Some(&body),
            )
            .await?;
        self.upload_checkpoint(written_json(response).await?, None)
            .map_err(uncertain_write)
    }

    async fn inspect_upload(
        &self,
        url: &UploadUrl,
    ) -> Result<AttachmentUploadSession, EmailApiError> {
        let response = self
            .gated_request(self.client.get(self.upload_url(url)?))
            .await?;
        let value = response.json().await.map_err(|_| invalid_response())?;
        self.upload_checkpoint(value, Some(url))
    }

    async fn upload_range(
        &self,
        url: &UploadUrl,
        offset: u64,
        total: u64,
        bytes: &[u8],
    ) -> Result<UploadProgress, EmailApiError> {
        let end = offset
            .checked_add(bytes.len() as u64)
            .ok_or_else(invalid_response)?;
        if bytes.is_empty()
            || bytes.len() >= MAX_RANGE_SIZE
            || total > MAX_ATTACHMENT_SIZE as u64
            || end > total
            || !offset.is_multiple_of(UPLOAD_BLOCK)
            || (end != total && !(bytes.len() as u64).is_multiple_of(UPLOAD_BLOCK))
        {
            return Err(EmailApiError::Permanent {
                message: "invalid attachment upload range".into(),
            });
        }
        let request = self
            .client
            .put(self.upload_url(url)?)
            .header("Content-Type", "application/octet-stream")
            .header("Content-Length", bytes.len())
            .header(
                "Content-Range",
                format!("bytes {offset}-{}/{total}", end - 1),
            )
            .body(bytes.to_vec());
        let response = self.gated_request(request).await?;
        if response.status() == StatusCode::CREATED {
            return Ok(UploadProgress::Complete);
        }
        let checkpoint = self
            .upload_checkpoint(written_json(response).await?, Some(url))
            .map_err(uncertain_write)?;
        if checkpoint.next_offset > total {
            return Err(uncertain_write(invalid_response()));
        }
        Ok(UploadProgress::Continue(checkpoint))
    }
}

fn draft_body(request: &DraftRequest) -> Result<Value, EmailApiError> {
    let content = &request.content;
    let mut properties = vec![
        json!({"id": CORRELATION_PROPERTY, "value": request.correlation.to_string()}),
        json!({"id":REVISION_PROPERTY,"value":request.revision.to_string()}),
    ];
    // RFC reply metadata maps to documented MAPI properties. Graph permits only
    // custom X- headers in internetMessageHeaders when constructing JSON messages.
    for (property, value) in [
        (
            "String 0x1042",
            content
                .parent_message_id
                .as_deref()
                .map(rfc_message_id)
                .transpose()?,
        ),
        (
            "String 0x1039",
            content
                .references
                .as_ref()
                .map(|values| {
                    values
                        .iter()
                        .map(|value| rfc_message_id(value))
                        .collect::<Result<Vec<_>, _>>()
                        .map(|ids| ids.join(" "))
                })
                .transpose()?,
        ),
    ] {
        if let Some(value) = value {
            if value.contains(['\r', '\n', '\0']) {
                return Err(EmailApiError::Permanent {
                    message: "invalid reply header".into(),
                });
            }
            properties.push(json!({"id":property,"value":value}));
        }
    }
    let (body_type, body) = match &content.message.body_html {
        Some(html) => ("HTML", html.as_str()),
        None => (
            "Text",
            content.message.body_text.as_deref().unwrap_or_default(),
        ),
    };
    Ok(json!({
        "subject": content.message.subject,
        "body": {"contentType":body_type,"content":body},
        "from": recipient(&content.from),
        "toRecipients": recipients(content.message.to.as_deref()),
        "ccRecipients": recipients(content.message.cc.as_deref()),
        "bccRecipients": recipients(content.message.bcc.as_deref()),
        "singleValueExtendedProperties": properties
    }))
}

fn recipient(contact: &ContactInfo) -> Value {
    json!({"emailAddress":{"address":contact.email,"name":contact.name}})
}

fn rfc_message_id(value: &str) -> Result<String, EmailApiError> {
    let id = value.trim_matches(['<', '>']);
    if id.is_empty()
        || id
            .chars()
            .any(|c| c.is_whitespace() || c.is_control() || matches!(c, '<' | '>'))
    {
        return Err(EmailApiError::Permanent {
            message: "invalid reply message identifier".into(),
        });
    }
    Ok(format!("<{id}>"))
}

fn recipients(contacts: Option<&[ContactInfo]>) -> Vec<Value> {
    contacts.unwrap_or_default().iter().map(recipient).collect()
}

async fn written_json<T: serde::de::DeserializeOwned>(
    response: Response,
) -> Result<T, EmailApiError> {
    response
        .json()
        .await
        .map_err(|_| uncertain_write(invalid_response()))
}

fn uncertain_write(_: EmailApiError) -> EmailApiError {
    EmailApiError::Transient {
        message: "Microsoft write response could not be confirmed".into(),
    }
}
