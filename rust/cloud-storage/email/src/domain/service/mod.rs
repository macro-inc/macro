mod draft;
mod previews;
mod thread;

use crate::domain::{
    models::{
        CreateDraftInput, CreatedDraft, EmailErr, EnrichedEmailThreadPreview, GetEmailsRequest,
        Link, Thread,
    },
    ports::{EmailRepo, EmailService},
};
use entity_access::domain::models::{EntityAccessReceipt, ViewAccessLevel};
use frecency::domain::ports::FrecencyQueryService;
use models_pagination::{PaginatedCursor, SimpleSortMethod};
use uuid::Uuid;

#[derive(Clone)]
pub struct EmailServiceImpl<T, U> {
    email_repo: T,
    frecency_service: U,
}

impl<T, U> EmailServiceImpl<T, U>
where
    T: EmailRepo,
    U: FrecencyQueryService,
{
    pub fn new(email_repo: T, frecency_service: U) -> EmailServiceImpl<T, U> {
        EmailServiceImpl {
            email_repo,
            frecency_service,
        }
    }
}

impl<T, U> EmailService for EmailServiceImpl<T, U>
where
    T: EmailRepo,
    U: FrecencyQueryService,
    anyhow::Error: From<T::Err>,
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

    async fn get_thread_with_messages(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
        offset: i64,
        limit: i64,
    ) -> Result<Option<Thread>, EmailErr> {
        self.get_thread_with_messages_impl(receipt, offset, limit)
            .await
    }

    async fn create_draft(
        &self,
        link: &Link,
        input: CreateDraftInput,
    ) -> Result<CreatedDraft, EmailErr> {
        self.create_draft_impl(link, input).await
    }
}
