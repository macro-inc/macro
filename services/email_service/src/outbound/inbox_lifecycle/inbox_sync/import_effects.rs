use super::*;
use crate::outbound::backfill_jobs::PgBackfillJobs;
use crate::util::upload_attachment::{
    UploadAttachmentContext, UploadAttachmentError, upload_attachment,
};
use contacts::domain::{models::messages::ContactConnection, ports::ContactsIngress};
use email_api_client::domain::models::{CalendarPart, ChangeBatch};
use macro_user_id::user_id::MacroUserIdStr;
use models_email::service::{
    attachment::{Attachment, AttachmentUploadArgs},
    message::Message,
    thread::Thread,
};

impl InboxSyncHistory for InboxSyncEffects {
    type Jobs = PgBackfillJobs;
    fn recovery_jobs(&self) -> Self::Jobs {
        PgBackfillJobs(self.db.clone())
    }
    fn accept_history<'a>(
        &'a self,
        link: Uuid,
        expected: &'a str,
        batch: ChangeBatch,
    ) -> BoxFuture<'a, Result<(), email::domain::mailbox::MailboxError>> {
        Box::pin(self.gmail_history.accept(link, expected, batch))
    }
}
impl InboxSyncPreparation for InboxSyncEffects {
    fn prepare_message<'a>(&'a self, message: &'a mut Message) -> BoxFuture<'a, ()> {
        Box::pin(crate::util::process_pre_insert::process_message_pre_insert(
            message,
        ))
    }
    fn prepare_threads<'a>(&'a self, threads: &'a mut Vec<Thread>) -> BoxFuture<'a, ()> {
        Box::pin(crate::util::process_pre_insert::process_threads_pre_insert(
            threads,
        ))
    }
    fn save_invitations<'a>(
        &'a self,
        link: Uuid,
        provider: &'a str,
        message: Uuid,
        parts: &'a [CalendarPart],
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
impl InboxSyncUploads for InboxSyncEffects {
    fn attachment_eligibility(&self, attachments: &[Attachment]) -> (bool, bool) {
        let value = attachment_upload_eligibility(attachments);
        (value.documents, value.media)
    }
    fn upload<'a>(
        &'a self,
        link: &'a Link,
        args: AttachmentUploadArgs,
    ) -> BoxFuture<'a, Result<String, InboxSyncUploadError>> {
        Box::pin(async move {
            let ctx = self;
            let ctx_upload = UploadAttachmentContext {
                db: &ctx.db,
                email_api: &ctx.email_api,
                dss_client: &ctx.dss_client,
                sfs_client: &ctx.sfs_client,
                system_properties_service: &ctx.system_properties_service,
                link,
            };
            upload_attachment(ctx_upload, &args)
                .await
                .map_err(|error| match error {
                    UploadAttachmentError::RateLimited(error) => {
                        InboxSyncUploadError::RateLimited(error)
                    }
                    UploadAttachmentError::AttachmentDeleted => {
                        InboxSyncUploadError::AttachmentDeleted
                    }
                    error => InboxSyncUploadError::Other(Box::new(error)),
                })
        })
    }
}
impl InboxSyncContacts for InboxSyncEffects {
    fn connect<'a>(
        &'a self,
        owner: &'a MacroUserIdStr<'static>,
        contacts: Vec<MacroUserIdStr<'static>>,
    ) -> BoxFuture<'a, anyhow::Result<()>> {
        Box::pin(async move {
            let connections = contacts
                .into_iter()
                .map(|contact| ContactConnection::new(owner.clone(), contact))
                .collect();
            self.contacts_ingress
                .enqueue_contact_connections(connections)
                .await
                .map_err(|e| anyhow::anyhow!("{e:?}"))
        })
    }
}

use email_db_client::attachments::provider::upload_filters::{
    attachment_is_document, attachment_is_media,
};
#[derive(Debug, Default, PartialEq, Eq)]
struct AttachmentUploadEligibility {
    documents: bool,
    media: bool,
}

fn attachment_upload_eligibility(attachments: &[Attachment]) -> AttachmentUploadEligibility {
    let mut eligibility = AttachmentUploadEligibility::default();

    for attachment in attachments {
        let Some(mime_type) = attachment.mime_type.as_deref() else {
            continue;
        };

        eligibility.documents |= attachment_is_document(mime_type, attachment.filename.as_deref());
        eligibility.media |= attachment_is_media(mime_type);
    }

    eligibility
}

#[cfg(test)]
mod test;
