use async_graphql::{Context, ID, Object, dataloader::DataLoader};
use email::domain::models::{ContactInfo, ParsedLabel, ParsedMessage};

use crate::loaders::{EmailContentKey, EmailContentLoad, EmailContentLoader};

/// A lightweight email content projection for Soup queries.
pub struct GraphqlSoupEmailMessage(ParsedMessage);

#[Object]
impl GraphqlSoupEmailMessage {
    async fn id(&self) -> ID {
        ID(self.0.db_id.to_string())
    }

    async fn thread_id(&self) -> ID {
        ID(self.0.thread_db_id.to_string())
    }

    async fn link_id(&self) -> ID {
        ID(self.0.link_id.to_string())
    }

    async fn subject(&self) -> Option<&str> {
        self.0.subject.as_deref()
    }

    async fn snippet(&self) -> Option<&str> {
        self.0.snippet.as_deref()
    }

    async fn internal_date_ts(&self) -> Option<String> {
        self.0.internal_date_ts.map(|value| value.to_rfc3339())
    }

    async fn sent_at(&self) -> Option<String> {
        self.0.sent_at.map(|value| value.to_rfc3339())
    }

    async fn is_read(&self) -> bool {
        self.0.is_read
    }

    async fn is_starred(&self) -> bool {
        self.0.is_starred
    }

    async fn is_sent(&self) -> bool {
        self.0.is_sent
    }

    async fn has_attachments(&self) -> bool {
        self.0.has_attachments
    }

    async fn from(&self) -> Option<GraphqlSoupEmailContact> {
        self.0.from.clone().map(GraphqlSoupEmailContact)
    }

    async fn to(&self) -> Vec<GraphqlSoupEmailContact> {
        self.0
            .to
            .iter()
            .cloned()
            .map(GraphqlSoupEmailContact)
            .collect()
    }

    async fn cc(&self) -> Vec<GraphqlSoupEmailContact> {
        self.0
            .cc
            .iter()
            .cloned()
            .map(GraphqlSoupEmailContact)
            .collect()
    }

    async fn bcc(&self) -> Vec<GraphqlSoupEmailContact> {
        self.0
            .bcc
            .iter()
            .cloned()
            .map(GraphqlSoupEmailContact)
            .collect()
    }

    async fn labels(&self) -> Vec<GraphqlSoupEmailMessageLabel> {
        self.0
            .labels
            .iter()
            .cloned()
            .map(GraphqlSoupEmailMessageLabel)
            .collect()
    }

    async fn body_parsed(&self) -> Option<&str> {
        self.0.body_parsed.as_deref()
    }

    async fn body_text(&self) -> Option<&str> {
        self.0.body_text.as_deref()
    }

    async fn body_html_sanitized(&self) -> Option<&str> {
        self.0.body_html_sanitized.as_deref()
    }

    async fn body_macro(&self) -> Option<&str> {
        self.0.body_macro.as_deref()
    }

    async fn body_replyless(&self) -> Option<&str> {
        self.0.body_replyless.as_deref()
    }

    async fn created_at(&self) -> String {
        self.0.created_at.to_rfc3339()
    }

    async fn updated_at(&self) -> String {
        self.0.updated_at.to_rfc3339()
    }
}

/// An email sender or recipient embedded in a message.
pub struct GraphqlSoupEmailContact(ContactInfo);

#[Object]
impl GraphqlSoupEmailContact {
    async fn email(&self) -> &str {
        &self.0.email
    }

    async fn name(&self) -> Option<&str> {
        self.0.name.as_deref()
    }

    async fn photo_url(&self) -> Option<&str> {
        self.0.photo_url.as_deref()
    }
}

/// A lightweight label embedded in an email message.
pub struct GraphqlSoupEmailMessageLabel(ParsedLabel);

#[Object]
impl GraphqlSoupEmailMessageLabel {
    async fn provider_label_id(&self) -> &str {
        &self.0.provider_id
    }

    async fn name(&self) -> &str {
        &self.0.name
    }
}

/// Load the newest non-draft content message for an email thread.
pub async fn load_latest_email_message(
    ctx: &Context<'_>,
    key: EmailContentKey,
) -> async_graphql::Result<Option<GraphqlSoupEmailMessage>> {
    let loader = ctx.data::<DataLoader<EmailContentLoader>>()?;
    let value = loader.load_one(key).await?;
    Ok(match value {
        Some(EmailContentLoad::Found(message)) => Some(GraphqlSoupEmailMessage(*message)),
        Some(EmailContentLoad::Missing | EmailContentLoad::Failed) | None => None,
    })
}

#[cfg(test)]
mod tests {
    use std::{collections::HashMap, sync::Arc};

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
            load_latest_email_message(
                ctx,
                EmailContentKey {
                    thread_id: Uuid::from_u128(2).to_string(),
                },
            )
            .await
        }
    }

    struct ContentReader;

    #[async_trait::async_trait]
    impl SoupEmailContentEdgeReader for ContentReader {
        async fn get_email_content(
            &self,
            _user_id: &MacroUserIdStr<'static>,
            keys: Vec<EmailContentKey>,
        ) -> HashMap<EmailContentKey, EmailContentLoad> {
            keys.into_iter()
                .map(|key| {
                    let thread_id = Uuid::parse_str(&key.thread_id).unwrap();
                    (key, EmailContentLoad::Found(Box::new(message(thread_id))))
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
        let reader: Arc<dyn SoupEmailContentEdgeReader> = Arc::new(ContentReader);
        let schema = Schema::build(ContentQuery, EmptyMutation, EmptySubscription)
            .data(email_content_loader(user_id, reader))
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
