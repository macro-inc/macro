#[cfg(test)]
mod test;

use super::*;
use crate::util::upload_attachment::{
    UploadAttachmentContext, UploadAttachmentError, upload_attachment,
};
use contacts::domain::ports::ContactsIngress;
use crm::domain::{
    email_privacy::{EmailContributionMailbox, EmailPrivacyService},
    model::{CrmError, DepopulateContactOutcome},
    service::CrmService,
};
use macro_event_broker::{EventBrokerError, MacroEvent, MacroEventBroker};
use macro_user_id::user_id::MacroUserIdStr;
use models_email::api::refresh::{BackfillStatus, RefreshEmailEvent};
use models_email::service::{backfill::*, link::Link};
use std::collections::HashSet;

impl BackfillEffects for BackfillWorkerEffects {
    type Permit = crate::util::redis::backfill_write_slots::BackfillWriteSlot;
    async fn delete_job_progress(&self, job: Uuid) {
        let _ = self.redis_client.delete_backfill_job_progress(job).await;
    }
    async fn delete_thread_progress(&self, job: Uuid, thread: &str) {
        let _ = self
            .redis_client
            .delete_backfill_thread_progress(job, thread)
            .await;
    }
    async fn upload(
        &self,
        link: &Link,
        p: &BackfillAttachmentPayload,
    ) -> Result<(), BackfillUploadError> {
        let ctx = self;
        let ctx_upload = UploadAttachmentContext {
            db: &ctx.db,
            email_api: &ctx.email_api,
            dss_client: &ctx.dss_client,
            sfs_client: &ctx.sfs_client,
            system_properties_service: &ctx.system_properties_service,
            link,
        };

        let attachment_args = p.metadata.clone();
        upload_attachment(ctx_upload, &attachment_args)
            .await
            .map(|_| ())
            .map_err(|e| match e {
                UploadAttachmentError::AttachmentDeleted => BackfillUploadError::Deleted,
                UploadAttachmentError::RateLimited(error) => {
                    BackfillUploadError::RateLimited(error)
                }
                error => BackfillUploadError::Failed(anyhow::Error::new(error)),
            })
    }
    async fn connect(
        &self,
        users: HashSet<MacroUserIdStr<'static>>,
    ) -> Result<(), rootcause::Report> {
        self.contacts_ingress.enqueue_contacts(users).await
    }
    async fn acquire_crm(&self, team: Uuid) -> anyhow::Result<Option<Self::Permit>> {
        self.redis_client
            .acquire_crm_population_slot(team)
            .await
            .map_err(anyhow::Error::new)
    }
    async fn notify_failed(&self, link: &Link) {
        crate::pubsub::util::cg_refresh_email(
            &self.connection_gateway_client,
            link.macro_id.as_ref(),
            RefreshEmailEvent::Backfill {
                link_id: link.id,
                status: BackfillStatus::Failed,
            },
        )
        .await;
    }
}

impl BackfillWritePermit for crate::util::redis::backfill_write_slots::BackfillWriteSlot {
    async fn hold<F: Future + Send>(self, work: F) -> F::Output
    where
        F::Output: Send,
    {
        self.hold(work).await
    }
}

impl MacroEventBroker for BackfillWorkerEffects {
    fn send_event<E: MacroEvent + ?Sized>(
        &self,
        event: &E,
    ) -> Result<tokio::task::JoinHandle<Result<(), EventBrokerError>>, EventBrokerError> {
        self.macro_event_broker.send_event(event)
    }
}

impl BackfillCrm for BackfillWorkerCrm {
    async fn get_team_id_for_user(&self, user: &str) -> Result<Option<Uuid>, CrmError> {
        self.0.get_team_id_for_user(user).await
    }
    async fn contribution_mailbox(
        &self,
        team: Uuid,
        user: &str,
    ) -> Result<Option<EmailContributionMailbox>, CrmError> {
        self.0.contribution_mailbox(team, user).await
    }
    async fn populate_contact(
        &self,
        team: &Uuid,
        link: &Link,
        p: &PopulateCrmContactPayload,
    ) -> Result<(), CrmError> {
        self.0
            .populate_contact(
                team,
                &link.id,
                link.email_address.0.as_ref(),
                &p.contact_email,
                p.contact_name.as_deref(),
                p.first_at,
                p.last_at,
                p.is_sent,
            )
            .await
    }
    async fn depopulate_contact(
        &self,
        team: &Uuid,
        link: &Uuid,
        email: &str,
    ) -> Result<DepopulateContactOutcome, CrmError> {
        self.0.depopulate_contact(team, link, email).await
    }
    async fn depopulate_link_in_team(&self, team: &Uuid, link: &Uuid) -> Result<(), CrmError> {
        self.0.depopulate_link_in_team(team, link).await
    }
}

