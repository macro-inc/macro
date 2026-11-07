use super::*;
use crate::domain::models::{EmailErr, EmailFilter, EmailInboxDetails, LinkLabel};
use entity_access::domain::ports::NoOpEntityAccessService;
use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};

#[derive(Clone)]
struct Probe {
    record: MessageSourceRecord,
    accessible: bool,
    provider_reads: Arc<AtomicUsize>,
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
                provider: crate::domain::models::UserProvider::Gmail,
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
impl MessageSourceRepository for Probe {
    async fn message_source_record(
        &self,
        _: Uuid,
    ) -> Result<Option<MessageSourceRecord>, AttachmentError> {
        Ok(Some(self.record.clone()))
    }
}
impl MessageSourceBytes for Probe {
    async fn bytes(&self, _: &MessageSourceRecord) -> Result<Vec<u8>, AttachmentError> {
        self.provider_reads.fetch_add(1, Ordering::Relaxed);
        Ok(b"Subject: hi\r\n\r\nbody".to_vec())
    }
}
fn probe(accessible: bool) -> Probe {
    let now = chrono::Utc::now();
    let link = Uuid::now_v7();
    Probe {
        record: MessageSourceRecord {
            message_id: Uuid::now_v7(),
            thread_id: Uuid::now_v7(),
            message_provider_id: "provider-message".into(),
            subject: Some("Re: Q3 plan".into()),
            link: Link {
                id: link,
                macro_id: MacroUserIdStr::try_from_email("owner@example.com").unwrap(),
                fusionauth_user_id: "owner".into(),
                email_address: macro_user_id::email::EmailStr::try_from(
                    "owner@example.com".to_owned(),
                )
                .unwrap(),
                provider: models_email::service::link::UserProvider::Gmail,
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
        provider_reads: Arc::new(AtomicUsize::new(0)),
    }
}
fn service(probe: &Probe) -> MessageSourceService<Probe, Probe, NoOpEntityAccessService> {
    MessageSourceService {
        repository: probe.clone(),
        provider: probe.clone(),
        access: NoOpEntityAccessService,
    }
}

#[tokio::test]
async fn unauthorized_reader_never_reaches_the_provider() {
    let probe = probe(false);
    let actor = MacroUserIdStr::try_from_email("unrelated@example.com").unwrap();
    assert!(matches!(
        service(&probe)
            .download(&actor, probe.record.message_id)
            .await,
        Err(AttachmentError::Forbidden)
    ));
    assert_eq!(probe.provider_reads.load(Ordering::Relaxed), 0);
}

#[tokio::test]
async fn inbox_reader_downloads_named_source() {
    let probe = probe(true);
    let actor = MacroUserIdStr::try_from_email("owner@example.com").unwrap();
    let source = service(&probe)
        .download(&actor, probe.record.message_id)
        .await
        .unwrap();
    assert_eq!(source.filename, "Re Q3 plan.eml");
    assert_eq!(source.bytes, b"Subject: hi\r\n\r\nbody");
    assert_eq!(probe.provider_reads.load(Ordering::Relaxed), 1);
}

#[test]
fn filenames_drop_unsafe_characters_and_fall_back() {
    assert_eq!(eml_filename(None), "email.eml");
    assert_eq!(eml_filename(Some("  ")), "email.eml");
    assert_eq!(eml_filename(Some("a/b\\c\r\n\"d\"")), "a b c d.eml");
    assert_eq!(eml_filename(Some("...")), "email.eml");
    assert_eq!(eml_filename(Some(&"x".repeat(300))).len(), 124);
}
