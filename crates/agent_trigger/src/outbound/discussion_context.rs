//! The discussion a message was posted in, read through the common message
//! read port under the poster's verified capability on its parent.

#[cfg(test)]
mod test;

use std::collections::HashMap;
use std::sync::Arc;

use agent_session::domain::error::{AgentSessionError, Result};
use call::domain::{models::CallRecordPreview, ports::CallRepository};
use channels::domain::{models::ChannelType as StoredChannelType, ports::ChannelRepo};
use document_storage_service_client::DocumentStorageServiceClient;
use entity_access::domain::models::EntityAccessReceipt;
use initiative::domain::{lookup::InitiativeReader, models::InitiativeId};
use lexical_client::LexicalClient;
use lexical_client::parse_markdown::ExtractedExplicitReply;
use macro_uuid::Uuid;
use messages::domain::{
    api::MessageReader,
    events::MessagePostedMetadata,
    models::{Message, MessageParent, MessageThread, ThreadAnchor},
    ports::CrmParentReader,
    service::MessageView,
};
use trigger_context::{
    ChannelType, CommentAnchor, ContextMessage, ContextPerson, ContextThread, DiscussionContext,
    DiscussionSurface, MarkedPassage, ReplyTarget,
};

use crate::domain::{
    context::{DiscussionReader, PeopleDirectory},
    service::AuthorizedInvocation,
};

/// Channel messages before the prompt read as the surrounding activity.
const CHANNEL_MESSAGES: u16 = 10;

/// Most messages of the prompt's own discussion carried. The root is always
/// kept, so a long thread loses its middle rather than its subject.
const THREAD_MESSAGES: usize = 50;

/// What a message's parent is called.
#[derive(Debug, Clone, PartialEq, Eq)]
enum ParentName {
    /// A channel's stored name, absent for direct messages, and its type.
    Channel {
        name: Option<String>,
        channel_type: ChannelType,
    },
    /// Any other parent's display name.
    Named(String),
}

/// Reads what a message's parent is called. It checks no access of its own:
/// it is only asked under the actor's capability on that parent.
trait ParentNames: Send + Sync + 'static {
    fn name(
        &self,
        access: &EntityAccessReceipt<MessageView>,
        parent: &MessageParent,
    ) -> impl Future<Output = Result<ParentName>> + Send;
}

/// Reads what a comment mark covers in the live document. It checks no access
/// of its own: it is only asked after the thread was read under the actor's
/// capability on that document.
trait MarkReader: Send + Sync + 'static {
    fn resolve(
        &self,
        document_id: &str,
        mark_id: &str,
    ) -> impl Future<Output = anyhow::Result<Option<MarkedPassage>>> + Send;
}

impl MarkReader for LexicalClient {
    async fn resolve(
        &self,
        document_id: &str,
        mark_id: &str,
    ) -> anyhow::Result<Option<MarkedPassage>> {
        Ok(self
            .resolve_comment_mark(document_id, mark_id)
            .await?
            .map(|mark| MarkedPassage {
                marked_text: mark.marked_text,
                surrounding_text: mark.surrounding_text,
            }))
    }
}

/// Reads the message a prompt quote-replies to out of the prompt's markdown.
/// The quoted message itself is read separately, under the actor's access.
trait QuoteReader: Send + Sync + 'static {
    fn quoted(
        &self,
        markdown: &str,
    ) -> impl Future<Output = anyhow::Result<Option<ExtractedExplicitReply>>> + Send;
}

impl QuoteReader for LexicalClient {
    async fn quoted(&self, markdown: &str) -> anyhow::Result<Option<ExtractedExplicitReply>> {
        self.extract_explicit_reply(markdown).await
    }
}

/// Names every kind of message parent through the domain that owns it.
pub struct ParentNameReader<Channels, Calls> {
    channels: Channels,
    documents: DocumentStorageServiceClient,
    initiatives: Arc<dyn InitiativeReader>,
    crm: Arc<dyn CrmParentReader>,
    calls: Calls,
}

