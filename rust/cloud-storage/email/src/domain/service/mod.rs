mod draft;
mod previews;
mod send;
mod thread;

use crate::domain::{
    models::{
        CreateDraftInput, CreatedDraft, EmailErr, EnrichedEmailThreadPreview, GetEmailsRequest,
        Link, Thread,
    },
    ports::{EmailMessageEnqueuer, EmailRepo, EmailService},
};
use entity_access::domain::models::{EntityAccessReceipt, ViewAccessLevel};
use frecency::domain::ports::FrecencyQueryService;
use models_pagination::{PaginatedCursor, SimpleSortMethod};
use uuid::Uuid;

#[derive(Clone)]
pub struct EmailServiceImpl<T, U, E> {
    email_repo: T,
    frecency_service: U,
    enqueuer: E,
    sent_undo_delay_secs: u32,
}

impl<T, U, E> EmailServiceImpl<T, U, E>
where
    T: EmailRepo,
    U: FrecencyQueryService,
    E: EmailMessageEnqueuer,
{
    pub fn new(
        email_repo: T,
        frecency_service: U,
        enqueuer: E,
        sent_undo_delay_secs: u32,
    ) -> EmailServiceImpl<T, U, E> {
        EmailServiceImpl {
            email_repo,
            frecency_service,
            enqueuer,
            sent_undo_delay_secs,
        }
    }
}

impl<T, U, E> EmailService for EmailServiceImpl<T, U, E>
where
    T: EmailRepo,
    U: FrecencyQueryService,
    E: EmailMessageEnqueuer,
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

    async fn send_message(
        &self,
        link: &Link,
        input: CreateDraftInput,
    ) -> Result<CreatedDraft, EmailErr> {
        self.send_message_impl(link, input).await
    }
}
