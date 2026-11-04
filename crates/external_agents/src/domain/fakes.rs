//! In-memory fakes of the external agent ports, for domain tests.

use std::collections::HashMap;
use std::sync::Mutex;

use bot_id::BotId;
use bots::domain::models::{
    Agent, AgentChannelScope, AgentMcpServers, Bot, BotKind, BotOwner, CreateAgentRequest,
};
use chrono::DateTime;
use entity_access::domain::models::{
    BotReceiptScope, Entity, EntityAccessReceipt, EntityPermission, ParticipantRole,
};
use macro_user_id::user_id::MacroUserIdStr;
use messages::domain::{models::MessageParent, service::MessageWrite};
use uuid::Uuid;

use super::models::{AgentEndpoint, ExternalAgentEvent};
use super::ports::{
    AgentEndpoints, AgentPersonas, AgentWriteAccess, CreatedEndpoint, EndpointCheck,
    ExternalAgentError, ExternalAgentRepo, ExternalAgentRow, Result,
};

pub(crate) const OWNER: &str = "macro|owner@example.com";

pub(crate) fn user(id: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(id.to_owned()).expect("a valid user id")
}

pub(crate) fn agent(bot_id: BotId, harness: &str) -> Agent {
    Agent {
        bot: Bot {
            id: bot_id,
            kind: BotKind::Owned,
            owner: Some(BotOwner::User {
                user_id: OWNER.to_owned(),
            }),
            name: "Outside Assistant".to_owned(),
            handle: "outside".to_owned(),
            description: None,
            avatar_url: None,
            created_by: Some(OWNER.to_owned()),
            created_at: DateTime::UNIX_EPOCH,
            updated_at: DateTime::UNIX_EPOCH,
            deleted_at: None,
            has_agent: true,
        },
        instructions: String::new(),
        harness: harness.to_owned(),
        harness_id: None,
        default_model: "model".to_owned(),
        channel_scope: AgentChannelScope::All,
        channel_ids: Vec::new(),
        mcp: AgentMcpServers::OwnerConnections,
        auto_accept_permissions: None,
        is_coding: false,
    }
}

/// Agents the bots domain would keep, creating each under the next id.
#[derive(Default)]
pub(crate) struct FakePersonas {
    pub(crate) agents: Mutex<Vec<Agent>>,
    pub(crate) created: Mutex<Vec<CreateAgentRequest>>,
    pub(crate) deleted: Mutex<Vec<BotId>>,
    pub(crate) tokens: Mutex<Vec<BotId>>,
    pub(crate) next_id: Mutex<u128>,
}

impl AgentPersonas for FakePersonas {
    async fn create(&self, _: MacroUserIdStr<'static>, req: CreateAgentRequest) -> Result<Agent> {
        let mut next = self.next_id.lock().unwrap();
        *next += 1;
        let mut created = agent(BotId::new_from_uuid(Uuid::from_u128(0xA000 + *next)), &req.harness);
        created.bot.name = req.name.clone();
        created.bot.handle = req.handle.clone();
        created.default_model = req.default_model.clone();
        self.created.lock().unwrap().push(req);
        self.agents.lock().unwrap().push(created.clone());
        Ok(created)
    }

    async fn manageable(&self, _: MacroUserIdStr<'static>, bot_id: BotId) -> Result<Agent> {
        self.agents
            .lock()
            .unwrap()
            .iter()
            .find(|agent| agent.bot.id == bot_id)
            .cloned()
            .ok_or(ExternalAgentError::NotFound)
    }

    async fn list(&self, _: MacroUserIdStr<'static>) -> Result<Vec<Agent>> {
        Ok(self.agents.lock().unwrap().clone())
    }

    async fn delete(&self, _: MacroUserIdStr<'static>, bot_id: BotId) -> Result<()> {
        self.agents
            .lock()
            .unwrap()
            .retain(|agent| agent.bot.id != bot_id);
        self.deleted.lock().unwrap().push(bot_id);
        Ok(())
    }

    async fn issue_token(&self, _: MacroUserIdStr<'static>, bot_id: BotId) -> Result<String> {
        self.tokens.lock().unwrap().push(bot_id);
        Ok(format!("mbot_token_for_{bot_id}"))
    }
}

/// Webhook endpoints, answering validation as `verifies` says.
#[derive(Default)]
pub(crate) struct FakeEndpoints {
    pub(crate) endpoints: Mutex<HashMap<String, AgentEndpoint>>,
    pub(crate) pushed: Mutex<Vec<(String, Uuid)>>,
    pub(crate) reject_urls: bool,
    pub(crate) verifies: bool,
}

impl AgentEndpoints for FakeEndpoints {
    async fn create(
        &self,
        _: MacroUserIdStr<'static>,
        _: &BotOwner,
        bot_id: BotId,
        _: &str,
        url: String,
    ) -> Result<CreatedEndpoint> {
        if self.reject_urls {
            return Err(ExternalAgentError::BadRequest(
                "endpoint_url must use https".to_owned(),
            ));
        }
        let endpoint = AgentEndpoint {
            webhook_id: format!("wh_{bot_id}"),
            url,
            verified: false,
        };
        self.endpoints
            .lock()
            .unwrap()
            .insert(endpoint.webhook_id.clone(), endpoint.clone());
        Ok(CreatedEndpoint {
            endpoint,
            signing_secret: "whsec_test".to_owned(),
        })
    }

