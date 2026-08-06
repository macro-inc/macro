use async_graphql::{Context, ID, Object, SimpleObject, dataloader::DataLoader};
use email::domain::models::{
    AttachmentDraft, AttachmentForwarded, ContactInfo, Message, MessageAttachment, ParsedLabel,
    ParsedMessage,
};

use crate::loaders::{
    EmailContentKey, EmailContentLoad, EmailContentLoader, EmailContentMessage,
    SoupEmailContentEdgeReader,
};

const FULL_MESSAGE_FIELDS: &[&str] = &[
    "providerId",
    "replyingToId",
    "scheduledSendTime",
    "attachments",
    "attachmentsDraft",
    "attachmentsForwarded",
];

/// Whether the selected message fields require fully hydrated email messages.
pub fn email_message_selection_requires_full_payload(ctx: &Context<'_>) -> bool {
    let lookahead = ctx.look_ahead();
    FULL_MESSAGE_FIELDS
        .iter()
        .any(|field| lookahead.field(field).exists())
}

/// An adaptively hydrated email content projection for Soup queries.
pub struct GraphqlSoupEmailMessage(EmailContentMessage);

impl GraphqlSoupEmailMessage {
    fn parsed(&self) -> &ParsedMessage {
        self.0.parsed()
    }

    fn full(&self) -> async_graphql::Result<&Message> {
        self.0.full().ok_or_else(|| {
            async_graphql::Error::new("requested email message fields were not hydrated")
        })
    }
}

/// An adaptively hydrated email content projection for Soup queries.
#[Object]
impl GraphqlSoupEmailMessage {
    /// The unique message identifier.
    async fn id(&self) -> ID {
        ID(self.parsed().db_id.to_string())
    }

    /// The identifier assigned by the email provider.
    async fn provider_id(&self) -> async_graphql::Result<Option<&str>> {
        Ok(self.full()?.provider_id.as_deref())
    }

    /// The identifier of the containing thread.
    async fn thread_id(&self) -> ID {
        ID(self.parsed().thread_db_id.to_string())
    }

    /// The identifier of the message this message replies to.
    async fn replying_to_id(&self) -> async_graphql::Result<Option<ID>> {
        Ok(self
            .full()?
            .replying_to_id
            .map(|value| ID(value.to_string())))
    }

    /// The identifier of the linked email account.
    async fn link_id(&self) -> ID {
        ID(self.parsed().link_id.to_string())
    }

    /// The message subject.
    async fn subject(&self) -> Option<&str> {
        self.parsed().subject.as_deref()
    }

    /// A short preview of the message content.
    async fn snippet(&self) -> Option<&str> {
        self.parsed().snippet.as_deref()
    }

    /// The provider's internal timestamp in RFC 3339 format.
    async fn internal_date_ts(&self) -> Option<String> {
        self.parsed()
            .internal_date_ts
            .map(|value| value.to_rfc3339())
    }

    /// The sent timestamp in RFC 3339 format.
    async fn sent_at(&self) -> Option<String> {
        self.parsed().sent_at.map(|value| value.to_rfc3339())
    }

    /// Whether the message has been read.
    async fn is_read(&self) -> bool {
        self.parsed().is_read
    }

    /// Whether the message is starred.
    async fn is_starred(&self) -> bool {
        self.parsed().is_starred
    }

    /// Whether the message was sent by the linked account.
    async fn is_sent(&self) -> bool {
        self.parsed().is_sent
    }

    /// Whether the message is a draft.
    async fn is_draft(&self) -> bool {
        self.parsed().is_draft
    }

    /// Whether the message has attachments.
    async fn has_attachments(&self) -> bool {
        self.parsed().has_attachments
    }

    /// When this draft is scheduled to be sent, in RFC 3339 format.
    async fn scheduled_send_time(&self) -> async_graphql::Result<Option<String>> {
        Ok(self
            .full()?
            .scheduled_send_time
            .map(|value| value.to_rfc3339()))
    }

    /// The sender of the message.
    async fn from(&self) -> Option<GraphqlSoupEmailContact> {
        self.parsed().from.clone().map(GraphqlSoupEmailContact)
    }

