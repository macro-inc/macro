use chrono::Utc;
use models_email::service::{address::ContactInfo, attachment::Attachment, message::Message};
use reqwest::Method;
use serde_json::json;
use uuid::Uuid;

use super::{OutlookApiClientRepository, transport::invalid_response, wire};
use crate::domain::models::{
    AccessToken, Attention, EmailApiError, FolderRole, MailFolder, MailboxMessage, MailboxState,
    MessageAction, MessageWithCalendarParts, MessageWriteReceipt, ProviderId, StreamToken,
    SubmissionOutcome,
};
use crate::domain::ports::{MailboxActionWriter, MailboxCalendarClient, MailboxContentReader};

const MESSAGE_FIELDS: &str = "id,conversationId,parentFolderId,changeKey,internetMessageId,subject,bodyPreview,body,from,toRecipients,ccRecipients,bccRecipients,isRead,isDraft,flag,categories,inferenceClassification,receivedDateTime,sentDateTime,createdDateTime,lastModifiedDateTime,internetMessageHeaders,webLink";

const ARCHIVE_ROLE_PROPERTY: &str =
    "String {81f532e3-7ace-4e0b-bae9-312ce0d50c8c} Name MacroFolderRole";

impl OutlookApiClientRepository {
    async fn archive_destination(&self, token: &AccessToken) -> Result<ProviderId, EmailApiError> {
        match self
            .get::<wire::Folder>(token, self.endpoint(&["me", "mailFolders", "archive"])?)
            .await
        {
            Ok(folder) => return ProviderId::new(folder.id),
            Err(EmailApiError::NotFound) => {}
            Err(error) => return Err(error),
        }
        let mut url = self.endpoint(&["me", "mailFolders"])?;
        url.query_pairs_mut().append_pair("$filter",&format!("singleValueExtendedProperties/any(p:p/id eq '{ARCHIVE_ROLE_PROPERTY}' and p/value eq 'archive')"));
        let mut visited = std::collections::HashSet::new();
        loop {
            if !visited.insert(url.as_str().to_owned()) {
                return Err(invalid_response());
            }
            let page: wire::Page<wire::Folder> = self.get(token, url).await?;
            if let Some(folder) = page.value.into_iter().min_by(|a, b| a.id.cmp(&b.id)) {
                return ProviderId::new(folder.id);
            }
            match page.next {
                Some(next) => url = self.continuation(&StreamToken::new(next))?,
                None => break,
            }
        }
        // The marker recovers lost create responses. A stable unique name also
        // prevents simultaneous first archives from creating duplicate folders.
        let suffix = self
            .mailbox
            .map(|m| m.link_id.simple().to_string())
            .unwrap_or_else(|| "macro".into());
        let body = json!({"displayName":format!("Macro Archive ({})",&suffix[..suffix.len().min(8)]),"singleValueExtendedProperties":[{"id":ARCHIVE_ROLE_PROPERTY,"value":"archive"}]});
        let folder: wire::Folder = self
            .request(
                token,
                Method::POST,
                self.endpoint(&["me", "mailFolders"])?,
                Some(&body),
            )
            .await?
            .json()
            .await
            .map_err(|_| invalid_response())?;
        ProviderId::new(folder.id)
    }
}