impl<Channels, Calls> ParentNameReader<Channels, Calls> {
    /// Compose the owning readers of channels, documents, projects, CRM
    /// records and calls.
    pub fn new(
        channels: Channels,
        documents: DocumentStorageServiceClient,
        initiatives: impl InitiativeReader,
        crm: impl CrmParentReader,
        calls: Calls,
    ) -> Self {
        Self {
            channels,
            documents,
            initiatives: Arc::new(initiatives),
            crm: Arc::new(crm),
            calls,
        }
    }
}

fn unknown(error: impl Into<anyhow::Error>) -> AgentSessionError {
    AgentSessionError::Unknown(error.into())
}

fn unnamed(parent: &MessageParent, why: &str) -> AgentSessionError {
    AgentSessionError::Unknown(anyhow::anyhow!("{why}: {parent:?}"))
}

impl<Channels: ChannelRepo, Calls: CallRepository> ParentNames
    for ParentNameReader<Channels, Calls>
{
    async fn name(
        &self,
        access: &EntityAccessReceipt<MessageView>,
        parent: &MessageParent,
    ) -> Result<ParentName> {
        let name = match parent {
            MessageParent::Channel(id) => {
                let info = self.channels.get_channel_info(*id).await.map_err(unknown)?;
                let channel_type = match info.channel_type {
                    StoredChannelType::Public => ChannelType::Public,
                    StoredChannelType::Private => ChannelType::Private,
                    StoredChannelType::DirectMessage => ChannelType::DirectMessage,
                    StoredChannelType::Team => ChannelType::Team,
                };
                // Direct messages and unnamed group conversations are named
                // after their members, per viewer; only they lack a name.
                if info.name.is_none()
                    && matches!(channel_type, ChannelType::Public | ChannelType::Team)
                {
                    return Err(unnamed(parent, "channel has no name"));
                }
                return Ok(ParentName::Channel {
                    name: info.name,
                    channel_type,
                });
            }
            MessageParent::Document(_) => self
                .documents
                .get_document_basic(&parent.entity_id())
                .await
                .map_err(unknown)?
                .filter(|document| document.deleted_at.is_none())
                .map(|document| document.document_name),
            MessageParent::Initiative(id) => self
                .initiatives
                .read_basic(InitiativeId::from_uuid(*id))
                .await
                .map_err(unknown)?
                .map(|initiative| initiative.name),
            MessageParent::CrmCompany(_) | MessageParent::CrmContact(_) => self
                .crm
                .read_crm_parent(parent)
                .await
                .map_err(|error| unknown(anyhow::anyhow!("{error:?}")))?
                .map(|record| record.name),
            MessageParent::Call(id) => {
                // A call is named by its own title, else by its channel as
                // the viewer sees it.
                let viewer = access.get_authenticated_user().map_err(unknown)?.clone();
                let previews = self
                    .calls
                    .batch_get_call_record_previews(&[*id], viewer)
                    .await
                    .map_err(unknown)?;
                match previews.into_iter().next() {
                    Some(CallRecordPreview::Exists(call)) => call.custom_name.or(call.channel_name),
                    Some(CallRecordPreview::DoesNotExist(_)) | None => None,
                }
            }
        };
        name.filter(|name| !name.trim().is_empty())
            .map(ParentName::Named)
            .ok_or_else(|| unnamed(parent, "discussion parent has no name"))
    }
}

/// Reads a message's discussion under the capability its invocation verified.
pub struct MessageDiscussionReader<People, Names, Lexical = LexicalClient> {
    messages: Arc<dyn MessageReader>,
    people: People,
    names: Names,
    lexical: Lexical,
}

impl<People, Names, Lexical> MessageDiscussionReader<People, Names, Lexical> {
    /// Compose the shared message read port, the people directory, the
    /// parent names, and the lexical service that resolves comment marks and
    /// quotes.
    pub fn new(
        messages: Arc<dyn MessageReader>,
        people: People,
        names: Names,
        lexical: Lexical,
    ) -> Self {
        Self {
            messages,
            people,
            names,
            lexical,
        }
    }
}

