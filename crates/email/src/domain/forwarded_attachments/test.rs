use super::*;
use std::{convert::Infallible, sync::Mutex};

const SOURCE: Uuid = Uuid::from_u128(1);
const SENDING: Uuid = Uuid::from_u128(2);
const PRIVATE: Uuid = Uuid::from_u128(3);
const DRAFT: Uuid = Uuid::from_u128(4);
const ATTACHMENT: Uuid = Uuid::from_u128(5);

struct Repo {
    inboxes: Mutex<Vec<Uuid>>,
    source: Uuid,
    exists: bool,
    inserted: Mutex<Vec<(Uuid, Uuid, Uuid)>>,
}

impl Repo {
    fn new(source: Uuid) -> Self {
        Self {
            inboxes: Mutex::new(vec![SOURCE, SENDING]),
            source,
            exists: true,
            inserted: Mutex::new(vec![]),
        }
    }
}

impl ForwardedAttachmentRepo for Repo {
    type Err = Infallible;
    async fn accessible_inboxes(&self, actor: &MacroUserIdStr<'_>) -> Result<Vec<Uuid>, Self::Err> {
        // The selected sending inbox belongs to someone else. Its owner's private
        // inbox must never replace the authenticated delegate's accessible set.
        assert_eq!(actor.as_ref(), "macro|delegate@example.com");
        Ok(self.inboxes.lock().unwrap().clone())
    }
    async fn draft_exists(&self, link: Uuid, draft: Uuid) -> Result<bool, Self::Err> {
        assert_eq!((link, draft), (SENDING, DRAFT));
        Ok(self.exists)
    }
    async fn source_attachment(
        &self,
        id: Uuid,
    ) -> Result<Option<(Uuid, MessageAttachment)>, Self::Err> {
        Ok((id == ATTACHMENT).then(|| {
            (
                self.source,
                MessageAttachment {
                    reference_url: None,
                    db_id: id,
                    provider_id: Some("provider-attachment".into()),
                    filename: Some("report.pdf".into()),
                    mime_type: Some("application/pdf".into()),
                    size_bytes: Some(123),
                    sfs_id: None,
                    content_id: None,
                },
            )
        }))
    }
    async fn insert(&self, link: Uuid, draft: Uuid, attachment: Uuid) -> Result<(), Self::Err> {
        self.inserted
            .lock()
            .unwrap()
            .push((link, draft, attachment));
        Ok(())
    }
    async fn registered_sources(
        &self,
        link: Uuid,
        draft: Uuid,
    ) -> Result<Vec<ForwardedAttachmentSource>, Self::Err> {
        assert_eq!((link, draft), (SENDING, DRAFT));
        Ok(vec![ForwardedAttachmentSource {
            source_link_id: self.source,
            attachment: AttachmentForwarded {
                attachment_id: ATTACHMENT,
                draft_id: DRAFT,
                provider_attachment_id: Some("provider-attachment".into()),
                message_provider_id: "source-message".into(),
                filename: Some("report.pdf".into()),
                mime_type: Some("application/pdf".into()),
                size_bytes: Some(123),
            },
        }])
    }
}

#[tokio::test]
async fn registers_an_owned_source_on_a_delegated_sending_inbox() {
    let service = ForwardedAttachmentService::new(Repo::new(SOURCE));
    let actor = MacroUserIdStr::parse_from_str("macro|delegate@example.com").unwrap();
    let attachment = service
        .add(&actor, SENDING, DRAFT, ATTACHMENT)
        .await
        .unwrap();
    assert_eq!(attachment.filename.as_deref(), Some("report.pdf"));
    assert_eq!(
        *service.repo.inserted.lock().unwrap(),
        [(SENDING, DRAFT, ATTACHMENT)]
    );
    let sources = service
        .for_delivery(Some(&actor), SENDING, DRAFT)
        .await
        .unwrap();
    assert_eq!(sources[0].source_link_id, SOURCE);
    assert_eq!(sources[0].attachment.message_provider_id, "source-message");
}

#[tokio::test]
async fn inaccessible_and_missing_sources_have_the_same_error_without_registration() {
    let service = ForwardedAttachmentService::new(Repo::new(PRIVATE));
    let actor = MacroUserIdStr::parse_from_str("macro|delegate@example.com").unwrap();
    for attachment in [ATTACHMENT, Uuid::nil()] {
        let error = service
            .add(&actor, SENDING, DRAFT, attachment)
            .await
            .unwrap_err();
        assert!(matches!(
            error,
            ForwardedAttachmentError::AttachmentNotFound
        ));
        assert_eq!(error.to_string(), "Attachment not found");
    }
    assert!(service.repo.inserted.lock().unwrap().is_empty());
}

#[tokio::test]
async fn missing_or_inaccessible_drafts_never_register_an_attachment() {
    let mut repo = Repo::new(SOURCE);
    repo.exists = false;
    let service = ForwardedAttachmentService::new(repo);
    let actor = MacroUserIdStr::parse_from_str("macro|delegate@example.com").unwrap();
    for sending in [SENDING, PRIVATE] {
        assert!(matches!(
            service.add(&actor, sending, DRAFT, ATTACHMENT).await,
            Err(ForwardedAttachmentError::DraftNotFound)
        ));
    }
    assert!(service.repo.inserted.lock().unwrap().is_empty());
}

#[tokio::test]
async fn revoking_source_access_after_registration_blocks_scheduled_delivery() {
    let service = ForwardedAttachmentService::new(Repo::new(SOURCE));
    let actor = MacroUserIdStr::parse_from_str("macro|delegate@example.com").unwrap();
    service
        .add(&actor, SENDING, DRAFT, ATTACHMENT)
        .await
        .unwrap();
    *service.repo.inboxes.lock().unwrap() = vec![SENDING];
    assert!(matches!(
        service.for_delivery(Some(&actor), SENDING, DRAFT).await,
        Err(ForwardedAttachmentError::AttachmentNotFound)
    ));
}

#[tokio::test]
async fn cross_inbox_delivery_requires_a_recorded_actor() {
    let service = ForwardedAttachmentService::new(Repo::new(SOURCE));
    assert!(matches!(
        service.for_delivery(None, SENDING, DRAFT).await,
        Err(ForwardedAttachmentError::AttachmentNotFound)
    ));
}

#[tokio::test]
async fn legacy_same_inbox_delivery_does_not_require_an_actor() {
    let service = ForwardedAttachmentService::new(Repo::new(SENDING));
    let sources = service.for_delivery(None, SENDING, DRAFT).await.unwrap();
    assert_eq!(sources[0].source_link_id, SENDING);
}