impl MailboxContentReader for OutlookApiClientRepository {
    async fn organization(
        &self,
        token: &AccessToken,
        link_id: Uuid,
        id: &ProviderId,
        folders: &[MailFolder],
    ) -> Result<Option<crate::domain::models::MailboxOrganization>, EmailApiError> {
        let mut url = self.endpoint(&["me", "messages", id.as_str()])?;
        url.query_pairs_mut().append_pair("$select","id,conversationId,parentFolderId,changeKey,isRead,isDraft,flag,categories,inferenceClassification")
            .append_pair("$expand","singleValueExtendedProperties($filter=id eq 'Integer 0x0E07')");
        match self.get::<wire::Message>(token, url).await {
            Ok(message) => Ok(Some(
                normalize(message, Vec::new(), link_id, folders)?.into(),
            )),
            Err(EmailApiError::NotFound) => Ok(None),
            Err(error) => Err(error),
        }
    }
    async fn folders(&self, token: &AccessToken) -> Result<Vec<MailFolder>, EmailApiError> {
        let mut roles = Vec::new();
        for (name, role) in [
            ("inbox", FolderRole::Inbox),
            ("sentitems", FolderRole::Sent),
            ("drafts", FolderRole::Drafts),
            ("archive", FolderRole::Archive),
            ("deleteditems", FolderRole::Trash),
            ("junkemail", FolderRole::Junk),
        ] {
            let folder: wire::Folder = match self
                .get(token, self.endpoint(&["me", "mailFolders", name])?)
                .await
            {
                Ok(folder) => folder,
                // Archive may not exist before the user's first archive action.
                Err(EmailApiError::NotFound) if role == FolderRole::Archive => continue,
                Err(error) => return Err(error),
            };
            roles.push((folder.id, role));
        }
        let mut result = Vec::new();
        let mut pending = vec![self.endpoint(&["me", "mailFolders"])?];
        let mut visited = std::collections::HashSet::new();
        let mut visited_pages = std::collections::HashSet::new();
        while let Some(mut url) = pending.pop() {
            url.query_pairs_mut()
                .append_pair("$top", "100")
                .append_pair(
                    "$expand",
                    &format!(
                        "singleValueExtendedProperties($filter=id eq '{ARCHIVE_ROLE_PROPERTY}')"
                    ),
                );
            loop {
                if !visited_pages.insert(url.as_str().to_owned()) {
                    return Err(invalid_response());
                }
                let page: wire::Page<wire::Folder> = self.get(token, url).await?;
                for folder in page.value {
                    if !visited.insert(folder.id.clone()) {
                        continue;
                    }
                    if folder.child_folder_count > 0 {
                        pending.push(self.endpoint(&[
                            "me",
                            "mailFolders",
                            &folder.id,
                            "childFolders",
                        ])?);
                    }
                    let role = roles
                        .iter()
                        .find(|(id, _)| id == &folder.id)
                        .map(|(_, role)| *role)
                        .unwrap_or_else(|| {
                            if folder.single_value_extended_properties.iter().any(|p| {
                                p["id"] == ARCHIVE_ROLE_PROPERTY && p["value"] == "archive"
                            }) {
                                FolderRole::Archive
                            } else {
                                FolderRole::Other
                            }
                        });
                    result.push(MailFolder {
                        id: ProviderId::new(folder.id)?,
                        parent_id: folder.parent_folder_id.map(ProviderId::new).transpose()?,
                        name: folder.display_name,
                        role,
                        has_children: folder.child_folder_count > 0,
                    });
                }
                match page.next {
                    Some(next) => url = self.continuation(&StreamToken::new(next))?,
                    None => break,
                }
            }
        }
        Ok(result)
    }

    async fn message(
        &self,
        token: &AccessToken,
        link_id: Uuid,
        id: &ProviderId,
        folders: &[MailFolder],
    ) -> Result<Option<MailboxMessage>, EmailApiError> {
        let mut url = self.endpoint(&["me", "messages", id.as_str()])?;
        url.query_pairs_mut().append_pair("$select", MESSAGE_FIELDS);
        url.query_pairs_mut().append_pair(
            "$expand",
            &format!(
                "singleValueExtendedProperties($filter=id eq 'Integer 0x0E07' or id eq '{}')",
                super::drafts::CORRELATION_PROPERTY
            ),
        );
        let message: wire::Message = match self.get(token, url).await {
            Ok(message) => message,
            Err(EmailApiError::NotFound) => return Ok(None),
            Err(error) => return Err(error),
        };
        let mut attachments = Vec::new();
        let mut url = self.endpoint(&["me", "messages", id.as_str(), "attachments"])?;
        // hasAttachments excludes inline attachments, so always enumerate metadata.
        url.query_pairs_mut().append_pair(
            "$select",
            "id,name,contentType,size,microsoft.graph.fileAttachment/contentId",
        );
        let mut visited_pages = std::collections::HashSet::new();
        loop {
            if !visited_pages.insert(url.as_str().to_owned()) {
                return Err(invalid_response());
            }
            let page: wire::Page<wire::Attachment> = self.get(token, url).await?;
            attachments.extend(page.value.into_iter().map(|a| {
                Attachment {
                    db_id: Uuid::now_v7(),
                    provider_id: Some(a.id),
                    filename: a.name,
                    mime_type: a.content_type,
                    size_bytes: a.size,
                    content_id: a.content_id,
                    data_url: None,
                    reference_url: (a.resource_type.as_deref()
                        == Some("#microsoft.graph.referenceAttachment"))
                    .then(|| reference_url(message.web_link.as_deref())),
                    sfs_id: None,
                }
            }));
            match page.next {
                Some(next) => url = self.continuation(&StreamToken::new(next))?,
                None => break,
            }
        }
        let has_invitation = message
            .resource_type
            .as_deref()
            .is_some_and(|kind| kind.contains("eventMessage"))
            || attachments.iter().any(|attachment| {
                attachment
                    .mime_type
                    .as_deref()
                    .is_some_and(|mime| mime.eq_ignore_ascii_case("text/calendar"))
            });
        let calendar_parts = if has_invitation {
            self.get_calendar_parts(token, id.as_str()).await?
        } else {
            Vec::new()
        };
        let mut normalized = normalize(message, attachments, link_id, folders)?;
        normalized.content.calendar_parts = calendar_parts;
        Ok(Some(normalized))
    }

