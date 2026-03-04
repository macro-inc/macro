mod draft;
mod previews;
mod send;
mod thread;
mod thread_labels;

use crate::domain::{
    models::{
        CreateDraftInput, CreatedDraft, EmailErr, EnrichedEmailThreadPreview, GetEmailsRequest,
        Link, LinkLabel, Thread, UpdateThreadLabelsResult,
    },
    ports::{EmailMessageEnqueuer, EmailRepo, EmailService, GmailLabelModifier},
};
use entity_access::domain::models::{EntityAccessReceipt, ViewAccessLevel};
use frecency::domain::ports::FrecencyQueryService;
use models_pagination::{PaginatedCursor, SimpleSortMethod};
use uuid::Uuid;

#[derive(Clone)]
pub struct EmailServiceImpl<T, U, E, G> {
    email_repo: T,
    frecency_service: U,
    enqueuer: E,
    gmail_label_modifier: G,
    sent_undo_delay_secs: u32,
}

impl<T, U, E, G> EmailServiceImpl<T, U, E, G>
where
    T: EmailRepo,
    U: FrecencyQueryService,
    E: EmailMessageEnqueuer,
    G: GmailLabelModifier,
{
    pub fn new(
        email_repo: T,
        frecency_service: U,
        enqueuer: E,
        gmail_label_modifier: G,
        sent_undo_delay_secs: u32,
    ) -> EmailServiceImpl<T, U, E, G> {
        EmailServiceImpl {
            email_repo,
            frecency_service,
            enqueuer,
            gmail_label_modifier,
            sent_undo_delay_secs,
        }
    }
}

impl<T, U, E, G> EmailService for EmailServiceImpl<T, U, E, G>
where
    T: EmailRepo,
    U: FrecencyQueryService,
    E: EmailMessageEnqueuer,
    G: GmailLabelModifier,
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
}
