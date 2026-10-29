use super::*;
use crate::domain::models::{EmailErr, EmailFilter, EmailInboxDetails, LinkLabel};
use entity_access::domain::ports::NoOpEntityAccessService;
use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};

#[derive(Clone)]
struct Probe {
    record: AttachmentReadRecord,
    accessible: bool,
    document_reads: Arc<AtomicUsize>,
    provider_reads: Arc<AtomicUsize>,
    file_reads: Arc<AtomicUsize>,
}
impl EmailUserRepo for Probe {
    async fn user_sender_filters(&self, _: Uuid) -> Result<Vec<EmailFilter>, EmailErr> {
        Ok(Vec::new())
    }
    async fn user_labels_for_link(&self, _: Uuid) -> Result<Vec<LinkLabel>, EmailErr> {
        Ok(Vec::new())
    }
    async fn user_inbox_details(
        &self,
        _: MacroUserIdStr<'static>,
    ) -> Result<Vec<EmailInboxDetails>, EmailErr> {
        Ok(Vec::new())
    }
    async fn user_accessible_inboxes(
        &self,
        _: MacroUserIdStr<'static>,
    ) -> Result<Vec<crate::domain::models::Link>, EmailErr> {
        let link = &self.record.link;
        Ok(if self.accessible {
            vec![crate::domain::models::Link {
                id: link.id,
                macro_id: link.macro_id.clone(),
                fusionauth_user_id: link.fusionauth_user_id.clone(),
                email_address: link.email_address.clone(),
                provider: crate::domain::models::UserProvider::Outlook,
                is_sync_active: true,
                is_primary: true,
                created_at: link.created_at,
                updated_at: link.updated_at,
            }]
        } else {
            Vec::new()
        })
    }
}
impl AttachmentReadRepository for Probe {
    async fn attachment_read_record(
        &self,
        _: Uuid,
    ) -> Result<Option<AttachmentReadRecord>, AttachmentError> {
        Ok(Some(self.record.clone()))
    }
    async fn existing_attachment_document(
        &self,
        _: Uuid,
    ) -> Result<Option<String>, AttachmentError> {
        self.document_reads.fetch_add(1, Ordering::Relaxed);
        Ok(Some("existing-document".into()))
    }
}
impl AttachmentBytes for Probe {
    async fn bytes(&self, _: &AttachmentReadRecord) -> Result<Vec<u8>, AttachmentError> {
        self.provider_reads.fetch_add(1, Ordering::Relaxed);
        Ok(vec![1, 2, 3])
    }
}
impl AttachmentFiles for Probe {
    async fn cached_url(
        &self,
        _: &AttachmentReadRecord,
    ) -> Result<Option<String>, AttachmentError> {
        self.file_reads.fetch_add(1, Ordering::Relaxed);
        Ok(Some("https://attachments.example.test/file".into()))
    }
    async fn store_download(
        &self,
        _: &AttachmentReadRecord,
        _: Vec<u8>,
    ) -> Result<String, AttachmentError> {
        panic!("cached attachment")
    }
    async fn store_document(
        &self,
        _: &AttachmentReadRecord,
        _: Vec<u8>,
    ) -> Result<String, AttachmentError> {
        panic!("existing document")
    }
}
fn probe(accessible: bool) -> Probe {
    let now = chrono::Utc::now();
    let link = Uuid::now_v7();
    Probe {
        record: AttachmentReadRecord {
            blob: None,
            attachment: Attachment {
                db_id: Uuid::now_v7(),
                provider_id: Some("provider-file".into()),
                data_url: None,
                reference_url: None,
                filename: Some("report.pdf".into()),
                mime_type: Some("application/pdf".into()),
                size_bytes: Some(3),
                sfs_id: None,
                content_id: None,
            },
            message_id: Uuid::now_v7(),
            thread_id: Uuid::now_v7(),
            message_provider_id: "provider-message".into(),
            link: Link {
                id: link,
                macro_id: MacroUserIdStr::try_from_email("owner@example.com").unwrap(),
                fusionauth_user_id: "owner".into(),
                email_address: macro_user_id::email::EmailStr::try_from(
                    "owner@example.com".to_owned(),
                )
                .unwrap(),
                provider: models_email::service::link::UserProvider::Outlook,
                is_sync_active: true,
                is_primary: true,
                needs_reauth: false,
                last_sync_error_at: None,
                created_at: now,
                updated_at: now,
            },
            mailbox: MailboxKey {
                link_id: link,
                grant_generation: 1,
                sync_generation: 1,
            },
        },
        accessible,
        document_reads: Arc::new(AtomicUsize::new(0)),
        provider_reads: Arc::new(AtomicUsize::new(0)),
        file_reads: Arc::new(AtomicUsize::new(0)),
    }
}

#[tokio::test]
async fn unauthorized_reader_cannot_use_either_attachment_cache() {
    let probe = probe(false);
    let service = AttachmentReadService {
        repository: probe.clone(),
        provider: probe.clone(),
        files: probe.clone(),
        access: NoOpEntityAccessService,
    };
    let actor = MacroUserIdStr::try_from_email("unrelated@example.com").unwrap();
    let id = probe.record.attachment.db_id;
    assert!(matches!(
        service.document(&actor, id).await,
        Err(AttachmentError::Forbidden)
    ));
    assert!(matches!(
        service.download(&actor, id).await,
        Err(AttachmentError::Forbidden)
    ));
    assert_eq!(probe.document_reads.load(Ordering::Relaxed), 0);
    assert_eq!(probe.file_reads.load(Ordering::Relaxed), 0);
    assert_eq!(probe.provider_reads.load(Ordering::Relaxed), 0);
}
#[tokio::test]
async fn authorized_delegate_uses_cache_without_provider_credentials() {
    let probe = probe(true);
    let service = AttachmentReadService {
        repository: probe.clone(),
        provider: probe.clone(),
        files: probe.clone(),
        access: NoOpEntityAccessService,
    };
    let actor = MacroUserIdStr::try_from_email("delegate@example.com").unwrap();
    let id = probe.record.attachment.db_id;
    assert_eq!(
        service.document(&actor, id).await.unwrap(),
        "existing-document"
    );
    assert!(
        service
            .download(&actor, id)
            .await
            .unwrap()
            .data_url
            .is_some()
    );
    assert_eq!(probe.document_reads.load(Ordering::Relaxed), 1);
    assert_eq!(probe.file_reads.load(Ordering::Relaxed), 1);
    assert_eq!(probe.provider_reads.load(Ordering::Relaxed), 0);
}

#[tokio::test]
async fn cloud_reference_is_authorized_without_file_or_provider_io() {
    let mut probe = probe(true);
    probe.record.attachment.reference_url = Some("https://outlook.office.com/mail/message".into());
    let service = AttachmentReadService {
        repository: probe.clone(),
        provider: probe.clone(),
        files: probe.clone(),
        access: NoOpEntityAccessService,
    };
    let actor = MacroUserIdStr::try_from_email("delegate@example.com").unwrap();
    let id = probe.record.attachment.db_id;
    let attachment = service.download(&actor, id).await.unwrap();
    assert!(attachment.reference_url.is_some());
    assert!(attachment.data_url.is_none());
    assert!(matches!(
        service.document(&actor, id).await,
        Err(AttachmentError::Invalid(_))
    ));
    assert_eq!(probe.file_reads.load(Ordering::Relaxed), 0);
    assert_eq!(probe.provider_reads.load(Ordering::Relaxed), 0);
    assert_eq!(probe.document_reads.load(Ordering::Relaxed), 0);
}