    async fn attachment(
        &self,
        token: &AccessToken,
        message_id: &ProviderId,
        attachment_id: &ProviderId,
    ) -> Result<Vec<u8>, EmailApiError> {
        let url = self.endpoint(&[
            "me",
            "messages",
            message_id.as_str(),
            "attachments",
            attachment_id.as_str(),
            "$value",
        ])?;
        self.request(token, Method::GET, url, None)
            .await?
            .bytes()
            .await
            .map(|bytes| bytes.to_vec())
            .map_err(|_| EmailApiError::Transient {
                message: "Microsoft Graph attachment download was interrupted".into(),
            })
    }
}

fn reference_url(web_link: Option<&str>) -> String {
    web_link
        .and_then(|value| reqwest::Url::parse(value).ok())
        .filter(|url| {
            url.scheme() == "https"
                && url.username().is_empty()
                && url.password().is_none()
                && url.port_or_known_default() == Some(443)
                && matches!(
                    url.host_str(),
                    Some("outlook.office.com" | "outlook.office365.com" | "outlook.live.com")
                )
        })
        .map(String::from)
        .unwrap_or_else(|| "https://outlook.office.com/mail/".into())
}

fn contact(recipient: wire::Recipient) -> ContactInfo {
    ContactInfo {
        email: recipient.email_address.address,
        name: recipient.email_address.name,
        photo_url: None,
    }
}

pub(super) fn normalize(
    source: wire::Message,
    attachments: Vec<Attachment>,
    link_id: Uuid,
    folders: &[MailFolder],
) -> Result<MailboxMessage, EmailApiError> {
    ProviderId::new(source.id.clone())?;
    ProviderId::new(source.conversation_id.clone())?;
    let folder_id = source.parent_folder_id.map(ProviderId::new).transpose()?;
    let role = MailFolder::effective_role(folders, folder_id.as_ref());
    let state = MailboxState {
        is_read: source.is_read,
        is_draft: source.is_draft,
        is_flagged: source.flag.flag_status.as_deref() == Some("flagged"),
        in_inbox: role == FolderRole::Inbox,
        in_trash: role == FolderRole::Trash,
        in_junk: role == FolderRole::Junk,
        attention: match source.inference_classification.as_deref() {
            Some("focused") => Attention::Primary,
            Some("other") => Attention::Other,
            _ => Attention::Unknown,
        },
    };
    let (body_text, body_html_sanitized) = match source.body {
        Some(body) if body.content_type.eq_ignore_ascii_case("html") => {
            let sanitized = email_utils::sanitize_email_html(&body.content);
            (
                email_utils::body_parsed::html_to_plaintext(&sanitized),
                Some(sanitized),
            )
        }
        Some(body) => (Some(body.content), None),
        None => (None, None),
    };
    let headers =
        serde_json::to_value(source.internet_message_headers).map_err(|_| invalid_response())?;
    let now = Utc::now();
    let message = Message {
        db_id: Uuid::now_v7(),
        provider_id: Some(source.id),
        thread_db_id: Uuid::now_v7(),
        provider_thread_id: Some(source.conversation_id),
        replying_to_id: None,
        global_id: source.internet_message_id,
        link_id,
        subject: source.subject,
        snippet: source.body_preview,
        provider_history_id: None,
        internal_date_ts: source.received_date_time.or(source.sent_date_time),
        sent_at: source.sent_date_time,
        size_estimate: None,
        is_read: state.is_read,
        is_starred: state.is_flagged,
        // PidTagMessageFlags.mfFromMe survives folder moves. Once ingested,
        // sent provenance is retained independently of current folder membership.
        is_sent: role == FolderRole::Sent
            || (!state.is_draft
                && source
                    .single_value_extended_properties
                    .iter()
                    .any(|property| {
                        property.id.eq_ignore_ascii_case("Integer 0x0E07")
                            && property
                                .value
                                .parse::<u32>()
                                .is_ok_and(|flags| flags & 0x20 != 0)
                    })),
        is_draft: state.is_draft,
        scheduled_send_time: None,
        has_attachments: !attachments.is_empty(),
        from: source.from.map(contact),
        to: source.to_recipients.into_iter().map(contact).collect(),
        cc: source.cc_recipients.into_iter().map(contact).collect(),
        bcc: source.bcc_recipients.into_iter().map(contact).collect(),
        labels: Vec::new(),
        body_text,
        body_html_sanitized,
        body_macro: None,
        attachments,
        attachments_draft: Vec::new(),
        attachments_forwarded: Vec::new(),
        headers_json: Some(headers),
        created_at: source.created_date_time.unwrap_or(now),
        updated_at: source.last_modified_date_time.unwrap_or(now),
    };
    Ok(MailboxMessage {
        draft_correlation: source
            .single_value_extended_properties
            .iter()
            .find(|p| p.id == super::drafts::CORRELATION_PROPERTY)
            .and_then(|p| Uuid::parse_str(&p.value).ok()),
        content: MessageWithCalendarParts {
            message,
            calendar_parts: Vec::new(),
        },
        state,
        folder_id,
        tags: source.categories,
        version: source.etag,
    })
}

