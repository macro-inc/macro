use super::*;
use email::domain::mailbox::inbox_sync::CrmContactRecipient;
use models_email::service::link::Link;

impl BackfillRepository for PgBackfillWorker {
    type Err = InboxPersistenceError;
    type Jobs = super::super::PgBackfillJobs;
    type Metadata = super::transaction::MetadataTransaction;

    fn jobs(&self) -> &Self::Jobs {
        &self.jobs
    }

    async fn link(&self, id: Uuid) -> Result<Option<Link>, Self::Err> {
        email_db_client::links::get::fetch_link_by_id(&self.jobs.0, id)
            .await
            .map_err(Into::into)
    }
    async fn link_by_email(&self, owner: &str, email: &str) -> Result<Option<Link>, Self::Err> {
        email_db_client::links::get::fetch_link_by_macro_id_and_email_address(
            &self.jobs.0,
            owner,
            email,
        )
        .await
        .map_err(Into::into)
    }
    async fn attachment_document(
        &self,
        link: Uuid,
        attachment: Uuid,
    ) -> Result<Option<String>, Self::Err> {
        email_db_client::attachments::provider::get_document_id_by_att_id_and_link(
            &self.jobs.0,
            link,
            attachment,
        )
        .await
        .map_err(Into::into)
    }
    async fn has_contact_messages(&self, link: Uuid, email: &str) -> Result<bool, Self::Err> {
        email_db_client::contacts::get::link_has_any_message_with(&self.jobs.0, link, email)
            .await
            .map_err(Into::into)
    }
    async fn sent_contacts(&self, link: Uuid) -> Result<Vec<CrmContactRecipient>, Self::Err> {
        email_db_client::contacts::get::fetch_sent_message_recipient_contacts_by_link(
            &self.jobs.0,
            link,
        )
        .await
        .map_err(Into::into)
    }
    async fn received_contacts(&self, link: Uuid) -> Result<Vec<CrmContactRecipient>, Self::Err> {
        email_db_client::contacts::get::fetch_received_sender_contacts_by_link(&self.jobs.0, link)
            .await
            .map_err(Into::into)
    }
    async fn begin_metadata(&self) -> Result<Self::Metadata, Self::Err> {
        self.jobs
            .0
            .begin()
            .await
            .map(super::transaction::MetadataTransaction)
            .map_err(|e| anyhow::Error::from(e).into())
    }
    async fn republish_completion(&self, job: Uuid) {
        sqlx::query!(
            r#"
                UPDATE email_backfill_completion_outbox
                SET published_at = NULL
                WHERE backfill_job_id = $1
                "#,
            job,
        )
        .execute(&self.jobs.0)
        .await
        .inspect_err(|error| {
            tracing::error!(error = ?error, job_id = %job, "failed to republish completion outbox after terminal finalize failure");
        })
        .ok();
    }
}
