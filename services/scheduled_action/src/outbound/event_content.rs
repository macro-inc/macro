//! Read a triggering event's content through each owning domain, as the
//! routine owner, and describe it as JSON for the condition classifier.
//!
//! Every read uses the run's access receipt or an id it covers. Nothing here
//! is logged: the content is the user's, and only the classifier sees it.

use channels::domain::{models::ChannelType, ports::ChannelService};
use documents::domain::ports::DocumentRepo;
use email::domain::{
    models::{ContactInfo, ParsedMessage},
    ports::EmailContentService,
};
use entity_access::domain::models::{EntityAccessReceipt, ViewAccessLevel, ViewOnly};
use lexical_client::{LexicalClient, parse_markdown::MarkdownTarget};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use mention_utils::parse::{ParsedXmlText, PlainTextFormatter, XmlFormatter};
use messages::domain::{
    api::MessageReader, models::Message, ports::MessageError, service::MessageView,
};
use model::document::DocumentBasic;
use models_properties::service::{
    property_option::PropertyOptionValue, property_value::PropertyValue,
};
use properties::{EntityPropertyInfo, PropertiesService};
use rootcause::{Report, compat::IntoRootcause};
use serde_json::{Map, Value, json};

use crate::domain::{
    event_runs::{AuthorizedEventRun, EventAccessCapability, condition::EventContentReader},
    event_trigger::{EventName, EventReference},
};

#[cfg(test)]
mod test;

/// Longest text passed on per field, in characters. Jev reads up to 32k
/// tokens of state; a few fields at this size stay well inside it.
const MAX_TEXT_CHARS: usize = 8_000;
/// Messages per thread page searched for the triggering email, newest first.
const EMAIL_PAGE: i64 = 20;
const MARKDOWN_FILE_TYPE: &str = "md";

pub struct EventContentAdapter<E, M, C, D, P> {
    email: E,
    messages: M,
    channels: C,
    documents: D,
    properties: P,
    markdown: LexicalClient,
}

impl<E, M, C, D, P> EventContentAdapter<E, M, C, D, P> {
    pub fn new(
        email: E,
        messages: M,
        channels: C,
        documents: D,
        properties: P,
        markdown: LexicalClient,
    ) -> Self {
        Self {
            email,
            messages,
            channels,
            documents,
            properties,
            markdown,
        }
    }
}

impl<E, M, C, D, P> EventContentReader for EventContentAdapter<E, M, C, D, P>
where
    E: EmailContentService,
    M: MessageReader,
    C: ChannelService,
    D: DocumentRepo,
    P: PropertiesService,
{
    async fn read(
        &self,
        owner: &MacroUserIdStr<'static>,
        run: &AuthorizedEventRun,
    ) -> Result<Value, Report> {
        let event = &run.pending.event;
        let content = match &run.access {
            EventAccessCapability::EmailThread(receipt) => {
                json!({ "email": self.email(receipt.clone(), event).await? })
            }
            EventAccessCapability::Channel(receipt) => {
                self.channel(owner, receipt.clone(), event).await?
            }
            EventAccessCapability::Document(receipt) => {
                json!({ "item": self.document(receipt, event).await? })
            }
        };
        Ok(envelope(owner, event, content))
    }
}

impl<E, M, C, D, P> EventContentAdapter<E, M, C, D, P>
where
    E: EmailContentService,
    M: MessageReader,
    C: ChannelService,
    D: DocumentRepo,
    P: PropertiesService,
{
    async fn email(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
        event: &EventReference,
    ) -> Result<Value, Report> {
        let messages = self
            .email
            .get_messages_parsed(receipt, 0, EMAIL_PAGE)
            .await
            .map_err(|error| Report::new(error).into_dynamic())?
            .unwrap_or_default();
        Ok(messages
            .iter()
            .find(|message| Some(message.db_id) == event.message_id())
            .map_or_else(
                || unavailable("the email is no longer available"),
                email_json,
            ))
    }

    async fn channel(
        &self,
        owner: &MacroUserIdStr<'static>,
        receipt: EntityAccessReceipt<ViewOnly>,
        event: &EventReference,
    ) -> Result<Value, Report> {
        let channel = self
            .channels
            .get_channel_metadata(event.entity_id(), owner.clone())
            .await
            .map_err(|error| Report::new(error).into_dynamic())?;
        let mut content = json!({
            "channel": {
                "name": channel.channel_name,
                "type": channel_type(channel.channel_type),
            }
        });
        let Some(message_id) = event.message_id() else {
            return Ok(content);
        };
        let access = receipt
            .try_into_requirement::<MessageView>()
            .map_err(|error| Report::new(error).into_dynamic())?;
        let Some(message) = self.message(access.clone(), message_id).await? else {
            content["message"] = unavailable("the message is no longer available");
            return Ok(content);
        };
        if let Some(root) = message.thread_id.filter(|root| *root != message.id)
            && let Some(parent) = self.message(access, root).await?
        {
            content["thread_parent"] = message_json(&parent);
        }
        content["message"] = message_json(&message);
        Ok(content)
    }

    /// None when the message, or the thread it was in, has been deleted.
    async fn message(
        &self,
        access: EntityAccessReceipt<MessageView>,
        id: Uuid,
    ) -> Result<Option<Message>, Report> {
        match self.messages.get(access, id).await {
            Ok(message) if message.deleted_at.is_none() => Ok(Some(message)),
            Ok(_) | Err(MessageError::NotFound) => Ok(None),
            Err(error) => Err(Report::new(error).into_dynamic()),
        }
    }

    async fn document(
        &self,
        receipt: &EntityAccessReceipt<ViewAccessLevel>,
        event: &EventReference,
    ) -> Result<Value, Report> {
        let id = event.entity_id().to_string();
        let document = self
            .documents
            .get_basic_document(&id)
            .await
            .map_err(|error| Into::<anyhow::Error>::into(error).into_rootcause())?;
        if document.deleted_at.is_some() || event.event_name() == EventName::DocumentDeleted {
            return Ok(document_json(&document, &[], None));
        }
        let properties = self
            .properties
            .get_entity_properties(receipt)
            .await
            .map_err(|error| Report::new(error).into_dynamic())?;
        // Lexical renders only Macro's own documents; tasks are among them.
        // The body is an excerpt: without it, the name and properties remain.
        let markdown = if document.file_type.as_deref() == Some(MARKDOWN_FILE_TYPE) {
            self.markdown
                .get_markdown(&id, MarkdownTarget::External)
                .await
                .inspect_err(|error| {
                    tracing::warn!(error = ?error, "document body unavailable for condition");
                })
                .ok()
        } else {
            None
        };
        Ok(document_json(&document, &properties, markdown.as_deref()))
    }
}

