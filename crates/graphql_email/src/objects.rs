use async_graphql::{Context, ID, Object, dataloader::DataLoader};
use email::domain::models::{ContactInfo, ParsedLabel, ParsedMessage};

use crate::loaders::{
    EmailContentKey, EmailContentLoad, EmailContentLoader, SoupEmailContentEdgeReader,
};

/// A lightweight email content projection for Soup queries.
pub struct GraphqlSoupEmailMessage(ParsedMessage);

/// A lightweight email content projection for Soup queries.
#[Object]
impl GraphqlSoupEmailMessage {
    /// The unique message identifier.
    async fn id(&self) -> ID {
        ID(self.0.db_id.to_string())
    }

    /// The identifier of the containing thread.
    async fn thread_id(&self) -> ID {
        ID(self.0.thread_db_id.to_string())
    }

    /// The identifier of the linked email account.
    async fn link_id(&self) -> ID {
        ID(self.0.link_id.to_string())
    }

    /// The message subject.
    async fn subject(&self) -> Option<&str> {
        self.0.subject.as_deref()
    }

    /// A short preview of the message content.
    async fn snippet(&self) -> Option<&str> {
        self.0.snippet.as_deref()
    }

    /// The provider's internal timestamp in RFC 3339 format.
    async fn internal_date_ts(&self) -> Option<String> {
        self.0.internal_date_ts.map(|value| value.to_rfc3339())
    }

    /// The sent timestamp in RFC 3339 format.
    async fn sent_at(&self) -> Option<String> {
        self.0.sent_at.map(|value| value.to_rfc3339())
    }

    /// Whether the message has been read.
    async fn is_read(&self) -> bool {
        self.0.is_read
    }

    /// Whether the message is starred.
    async fn is_starred(&self) -> bool {
        self.0.is_starred
    }

    /// Whether the message was sent by the linked account.
    async fn is_sent(&self) -> bool {
        self.0.is_sent
    }

    /// Whether the message has attachments.
    async fn has_attachments(&self) -> bool {
        self.0.has_attachments
    }

    /// The sender of the message.
    async fn from(&self) -> Option<GraphqlSoupEmailContact> {
        self.0.from.clone().map(GraphqlSoupEmailContact)
    }

    /// The primary recipients of the message.
    async fn to(&self) -> Vec<GraphqlSoupEmailContact> {
        self.0
            .to
            .iter()
            .cloned()
            .map(GraphqlSoupEmailContact)
            .collect()
    }

    /// The carbon-copy recipients of the message.
    async fn cc(&self) -> Vec<GraphqlSoupEmailContact> {
        self.0
            .cc
            .iter()
            .cloned()
            .map(GraphqlSoupEmailContact)
            .collect()
    }

    /// The blind-carbon-copy recipients of the message.
    async fn bcc(&self) -> Vec<GraphqlSoupEmailContact> {
        self.0
            .bcc
            .iter()
            .cloned()
            .map(GraphqlSoupEmailContact)
            .collect()
    }

    /// Labels assigned to the message.
    async fn labels(&self) -> Vec<GraphqlSoupEmailMessageLabel> {
        self.0
            .labels
            .iter()
            .cloned()
            .map(GraphqlSoupEmailMessageLabel)
            .collect()
    }

    /// The parsed message body.
    async fn body_parsed(&self) -> Option<&str> {
        self.0.body_parsed.as_deref()
    }

    /// The plain-text message body.
    async fn body_text(&self) -> Option<&str> {
        self.0.body_text.as_deref()
    }

    /// The sanitized HTML message body.
    async fn body_html_sanitized(&self) -> Option<&str> {
        self.0.body_html_sanitized.as_deref()
    }

    /// The message body in Macro's rich-text format.
    async fn body_macro(&self) -> Option<&str> {
        self.0.body_macro.as_deref()
    }

    /// The message body with quoted replies removed.
    async fn body_replyless(&self) -> Option<&str> {
        self.0.body_replyless.as_deref()
    }

    /// The creation timestamp in RFC 3339 format.
    async fn created_at(&self) -> String {
        self.0.created_at.to_rfc3339()
    }

    /// The last-updated timestamp in RFC 3339 format.
    async fn updated_at(&self) -> String {
        self.0.updated_at.to_rfc3339()
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

/// Load the newest non-draft content message for an email thread.
pub async fn load_latest_email_message<R>(
    ctx: &Context<'_>,
    key: EmailContentKey,
) -> async_graphql::Result<Option<GraphqlSoupEmailMessage>>
where
    R: SoupEmailContentEdgeReader,
{
    let loader = ctx.data::<DataLoader<EmailContentLoader<R>>>()?;
    let value = loader.load_one(key).await?;
    Ok(match value {
        Some(EmailContentLoad::Found(message)) => Some(GraphqlSoupEmailMessage(*message)),
        Some(EmailContentLoad::Missing | EmailContentLoad::Failed) | None => None,
    })
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
            load_latest_email_message::<ContentReader>(
                ctx,
                EmailContentKey {
                    thread_id: Uuid::from_u128(2),
                },
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
                        EmailContentLoad::Found(Box::new(message(key.thread_id))),
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