impl<People, Names, Lexical> DiscussionReader for MessageDiscussionReader<People, Names, Lexical>
where
    People: PeopleDirectory,
    Names: ParentNames,
    Lexical: MarkReader + QuoteReader,
{
    /// The prompt's own discussion is read whole, because that is what the
    /// prompt is about. Nearby channel messages are grouped by the discussion
    /// they belong to so the agent can tell them apart from it.
    async fn discussion(
        &self,
        invocation: &AuthorizedInvocation,
        posted: &MessagePostedMetadata,
    ) -> Result<DiscussionContext> {
        let access: EntityAccessReceipt<MessageView> = invocation
            .access()
            .clone()
            .try_into_requirement()
            .map_err(unknown)?;
        // The capability covers one parent and one discussion; a post claiming
        // another is never read with it.
        if access.entity().entity_type != posted.parent.access_entity_type()
            || access.entity().entity_id != posted.parent.entity_id()
            || invocation.root_id() != posted.root_id
        {
            return Err(AgentSessionError::Forbidden);
        }
        let parent = &posted.parent;
        let root_id = posted.root_id;
        let prompt = self
            .messages
            .get(access.clone(), posted.message_id)
            .await
            .map_err(unknown)?;
        let is_channel = matches!(parent, MessageParent::Channel(_));
        let top_level = is_channel && root_id == prompt.id;

        let discussion = if top_level {
            None
        } else {
            Some(
                self.messages
                    .get_thread(access.clone(), root_id)
                    .await
                    .map_err(unknown)?,
            )
        };
        let recent = if is_channel {
            self.messages
                .preceding(access.clone(), prompt.id, CHANNEL_MESSAGES)
                .await
                .map_err(unknown)?
        } else {
            Vec::new()
        };
        let quote = quote(
            self.messages.as_ref(),
            &self.lexical,
            parent,
            &prompt,
            access.clone(),
        )
        .await;
        let name = self.names.name(&access, parent).await?;
        let anchor = match (parent, &discussion) {
            (MessageParent::Document(_), Some(discussion)) => {
                anchor(&self.lexical, parent, discussion.state.anchor.clone()).await
            }
            _ => None,
        };

        let thread = discussion
            .as_ref()
            .map(|discussion| prompt_thread(discussion, &prompt));
        let mut channel = channel_threads(&recent, root_id);
        if top_level {
            channel.push(Selection {
                root_id: prompt.id,
                messages: std::iter::once(&prompt).filter(|m| readable(m)).collect(),
                messages_omitted: false,
            });
        }
        let quoted = quote.as_ref().and_then(|quote| quote.message.as_ref());

        let authors: Vec<&Message> = std::iter::once(&prompt)
            .chain(
                thread
                    .iter()
                    .flat_map(|thread| thread.messages.iter().copied()),
            )
            .chain(
                channel
                    .iter()
                    .flat_map(|thread| thread.messages.iter().copied()),
            )
            .chain(quoted)
            .collect();
        let people = self.people_of(&authors).await?;

        let reply_target = match quote {
            Some(quote) => ReplyTarget::Quote {
                message_id: quote.message_id,
                thread_id: quote.thread_id,
                preview: quote.preview,
                message: quote
                    .message
                    .as_ref()
                    .map(|message| people.message(message)),
            },
            None if top_level => ReplyTarget::None,
            None => ReplyTarget::Thread { root_id },
        };
        Ok(DiscussionContext {
            surface: surface(parent, name, anchor)?,
            prompt_message_id: prompt.id,
            sender: people.author(&prompt),
            reply_target,
            thread: thread.map(|thread| people.thread(thread)),
            channel: channel
                .into_iter()
                .map(|thread| people.thread(thread))
                .collect(),
        })
    }
}

impl<People: PeopleDirectory, Names, Lexical> MessageDiscussionReader<People, Names, Lexical> {
    /// Everyone who wrote one of `messages`, named once each.
    async fn people_of(&self, messages: &[&Message]) -> Result<Authors> {
        let mut ids: Vec<String> = Vec::new();
        for message in messages {
            if let Some(id) = directory_id(message)
                && !ids.contains(&id)
            {
                ids.push(id);
            }
        }
        let people = self.people.people(ids.clone()).await?;
        if people.len() != ids.len() {
            return Err(AgentSessionError::Unknown(anyhow::anyhow!(
                "people directory named {} of {} authors",
                people.len(),
                ids.len()
            )));
        }
        Ok(Authors(ids.into_iter().zip(people).collect()))
    }
}

