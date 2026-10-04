use super::{model::*, ports::*};
use chrono::{Duration, Utc};
use entity_access::domain::models::{
    AdminTeamRole, EntityAccessReceipt, EntityType, MemberTeamRole, RequiredPermission,
};
use sha2::{Digest, Sha256};
use std::sync::Arc;
use uuid::Uuid;

#[derive(Clone)]
pub struct Service {
    pub repository: Arc<dyn Repository>,
    pub platform: Arc<dyn Platform>,
}
fn scope<T: RequiredPermission>(access: &EntityAccessReceipt<T>) -> Result<(Uuid, String)> {
    if access.entity().entity_type != EntityType::Team {
        return Err(Error::Forbidden);
    }
    Ok((
        Uuid::parse_str(&access.entity().entity_id).map_err(|_| Error::Forbidden)?,
        access
            .get_authenticated_user()
            .map_err(|_| Error::Forbidden)?
            .to_string(),
    ))
}
impl Service {
    pub async fn settings(&self, access: &EntityAccessReceipt<MemberTeamRole>) -> Result<Settings> {
        let (team, _) = scope(access)?;
        Ok(self
            .repository
            .settings(team)
            .await?
            .map(|v| v.settings)
            .unwrap_or_default())
    }
    pub async fn configure(
        &self,
        access: &EntityAccessReceipt<AdminTeamRole>,
        mut settings: Settings,
    ) -> Result<Settings> {
        let (team, user) = scope(access)?;
        settings.validate()?;
        if let Some(id) = settings.email_link_id
            && !self
                .platform
                .inboxes(&user)
                .await?
                .iter()
                .any(|i| i.id == id)
        {
            return Err(Error::Forbidden);
        }
        let previous = self.repository.settings(team).await?;
        let now = Utc::now();
        let (cursor, id) = if let Some(old) = previous {
            settings.widget_key = old.settings.widget_key;
            if old.settings.email_link_id == settings.email_link_id
                && old.settings.support_email == settings.support_email
            {
                (old.email_cursor_at, old.email_cursor_id)
            } else {
                (now, Uuid::nil())
            }
        } else {
            (now, Uuid::nil())
        };
        self.repository
            .save_settings(&TeamSettings {
                team_id: team,
                user_id: user,
                settings: settings.clone(),
                email_cursor_at: cursor,
                email_cursor_id: id,
            })
            .await?;
        Ok(settings)
    }
    pub async fn list(
        &self,
        access: &EntityAccessReceipt<MemberTeamRole>,
        filter: &TicketFilter,
    ) -> Result<Vec<Ticket>> {
        let (team, _) = scope(access)?;
        self.repository.tickets(team, filter).await
    }
    pub async fn detail(
        &self,
        access: &EntityAccessReceipt<MemberTeamRole>,
        id: Uuid,
    ) -> Result<Detail> {
        let (team, user) = scope(access)?;
        self.detail_for(team, &user, id).await
    }
    async fn detail_for(&self, team: Uuid, user: &str, id: Uuid) -> Result<Detail> {
        let ticket = self.repository.ticket(team, id).await?;
        let messages = self.repository.messages(team, id, false).await?;
        let mut tasks = vec![];
        for task in self.repository.tasks(team, id).await? {
            match self.platform.task(team, user, &task).await {
                Ok(facts) if facts.shared_with_team && facts.team_id == Some(team) => {
                    tasks.push(facts.task)
                }
                Ok(_) => {}
                Err(Error::Forbidden | Error::NotFound) => {}
                Err(e) => return Err(e),
            }
        }
        Ok(Detail {
            ticket,
            messages,
            tasks,
        })
    }
    pub async fn create(
        &self,
        access: &EntityAccessReceipt<MemberTeamRole>,
        input: NewTicket,
    ) -> Result<Ticket> {
        let (team, user) = scope(access)?;
        let customer = self
            .platform
            .customer(access, &input.email.to_lowercase(), &input.name)
            .await?;
        self.create_for(team, &user, input, customer, Source::Manual, None)
            .await
    }
    async fn create_for(
        &self,
        team: Uuid,
        user: &str,
        input: NewTicket,
        customer: Customer,
        source: Source,
        email: Option<&IncomingEmail>,
    ) -> Result<Ticket> {
        validate_content(&input.content)?;
        if !valid_email(&input.email)
            || input.subject.trim().is_empty()
            || input.subject.len() > 240
            || input.name.len() > 200
        {
            return Err(Error::Invalid("invalid ticket subject or customer".into()));
        }
        let customer = if customer.contact_id.is_none() {
            self.platform
                .customer_for_team(team, user, &customer.email, &customer.name)
                .await?
        } else {
            customer
        };
        let channel = self
            .platform
            .create_channel(team, user, &input.subject)
            .await?;
        let now = Utc::now();
        let id = Uuid::now_v7();
        let mut ticket = Ticket {
            id,
            team_id: team,
            channel_id: channel,
            subject: input.subject,
            customer,
            status: Status::Open,
            priority: Priority::Medium,
            assignee_id: None,
            source,
            email_thread_id: email.map(|e| e.thread_id),
            email_reply_id: email.map(|e| e.id),
            agent_paused: false,
            draft: None,
            preview: String::new(),
            last_customer_message_id: None,
            last_customer_at: None,
            last_human_reply_at: None,
            created_at: now,
            updated_at: now,
        };
        // Persist the ticket before the canonical post so a projection failure is retryable.
        self.repository.save(&ticket, None, None).await?;
        self.customer_message(
            &mut ticket,
            user,
            email
                .map(|e| incoming_message_id(e.id, e.created_at))
                .unwrap_or_else(Uuid::now_v7),
            &input.content,
            email,
        )
        .await?;
        Ok(ticket)
    }
    pub async fn patch(
        &self,
        access: &EntityAccessReceipt<MemberTeamRole>,
        id: Uuid,
        input: TicketPatch,
    ) -> Result<Ticket> {
        let (team, _) = scope(access)?;
        let _lock = self.repository.lock(id).await?;
        let mut ticket = self.repository.ticket(team, id).await?;
        if let Some(assignee) = input.assignee_id {
            if !assignee.is_empty() && !self.platform.team_member(team, &assignee).await? {
                return Err(Error::Forbidden);
            }
            ticket.assignee_id = (!assignee.is_empty()).then_some(assignee);
        }
        if let Some(status) = input.status {
            ticket.status = status;
            ticket.draft = None;
        }
        if let Some(priority) = input.priority {
            ticket.priority = priority;
        }
        if let Some(paused) = input.agent_paused {
            ticket.agent_paused = paused;
        }
        ticket.updated_at = Utc::now();
        self.repository.save(&ticket, None, None).await?;
        Ok(ticket)
    }
    pub async fn reply(
        &self,
        access: &EntityAccessReceipt<MemberTeamRole>,
        id: Uuid,
        reply: Reply,
    ) -> Result<Ticket> {
        let (team, user) = scope(access)?;
        let _lock = self.repository.lock(id).await?;
        let mut ticket = self.repository.ticket(team, id).await?;
        self.send(&mut ticket, &user, reply, Author::Human).await?;
        Ok(ticket)
    }
    async fn send(
        &self,
        ticket: &mut Ticket,
        user: &str,
        mut reply: Reply,
        author: Author,
    ) -> Result<()> {
        validate_content(&reply.content)?;
        if reply.public && !has_customer_channel(ticket.source) {
            return Err(Error::Invalid("This is a tracking ticket. Use internal notes; customer replies require an email or website conversation.".into()));
        }

        if reply.id.get_version_num() != 7 {
            return Err(Error::Invalid("message id must be UUIDv7".into()));
        }
        if self
            .repository
            .message(ticket.team_id, ticket.id, reply.id)
            .await?
            .is_some()
        {
            return Ok(());
        }
        let content = reply.content.clone();
        if matches!(author, Author::Agent) {
            reply.content = format!("**Support agent**\n\n{}", reply.content);
        }
        if !reply.public {
            reply.content = format!("**Internal note**\n\n{}", reply.content);
        }
        self.platform.post(user, ticket.channel_id, &reply).await?;
        reply.content = public_content(&content);
        if reply.public && ticket.source == Source::Email {
            let settings = self
                .repository
                .settings(ticket.team_id)
                .await?
                .ok_or(Error::Forbidden)?;
            self.platform.send_email(&settings, ticket, &reply).await?;
        }
        let now = Utc::now();
        let human = matches!(author, Author::Human);
        let message = Message {
            id: reply.id,
            author_kind: author,
            author_name: if human {
                user.into()
            } else {
                "Support agent".into()
            },
            content,
            public: reply.public,
            email_message_id: None,
            created_at: now,
        };
        if reply.public {
            ticket.status = Status::WaitingOnCustomer;
            ticket.draft = None;
            ticket.preview = reply.content;
            if human {
                ticket.last_human_reply_at = Some(now);
            }
        }
        ticket.updated_at = now;
        self.repository.save(ticket, Some(&message), None).await
    }
    async fn customer_message(
        &self,
        ticket: &mut Ticket,
        user: &str,
        id: Uuid,
        content: &str,
        email: Option<&IncomingEmail>,
    ) -> Result<()> {
        validate_content(content)?;
        if self
            .repository
            .message(ticket.team_id, ticket.id, id)
            .await?
            .is_some()
        {
            return Ok(());
        }
        let reply = Reply {
            id,
            content: format!("**{} (customer)**\n\n{}", ticket.customer.name, content),
            public: true,
            mentions: vec![],
        };
        self.platform.post(user, ticket.channel_id, &reply).await?;
        let now = Utc::now();
        let message = Message {
            id,
            author_kind: Author::Customer,
            author_name: ticket.customer.name.clone(),
            content: content.into(),
            public: true,
            email_message_id: email.map(|e| e.id),
            created_at: now,
        };
        ticket.status = Status::Open;
        ticket.draft = None;
        ticket.preview = content.into();
        ticket.last_customer_message_id = Some(id);
        ticket.last_customer_at = Some(now);
        ticket.updated_at = now;
        if let Some(email) = email {
            ticket.email_reply_id = Some(email.id);
        }
        let settings = self.repository.settings(ticket.team_id).await?;
        let due = settings
            .filter(|s| s.settings.agent_enabled)
            .map(|s| agent_due(&s.settings, now));
        self.repository.save(ticket, Some(&message), due).await
    }
    pub async fn link_task(
        &self,
        access: &EntityAccessReceipt<MemberTeamRole>,
        id: Uuid,
        input: TaskInput,
    ) -> Result<LinkedTask> {
        let (team, user) = scope(access)?;
        let _lock = self.repository.lock(id).await?;
        let ticket = self.repository.ticket(team, id).await?;
        if self.repository.tasks(team, id).await?.len() >= 20 {
            return Err(Error::Invalid("a ticket can link up to 20 Tasks".into()));
        }
        let task_id = if let Some(task) = input.task_id {
            task
        } else {
            let title = input
                .title
                .filter(|v| !v.trim().is_empty() && v.len() <= 240)
                .ok_or_else(|| Error::Invalid("Task title required".into()))?;
            self.platform
                .create_task(team, &user, &ticket, &title, &input.description)
                .await?
        };
        let facts = self.platform.task(team, &user, &task_id).await?;
        if !facts.shared_with_team || facts.team_id != Some(team) {
            return Err(Error::Forbidden);
        }
        let task = facts.task;
        self.repository.link_task(team, id, &task_id, false).await?;
        Ok(task)
    }
    pub async fn unlink_task(
        &self,
        access: &EntityAccessReceipt<MemberTeamRole>,
        id: Uuid,
        task: &str,
    ) -> Result<()> {
        let (team, _) = scope(access)?;
        self.repository.ticket(team, id).await?;
        self.repository.link_task(team, id, task, true).await
    }
    pub async fn inboxes(
        &self,
        access: &EntityAccessReceipt<MemberTeamRole>,
    ) -> Result<Vec<Inbox>> {
        let (_, user) = scope(access)?;
        self.platform.inboxes(&user).await
    }
    async fn widget_settings(&self, key: Uuid, origin: &str) -> Result<TeamSettings> {
        let config = self.repository.widget(key).await?.ok_or(Error::NotFound)?;
        if !config.settings.widget_enabled
            || !config.settings.allowed_origins.iter().any(|o| o == origin)
            || !self
                .platform
                .team_member(config.team_id, &config.user_id)
                .await?
        {
            return Err(Error::Forbidden);
        }
        Ok(config)
    }
    pub async fn widget_config(&self, key: Uuid, origin: &str) -> Result<serde_json::Value> {
        let config = self.widget_settings(key, origin).await?;
        Ok(serde_json::json!({"name":config.settings.name,"welcome":config.settings.welcome}))
    }
    pub async fn open_visitor(
        &self,
        key: Uuid,
        origin: &str,
        input: NewTicket,
    ) -> Result<serde_json::Value> {
        let config = self.widget_settings(key, origin).await?;
        self.repository
            .rate(&format!("open:{}", config.team_id), 30)
            .await?;
        let customer = Customer {
            email: input.email.to_lowercase(),
            name: input.name.clone(),
            contact_id: None,
            company_id: None,
            company_name: None,
        };
        let ticket = self
            .create_for(
                config.team_id,
                &config.user_id,
                input,
                customer,
                Source::Widget,
                None,
            )
            .await?;
        let token = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
        self.repository
            .save_visitor(&Sha256::digest(token.as_bytes()), ticket.id, origin)
            .await?;
        Ok(serde_json::json!({"token":token}))
    }
    async fn visitor_ticket(&self, token: &str, origin: &str) -> Result<(Ticket, TeamSettings)> {
        if token.len() != 64 || !token.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err(Error::Forbidden);
        }
        let hash = Sha256::digest(token.as_bytes());
        let (team, id) = self.repository.visitor(&hash, origin).await?;
        let settings = self
            .repository
            .settings(team)
            .await?
            .ok_or(Error::Forbidden)?;
        self.widget_settings(settings.settings.widget_key, origin)
            .await?;
        self.repository
            .rate(&format!("session:{hash:x}"), 60)
            .await?;
        Ok((self.repository.ticket(team, id).await?, settings))
    }
    pub async fn visitor_messages(&self, token: &str, origin: &str) -> Result<serde_json::Value> {
        let (ticket, _) = self.visitor_ticket(token, origin).await?;
        let messages = self
            .repository
            .messages(ticket.team_id, ticket.id, true)
            .await?;
        Ok(
            serde_json::json!({"messages":messages.into_iter().map(|m|serde_json::json!({"id":m.id,"author_kind":m.author_kind,"content":public_content(&m.content),"created_at":m.created_at})).collect::<Vec<_>>()}),
        )
    }
    pub async fn visitor_reply(&self, token: &str, origin: &str, reply: Reply) -> Result<()> {
        if reply.id.get_version_num() != 7 {
            return Err(Error::Invalid("message id must be UUIDv7".into()));
        }
        let (ticket, settings) = self.visitor_ticket(token, origin).await?;
        let _lock = self.repository.lock(ticket.id).await?;
        let mut ticket = self.repository.ticket(ticket.team_id, ticket.id).await?;
        self.customer_message(
            &mut ticket,
            &settings.user_id,
            reply.id,
            &reply.content,
            None,
        )
        .await
    }
    pub async fn sweep(&self) -> Result<()> {
        for config in self.repository.active_settings().await? {
            if !self
                .platform
                .team_member(config.team_id, &config.user_id)
                .await?
            {
                continue;
            }
            if config.settings.email_link_id.is_some() {
                match tokio::time::timeout(
                    std::time::Duration::from_secs(60),
                    self.import_mail(&config),
                )
                .await
                {
                    Ok(Ok(())) => {}
                    other => tracing::warn!(?other, "Support email intake failed"),
                }
            }
        }
        let mut workers = Vec::new();
        for job in self.repository.jobs().await? {
            let service = self.clone();
            workers.push(tokio::spawn(async move {
                match tokio::time::timeout(
                    std::time::Duration::from_secs(120),
                    service.process_job(&job),
                )
                .await
                {
                    Ok(Ok(())) => {}
                    other => tracing::warn!(?other, "Support agent job failed"),
                }
            }));
        }
        for worker in workers {
            if let Err(e) = worker.await {
                tracing::warn!(error=?e,"Support agent worker failed");
            }
        }
        Ok(())
    }
    async fn import_mail(&self, config: &TeamSettings) -> Result<()> {
        for email in self.platform.incoming_email(config).await? {
            let lock_id = email.thread_id;
            let _lock = self.repository.lock(lock_id).await?;
            if let Some(mut ticket) = self
                .repository
                .email_ticket(config.team_id, email.thread_id)
                .await?
            {
                let _ticket_lock = self.repository.lock(ticket.id).await?;
                ticket = self.repository.ticket(config.team_id, ticket.id).await?;
                if !self
                    .repository
                    .messages(config.team_id, ticket.id, false)
                    .await?
                    .iter()
                    .any(|m| m.email_message_id == Some(email.id))
                {
                    self.customer_message(
                        &mut ticket,
                        &config.user_id,
                        incoming_message_id(email.id, email.created_at),
                        &email.content,
                        Some(&email),
                    )
                    .await?;
                }
            } else {
                let customer = Customer {
                    email: email.email.clone(),
                    name: email.name.clone(),
                    company_id: None,
                    contact_id: None,
                    company_name: None,
                };
                self.create_for(
                    config.team_id,
                    &config.user_id,
                    NewTicket {
                        subject: email.subject.clone(),
                        email: email.email.clone(),
                        name: email.name.clone(),
                        content: email.content.clone(),
                    },
                    customer,
                    Source::Email,
                    Some(&email),
                )
                .await?;
            }
            self.repository
                .cursor(config.team_id, email.created_at, email.id)
                .await?;
        }
        Ok(())
    }
    async fn process_job(&self, job: &Job) -> Result<()> {
        let config = self
            .repository
            .settings(job.team_id)
            .await?
            .ok_or(Error::NotFound)?;
        let ticket = self.repository.ticket(job.team_id, job.ticket_id).await?;
        if !eligible(&config.settings, &ticket, job.trigger_id)
            || !self
                .platform
                .team_member(job.team_id, &config.user_id)
                .await?
        {
            self.repository.finish_job(job, None).await?;
            return Ok(());
        }
        let history = self
            .repository
            .messages(job.team_id, job.ticket_id, true)
            .await?;
        let generated_config = config.clone();
        let answer = self.platform.answer(&config, &ticket, &history).await?;
        let _lock = self.repository.lock(job.ticket_id).await?;
        let config = self
            .repository
            .settings(job.team_id)
            .await?
            .ok_or(Error::NotFound)?;
        let mut current = self.repository.ticket(job.team_id, job.ticket_id).await?;
        if !eligible(&config.settings, &current, job.trigger_id) {
            self.repository.finish_job(job, None).await?;
            return Ok(());
        }
        if !self
            .platform
            .team_member(job.team_id, &config.user_id)
            .await?
        {
            self.repository.finish_job(job, None).await?;
            return Ok(());
        }
        if !same_grounding(&generated_config, &config) {
            return self.repository.finish_job(job, Some(Utc::now())).await;
        }
        let due = agent_due(
            &config.settings,
            current.last_customer_at.ok_or(Error::NotFound)?,
        );
        if config.settings.response_mode == ResponseMode::Delayed && due > Utc::now() {
            return self.repository.finish_job(job, Some(due)).await;
        }
        validate_content(&answer.content)?;
        if has_customer_channel(current.source) && dispatches(&config.settings, &answer) {
            let reply = Reply {
                id: agent_message_id(job.trigger_id),
                content: public_content(&answer.content),
                public: true,
                mentions: vec![],
            };
            self.send(&mut current, &config.user_id, reply, Author::Agent)
                .await?;
        } else {
            current.draft = Some(answer);
            current.updated_at = Utc::now();
            self.repository.save(&current, None, None).await?;
        }
        self.repository.finish_job(job, None).await
    }
}
fn has_customer_channel(source: Source) -> bool {
    matches!(source, Source::Widget | Source::Email)
}
fn same_grounding(previous: &TeamSettings, current: &TeamSettings) -> bool {
    previous.user_id == current.user_id
        && previous.settings.system_prompt == current.settings.system_prompt
        && previous.settings.knowledge == current.settings.knowledge
}
fn agent_due(settings: &Settings, at: chrono::DateTime<Utc>) -> chrono::DateTime<Utc> {
    at + Duration::minutes(if settings.response_mode == ResponseMode::Delayed {
        settings.delay_minutes as i64
    } else {
        0
    })
}
fn eligible(settings: &Settings, ticket: &Ticket, trigger: Uuid) -> bool {
    settings.agent_enabled
        && !ticket.agent_paused
        && ticket.status == Status::Open
        && ticket.last_customer_message_id == Some(trigger)
        && ticket
            .last_human_reply_at
            .zip(ticket.last_customer_at)
            .is_none_or(|(human, customer)| human < customer)
}
fn dispatches(settings: &Settings, answer: &AgentAnswer) -> bool {
    !answer.handoff
        && answer.confidence.is_finite()
        && answer.confidence >= settings.confidence_threshold
        && settings.response_mode != ResponseMode::Draft
}
fn agent_message_id(trigger: Uuid) -> Uuid {
    let mut bytes = *trigger.as_bytes();
    let hash = Sha256::digest(trigger.as_bytes());
    bytes[8..].copy_from_slice(&hash[..8]);
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    Uuid::from_bytes(bytes)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn human_review_and_confidence() {
        let mut config = Settings::default();
        let answer = AgentAnswer {
            content: "answer".into(),
            confidence: 0.9,
            handoff: false,
        };
        assert!(!dispatches(&config, &answer));
        config.response_mode = ResponseMode::Automatic;
        assert!(dispatches(&config, &answer));
        assert!(!dispatches(
            &config,
            &AgentAnswer {
                confidence: 0.5,
                ..answer.clone()
            }
        ));
        assert!(!dispatches(
            &config,
            &AgentAnswer {
                handoff: true,
                ..answer
            }
        ));
    }
    #[test]
    fn suppression_checks_current_customer_human_pause_and_resolution() {
        let now = Utc::now();
        let trigger = Uuid::now_v7();
        let settings = Settings {
            agent_enabled: true,
            ..Default::default()
        };
        let mut ticket = Ticket {
            id: Uuid::now_v7(),
            team_id: Uuid::now_v7(),
            channel_id: Uuid::now_v7(),
            subject: "Help".into(),
            customer: Customer {
                email: "nina@acme.com".into(),
                name: "Nina".into(),
                contact_id: None,
                company_id: None,
                company_name: None,
            },
            status: Status::Open,
            priority: Priority::Medium,
            assignee_id: None,
            source: Source::Widget,
            email_thread_id: None,
            email_reply_id: None,
            agent_paused: false,
            draft: None,
            preview: String::new(),
            last_customer_message_id: Some(trigger),
            last_customer_at: Some(now),
            last_human_reply_at: None,
            created_at: now,
            updated_at: now,
        };
        assert!(eligible(&settings, &ticket, trigger));
        assert!(!eligible(&settings, &ticket, Uuid::now_v7()));
        ticket.agent_paused = true;
        assert!(!eligible(&settings, &ticket, trigger));
        ticket.agent_paused = false;
        ticket.status = Status::Resolved;
        assert!(!eligible(&settings, &ticket, trigger));
        ticket.status = Status::Open;
        ticket.last_human_reply_at = Some(now);
        assert!(!eligible(&settings, &ticket, trigger));
        ticket.last_customer_at = Some(now + Duration::seconds(1));
        assert!(eligible(&settings, &ticket, trigger));
        assert!(!eligible(&Settings::default(), &ticket, trigger));
    }
    #[test]
    fn tracking_tickets_cannot_claim_to_send_customer_replies() {
        assert!(!has_customer_channel(Source::Manual));
        assert!(has_customer_channel(Source::Widget));
        assert!(has_customer_channel(Source::Email));
    }
    #[test]
    fn changed_grounding_requires_regeneration() {
        let previous = TeamSettings {
            team_id: Uuid::now_v7(),
            user_id: "macro|admin@acme.com".into(),
            settings: Settings::default(),
            email_cursor_at: Utc::now(),
            email_cursor_id: Uuid::nil(),
        };
        let mut current = previous.clone();
        assert!(same_grounding(&previous, &current));
        current.settings.knowledge = "New public policy".into();
        assert!(!same_grounding(&previous, &current));
        current = previous.clone();
        current.settings.system_prompt = "Escalate all requests".into();
        assert!(!same_grounding(&previous, &current));
        current = previous.clone();
        current.user_id = "macro|other@acme.com".into();
        assert!(!same_grounding(&previous, &current));
    }
    #[test]
    fn incoming_email_retries_use_one_uuid7() {
        let id = Uuid::new_v4();
        let at = Utc::now();
        assert_eq!(incoming_message_id(id, at), incoming_message_id(id, at));
        assert_eq!(incoming_message_id(id, at).get_version_num(), 7);
    }
    #[test]
    fn stable_uuid7() {
        let id = Uuid::now_v7();
        assert_eq!(agent_message_id(id), agent_message_id(id));
        assert_eq!(agent_message_id(id).get_version_num(), 7);
        assert_ne!(agent_message_id(id), id);
    }
    #[test]
    fn delay() {
        let mut config = Settings::default();
        let now = Utc::now();
        assert_eq!(agent_due(&config, now), now);
        config.response_mode = ResponseMode::Delayed;
        assert_eq!(agent_due(&config, now), now + Duration::minutes(5));
    }
}

fn incoming_message_id(id: Uuid, at: chrono::DateTime<Utc>) -> Uuid {
    let digest = Sha256::digest(id.as_bytes());
    let mut bytes: [u8; 16] = digest[..16].try_into().expect("SHA256 contains 16 bytes");
    let time = (at.timestamp_millis().max(0) as u64).to_be_bytes();
    bytes[..6].copy_from_slice(&time[2..]);
    bytes[6] = (bytes[6] & 15) | 0x70;
    bytes[8] = (bytes[8] & 63) | 0x80;
    Uuid::from_bytes(bytes)
}