    /// The primary recipients of the message.
    async fn to(&self) -> Vec<GraphqlSoupEmailContact> {
        self.parsed()
            .to
            .iter()
            .cloned()
            .map(GraphqlSoupEmailContact)
            .collect()
    }

    /// The carbon-copy recipients of the message.
    async fn cc(&self) -> Vec<GraphqlSoupEmailContact> {
        self.parsed()
            .cc
            .iter()
            .cloned()
            .map(GraphqlSoupEmailContact)
            .collect()
    }

    /// The blind-carbon-copy recipients of the message.
    async fn bcc(&self) -> Vec<GraphqlSoupEmailContact> {
        self.parsed()
            .bcc
            .iter()
            .cloned()
            .map(GraphqlSoupEmailContact)
            .collect()
    }

    /// Labels assigned to the message.
    async fn labels(&self) -> Vec<GraphqlSoupEmailMessageLabel> {
        self.parsed()
            .labels
            .iter()
            .cloned()
            .map(GraphqlSoupEmailMessageLabel)
            .collect()
    }

    /// The parsed message body.
    async fn body_parsed(&self) -> Option<&str> {
        self.parsed().body_parsed.as_deref()
    }

    /// The plain-text message body.
    async fn body_text(&self) -> Option<&str> {
        self.parsed().body_text.as_deref()
    }

    /// The sanitized HTML message body.
    async fn body_html_sanitized(&self) -> Option<&str> {
        self.parsed().body_html_sanitized.as_deref()
    }

    /// The message body in Macro's rich-text format.
    async fn body_macro(&self) -> Option<&str> {
        self.parsed().body_macro.as_deref()
    }

    /// The message body with quoted replies removed.
    async fn body_replyless(&self) -> Option<&str> {
        self.parsed().body_replyless.as_deref()
    }

    /// Provider-hosted attachments on the message.
    async fn attachments(&self) -> async_graphql::Result<Vec<GraphqlSoupEmailMessageAttachment>> {
        Ok(self
            .full()?
            .attachments
            .iter()
            .map(GraphqlSoupEmailMessageAttachment::new)
            .collect())
    }

    /// Uploaded attachments belonging to a draft message.
    async fn attachments_draft(
        &self,
    ) -> async_graphql::Result<Vec<GraphqlSoupEmailDraftAttachment>> {
        Ok(self
            .full()?
            .attachments_draft
            .iter()
            .map(GraphqlSoupEmailDraftAttachment::new)
            .collect())
    }

    /// Forwarded provider attachments belonging to a draft message.
    async fn attachments_forwarded(
        &self,
    ) -> async_graphql::Result<Vec<GraphqlSoupEmailForwardedAttachment>> {
        Ok(self
            .full()?
            .attachments_forwarded
            .iter()
            .map(GraphqlSoupEmailForwardedAttachment::new)
            .collect())
    }

    /// The creation timestamp in RFC 3339 format.
    async fn created_at(&self) -> String {
        self.parsed().created_at.to_rfc3339()
    }

    /// The last-updated timestamp in RFC 3339 format.
    async fn updated_at(&self) -> String {
        self.parsed().updated_at.to_rfc3339()
    }
}

/// A provider-hosted attachment embedded in an email message.
#[derive(SimpleObject)]
pub struct GraphqlSoupEmailMessageAttachment {
    /// The attachment's canonical database identifier.
    id: ID,
    /// The attachment identifier assigned by the email provider.
    provider_id: Option<String>,
    /// The original filename.
    filename: Option<String>,
    /// The MIME type.
    mime_type: Option<String>,
    /// The attachment size in bytes.
    size_bytes: Option<i64>,
    /// The corresponding static-file-service identifier, when uploaded.
    sfs_id: Option<ID>,
    /// The content identifier used by inline attachments.
    content_id: Option<String>,
}

impl GraphqlSoupEmailMessageAttachment {
    fn new(value: &MessageAttachment) -> Self {
        Self {
            id: ID(value.db_id.to_string()),
            provider_id: value.provider_id.clone(),
            filename: value.filename.clone(),
            mime_type: value.mime_type.clone(),
            size_bytes: value.size_bytes,
            sfs_id: value.sfs_id.map(|id| ID(id.to_string())),
            content_id: value.content_id.clone(),
        }
    }
}