impl email::domain::mailbox::inbox_sync::InboxSyncPreparation for BackfillWorkerEffects {
    fn prepare_message<'a>(
        &'a self,
        message: &'a mut models_email::service::message::Message,
    ) -> BoxFuture<'a, ()> {
        Box::pin(crate::util::process_pre_insert::process_message_pre_insert(
            message,
        ))
    }
    fn prepare_threads<'a>(
        &'a self,
        threads: &'a mut Vec<models_email::service::thread::Thread>,
    ) -> BoxFuture<'a, ()> {
        Box::pin(crate::util::process_pre_insert::process_threads_pre_insert(
            threads,
        ))
    }
    fn save_invitations<'a>(
        &'a self,
        link: Uuid,
        provider: &'a str,
        message: Uuid,
        parts: &'a [email_api_client::domain::models::CalendarPart],
    ) -> BoxFuture<'a, ()> {
        Box::pin(crate::outbound::invitation_extraction::save_discovered(
            &self.invitation_extractor,
            link,
            provider,
            message,
            parts,
        ))
    }
}
impl BackfillImportEffects for BackfillWorkerEffects {
    type WritePermit = crate::util::redis::backfill_write_slots::BackfillWriteSlot;
    async fn add_total_threads(&self, job: Uuid, count: i32) -> anyhow::Result<()> {
        self.redis_client.add_to_total_threads(job, count).await
    }
    async fn delete_listing_progress(&self, job: Uuid) -> anyhow::Result<()> {
        self.redis_client.delete_backfill_job_progress(job).await
    }
    async fn acquire_write(&self) -> anyhow::Result<Option<Self::WritePermit>> {
        self.redis_client
            .acquire_backfill_write_slot()
            .await
            .map_err(anyhow::Error::new)
    }
}

impl BackfillLifecycleEffects for BackfillWorkerEffects {
    async fn sync_contacts(&self, link: &Link) -> anyhow::Result<()> {
        Box::pin(crate::util::sync_contacts::sync_contacts(
            link,
            &self.db,
            &self.email_api,
            &self.sqs_client,
            &self.macro_event_broker,
            &*self.contacts_ingress,
        ))
        .await
    }
    async fn colleague_dms(&self, link: &Link) {
        crate::util::contact_dms::ensure_colleague_dms(&self.db, link).await;
    }
    async fn top_contact_dms(&self, link: &Link) {
        crate::util::contact_dms::ensure_top_contact_dms(&self.db, link).await;
    }
    async fn init_progress(&self, job: Uuid, total: i32) -> anyhow::Result<()> {
        self.redis_client
            .init_backfill_job_progress(job, total)
            .await
    }
    async fn increment_threads(&self, job: Uuid) -> anyhow::Result<BackfillProgress> {
        let progress = self.redis_client.incr_completed_threads(job).await?;
        Ok(BackfillProgress {
            completed_threads: progress.completed_threads,
            total_threads: progress.total_threads,
            job_complete: progress.job_complete,
        })
    }
    async fn increment_messages(&self, job: Uuid, thread: &str) -> anyhow::Result<bool> {
        self.redis_client.incr_completed_messages(job, thread).await
    }
    async fn refresh_progress(
        &self,
        owner: &MacroUserIdStr<'static>,
        link_id: Uuid,
        progress: BackfillProgress,
    ) {
        crate::pubsub::util::cg_refresh_email(
            &self.connection_gateway_client,
            owner.as_ref(),
            RefreshEmailEvent::BackfillProgress {
                link_id,
                status: if progress.job_complete {
                    BackfillStatus::Complete
                } else {
                    BackfillStatus::Progress
                },
                completed_threads: progress.completed_threads,
                total_threads: progress.total_threads,
            },
        )
        .await;
    }
    async fn connect_contacts(
        &self,
        owner: &MacroUserIdStr<'static>,
        contacts: Vec<MacroUserIdStr<'static>>,
    ) -> Result<(), rootcause::Report> {
        self.contacts_ingress
            .enqueue_contact_connections(
                contacts
                    .into_iter()
                    .map(|contact| {
                        contacts::domain::models::messages::ContactConnection::new(
                            owner.clone(),
                            contact,
                        )
                    })
                    .collect(),
            )
            .await
    }
}
