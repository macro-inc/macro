use super::database_error::database_error;
use super::*;
use email::domain::mailbox::inbox_sync::{InboxSyncAttachmentRecipients, LabelCatalogRepository};
use email::domain::message_labels::state as label_state;
use email::outbound::label_state_pg::PgLabelCatalog;
use email_db_client::backfill::job::update as jobs;
use models_email::service::{attachment::AttachmentUploadMetadata, label::Label};

impl LabelCatalogRepository for PgBackfillWorker {
    type CatalogError = BackfillDatabaseError;
    async fn stored_catalog(&self, link: Uuid) -> Result<Vec<Label>, Self::CatalogError> {
        email_db_client::labels::get::fetch_labels_by_link_id(&self.jobs.0, link)
            .await
            .map_err(database_error)
    }
    async fn delete_stored_catalog(
        &self,
        link: Uuid,
        labels: Vec<String>,
    ) -> Result<u64, Self::CatalogError> {
        label_state::delete_labels_by_provider_ids(&mut PgLabelCatalog(&self.jobs.0), link, labels)
            .await
            .map_err(database_error)
    }
    async fn upsert_stored_catalog(&self, labels: Vec<Label>) -> Result<(), Self::CatalogError> {
        label_state::insert_or_update_labels(&mut PgLabelCatalog(&self.jobs.0), labels)
            .await
            .map_err(database_error)
    }
}
impl BackfillInitRepository for PgBackfillWorker {
    async fn claim_init_lease(&self, job: Uuid) -> anyhow::Result<InitLeaseClaim> {
        Ok(match jobs::claim_init_lease(&self.jobs.0, job).await? {
            jobs::InitLeaseClaim::Claimed(token) => InitLeaseClaim::Claimed(token),
            jobs::InitLeaseClaim::Complete => InitLeaseClaim::Complete,
            jobs::InitLeaseClaim::Busy => InitLeaseClaim::Busy,
            jobs::InitLeaseClaim::NotFound => InitLeaseClaim::NotFound,
        })
    }
    async fn renew_init_lease(&self, job: Uuid, token: Uuid) -> anyhow::Result<InitLeaseRenewal> {
        Ok(
            match jobs::renew_init_lease(&self.jobs.0, job, token).await? {
                jobs::InitLeaseRenewal::Renewed => InitLeaseRenewal::Renewed,
                jobs::InitLeaseRenewal::Complete => InitLeaseRenewal::Complete,
                jobs::InitLeaseRenewal::Lost => InitLeaseRenewal::Lost,
                jobs::InitLeaseRenewal::NotFound => InitLeaseRenewal::NotFound,
            },
        )
    }
    async fn release_init_lease(&self, job: Uuid, token: Uuid) -> anyhow::Result<()> {
        jobs::release_init_lease(&self.jobs.0, job, token)
            .await
            .map(|_| ())
    }
    async fn update_total_threads(&self, job: Uuid, total: i32) -> anyhow::Result<()> {
        jobs::update_job_total_threads(&self.jobs.0, job, total).await
    }
    async fn finalize_initialization(&self, job: Uuid, token: Uuid) -> anyhow::Result<bool> {
        jobs::finalize_initialization(&self.jobs.0, job, token).await
    }
}

impl BackfillCompletionRepository for PgBackfillWorker {
    async fn complete_job(
        &self,
        job: Uuid,
        token: Option<Uuid>,
    ) -> anyhow::Result<BackfillCompletion> {
        Ok(
            match jobs::complete_backfill_job(&self.jobs.0, job, token).await? {
                jobs::BackfillCompletion::Completed => BackfillCompletion::Completed,
                jobs::BackfillCompletion::AlreadyTerminal => BackfillCompletion::AlreadyTerminal,
                jobs::BackfillCompletion::LeaseLost => BackfillCompletion::LeaseLost,
                jobs::BackfillCompletion::NotFound => BackfillCompletion::NotFound,
            },
        )
    }
    async fn claim_completion(&self, job: Uuid) -> anyhow::Result<Option<Uuid>> {
        jobs::claim_completion_effects(&self.jobs.0, job).await
    }
    async fn completion_pending(&self, job: Uuid) -> anyhow::Result<bool> {
        jobs::completion_effects_pending(&self.jobs.0, job).await
    }
    async fn release_completion(&self, job: Uuid, token: Uuid) -> anyhow::Result<()> {
        jobs::release_completion_effects(&self.jobs.0, job, token)
            .await
            .map(|_| ())
    }
    async fn renew_completion(&self, job: Uuid, token: Uuid) -> anyhow::Result<bool> {
        jobs::renew_completion_effects(&self.jobs.0, job, token).await
    }
    async fn retire_completion(&self, job: Uuid, token: Uuid) -> anyhow::Result<()> {
        jobs::mark_completion_effects_complete(&self.jobs.0, job, token).await
    }
}

impl BackfillFollowupRepository for PgBackfillWorker {
    async fn job_attachments(&self, link: Uuid) -> anyhow::Result<Vec<AttachmentUploadMetadata>> {
        email_db_client::attachments::provider::upload::fetch_job_attachments_for_backfill(
            &self.jobs.0,
            link,
        )
        .await
    }
    async fn thread_attachments(
        &self,
        thread: Uuid,
    ) -> anyhow::Result<(Vec<AttachmentUploadMetadata>, Vec<AttachmentUploadMetadata>)> {
        tokio::try_join!(
            email_db_client::attachments::provider::upload::thread_document_atts_for_backfill(
                &self.jobs.0,
                thread
            ),
            email_db_client::attachments::provider::upload::thread_media_atts_for_backfill(
                &self.jobs.0,
                thread
            )
        )
    }
    async fn attachment_recipients(
        &self,
        messages: &[Uuid],
    ) -> anyhow::Result<InboxSyncAttachmentRecipients> {
        email_db_client::contacts::get::fetch_db_recipients_in_bulk(&self.jobs.0, messages).await
    }
    async fn contact_emails(&self, link: Uuid) -> anyhow::Result<Vec<String>> {
        email_db_client::contacts::get::fetch_contacts_emails_by_link_id(&self.jobs.0, link).await
    }
}