/// An uploaded attachment embedded in a draft email message.
#[derive(SimpleObject)]
pub struct GraphqlSoupEmailDraftAttachment {
    /// The attachment's canonical identifier.
    id: ID,
    /// The draft message identifier.
    draft_id: ID,
    /// The original filename.
    file_name: String,
    /// The MIME type.
    content_type: String,
    /// The SHA-256 content digest.
    sha: String,
    /// The attachment size in bytes.
    size: i32,
    /// The storage key containing the uploaded attachment.
    s3_key: String,
}

impl GraphqlSoupEmailDraftAttachment {
    fn new(value: &AttachmentDraft) -> Self {
        Self {
            id: ID(value.id.to_string()),
            draft_id: ID(value.draft_id.to_string()),
            file_name: value.file_name.clone(),
            content_type: value.content_type.clone(),
            sha: value.sha.clone(),
            size: value.size,
            s3_key: value.s3_key.clone(),
        }
    }
}

/// A forwarded provider attachment embedded in a draft email message.
#[derive(SimpleObject)]
pub struct GraphqlSoupEmailForwardedAttachment {
    /// The original attachment identifier.
    attachment_id: ID,
    /// The draft message identifier.
    draft_id: ID,
    /// The attachment identifier assigned by the email provider.
    provider_attachment_id: Option<String>,
    /// The provider identifier of the original message.
    message_provider_id: String,
    /// The original filename.
    filename: Option<String>,
    /// The MIME type.
    mime_type: Option<String>,
    /// The attachment size in bytes.
    size_bytes: Option<i64>,
}

impl GraphqlSoupEmailForwardedAttachment {
    fn new(value: &AttachmentForwarded) -> Self {
        Self {
            attachment_id: ID(value.attachment_id.to_string()),
            draft_id: ID(value.draft_id.to_string()),
            provider_attachment_id: value.provider_attachment_id.clone(),
            message_provider_id: value.message_provider_id.clone(),
            filename: value.filename.clone(),
            mime_type: value.mime_type.clone(),
            size_bytes: value.size_bytes,
        }
    }
}

/// An email sender or recipient embedded in a message.
pub struct GraphqlSoupEmailContact(ContactInfo);

/// An email sender or recipient embedded in a message.
#[Object]
impl GraphqlSoupEmailContact {
    /// The contact's email address.
    async fn email(&self) -> &str {
        &self.0.email
    }

    /// The contact's display name.
    async fn name(&self) -> Option<&str> {
        self.0.name.as_deref()
    }

    /// The contact's profile photo URL.
    async fn photo_url(&self) -> Option<&str> {
        self.0.photo_url.as_deref()
    }
}

/// A lightweight label embedded in an email message.
pub struct GraphqlSoupEmailMessageLabel(ParsedLabel);

/// A lightweight label embedded in an email message.
#[Object]
impl GraphqlSoupEmailMessageLabel {
    /// The label identifier assigned by the email provider.
    async fn provider_label_id(&self) -> &str {
        &self.0.provider_id
    }

    /// The label name.
    async fn name(&self) -> &str {
        &self.0.name
    }
}

/// Load a paginated adaptively hydrated message page for an email thread.
pub async fn load_email_messages<R>(
    ctx: &Context<'_>,
    key: EmailContentKey,
) -> async_graphql::Result<Vec<GraphqlSoupEmailMessage>>
where
    R: SoupEmailContentEdgeReader,
{
    let loader = ctx.data::<DataLoader<EmailContentLoader<R>>>()?;
    let value = loader.load_one(key).await?;
    Ok(match value {
        Some(EmailContentLoad::Found(messages)) => {
            messages.into_iter().map(GraphqlSoupEmailMessage).collect()
        }
        Some(EmailContentLoad::Missing | EmailContentLoad::Failed) | None => Vec::new(),
    })
}