    async fn get(&self, _: MacroUserIdStr<'static>, webhook_id: &str) -> Result<Option<AgentEndpoint>> {
        Ok(self.endpoints.lock().unwrap().get(webhook_id).cloned())
    }

    async fn set_url(
        &self,
        _: MacroUserIdStr<'static>,
        webhook_id: &str,
        url: String,
    ) -> Result<AgentEndpoint> {
        let mut endpoints = self.endpoints.lock().unwrap();
        let endpoint = endpoints
            .get_mut(webhook_id)
            .ok_or(ExternalAgentError::NotFound)?;
        endpoint.url = url;
        endpoint.verified = false;
        Ok(endpoint.clone())
    }

    async fn verify(&self, _: MacroUserIdStr<'static>, webhook_id: &str) -> Result<EndpointCheck> {
        let mut endpoints = self.endpoints.lock().unwrap();
        let endpoint = endpoints
            .get_mut(webhook_id)
            .ok_or(ExternalAgentError::NotFound)?;
        endpoint.verified = self.verifies;
        Ok(EndpointCheck {
            verified: self.verifies,
            response_status: Some(if self.verifies { 200 } else { 404 }),
            message: None,
        })
    }

    async fn delete(&self, _: MacroUserIdStr<'static>, webhook_id: &str) -> Result<()> {
        self.endpoints.lock().unwrap().remove(webhook_id);
        Ok(())
    }

    async fn push(&self, webhook_id: &str, event: &ExternalAgentEvent) -> Result<()> {
        self.pushed
            .lock()
            .unwrap()
            .push((webhook_id.to_owned(), event.id));
        Ok(())
    }
}

/// Registrations and inboxes, recording each trigger once.
#[derive(Default)]
pub(crate) struct FakeRepo {
    pub(crate) agents: Mutex<HashMap<BotId, Option<String>>>,
    pub(crate) events: Mutex<Vec<(Uuid, ExternalAgentEvent)>>,
}

impl ExternalAgentRepo for FakeRepo {
    async fn register(&self, bot_id: BotId, webhook_id: Option<&str>) -> Result<()> {
        self.agents
            .lock()
            .unwrap()
            .entry(bot_id)
            .or_insert(webhook_id.map(str::to_owned));
        Ok(())
    }

    async fn set_webhook(&self, bot_id: BotId, webhook_id: Option<&str>) -> Result<()> {
        let mut agents = self.agents.lock().unwrap();
        let slot = agents.get_mut(&bot_id).ok_or(ExternalAgentError::NotFound)?;
        *slot = webhook_id.map(str::to_owned);
        Ok(())
    }

    async fn get(&self, bot_ids: &[BotId]) -> Result<Vec<ExternalAgentRow>> {
        let agents = self.agents.lock().unwrap();
        Ok(bot_ids
            .iter()
            .filter_map(|bot_id| {
                agents.get(bot_id).map(|webhook_id| ExternalAgentRow {
                    bot_id: *bot_id,
                    webhook_id: webhook_id.clone(),
                })
            })
            .collect())
    }

    async fn remove(&self, bot_id: BotId) -> Result<()> {
        self.agents.lock().unwrap().remove(&bot_id);
        self.events
            .lock()
            .unwrap()
            .retain(|(_, event)| event.bot_id != bot_id);
        Ok(())
    }

    async fn record(
        &self,
        event: ExternalAgentEvent,
        trigger_event_id: Uuid,
    ) -> Result<ExternalAgentEvent> {
        let mut events = self.events.lock().unwrap();
        if let Some((_, stored)) = events
            .iter()
            .find(|(trigger, stored)| *trigger == trigger_event_id && stored.bot_id == event.bot_id)
        {
            return Ok(stored.clone());
        }
        events.push((trigger_event_id, event.clone()));
        Ok(event)
    }

    async fn events(
        &self,
        bot_id: BotId,
        after: Option<Uuid>,
        limit: u16,
    ) -> Result<Vec<ExternalAgentEvent>> {
        let mut events: Vec<ExternalAgentEvent> = self
            .events
            .lock()
            .unwrap()
            .iter()
            .map(|(_, event)| event.clone())
            .filter(|event| event.bot_id == bot_id && after.is_none_or(|after| event.id > after))
            .collect();
        events.sort_by_key(|event| event.id);
        events.truncate(usize::from(limit));
        Ok(events)
    }

    async fn event(&self, bot_id: BotId, event_id: Uuid) -> Result<Option<ExternalAgentEvent>> {
        Ok(self
            .events
            .lock()
            .unwrap()
            .iter()
            .map(|(_, event)| event)
            .find(|event| event.bot_id == bot_id && event.id == event_id)
            .cloned())
    }
}

/// People who may currently write in every conversation.
pub(crate) struct FakeAccess {
    pub(crate) writers: Vec<&'static str>,
}

impl AgentWriteAccess for FakeAccess {
    async fn bot_write(
        &self,
        bot_id: BotId,
        user: MacroUserIdStr<'static>,
        parent: &MessageParent,
    ) -> Result<Option<EntityAccessReceipt<MessageWrite>>> {
        if !self.writers.contains(&user.as_ref()) {
            return Ok(None);
        }
        Ok(Some(
            EntityAccessReceipt::try_new_bot(
                bot_id.into_storage_id(),
                BotReceiptScope::User { acting_user: user },
                Entity {
                    entity_id: parent.entity_id(),
                    entity_type: parent.access_entity_type(),
                },
                EntityPermission::ChannelRole {
                    role: ParticipantRole::Member,
                },
            )
            .expect("a member may write"),
        ))
    }
}