impl MailboxActionWriter for OutlookApiClientRepository {
    async fn apply_message_action(
        &self,
        token: &AccessToken,
        message: &ProviderId,
        action: &MessageAction,
        expected_version: Option<&str>,
    ) -> Result<MessageWriteReceipt, EmailApiError> {
        if matches!(action, MessageAction::SetTags(_)) && expected_version.is_none() {
            return Err(EmailApiError::Conflict);
        }
        let (method, url, body) = match action {
            MessageAction::SetRead(value) => (
                Method::PATCH,
                self.endpoint(&["me", "messages", message.as_str()])?,
                json!({"isRead":value}),
            ),
            MessageAction::SetFlagged(value) => (
                Method::PATCH,
                self.endpoint(&["me", "messages", message.as_str()])?,
                json!({"flag":{"flagStatus":if *value {"flagged"} else {"notFlagged"}}}),
            ),
            MessageAction::SetTags(tags) => (
                Method::PATCH,
                self.endpoint(&["me", "messages", message.as_str()])?,
                json!({"categories":tags}),
            ),
            MessageAction::Archive => (
                Method::POST,
                self.endpoint(&["me", "messages", message.as_str(), "move"])?,
                json!({"destinationId":self.archive_destination(token).await?.as_str()}),
            ),
            MessageAction::MoveToFolder(folder) => (
                Method::POST,
                self.endpoint(&["me", "messages", message.as_str(), "move"])?,
                json!({"destinationId":folder.as_str()}),
            ),
        };
        let conditional_patch = method == Method::PATCH && expected_version.is_some();
        let result: serde_json::Value = self
            .conditional_request(token, method, url, Some(&body), expected_version)
            .await?
            .json()
            .await
            .map_err(|_| EmailApiError::Transient {
                message: "Microsoft Graph write response was interrupted".into(),
            })?;
        Ok(MessageWriteReceipt {
            id: ProviderId::new(
                result
                    .get("id")
                    .and_then(serde_json::Value::as_str)
                    .ok_or_else(invalid_response)?,
            )?,
            // Move actions do not document conditional-write support. Their
            // response cannot prove an unchanged draft baseline.
            version: conditional_patch
                .then(|| result["@odata.etag"].as_str().map(str::to_owned))
                .flatten(),
        })
    }

    async fn submit_draft(
        &self,
        token: &AccessToken,
        draft: &ProviderId,
    ) -> Result<SubmissionOutcome, EmailApiError> {
        let result = self
            .request(
                token,
                Method::POST,
                self.endpoint(&["me", "messages", draft.as_str(), "send"])?,
                None,
            )
            .await;
        match result {
            Ok(_) => Ok(SubmissionOutcome::Accepted),
            // A 5xx or lost response after a write might follow a committed send.
            Err(EmailApiError::Transient { .. }) => Ok(SubmissionOutcome::Unknown),
            Err(error) => Err(error),
        }
    }
}
