//! Authorized conversation history through the common read application boundary.

#[cfg(test)]
mod test;

use crate::domain::{
    context::PeopleDirectory,
    service::{AuthorizedInvocation, ThreadHistory},
    thread_window::ThreadMessage,
};
use agent_session::domain::error::{AgentSessionError, Result};
use entity_access::domain::{
    models::{AccessError, EntityAccessReceipt, EntityType},
    ports::EntityAccessService,
};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use messages::domain::{
    api::MessageReader, models::MessageParent, ports::MessageError, service::MessageWrite,
};
use std::collections::HashMap;
use std::sync::Arc;
use trigger_context::ContextPerson;

trait InvocationAuthorizer: Send + Sync + 'static {
    fn capability(
        &self,
        user: &MacroUserIdStr<'static>,
        parent: &MessageParent,
    ) -> impl Future<Output = std::result::Result<EntityAccessReceipt<MessageWrite>, AccessError>> + Send;
}

impl<Access: EntityAccessService> InvocationAuthorizer for Access {
    async fn capability(
        &self,
        user: &MacroUserIdStr<'static>,
        parent: &MessageParent,
    ) -> std::result::Result<EntityAccessReceipt<MessageWrite>, AccessError> {
        self.generate_entity_access_receipt::<MessageWrite>(
            user,
            None,
            &parent.entity_id(),
            match parent {
                MessageParent::Channel(_) => EntityType::Channel,
                MessageParent::Document(_) => EntityType::Document,
                MessageParent::Initiative(_) => EntityType::Initiative,
                MessageParent::CrmCompany(_) => EntityType::CrmCompany,
                MessageParent::CrmContact(_) => EntityType::CrmContact,
                MessageParent::Call(_) => EntityType::Call,
            },
        )
        .await
    }
}

/// Reads common message history with the invoking user's current capability,
/// naming each sender the way people in the thread do.
pub struct MessageThreadHistory<Access, People> {
    messages: Arc<dyn MessageReader>,
    access: Access,
    people: People,
}

impl<Access, People> MessageThreadHistory<Access, People> {
    /// Compose the read application port, current parent authorization, and
    /// the directory that names senders.
    pub fn new(messages: Arc<dyn MessageReader>, access: Access, people: People) -> Self {
        Self {
            messages,
            access,
            people,
        }
    }
}

impl<Access, People: PeopleDirectory> MessageThreadHistory<Access, People> {
    /// Names for the given senders, keyed by sender id. Best effort: a failed
    /// lookup leaves every sender unnamed rather than failing the read.
    async fn sender_names(&self, senders: Vec<String>) -> HashMap<String, String> {
        let people = match self.people.people(senders).await {
            Ok(people) => people,
            Err(error) => {
                tracing::warn!(error = ?error, "sender names unavailable; reading the thread unnamed");
                return HashMap::new();
            }
        };
        people
            .into_iter()
            .filter_map(|person| known_name(&person).map(|name| (person.id, name)))
            .collect()
    }
}

/// A person's name when one is on record. The directory falls back to a
/// user's email, or a bot's id, when it has none; neither is a name.
fn known_name(person: &ContextPerson) -> Option<String> {
    let is_fallback =
        person.email.as_deref() == Some(person.name.as_str()) || person.name == person.id;
    (!is_fallback).then(|| person.name.clone())
}

impl<Access: InvocationAuthorizer, People: PeopleDirectory> ThreadHistory
    for MessageThreadHistory<Access, People>
{
    async fn authorize_invocation(
        &self,
        user: &MacroUserIdStr<'static>,
        parent: &MessageParent,
        root_id: Uuid,
    ) -> Result<Option<AuthorizedInvocation>> {
        match self.access.capability(user, parent).await {
            Ok(access) => Ok(Some(AuthorizedInvocation::new(access, root_id))),
            Err(AccessError::Unavailable(error) | AccessError::Internal(error)) => {
                Err(AgentSessionError::Unknown(error.into()))
            }
            Err(_) => Ok(None),
        }
    }

    async fn thread_messages(
        &self,
        invocation: &AuthorizedInvocation,
    ) -> Result<Vec<ThreadMessage>> {
        let access = invocation
            .access()
            .clone()
            .try_into_requirement()
            .map_err(|error| AgentSessionError::Unknown(error.into()))?;
        let thread = match self.messages.get_thread(access, invocation.root_id()).await {
            Ok(thread) => thread,
            Err(MessageError::NotFound) => return Ok(Vec::new()),
            Err(error) => return Err(AgentSessionError::Unknown(error.into())),
        };
        let messages: Vec<_> = std::iter::once(thread.root)
            .chain(thread.replies)
            .filter(|message| message.deleted_at.is_none())
            .collect();

        let mut senders: Vec<String> = messages
            .iter()
            .map(|message| message.sender_id.as_ref().to_owned())
            .collect();
        senders.sort_unstable();
        senders.dedup();
        let names = self.sender_names(senders).await;

        Ok(messages
            .into_iter()
            .map(|message| ThreadMessage {
                id: message.id,
                name: names.get(message.sender_id.as_ref()).cloned(),
                sender: message.sender_id,
                content: message.content,
                created_at: message.created_at,
            })
            .collect())
    }
}
