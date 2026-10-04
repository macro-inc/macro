use super::model::*;
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use entity_access::domain::models::{EntityAccessReceipt, MemberTeamRole};
use uuid::Uuid;

pub trait TicketLock: Send {}
#[async_trait]
pub trait Repository: Send + Sync {
    async fn settings(&self, team: Uuid) -> Result<Option<TeamSettings>>;
    async fn save_settings(&self, value: &TeamSettings) -> Result<()>;
    async fn widget(&self, key: Uuid) -> Result<Option<TeamSettings>>;
    async fn active_settings(&self) -> Result<Vec<TeamSettings>>;
    async fn tickets(&self, team: Uuid, filter: &TicketFilter) -> Result<Vec<Ticket>>;
    async fn ticket(&self, team: Uuid, id: Uuid) -> Result<Ticket>;
    async fn email_ticket(&self, team: Uuid, thread: Uuid) -> Result<Option<Ticket>>;
    async fn save(
        &self,
        ticket: &Ticket,
        message: Option<&Message>,
        due: Option<DateTime<Utc>>,
    ) -> Result<()>;
    async fn messages(&self, team: Uuid, id: Uuid, public_only: bool) -> Result<Vec<Message>>;
    async fn message(&self, team: Uuid, ticket: Uuid, id: Uuid) -> Result<Option<Message>>;
    async fn lock(&self, id: Uuid) -> Result<Box<dyn TicketLock>>;
    async fn tasks(&self, team: Uuid, ticket: Uuid) -> Result<Vec<String>>;
    async fn link_task(&self, team: Uuid, ticket: Uuid, task: &str, remove: bool) -> Result<()>;
    async fn visitor(&self, hash: &[u8], origin: &str) -> Result<(Uuid, Uuid)>;
    async fn save_visitor(&self, hash: &[u8], ticket: Uuid, origin: &str) -> Result<()>;
    async fn rate(&self, bucket: &str, limit: i32) -> Result<()>;
    async fn jobs(&self) -> Result<Vec<Job>>;
    async fn finish_job(&self, job: &Job, due: Option<DateTime<Utc>>) -> Result<()>;
    async fn cursor(&self, team: Uuid, at: DateTime<Utc>, id: Uuid) -> Result<()>;
}
/// All outbound calls to other Macro domains are wired in the composition root.
#[async_trait]
pub trait Platform: Send + Sync {
    async fn team_member(&self, team: Uuid, user: &str) -> Result<bool>;
    async fn customer(
        &self,
        access: &EntityAccessReceipt<MemberTeamRole>,
        email: &str,
        name: &str,
    ) -> Result<Customer>;
    async fn customer_for_team(
        &self,
        team: Uuid,
        user: &str,
        email: &str,
        name: &str,
    ) -> Result<Customer>;
    async fn create_channel(&self, team: Uuid, user: &str, subject: &str) -> Result<Uuid>;
    async fn post(&self, user: &str, channel: Uuid, reply: &Reply) -> Result<()>;
    async fn task(&self, team: Uuid, user: &str, id: &str) -> Result<TaskFacts>;
    async fn create_task(
        &self,
        team: Uuid,
        user: &str,
        ticket: &Ticket,
        title: &str,
        description: &str,
    ) -> Result<String>;
    async fn inboxes(&self, user: &str) -> Result<Vec<Inbox>>;
    async fn incoming_email(&self, settings: &TeamSettings) -> Result<Vec<IncomingEmail>>;
    async fn send_email(
        &self,
        settings: &TeamSettings,
        ticket: &Ticket,
        reply: &Reply,
    ) -> Result<()>;
    async fn answer(
        &self,
        settings: &TeamSettings,
        ticket: &Ticket,
        messages: &[Message],
    ) -> Result<AgentAnswer>;
}
