//! PostgreSQL statements behind durable-delivery domain decisions.
use crate::domain::scheduled_delivery::deletion::{
    self, DeletionQueries, DeletionStore, DeletionTransaction,
};
use crate::domain::scheduled_delivery::state::{
    self, ClaimStore, ClaimTransaction, CompletionQueries, DeliveryClaim, DeliveryTransitions,
};
use email_db_client::messages::delete;
use email_db_client::messages::scheduled::delivery;
use sqlx::{PgConnection, PgPool, Postgres, Transaction};
use uuid::Uuid;

/// Owned transaction; early domain returns drop it without an explicit commit.
pub struct PgClaimTransaction(Transaction<'static, Postgres>);

impl ClaimStore for PgPool {
    type Transaction = PgClaimTransaction;
    async fn begin(&self) -> anyhow::Result<Self::Transaction> {
        Ok(PgClaimTransaction(self.begin().await?))
    }
}
impl ClaimTransaction for PgClaimTransaction {
    async fn message_sent(&mut self, link: Uuid, message: Uuid) -> anyhow::Result<Option<bool>> {
        delivery::message_sent(&mut self.0, link, message).await
    }
    async fn schedule(
        &mut self,
        link: Uuid,
        message: Uuid,
        lease: i32,
    ) -> anyhow::Result<Option<state::ScheduleFacts>> {
        Ok(delivery::schedule_facts(&mut self.0, link, message, lease)
            .await?
            .map(|row| state::ScheduleFacts {
                send_time: row.send_time,
                processing: row.processing,
                actor_id: row.actor_id,
                agent_correlation_id: row.agent_correlation_id,
                delivery_claim_id: row.delivery_claim_id,
                delivery_started_at: row.delivery_started_at,
                delivery_message_id: row.delivery_message_id,
                delivery_status: row.delivery_status,
                approved_attachments: row.approved_attachments,
                available: row.available,
            }))
    }
    async fn acquire(
        &mut self,
        link: Uuid,
        message: Uuid,
        token: Uuid,
        lease: i32,
        header: Option<&str>,
        legacy: bool,
    ) -> anyhow::Result<()> {
        delivery::acquire_claim(&mut self.0, link, message, token, lease, header, legacy).await
    }
    async fn attempt(
        &mut self,
        link: Uuid,
        message: Uuid,
    ) -> anyhow::Result<Option<state::AttemptFacts>> {
        Ok(delivery::attempt_facts(&mut self.0, link, message)
            .await?
            .map(|row| state::AttemptFacts {
                request: row.request,
                prepared_content: row.prepared_content,
            }))
    }
    async fn commit(self) -> anyhow::Result<()> {
        Ok(self.0.commit().await?)
    }
}
impl DeliveryTransitions for PgPool {
    async fn begin_submission(&self, claim: &DeliveryClaim, lease: i32) -> anyhow::Result<u64> {
        delivery::begin_submission(
            self,
            claim.schedule.message_id,
            claim.schedule.link_id,
            claim.token.0,
            lease,
        )
        .await
    }
    async fn release_preparation(&self, claim: &DeliveryClaim, retry: i32) -> anyhow::Result<()> {
        delivery::release_preparation(
            self,
            claim.schedule.message_id,
            claim.schedule.link_id,
            claim.token.0,
            retry,
        )
        .await
    }
    async fn pause_delivery(
        &self,
        claim: &DeliveryClaim,
        unconfirmed: bool,
        retry: i32,
    ) -> anyhow::Result<()> {
        delivery::pause_delivery(
            self,
            claim.schedule.message_id,
            claim.schedule.link_id,
            claim.token.0,
            unconfirmed,
            retry,
        )
        .await
    }
}
impl CompletionQueries for PgConnection {
    async fn message_sent(&mut self, link: Uuid, message: Uuid) -> anyhow::Result<Option<bool>> {
        delivery::completion_message_sent(self, link, message).await
    }
    async fn complete(&mut self, claim: &DeliveryClaim) -> anyhow::Result<u64> {
        delivery::complete_delivery(
            self,
            claim.schedule.message_id,
            claim.schedule.link_id,
            claim.token.0,
        )
        .await
    }
}

impl crate::domain::scheduled_delivery::identity::MessageIdentityQueries for PgConnection {
    async fn imported_message(
        &mut self,
        link_id: Uuid,
        message_id: Uuid,
        provider_id: &str,
    ) -> anyhow::Result<Option<Uuid>> {
        email_db_client::messages::sent_identity::imported_message(
            self,
            link_id,
            message_id,
            provider_id,
        )
        .await
    }
    async fn adopt_metadata(
        &mut self,
        link_id: Uuid,
        message_id: Uuid,
        imported_id: Uuid,
    ) -> anyhow::Result<()> {
        email_db_client::messages::sent_identity::adopt_metadata(
            self,
            link_id,
            message_id,
            imported_id,
        )
        .await
    }
    async fn adopt_labels(&mut self, message_id: Uuid, imported_id: Uuid) -> anyhow::Result<()> {
        email_db_client::messages::sent_identity::adopt_labels(self, message_id, imported_id).await
    }
    async fn adopt_recipients(
        &mut self,
        message_id: Uuid,
        imported_id: Uuid,
    ) -> anyhow::Result<()> {
        email_db_client::messages::sent_identity::adopt_recipients(self, message_id, imported_id)
            .await
    }
    async fn adopt_calendar(&mut self, message_id: Uuid, imported_id: Uuid) -> anyhow::Result<()> {
        email_db_client::messages::sent_identity::adopt_calendar(self, message_id, imported_id)
            .await
    }
    async fn adopt_replies(&mut self, message_id: Uuid, imported_id: Uuid) -> anyhow::Result<()> {
        email_db_client::messages::sent_identity::adopt_replies(self, message_id, imported_id).await
    }
    async fn adopt_client_ids(
        &mut self,
        message_id: Uuid,
        imported_id: Uuid,
    ) -> anyhow::Result<()> {
        email_db_client::messages::sent_identity::adopt_client_ids(self, message_id, imported_id)
            .await
    }
    async fn adopt_draft_attachments(
        &mut self,
        message_id: Uuid,
        imported_id: Uuid,
    ) -> anyhow::Result<()> {
        email_db_client::messages::sent_identity::adopt_draft_attachments(
            self,
            message_id,
            imported_id,
        )
        .await
    }
    async fn adopt_forwarded_attachments(
        &mut self,
        message_id: Uuid,
        imported_id: Uuid,
    ) -> anyhow::Result<()> {
        email_db_client::messages::sent_identity::adopt_forwarded_attachments(
            self,
            message_id,
            imported_id,
        )
        .await
    }
    async fn remove_imported_message(&mut self, imported_id: Uuid) -> anyhow::Result<()> {
        email_db_client::messages::sent_identity::remove_imported_message(self, imported_id).await
    }
    async fn duplicate_attachments(
        &mut self,
        message_id: Uuid,
        imported_id: Uuid,
    ) -> anyhow::Result<Vec<(Uuid, Uuid)>> {
        email_db_client::messages::sent_identity::duplicate_attachments(
            self,
            message_id,
            imported_id,
        )
        .await
    }
    async fn adopt_attachment_storage(
        &mut self,
        provider_attachment_id: Uuid,
        local_attachment_id: Uuid,
    ) -> anyhow::Result<()> {
        email_db_client::messages::sent_identity::adopt_attachment_storage(
            self,
            provider_attachment_id,
            local_attachment_id,
        )
        .await
    }
    async fn adopt_forwarded_references(
        &mut self,
        provider_attachment_id: Uuid,
        local_attachment_id: Uuid,
    ) -> anyhow::Result<()> {
        email_db_client::messages::sent_identity::adopt_forwarded_references(
            self,
            provider_attachment_id,
            local_attachment_id,
        )
        .await
    }
    async fn adopt_document_references(
        &mut self,
        provider_attachment_id: Uuid,
        local_attachment_id: Uuid,
    ) -> anyhow::Result<()> {
        email_db_client::messages::sent_identity::adopt_document_references(
            self,
            provider_attachment_id,
            local_attachment_id,
        )
        .await
    }
    async fn remove_duplicate_attachment(
        &mut self,
        local_attachment_id: Uuid,
    ) -> anyhow::Result<()> {
        email_db_client::messages::sent_identity::remove_duplicate_attachment(
            self,
            local_attachment_id,
        )
        .await
    }
    async fn adopt_attachments(
        &mut self,
        message_id: Uuid,
        imported_id: Uuid,
    ) -> anyhow::Result<()> {
        email_db_client::messages::sent_identity::adopt_attachments(self, message_id, imported_id)
            .await
    }
}

impl crate::domain::scheduled_delivery::identity::ThreadIdentityQueries for PgConnection {
    async fn original_thread(&mut self, message_id: Uuid, link_id: Uuid) -> anyhow::Result<Uuid> {
        email_db_client::threads::provider_identity::original_thread(self, message_id, link_id)
            .await
    }
    async fn canonical_thread(
        &mut self,
        link_id: Uuid,
        provider_thread_id: &str,
    ) -> anyhow::Result<Option<Uuid>> {
        email_db_client::threads::provider_identity::canonical_thread(
            self,
            link_id,
            provider_thread_id,
        )
        .await
    }
    async fn move_message_thread(
        &mut self,
        message_id: Uuid,
        link_id: Uuid,
        canonical: Uuid,
    ) -> anyhow::Result<()> {
        email_db_client::threads::provider_identity::move_message_thread(
            self, message_id, link_id, canonical,
        )
        .await
    }
    async fn move_attempt_thread(
        &mut self,
        message_id: Uuid,
        link_id: Uuid,
        canonical: Uuid,
    ) -> anyhow::Result<()> {
        email_db_client::threads::provider_identity::move_attempt_thread(
            self, message_id, link_id, canonical,
        )
        .await
    }
    async fn original_thread_empty(&mut self, original: Uuid) -> anyhow::Result<bool> {
        email_db_client::threads::provider_identity::original_thread_empty(self, original).await
    }
    async fn redirect_thread_aliases(
        &mut self,
        link_id: Uuid,
        original: Uuid,
        canonical: Uuid,
    ) -> anyhow::Result<()> {
        email_db_client::threads::provider_identity::redirect_thread_aliases(
            self, link_id, original, canonical,
        )
        .await
    }
    async fn redirect_original_thread(
        &mut self,
        original: Uuid,
        link_id: Uuid,
        canonical: Uuid,
    ) -> anyhow::Result<()> {
        email_db_client::threads::provider_identity::redirect_original_thread(
            self, original, link_id, canonical,
        )
        .await
    }
    async fn metadata(&mut self, thread: Uuid, link: Uuid) -> anyhow::Result<()> {
        email_db_client::threads::update::update_thread_metadata(self, thread, link).await
    }
    async fn attachment_flags(&mut self, thread: Uuid) -> anyhow::Result<()> {
        email_db_client::threads::update::sync_thread_attachment_flags(self, thread).await
    }
    async fn mark_sent(
        &mut self,
        provider: &str,
        provider_thread: &str,
        link: Uuid,
        message: Uuid,
    ) -> anyhow::Result<()> {
        email_db_client::messages::update::mark_message_as_sent(
            self,
            provider,
            provider_thread,
            link,
            message,
        )
        .await
    }
    async fn thread_provider(
        &mut self,
        thread: Uuid,
        link: Uuid,
        provider: &str,
    ) -> anyhow::Result<()> {
        email_db_client::threads::update::update_thread_provider_id(self, thread, link, provider)
            .await
    }
}

/// Independent retained-deletion transaction.
pub struct PgDeletionTransaction(Transaction<'static, Postgres>);
impl DeletionStore for PgPool {
    type Transaction = PgDeletionTransaction;
    async fn begin(&self) -> anyhow::Result<Self::Transaction> {
        Ok(PgDeletionTransaction(self.begin().await?))
    }
}
impl DeletionTransaction for PgDeletionTransaction {
    type Queries = PgConnection;
    fn queries(&mut self) -> &mut Self::Queries {
        &mut self.0
    }
    async fn commit(self) -> anyhow::Result<()> {
        Ok(self.0.commit().await?)
    }
}
impl DeletionQueries for PgConnection {
    async fn delete_message(&mut self, message: Uuid) -> anyhow::Result<bool> {
        delete::delete_db_message(self, message).await
    }
    async fn has_deferred(&mut self, message: Uuid) -> anyhow::Result<bool> {
        delete::has_deferred_deletion(self, message).await
    }
    async fn lock_thread(&mut self, thread: Uuid) -> anyhow::Result<()> {
        delete::lock_thread(self, thread).await
    }
    async fn metadata(&mut self, thread: Uuid, link: Uuid) -> anyhow::Result<()> {
        email_db_client::threads::update::update_thread_metadata(self, thread, link).await
    }
    async fn attachment_flags(&mut self, thread: Uuid) -> anyhow::Result<()> {
        email_db_client::threads::update::sync_thread_attachment_flags(self, thread).await
    }
    async fn message(
        &mut self,
        message: Uuid,
        link: Uuid,
    ) -> anyhow::Result<Option<deletion::DeletionMessage>> {
        Ok(delete::deletion_message(self, message, link)
            .await?
            .map(|row| deletion::DeletionMessage {
                thread_id: row.thread_id,
                provider_id: row.provider_id,
                draft_generation: row.draft_generation,
                is_draft: row.is_draft,
            }))
    }
    async fn deferred(
        &mut self,
        message: Uuid,
    ) -> anyhow::Result<Option<deletion::DeferredDeletion>> {
        Ok(delete::deferred_deletion(self, message)
            .await?
            .map(|row| deletion::DeferredDeletion {
                provider_id: row.provider_id,
                draft_generation: row.draft_generation,
            }))
    }
    async fn remove_deferred(&mut self, message: Uuid) -> anyhow::Result<()> {
        delete::remove_deferred_deletion(self, message).await
    }
    async fn active_attempt(&mut self, message: Uuid, link: Uuid) -> anyhow::Result<bool> {
        delete::has_active_attempt(self, message, link).await
    }
    async fn recipients(&mut self, message: Uuid) -> anyhow::Result<Vec<String>> {
        delete::deletion_recipients(self, message).await
    }
    async fn cleanup_contacts(&mut self, link: Uuid, emails: &[String]) -> anyhow::Result<()> {
        email_db_client::crm_cleanup::candidates::insert_candidates(self, link, emails).await?;
        Ok(())
    }
}

impl deletion::EmptyThreadQueries for PgConnection {
    async fn thread_has_messages(&mut self, thread_id: Uuid) -> anyhow::Result<bool> {
        email_db_client::threads::delete::thread_has_messages(self, thread_id).await
    }
    async fn delete_empty_thread(&mut self, thread_id: Uuid) -> anyhow::Result<u64> {
        email_db_client::threads::delete::delete_empty_thread(self, thread_id).await
    }
}

impl crate::domain::scheduled::drafts::ScheduledDraftQueries for PgPool {
    type Stored = models_email::db::message::Message;
    async fn scheduled_rows(
        &self,
        link: Uuid,
        offset: u32,
        limit: u32,
    ) -> anyhow::Result<Vec<Self::Stored>> {
        email_db_client::messages::scheduled::get::get_scheduled_db_messages_by_link_id(
            self, link, offset, limit,
        )
        .await
    }
    async fn expand_rows(
        &self,
        rows: Vec<Self::Stored>,
    ) -> anyhow::Result<Vec<models_email::service::message::Message>> {
        email_db_client::messages::get::convert_db_messages_to_service_concurrent(self, rows).await
    }
}

#[cfg(test)]
mod test;
