//! Support adapters belong at the DSS composition root, not inside Support.
use crate::api::context::{
    DocumentService, DssChannelService, DssCrmService, DssEmailService, EntityAccessService,
    PropertiesService,
};
use async_trait::async_trait;
use channels::domain::{
    models::{ChannelType, CreateChannelRequest, Sender},
    ports::ChannelService,
};
use crm::domain::{auth::CrmTeamReceipt, service::CrmService};
use documents_hex::domain::ports::DocumentService as _;
use email::{
    domain::{
        models::{ContactInfo, CreateDraftInput},
        ports::EmailService,
    },
    outbound::EmailPgRepo,
};
use entity_access::domain::{
    models::{EntityAccessReceipt, EntityType, MemberTeamRole, ViewAccessLevel},
    ports::EntityAccessService as _,
};
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use properties::domain::service::PropertiesService as _;
use std::{future::Future, pin::Pin, sync::Arc};
use support::domain::{model::*, ports::Platform};
use uuid::Uuid;
pub type TaskCreator = Arc<
    dyn Fn(
            Uuid,
            String,
            Ticket,
            String,
            String,
        ) -> Pin<Box<dyn Future<Output = Result<String>> + Send>>
        + Send
        + Sync,
>;
pub struct MacroSupportPlatform {
    pub channels: Arc<DssChannelService>,
    pub messages: Arc<dyn messages::domain::api::MessageCommands>,
    pub access: Arc<EntityAccessService>,
    pub crm: DssCrmService,
    pub email: DssEmailService,
    pub email_repo: EmailPgRepo,
    pub documents: Arc<DocumentService>,
    pub properties: Arc<PropertiesService>,
    pub create_task: TaskCreator,
    pub usage: Arc<dyn ai_usage::UsageRecorder>,
}
fn internal(e: impl std::fmt::Display) -> Error {
    Error::Internal(rootcause::report!(e.to_string()).into())
}
fn user(s: &str) -> Result<MacroUserIdStr<'static>> {
    MacroUserIdStr::parse_from_str(s)
        .map(CowLike::into_owned)
        .map_err(|_| Error::Forbidden)
}
fn bounded(s: &str, size: usize) -> String {
    s.chars()
        .scan(0, |n, c| {
            *n += c.len_utf8();
            (*n <= size).then_some(c)
        })
        .collect()
}
impl MacroSupportPlatform {
    async fn visible_customer(
        &self,
        access: &EntityAccessReceipt<MemberTeamRole>,
        email: &str,
        name: &str,
    ) -> Result<Customer> {
        let receipt = CrmTeamReceipt::from_team_receipt(access.clone()).map_err(internal)?;
        let contact = match self.crm.get_contact_by_email(&receipt, email).await {
            Ok(v) => v,
            Err(crm::domain::model::CrmError::CrmDisabledForTeam) => None,
            Err(e) => return Err(internal(e)),
        };
        Ok(Customer {
            email: email.into(),
            name: name.into(),
            contact_id: contact.as_ref().map(|c| c.id),
            company_id: contact.map(|c| c.company_id),
            company_name: None,
        })
    }
}
#[async_trait]
impl Platform for MacroSupportPlatform {
    async fn team_member(&self, team: Uuid, id: &str) -> Result<bool> {
        let id = user(id)?;
        Ok(self
            .access
            .generate_entity_access_receipt::<MemberTeamRole>(
                &id.0,
                None,
                &team.to_string(),
                EntityType::Team,
            )
            .await
            .is_ok())
    }
    async fn customer(
        &self,
        access: &EntityAccessReceipt<MemberTeamRole>,
        email: &str,
        name: &str,
    ) -> Result<Customer> {
        self.visible_customer(access, email, name).await
    }
    async fn customer_for_team(
        &self,
        team: Uuid,
        id: &str,
        email: &str,
        name: &str,
    ) -> Result<Customer> {
        let id = user(id)?;
        let access = self
            .access
            .generate_entity_access_receipt::<MemberTeamRole>(
                &id.0,
                None,
                &team.to_string(),
                EntityType::Team,
            )
            .await
            .map_err(|_| Error::Forbidden)?;
        self.visible_customer(&access, email, name).await
    }
    async fn create_channel(&self, team: Uuid, id: &str, subject: &str) -> Result<Uuid> {
        let result = self
            .channels
            .create_channel(
                Sender::new_from_user(user(id)?),
                None,
                CreateChannelRequest {
                    name: Some(format!("Support · {subject}")),
                    channel_type: ChannelType::Team,
                    team_id: Some(team),
                    auto_join_team: true,
                    participants: Default::default(),
                },
            )
            .await
            .map_err(internal)?;
        Uuid::parse_str(&result.id).map_err(internal)
    }
    async fn post(&self, id: &str, channel: Uuid, reply: &Reply) -> Result<()> {
        let id = user(id)?;
        let access = self
            .access
            .generate_entity_access_receipt::<messages::domain::service::MessageWrite>(
                &id.0,
                None,
                &channel.to_string(),
                EntityType::Channel,
            )
            .await
            .map_err(|_| Error::Forbidden)?;
        self.messages
            .post_from_event(
                access,
                reply.id,
                messages::domain::models::PostMessage {
                    id: Some(reply.id),
                    content: reply.content.clone(),
                    thread_id: None,
                    anchor: None,
                    mentions: reply
                        .mentions
                        .iter()
                        .cloned()
                        .map(serde_json::from_value)
                        .collect::<std::result::Result<_, _>>()?,
                    attachments: vec![],
                    nonce: None,
                    attribution: Default::default(),
                    notification_policy: Default::default(),
                },
            )
            .await
            .map_err(internal)?;
        Ok(())
    }
    async fn task(&self, _team: Uuid, id: &str, task: &str) -> Result<TaskFacts> {
        let id = user(id)?;
        let access = self
            .access
            .generate_entity_access_receipt::<ViewAccessLevel>(
                &id.0,
                None,
                task,
                EntityType::Document,
            )
            .await
            .map_err(|_| Error::Forbidden)?;
        let share = self
            .documents
            .get_team_share(access.clone())
            .await
            .map_err(internal)?;

        let data = self
            .documents
            .get_document(access.clone())
            .await
            .map_err(internal)?;
        let metadata = data.document_metadata.metadata;
        if metadata.sub_type != Some(document_sub_type::DocumentSubType::Task) {
            return Err(Error::Invalid(
                "only team-shared Tasks may be linked".into(),
            ));
        }
        let value = self
            .properties
            .get_system_property_value(&access, system_properties::SystemPropertyKey::Status)
            .await
            .map_err(internal)?;
        let status = if let Some(
            models_properties::service::property_value::PropertyValue::SelectOption(values),
        ) = value
        {
            values
                .first()
                .and_then(|id| system_properties::StatusOption::from_uuid(*id))
                .unwrap_or(system_properties::StatusOption::NotStarted)
        } else {
            system_properties::StatusOption::NotStarted
        };
        Ok(TaskFacts {
            shared_with_team: share.shared_with_team,
            team_id: share.team_id,
            task: LinkedTask {
                id: task.into(),
                title: metadata.document_name,
                status: serde_json::to_value(status)?
                    .as_str()
                    .unwrap_or("not_started")
                    .into(),
            },
        })
    }
    async fn create_task(
        &self,
        team: Uuid,
        id: &str,
        ticket: &Ticket,
        title: &str,
        description: &str,
    ) -> Result<String> {
        (self.create_task)(
            team,
            id.into(),
            ticket.clone(),
            title.into(),
            description.into(),
        )
        .await
    }
    async fn inboxes(&self, id: &str) -> Result<Vec<Inbox>> {
        Ok(self
            .email
            .get_inboxes_for_macro_id(user(id)?)
            .await
            .map_err(internal)?
            .into_iter()
            .filter(|l| l.is_sync_active)
            .map(|l| Inbox {
                id: l.id,
                email: l.email_address.0.as_ref().into(),
            })
            .collect())
    }
    async fn incoming_email(&self, config: &TeamSettings) -> Result<Vec<IncomingEmail>> {
        let link = config.settings.email_link_id.ok_or(Error::Forbidden)?;
        if !self
            .inboxes(&config.user_id)
            .await?
            .iter()
            .any(|i| i.id == link)
        {
            return Err(Error::Forbidden);
        }
        Ok(self
            .email_repo
            .support_mail(
                link,
                config
                    .settings
                    .support_email
                    .as_deref()
                    .ok_or(Error::Forbidden)?,
                config.email_cursor_at,
                config.email_cursor_id,
            )
            .await
            .map_err(internal)?
            .into_iter()
            .map(|e| IncomingEmail {
                id: e.id,
                thread_id: e.thread_id,
                email: e.email,
                name: bounded(&e.name, 200),
                subject: bounded(&e.subject, 240),
                content: bounded(&e.content, 32000),
                created_at: e.created_at,
            })
            .collect())
    }
    async fn send_email(
        &self,
        config: &TeamSettings,
        ticket: &Ticket,
        reply: &Reply,
    ) -> Result<()> {
        let actor = user(&config.user_id)?;
        let inboxes = self
            .email
            .get_inboxes_for_macro_id(actor.clone())
            .await
            .map_err(internal)?;
        let selected = config.settings.email_link_id.ok_or(Error::Forbidden)?;
        let link = inboxes
            .iter()
            .find(|l| l.id == selected && l.is_sync_active)
            .ok_or(Error::Forbidden)?;
        let thread = ticket.email_thread_id.ok_or(Error::Forbidden)?;
        let owned = self
            .email
            .get_owned_link_for_thread(actor.clone(), thread)
            .await
            .map_err(internal)?
            .ok_or(Error::Forbidden)?;
        if owned.id != link.id {
            return Err(Error::Forbidden);
        }
        self.email
            .send_support_reply(
                link,
                &inboxes,
                reply.id,
                CreateDraftInput {
                    db_id: Some(reply.id),
                    provider_id: None,
                    replying_to_id: ticket.email_reply_id,
                    provider_thread_id: None,
                    thread_db_id: Some(thread),
                    subject: ticket.subject.clone(),
                    to: vec![ContactInfo {
                        email: ticket.customer.email.clone(),
                        name: Some(ticket.customer.name.clone()),
                        photo_url: None,
                    }],
                    cc: vec![],
                    bcc: vec![],
                    body_text: Some(reply.content.clone()),
                    body_html: None,
                    body_macro: Some(reply.content.clone()),
                    headers_json: None,
                    send_time: None,
                    include_signature: Some(false),
                    actor: Some(actor),
                    draft_client_binding: None,
                    thread_client_binding: None,
                },
            )
            .await
            .map_err(internal)
    }
    async fn answer(
        &self,
        config: &TeamSettings,
        ticket: &Ticket,
        messages: &[Message],
    ) -> Result<AgentAnswer> {
        let system = format!(
            "{}\n\nTeam guidance:\n{}\n\nPublic knowledge:\n{}",
            include_str!("support-agent.md"),
            config.settings.system_prompt,
            config.settings.knowledge
        );
        let history = messages
            .iter()
            .map(|m| serde_json::json!({"role":m.author_kind,"content":public_content(&m.content)}))
            .collect::<Vec<_>>();
        let text = agent::complete(
            agent::PredefinedModel::Fast,
            &system,
            &serde_json::to_string(&history)?,
            self.usage.as_ref(),
            ai_usage::UsageContext::new(ai_usage::AiFeature::ChannelBot, user(&config.user_id)?)
                .with_entity(Some(ticket.channel_id)),
        )
        .await
        .map_err(internal)?;
        let trimmed = text
            .trim()
            .trim_start_matches("```json")
            .trim_start_matches("```")
            .trim_end_matches("```")
            .trim();
        let answer: AgentAnswer = serde_json::from_str(trimmed)?;
        validate_content(&answer.content)?;
        if !answer.confidence.is_finite() || !(0.0..=1.0).contains(&answer.confidence) {
            return Err(Error::Invalid("invalid agent confidence".into()));
        }
        Ok(answer)
    }
}