/// Load the newest non-draft content message for an email thread.
pub async fn load_latest_email_message<R>(
    ctx: &Context<'_>,
    thread_id: uuid::Uuid,
) -> async_graphql::Result<Option<GraphqlSoupEmailMessage>>
where
    R: SoupEmailContentEdgeReader,
{
    let key = if email_message_selection_requires_full_payload(ctx) {
        EmailContentKey::latest_full(thread_id)
    } else {
        EmailContentKey::latest(thread_id)
    };

    Ok(load_email_messages::<R>(ctx, key).await?.into_iter().next())
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use async_graphql::{EmptyMutation, EmptySubscription, Schema};
    use chrono::Utc;
    use macro_user_id::user_id::MacroUserIdStr;
    use uuid::Uuid;

    use super::*;
    use crate::{SoupEmailContentEdgeReader, email_content_loader};

    struct ContentQuery;

    #[Object]
    impl ContentQuery {
        async fn latest_content_message(
            &self,
            ctx: &Context<'_>,
        ) -> async_graphql::Result<Option<GraphqlSoupEmailMessage>> {
            load_latest_email_message::<ContentReader>(ctx, Uuid::from_u128(2)).await
        }

        async fn messages(
            &self,
            ctx: &Context<'_>,
        ) -> async_graphql::Result<Vec<GraphqlSoupEmailMessage>> {
            load_email_messages::<ContentReader>(
                ctx,
                EmailContentKey::page(Uuid::from_u128(2), 3, 2),
            )
            .await
        }
    }

    struct ContentReader;

    impl SoupEmailContentEdgeReader for ContentReader {
        async fn get_email_content(
            &self,
            _user_id: &MacroUserIdStr<'static>,
            keys: Vec<EmailContentKey>,
        ) -> HashMap<EmailContentKey, EmailContentLoad> {
            keys.into_iter()
                .map(|key| {
                    (
                        key,
                        EmailContentLoad::Found(vec![message(key.thread_id).into()]),
                    )
                })
                .collect()
        }
    }

    fn message(thread_id: Uuid) -> ParsedMessage {
        let now = Utc::now();
        ParsedMessage {
            db_id: Uuid::from_u128(1),
            link_id: Uuid::from_u128(3),
            thread_db_id: thread_id,
            subject: Some("Subject".to_owned()),
            snippet: Some("Snippet".to_owned()),
            from: None,
            to: Vec::new(),
            cc: Vec::new(),
            bcc: Vec::new(),
            labels: Vec::new(),
            body_parsed: Some("Hello from the edge".to_owned()),
            body_text: Some("Hello from the edge".to_owned()),
            body_html_sanitized: None,
            body_macro: None,
            body_replyless: Some("Hello from the edge".to_owned()),
            internal_date_ts: Some(now),
            sent_at: Some(now),
            is_read: true,
            is_starred: false,
            is_sent: false,
            is_draft: false,
            has_attachments: false,
            created_at: now,
            updated_at: now,
        }
    }

    #[tokio::test]
    async fn executes_paginated_messages_with_request_scoped_loader() {
        let user_id = MacroUserIdStr::try_from_email("reader@example.com").unwrap();
        let schema = Schema::build(ContentQuery, EmptyMutation, EmptySubscription)
            .data(email_content_loader(user_id, ContentReader))
            .finish();

        let response = schema
            .execute("{ messages { id threadId bodyParsed } }")
            .await;

        assert!(response.errors.is_empty(), "{:?}", response.errors);
        assert_eq!(
            response.data.to_string(),
            r#"{messages: [{id: "00000000-0000-0000-0000-000000000001", threadId: "00000000-0000-0000-0000-000000000002", bodyParsed: "Hello from the edge"}]}"#
        );
    }

    #[tokio::test]
    async fn executes_content_field_with_request_scoped_loader() {
        let user_id = MacroUserIdStr::try_from_email("reader@example.com").unwrap();
        let schema = Schema::build(ContentQuery, EmptyMutation, EmptySubscription)
            .data(email_content_loader(user_id, ContentReader))
            .finish();

        let response = schema
            .execute("{ latestContentMessage { id threadId bodyParsed } }")
            .await;

        assert!(response.errors.is_empty(), "{:?}", response.errors);
        assert_eq!(
            response.data.to_string(),
            r#"{latestContentMessage: {id: "00000000-0000-0000-0000-000000000001", threadId: "00000000-0000-0000-0000-000000000002", bodyParsed: "Hello from the edge"}}"#
        );
    }
}