/// What every condition can rely on: what happened, when, and to whom.
fn envelope(owner: &MacroUserIdStr<'static>, event: &EventReference, content: Value) -> Value {
    let mut value = json!({
        "event": event.event_name().as_str(),
        "occurred_at": event.published_at(),
        "routine_owner": owner.email_str(),
    });
    if let (Value::Object(target), Value::Object(content)) = (&mut value, content) {
        target.extend(content);
    }
    value
}

fn unavailable(note: &str) -> Value {
    json!({ "unavailable": note })
}

fn truncate(text: &str) -> String {
    match text.char_indices().nth(MAX_TEXT_CHARS) {
        Some((end, _)) => format!("{}…", &text[..end]),
        None => text.to_owned(),
    }
}

fn contact(contact: &ContactInfo) -> Value {
    json!({ "name": contact.name, "email": contact.email })
}

fn email_json(message: &ParsedMessage) -> Value {
    let body = message
        .body_parsed
        .as_deref()
        .or(message.body_text.as_deref())
        .or(message.snippet.as_deref())
        .map(truncate);
    json!({
        "subject": message.subject,
        "from": message.from.as_ref().map(contact),
        "to": message.to.iter().map(contact).collect::<Vec<_>>(),
        "cc": message.cc.iter().map(contact).collect::<Vec<_>>(),
        "received_at": message.internal_date_ts.or(message.sent_at),
        "labels": message.labels.iter().map(|label| &label.name).collect::<Vec<_>>(),
        "has_attachments": message.has_attachments,
        "body": body,
    })
}

fn channel_type(channel_type: ChannelType) -> &'static str {
    match channel_type {
        ChannelType::Public => "public",
        ChannelType::Private => "private",
        ChannelType::DirectMessage => "direct_message",
        ChannelType::Team => "team",
    }
}

fn message_json(message: &Message) -> Value {
    let sender = message
        .imported_author
        .as_ref()
        .map(|author| author.name.clone())
        .or_else(|| message.bot_profile.as_ref().map(|bot| bot.name.clone()))
        .or_else(|| {
            message
                .sender_id
                .as_user()
                .map(|user| user.email_str().to_owned())
        });
    let text = match ParsedXmlText::parse(&message.content) {
        Ok(parsed) => PlainTextFormatter::format_xml_text(parsed).0,
        Err(_) => message.content.clone(),
    };
    json!({
        "sender": sender,
        "sent_at": message.created_at,
        "edited": message.edited_at.is_some(),
        "attachments": message.attachments.len(),
        "text": truncate(&text),
    })
}

fn document_json(
    document: &DocumentBasic,
    properties: &[EntityPropertyInfo],
    markdown: Option<&str>,
) -> Value {
    let kind = match document.sub_type {
        Some(document_sub_type::DocumentSubType::Task) => "task",
        _ => "document",
    };
    let properties: Map<String, Value> = properties
        .iter()
        .filter_map(|property| {
            property_value(property).map(|value| (property.display_name.clone(), value))
        })
        .collect();
    json!({
        "kind": kind,
        "name": document.document_name,
        "file_type": document.file_type,
        "deleted": document.deleted_at.is_some(),
        "properties": properties,
        "content": markdown.map(truncate),
    })
}

/// A property's value as people read it: option labels rather than ids.
fn property_value(property: &EntityPropertyInfo) -> Option<Value> {
    match property.value.as_ref()? {
        PropertyValue::SelectOption(ids) => {
            let labels: Vec<Value> = ids
                .iter()
                .filter_map(|id| property.options.iter().find(|option| option.id == *id))
                .map(|option| match &option.value {
                    PropertyOptionValue::String(text) => json!(text),
                    PropertyOptionValue::Number(number) => json!(number),
                })
                .collect();
            (!labels.is_empty()).then(|| Value::Array(labels))
        }
        value => serde_json::to_value(value)
            .ok()
            .map(|value| value.get("value").cloned().unwrap_or(value)),
    }
}
