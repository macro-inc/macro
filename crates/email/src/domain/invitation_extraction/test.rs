use super::*;
use std::sync::{Arc, Mutex};

const GOOGLE: &[u8] = include_bytes!("../../../fixtures/calendar/google.ics");

#[derive(Clone, Default)]
struct Repository(Arc<Mutex<Vec<Vec<CalendarInvitation>>>>);
impl InvitationExtractionRepository for Repository {
    async fn save(&self, _: Uuid, invitations: &[CalendarInvitation]) -> Result<(), Report> {
        self.0.lock().unwrap().push(invitations.to_vec());
        Ok(())
    }
}
#[derive(Clone, Default)]
struct Provider(Arc<Mutex<Vec<String>>>);
impl InvitationAttachmentProvider for Provider {
    async fn download(&self, _: Uuid, _: &str, attachment: &str) -> Result<Vec<u8>, Report> {
        self.0.lock().unwrap().push(attachment.into());
        if attachment == "unavailable" {
            return Err(rootcause::report!("temporary provider failure"));
        }
        Ok(GOOGLE.to_vec())
    }
}
async fn ingest(parts: &[InvitationPart<'_>]) -> (Vec<Vec<CalendarInvitation>>, Vec<String>) {
    let service = InvitationExtractionService {
        repository: Repository::default(),
        provider: Provider::default(),
    };
    service
        .ingest(Uuid::now_v7(), Uuid::now_v7(), "provider", parts)
        .await
        .unwrap();
    let saves = service.repository.0.lock().unwrap().clone();
    let downloads = service.provider.0.lock().unwrap().clone();
    (saves, downloads)
}

#[tokio::test]
async fn inline_content_skips_attachment_downloads() {
    let (saves, downloads) = ingest(&[
        InvitationPart::Inline(GOOGLE),
        InvitationPart::Attachment("invite.ics"),
    ])
    .await;
    assert_eq!(saves.len(), 1);
    assert_eq!(saves[0].len(), 1);
    assert!(downloads.is_empty());
}

#[tokio::test]
async fn unavailable_attachment_does_not_lose_valid_parts() {
    let (saves, downloads) = ingest(&[
        InvitationPart::Attachment("available"),
        InvitationPart::Attachment("unavailable"),
    ])
    .await;
    assert_eq!(saves.len(), 1);
    assert_eq!(saves[0].len(), 1);
    assert_eq!(downloads, ["available", "unavailable"]);
}

#[tokio::test]
async fn messages_without_invitations_save_nothing() {
    for parts in [
        &[][..],
        &[InvitationPart::Inline(b"not a calendar")][..],
        &[InvitationPart::Attachment("unavailable")][..],
    ] {
        let (saves, _) = ingest(parts).await;
        assert!(saves.is_empty());
    }
}
