mod draft;
mod previews;
mod send;
mod signature;
mod thread;
mod thread_labels;

use crate::domain::{
    events::{EmailMacroEvent, ThreadProjectChangedMetadata},
    models::{
        CreateDraftInput, CreatedDraft, EmailErr, EmailFilter, EnrichedEmailThreadPreview,
        GetEmailsRequest, Link, LinkLabel, ParsedThread, Thread, UpdateThreadLabelsResult,
        UpsertEmailFilterInput,
    },
    ports::{EmailMessageEnqueuer, EmailRepo, EmailService},
};
use crm::domain::service::CrmService;
use entity_access::domain::models::{
    AccessLevel, EditAccessLevel, EntityAccessReceipt, EntityPermission, ViewAccessLevel,
};
use entity_access_management::domain::ports::EntityAccessManagementService;
use frecency::domain::ports::FrecencyQueryService;
use macro_event_broker::{MacroEventBroker, NoopMacroEventBroker};
use model_entity::EntityType;
use models_pagination::{PaginatedCursor, SimpleSortMethod};
use uuid::Uuid;

#[derive(Clone)]
pub struct EmailServiceImpl<T, U, E, CS, Eam, B = NoopMacroEventBroker> {
    pub(crate) email_repo: T,
    pub(crate) frecency_service: U,
    pub(crate) enqueuer: E,
    pub(crate) crm_service: CS,
    pub(crate) entity_access_management_service: Eam,
    pub(crate) macro_event_broker: B,
    pub(crate) sent_undo_delay_secs: u32,
}

impl<T, U, E, CS, Eam> EmailServiceImpl<T, U, E, CS, Eam>
where
    T: EmailRepo,
    U: FrecencyQueryService,
    E: EmailMessageEnqueuer,
    CS: CrmService,
    Eam: EntityAccessManagementService,
{
    pub fn new(
        email_repo: T,
        frecency_service: U,
        enqueuer: E,
        crm_service: CS,
        entity_access_management_service: Eam,
        sent_undo_delay_secs: u32,
    ) -> EmailServiceImpl<T, U, E, CS, Eam> {
        EmailServiceImpl {
            email_repo,
            frecency_service,
            enqueuer,
            crm_service,
            entity_access_management_service,
            macro_event_broker: NoopMacroEventBroker,
            sent_undo_delay_secs,
        }
    }
}

impl<T, U, E, CS, Eam, B> EmailServiceImpl<T, U, E, CS, Eam, B> {
    /// Replace the event broker used to publish `macro.email` events.
    /// [`new`](Self::new) starts with a [`NoopMacroEventBroker`].
    pub fn with_macro_event_broker<B2: MacroEventBroker>(
        self,
        macro_event_broker: B2,
    ) -> EmailServiceImpl<T, U, E, CS, Eam, B2> {
        EmailServiceImpl {
            email_repo: self.email_repo,
            frecency_service: self.frecency_service,
            enqueuer: self.enqueuer,
            crm_service: self.crm_service,
            entity_access_management_service: self.entity_access_management_service,
            macro_event_broker,
            sent_undo_delay_secs: self.sent_undo_delay_secs,
        }
    }

    /// Publish an email event to the `macro.email` topic, logging and
    /// dropping failures — event emission must never fail the operation.
    pub(crate) async fn publish_email_event(&self, event: &EmailMacroEvent)
    where
        B: MacroEventBroker,
    {
        let _ = self
            .macro_event_broker
            .send_event(event)
            .await
            .inspect_err(|e| tracing::error!(error=?e, "failed to publish email macro event"));
    }
}

impl<T, U, E, CS, Eam, B> EmailServiceImpl<T, U, E, CS, Eam, B> {
    /// Validate and normalize email filter input.
    fn validate_email_filter_input(
        input: UpsertEmailFilterInput,
    ) -> Result<UpsertEmailFilterInput, EmailErr> {
        match (&input.email_address, &input.email_domain) {
            (Some(addr), None) => {
                let addr = addr.trim().to_lowercase();
                if addr.is_empty() {
                    return Err(EmailErr::InvalidEmailFilter(
                        "Email address cannot be empty".to_string(),
                    ));
                }
                if !addr.contains('@') {
                    return Err(EmailErr::InvalidEmailFilter(
                        "Invalid email address format".to_string(),
                    ));
                }
                if addr.len() > 320 {
                    return Err(EmailErr::InvalidEmailFilter(
                        "Email address is too long".to_string(),
                    ));
                }
                Ok(UpsertEmailFilterInput {
                    email_address: Some(addr),
                    email_domain: None,
                    is_important: input.is_important,
                })
            }
            (None, Some(domain)) => {
                let domain = domain.trim().to_lowercase();
                if domain.is_empty() {
                    return Err(EmailErr::InvalidEmailFilter(
                        "Email domain cannot be empty".to_string(),
                    ));
                }
                if domain.contains('@') {
                    return Err(EmailErr::InvalidEmailFilter(
                        "Domain must not contain '@'; use email_address for full addresses"
                            .to_string(),
                    ));
                }
                if domain.len() > 255 {
                    return Err(EmailErr::InvalidEmailFilter(
                        "Email domain is too long".to_string(),
                    ));
                }
                Ok(UpsertEmailFilterInput {
                    email_address: None,
                    email_domain: Some(domain),
                    is_important: input.is_important,
                })
            }
            _ => Err(EmailErr::InvalidEmailFilter(
                "Exactly one of email_address or email_domain must be provided".to_string(),
            )),
        }
    }
}

