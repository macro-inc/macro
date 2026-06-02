mod draft;
mod previews;
mod send;
mod thread;
mod thread_labels;

use crate::domain::{
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
use frecency::domain::ports::FrecencyQueryService;
use models_pagination::{PaginatedCursor, SimpleSortMethod};
use uuid::Uuid;

#[derive(Clone)]
pub struct EmailServiceImpl<T, U, E, CS> {
    pub(crate) email_repo: T,
    pub(crate) frecency_service: U,
    pub(crate) enqueuer: E,
    pub(crate) crm_service: CS,
    pub(crate) sent_undo_delay_secs: u32,
}

impl<T, U, E, CS> EmailServiceImpl<T, U, E, CS>
where
    T: EmailRepo,
    U: FrecencyQueryService,
    E: EmailMessageEnqueuer,
    CS: CrmService,
{
    pub fn new(
        email_repo: T,
        frecency_service: U,
        enqueuer: E,
        crm_service: CS,
        sent_undo_delay_secs: u32,
    ) -> EmailServiceImpl<T, U, E, CS> {
        EmailServiceImpl {
            email_repo,
            frecency_service,
            enqueuer,
            crm_service,
            sent_undo_delay_secs,
        }
    }
}

impl<T, U, E, CS> EmailServiceImpl<T, U, E, CS> {
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

impl<T, U, E, CS> EmailService for EmailServiceImpl<T, U, E, CS>
where
    T: EmailRepo,
    U: FrecencyQueryService,
    E: EmailMessageEnqueuer,
    CS: CrmService,
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
        input: CreateDraftInput,
    ) -> Result<CreatedDraft, EmailErr> {
        self.create_draft_impl(link, input).await
    }

    async fn send_message(
        &self,
        link: &Link,
        input: CreateDraftInput,
    ) -> Result<CreatedDraft, EmailErr> {
        self.send_message_impl(link, input).await
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
