use async_graphql::{Context, ID, Object, dataloader::DataLoader};
use email::domain::models::{
    ContactInfo, LabelListVisibility, LabelType, MessageListVisibility, ParsedLabel,
};
use entity_access::domain::models::AccessLevel;

use crate::loaders::{EmailContentKey, EmailContentLoad, EmailContentLoader, LoadedEmailContent};

/// A lightweight email message suitable for Soup list preloading.
pub struct GraphqlSoupEmailMessage(LoadedEmailContent);

#[Object]
impl GraphqlSoupEmailMessage {
    async fn id(&self) -> ID {
        ID(self.0.message.db_id.to_string())
    }

    async fn thread_id(&self) -> ID {
        ID(self.0.message.thread_db_id.to_string())
    }

    async fn link_id(&self) -> ID {
        ID(self.0.message.link_id.to_string())
    }

    async fn access_level(&self) -> &'static str {
        match self.0.access_level {
            AccessLevel::View => "view",
            AccessLevel::Comment => "comment",
            AccessLevel::Edit => "edit",
            AccessLevel::Owner => "owner",
        }
    }

    async fn subject(&self) -> Option<&str> {
        self.0.message.subject.as_deref()
    }

    async fn snippet(&self) -> Option<&str> {
        self.0.message.snippet.as_deref()
    }

    async fn internal_date_ts(&self) -> Option<String> {
        self.0
            .message
            .internal_date_ts
            .map(|value| value.to_rfc3339())
    }

    async fn sent_at(&self) -> Option<String> {
        self.0.message.sent_at.map(|value| value.to_rfc3339())
    }

    async fn is_read(&self) -> bool {
        self.0.message.is_read
    }

    async fn is_starred(&self) -> bool {
        self.0.message.is_starred
    }

    async fn is_sent(&self) -> bool {
        self.0.message.is_sent
    }

    async fn has_attachments(&self) -> bool {
        self.0.message.has_attachments
    }

    async fn from(&self) -> Option<GraphqlSoupEmailContact> {
        self.0.message.from.clone().map(GraphqlSoupEmailContact)
    }

    async fn to(&self) -> Vec<GraphqlSoupEmailContact> {
        self.0
            .message
            .to
            .iter()
            .cloned()
            .map(GraphqlSoupEmailContact)
            .collect()
    }

    async fn cc(&self) -> Vec<GraphqlSoupEmailContact> {
        self.0
            .message
            .cc
            .iter()
            .cloned()
            .map(GraphqlSoupEmailContact)
            .collect()
    }

    async fn bcc(&self) -> Vec<GraphqlSoupEmailContact> {
        self.0
            .message
            .bcc
            .iter()
            .cloned()
            .map(GraphqlSoupEmailContact)
            .collect()
    }

    async fn labels(&self) -> Vec<GraphqlSoupEmailMessageLabel> {
        self.0
            .message
            .labels
            .iter()
            .cloned()
            .map(GraphqlSoupEmailMessageLabel)
            .collect()
    }

    async fn body_parsed(&self) -> Option<&str> {
        self.0.message.body_parsed.as_deref()
    }

    async fn body_text(&self) -> Option<&str> {
        self.0.message.body_text.as_deref()
    }

    async fn body_html_sanitized(&self) -> Option<&str> {
        self.0.message.body_html_sanitized.as_deref()
    }

    async fn body_macro(&self) -> Option<&str> {
        self.0.message.body_macro.as_deref()
    }

    async fn body_replyless(&self) -> Option<&str> {
        self.0.message.body_replyless.as_deref()
    }

    async fn created_at(&self) -> String {
        self.0.message.created_at.to_rfc3339()
    }

    async fn updated_at(&self) -> String {
        self.0.message.updated_at.to_rfc3339()
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
    async fn id(&self) -> Option<ID> {
        self.0.id.map(|id| ID(id.to_string()))
    }

    async fn link_id(&self) -> ID {
        ID(self.0.link_id.to_string())
    }

    async fn provider_label_id(&self) -> &str {
        &self.0.provider_id
    }

    async fn name(&self) -> &str {
        &self.0.name
    }

    async fn created_at(&self) -> String {
        self.0.created_at.to_rfc3339()
    }

    async fn message_list_visibility(&self) -> Option<&'static str> {
        self.0
            .message_list_visibility
            .map(|visibility| match visibility {
                MessageListVisibility::Show => "Show",
                MessageListVisibility::Hide => "Hide",
            })
    }

    async fn label_list_visibility(&self) -> Option<&'static str> {
        self.0
            .label_list_visibility
            .map(|visibility| match visibility {
                LabelListVisibility::LabelShow => "LabelShow",
                LabelListVisibility::LabelShowIfUnread => "LabelShowIfUnread",
                LabelListVisibility::LabelHide => "LabelHide",
            })
    }

    async fn r#type(&self) -> Option<&'static str> {
        self.0.type_.map(|label_type| match label_type {
            LabelType::System => "System",
            LabelType::User => "User",
        })
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
        Some(EmailContentLoad::Found(content)) => Some(GraphqlSoupEmailMessage(*content)),
        Some(EmailContentLoad::Missing | EmailContentLoad::Failed) | None => None,
    })
}