impl<T, U, E, CS, Eam, B> EmailService for EmailServiceImpl<T, U, E, CS, Eam, B>
where
    T: EmailRepo,
    U: FrecencyQueryService,
    E: EmailMessageEnqueuer,
    CS: CrmService,
    Eam: EntityAccessManagementService,
    B: MacroEventBroker,
    anyhow::Error: From<T::Err>,
    anyhow::Error: From<E::Err>,
{
    async fn get_email_thread_previews(
        &self,
        req: GetEmailsRequest,
    ) -> Result<PaginatedCursor<EnrichedEmailThreadPreview, Uuid, SimpleSortMethod, ()>, EmailErr>
    {
        self.get_email_thread_previews_impl(req).await
    }

    async fn get_link_by_auth_id_and_macro_id(
        &self,
        auth_id: &str,
        macro_id: macro_user_id::user_id::MacroUserIdStr<'_>,
    ) -> Result<Option<crate::domain::models::Link>, EmailErr> {
        self.get_link_by_auth_id_and_macro_id_impl(auth_id, macro_id)
            .await
    }

    async fn get_link_by_macro_id(
        &self,
        macro_id: macro_user_id::user_id::MacroUserIdStr<'_>,
    ) -> Result<Option<crate::domain::models::Link>, EmailErr> {
        self.email_repo
            .link_by_macro_id(macro_id)
            .await
            .map_err(|e| EmailErr::RepoErr(e.into()))
    }

    async fn get_inboxes_for_macro_id(
        &self,
        macro_id: macro_user_id::user_id::MacroUserIdStr<'_>,
    ) -> Result<Vec<crate::domain::models::Link>, EmailErr> {
        self.email_repo
            .inboxes_for_macro_id(macro_id)
            .await
            .map_err(|e| EmailErr::RepoErr(e.into()))
    }

    async fn get_owned_link_for_thread(
        &self,
        macro_id: macro_user_id::user_id::MacroUserIdStr<'_>,
        thread_id: uuid::Uuid,
    ) -> Result<Option<crate::domain::models::Link>, EmailErr> {
        self.email_repo
            .owned_link_for_thread(thread_id, macro_id)
            .await
            .map_err(|e| EmailErr::RepoErr(e.into()))
    }

    async fn get_thread_with_messages(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
        offset: i64,
        limit: i64,
    ) -> Result<Option<Thread>, EmailErr> {
        self.get_thread_with_messages_impl(receipt, offset, limit)
            .await
    }

    async fn get_thread_parsed(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
        offset: i64,
        limit: i64,
    ) -> Result<Option<ParsedThread>, EmailErr> {
        self.get_thread_parsed_impl(receipt, offset, limit).await
    }

    async fn create_draft(
        &self,
        link: &Link,
        accessible_inboxes: &[Link],
        input: CreateDraftInput,
    ) -> Result<CreatedDraft, EmailErr> {
        self.create_draft_impl(link, accessible_inboxes, input)
            .await
    }

    async fn send_message(
        &self,
        link: &Link,
        accessible_inboxes: &[Link],
        input: CreateDraftInput,
    ) -> Result<CreatedDraft, EmailErr> {
        self.send_message_impl(link, accessible_inboxes, input)
            .await
    }

    async fn list_labels(&self, link: &Link) -> Result<Vec<LinkLabel>, EmailErr> {
        self.email_repo
            .list_labels_by_link_id(link.id)
            .await
            .map_err(|e| EmailErr::RepoErr(e.into()))
    }

    async fn update_thread_labels(
        &self,
        access_token: &str,
        link: &Link,
        thread_id: Uuid,
        label_id: Uuid,
        add: bool,
    ) -> Result<UpdateThreadLabelsResult, EmailErr> {
        self.update_thread_labels_impl(access_token, link, thread_id, label_id, add)
            .await
    }

    async fn update_thread_project(
        &self,
        thread_receipt: EntityAccessReceipt<EditAccessLevel>,
        project_receipt: Option<EntityAccessReceipt<EditAccessLevel>>,
    ) -> Result<Option<String>, EmailErr> {
        let is_owner = matches!(
            thread_receipt.entity_permission(),
            EntityPermission::AccessLevel {
                access_level: AccessLevel::Owner
            }
        );

        if !is_owner {
            return Err(EmailErr::Unauthorized);
        }

        let thread_id = Uuid::parse_str(&thread_receipt.entity().entity_id)
            .map_err(|e| EmailErr::RepoErr(anyhow::anyhow!("invalid thread id: {}", e)))?;

        let project_id = project_receipt
            .as_ref()
            .map(|r| r.entity().entity_id.as_str());

        let old_project_id = self
            .email_repo
            .get_thread_project_id(thread_id)
            .await
            .map_err(|e| EmailErr::RepoErr(e.into()))?;

        let updated = self
            .email_repo
            .update_thread_project(thread_id, project_id)
            .await
            .map_err(|e| EmailErr::RepoErr(e.into()))?;

        if !updated {
            return Err(EmailErr::ThreadNotFound);
        }

        // Sync denormalized entity_access rows for the containing project.
        // Best-effort: the project assignment itself already succeeded.
        if old_project_id.as_deref() != project_id {
            if let Some(old) = old_project_id
                .as_deref()
                .and_then(|p| Uuid::parse_str(p).ok())
            {
                let _ = self
                    .entity_access_management_service
                    .remove_entity_from_project(&thread_id, EntityType::EmailThread, &old)
                    .await
                    .inspect_err(
                        |e| tracing::error!(error=?e, project_id=%old, "unable to remove thread project access"),
                    );
            }
            if let Some(new) = project_id.and_then(|p| Uuid::parse_str(p).ok()) {
                let _ = self
                    .entity_access_management_service
                    .add_entity_to_project(&thread_id, EntityType::EmailThread, &new)
                    .await
                    .inspect_err(
                        |e| tracing::error!(error=?e, project_id=%new, "unable to add thread project access"),
                    );
            }

            // Best-effort: emit only when the acting user and the thread's
            // link both resolve (the receipt is authenticated on this route).
            match thread_receipt.get_authenticated_user() {
                Ok(actor) => match self
                    .email_repo
                    .owned_link_for_thread(thread_id, actor.clone())
                    .await
                {
                    Ok(Some(link)) => {
                        self.publish_email_event(&EmailMacroEvent::thread_project_changed(
                            ThreadProjectChangedMetadata {
                                link_id: link.id,
                                owner: link.macro_id.clone(),
                                actor: actor.clone(),
                                thread_id,
                                previous_project_id: old_project_id.clone(),
                                project_id: project_id.map(|p| p.to_string()),
                            },
                        ))
                        .await;
                    }
                    Ok(None) => tracing::warn!(
                        %thread_id,
                        "skipping thread_project_changed event: no owned link resolved for actor"
                    ),
                    Err(e) => {
                        let e = anyhow::Error::from(e);
                        tracing::warn!(
                            error=?e,
                            %thread_id,
                            "skipping thread_project_changed event: link lookup failed"
                        );
                    }
                },
                Err(_) => tracing::debug!(
                    %thread_id,
                    "skipping thread_project_changed event: receipt has no authenticated user"
                ),
            }
        }

        Ok(old_project_id)
    }

    async fn upsert_email_filter(
        &self,
        link: &Link,
        input: UpsertEmailFilterInput,
    ) -> Result<EmailFilter, EmailErr> {
        let validated = Self::validate_email_filter_input(input)?;

        self.email_repo
            .upsert_email_filter(link.id, validated)
            .await
            .map_err(|e| EmailErr::RepoErr(e.into()))
    }

    async fn delete_email_filter(&self, link: &Link, filter_id: Uuid) -> Result<bool, EmailErr> {
        self.email_repo
            .delete_email_filter(filter_id, link.id)
            .await
            .map_err(|e| EmailErr::RepoErr(e.into()))
    }

    async fn list_email_filters(&self, link: &Link) -> Result<Vec<EmailFilter>, EmailErr> {
        self.email_repo
            .list_email_filters(link.id)
            .await
            .map_err(|e| EmailErr::RepoErr(e.into()))
    }
}