/// Where the discussion lives, by name.
fn surface(
    parent: &MessageParent,
    name: ParentName,
    anchor: Option<CommentAnchor>,
) -> Result<DiscussionSurface> {
    Ok(match (parent, name) {
        (MessageParent::Channel(id), ParentName::Channel { name, channel_type }) => {
            DiscussionSurface::Channel {
                id: *id,
                name,
                channel_type,
            }
        }
        (MessageParent::Document(_), ParentName::Named(name)) => {
            DiscussionSurface::DocumentComment {
                id: parent.entity_id(),
                name,
                anchor,
            }
        }
        (MessageParent::Initiative(id), ParentName::Named(name)) => {
            DiscussionSurface::ProjectComment { id: *id, name }
        }
        (MessageParent::CrmCompany(id), ParentName::Named(name)) => {
            DiscussionSurface::CrmCompanyComment { id: *id, name }
        }
        (MessageParent::CrmContact(id), ParentName::Named(name)) => {
            DiscussionSurface::CrmContactComment { id: *id, name }
        }
        (MessageParent::Call(id), ParentName::Named(title)) => {
            DiscussionSurface::CallChat { id: *id, title }
        }
        (parent, name) => {
            return Err(AgentSessionError::Unknown(anyhow::anyhow!(
                "{parent:?} was named as {name:?}"
            )));
        }
    })
}

/// Where a document discussion sits, and what that anchor covers now. A PDF
/// highlight's text arrives with the thread; a markdown mark is resolved
/// against the live document, and a failed lookup leaves the stored
/// snapshot to stand in rather than failing the prompt.
async fn anchor(
    lexical: &impl MarkReader,
    parent: &MessageParent,
    anchor: Option<ThreadAnchor>,
) -> Option<CommentAnchor> {
    let (mark_id, marked_text) = match anchor? {
        ThreadAnchor::Spreadsheet {
            sheet_id,
            sheet_name,
            range,
        } => {
            return Some(CommentAnchor::Spreadsheet {
                sheet_id,
                sheet_name,
                range,
            });
        }
        ThreadAnchor::PdfHighlight {
            anchor_id,
            marked_text,
        } => {
            return Some(CommentAnchor::PdfHighlight {
                anchor_id: anchor_id.to_string(),
                marked_text,
            });
        }
        ThreadAnchor::PdfPlaceable { anchor_id } => {
            return Some(CommentAnchor::PdfPin {
                anchor_id: anchor_id.to_string(),
            });
        }
        // The lexical prompt composer has no design anchor kind yet, so a
        // design pin reaches the agent as an unanchored thread on the design.
        ThreadAnchor::Fig { .. } => return None,
        ThreadAnchor::Markdown {
            mark_id,
            marked_text,
        } => (mark_id.to_string(), marked_text),
    };
    let current = lexical
        .resolve(&parent.entity_id(), &mark_id)
        .await
        .inspect_err(|error| {
            tracing::warn!(
                error = ?error,
                ?parent,
                %mark_id,
                "sending comment anchor without the live marked text"
            );
        })
        .ok()
        .flatten();
    Some(CommentAnchor::Mark {
        mark_id,
        marked_text,
        current,
    })
}

/// A quote-reply target, with the quoted message when it could be read.
struct Quote {
    message_id: Uuid,
    thread_id: Uuid,
    preview: String,
    message: Option<Message>,
}

/// The message the prompt quote-replies to, when it is one. The quoted
/// message is only read when it sits in the prompt's own conversation,
/// which the actor's access already covers; a quote from elsewhere
/// travels as its preview.
async fn quote(
    messages: &dyn MessageReader,
    lexical: &impl QuoteReader,
    parent: &MessageParent,
    prompt: &Message,
    access: EntityAccessReceipt<MessageView>,
) -> Option<Quote> {
    let quoted = lexical
        .quoted(&prompt.content)
        .await
        .inspect_err(|error| {
            tracing::warn!(
                error = ?error,
                message_id = %prompt.id,
                "sending agent prompt without its quote-reply target"
            );
        })
        .ok()
        .flatten()?;
    let (Ok(message_id), Ok(thread_id)) = (
        Uuid::parse_str(&quoted.target_message_id),
        Uuid::parse_str(&quoted.target_thread_id),
    ) else {
        tracing::warn!(
            target_message_id = %quoted.target_message_id,
            target_thread_id = %quoted.target_thread_id,
            "quote-reply target is not a message id"
        );
        return None;
    };
    let message = if quoted.parent == *parent {
        messages
            .get(access, message_id)
            .await
            .inspect_err(|error| {
                tracing::warn!(error = ?error, %message_id, "quoted message is unreadable");
            })
            .ok()
            .filter(|message| message.parent == *parent && readable(message))
    } else {
        None
    };
    Some(Quote {
        message_id,
        thread_id,
        preview: quoted.display_text,
        message,
    })
}

