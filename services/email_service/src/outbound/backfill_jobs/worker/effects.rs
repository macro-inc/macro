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
        let _ = self.0.redis_client.delete_backfill_job_progress(job).await;
    }
    async fn delete_thread_progress(&self, job: Uuid, thread: &str) {
        let _ = self
            .0
            .redis_client
            .delete_backfill_thread_progress(job, thread)
            .await;
    }
    async fn upload(
        &self,
        link: &Link,
        p: &BackfillAttachmentPayload,
    ) -> Result<(), BackfillUploadError> {
        let ctx = &self.0;
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
        self.0.contacts_ingress.enqueue_contacts(users).await
    }
    async fn acquire_crm(&self, team: Uuid) -> anyhow::Result<Option<Self::Permit>> {
        self.0
            .redis_client
            .acquire_crm_population_slot(team)
            .await
            .map_err(anyhow::Error::new)
    }
    async fn notify_failed(&self, link: &Link) {
        crate::pubsub::util::cg_refresh_email(
            &self.0.connection_gateway_client,
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
        self.0.macro_event_broker.send_event(event)
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