/// Messages of one discussion chosen for the context, before their authors
/// are named.
struct Selection<'a> {
    root_id: Uuid,
    messages: Vec<&'a Message>,
    messages_omitted: bool,
}

/// Whether a message is live and says something.
fn readable(message: &Message) -> bool {
    message.deleted_at.is_none() && !message.content.trim().is_empty()
}

/// The prompt's discussion from its root through the prompt. Replies posted
/// after the prompt belong to later turns and are left out.
fn prompt_thread<'a>(discussion: &'a MessageThread, prompt: &'a Message) -> Selection<'a> {
    let root_id = discussion.state.root_id;
    let mut messages = Vec::new();
    let mut reached_prompt = false;
    for message in std::iter::once(&discussion.root).chain(&discussion.replies) {
        if readable(message) {
            messages.push(message);
        }
        if message.id == prompt.id {
            reached_prompt = true;
            break;
        }
    }
    if !reached_prompt && !prompt.content.trim().is_empty() {
        messages.push(prompt);
    }

    let messages_omitted = messages.len() > THREAD_MESSAGES;
    if messages_omitted {
        let keep_root = messages
            .first()
            .is_some_and(|message| message.id == root_id);
        let tail = messages.split_off(messages.len() - (THREAD_MESSAGES - usize::from(keep_root)));
        messages.truncate(usize::from(keep_root));
        messages.extend(tail);
    }
    Selection {
        root_id,
        messages,
        messages_omitted,
    }
}

/// Channel messages outside the prompt's discussion, grouped by the
/// discussion each belongs to, in the order the discussions first appear.
fn channel_threads(recent: &[Message], prompt_root: Uuid) -> Vec<Selection<'_>> {
    let mut threads: Vec<Selection<'_>> = Vec::new();
    for message in recent {
        let root_id = message.root_id();
        if root_id == prompt_root || !readable(message) {
            continue;
        }
        match threads.iter_mut().find(|thread| thread.root_id == root_id) {
            Some(thread) => thread.messages.push(message),
            None => threads.push(Selection {
                root_id,
                // A reply whose root fell outside the window.
                messages_omitted: message.id != root_id,
                messages: vec![message],
            }),
        }
    }
    threads
}

/// The directory id of a message's author, when the message does not name
/// its author itself.
fn directory_id(message: &Message) -> Option<String> {
    (message.imported_author.is_none() && message.bot_profile.is_none())
        .then(|| message.sender_id.as_ref().to_owned())
}

/// Authors named by the people directory, by directory id.
struct Authors(HashMap<String, ContextPerson>);

impl Authors {
    /// Who wrote a message, as a reader would name them. Imported messages
    /// and bot posts carry their own names.
    fn author(&self, message: &Message) -> ContextPerson {
        let id = message.sender_id.as_ref().to_owned();
        if let Some(imported) = &message.imported_author {
            return ContextPerson {
                id,
                name: imported.name.clone(),
                email: None,
            };
        }
        if let Some(bot) = &message.bot_profile {
            return ContextPerson {
                id,
                name: bot.name.clone(),
                email: None,
            };
        }
        // Every author was named before any message is built.
        self.0.get(&id).cloned().unwrap_or(ContextPerson {
            name: id.clone(),
            id,
            email: None,
        })
    }

    fn message(&self, message: &Message) -> ContextMessage {
        ContextMessage {
            id: message.id,
            author: self.author(message),
            content: message.content.trim().to_owned(),
            posted_at: message.created_at,
        }
    }

    fn thread(&self, selection: Selection<'_>) -> ContextThread {
        ContextThread {
            root_id: selection.root_id,
            messages: selection
                .messages
                .into_iter()
                .map(|message| self.message(message))
                .collect(),
            messages_omitted: selection.messages_omitted,
        }
    }
}
