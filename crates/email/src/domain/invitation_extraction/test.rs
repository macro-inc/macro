use super::*;
use std::sync::{Arc, Mutex};

#[derive(Default)]
struct State {
    jobs: Vec<InvitationExtractionJob>,
    saves: Vec<(MessageCalendarInvitations, Vec<PendingInvitationPart>)>,
    notified: usize,
}
#[derive(Clone, Default)]
struct Repository(Arc<Mutex<State>>);
impl InvitationExtractionRepository for Repository {
    async fn is_processed(&self, _: Uuid) -> Result<bool, Report> {
        Ok(false)
    }
    async fn save(
        &self,
        _: Uuid,
        parsed: &MessageCalendarInvitations,
        pending: &[PendingInvitationPart],
        _: Option<i64>,
    ) -> Result<bool, Report> {
        self.0
            .lock()
            .unwrap()
            .saves
            .push((parsed.clone(), pending.to_vec()));
        Ok(true)
    }
    async fn claim(&self) -> Result<Vec<InvitationExtractionJob>, Report> {
        Ok(std::mem::take(&mut self.0.lock().unwrap().jobs))
    }
    async fn notified(&self, _: Uuid, _: i64) -> Result<(), Report> {
        self.0.lock().unwrap().notified += 1;
        Ok(())
    }
}
struct Provider;
impl InvitationAttachmentProvider for Provider {
    async fn discover(&self, _: Uuid, _: &str) -> Result<Vec<DiscoveredInvitationPart>, Report> {
        panic!("notification/attachment jobs must not fetch MIME")
    }
    async fn download(&self, _: Uuid, _: &str, attachment: &str) -> Result<Vec<u8>, Report> {
        if attachment == "unavailable" {
            return Err(rootcause::report!("temporary provider failure"));
        }
        Ok(include_bytes!("../../../fixtures/calendar/google.ics").to_vec())
    }
}
struct Notifier;
impl InvitationExtractionNotifier for Notifier {
    async fn completed(&self, _: Uuid) -> Result<(), Report> {
        Ok(())
    }
}
fn job(notification_only: bool) -> InvitationExtractionJob {
    InvitationExtractionJob {
        message_id: Uuid::now_v7(),
        link_id: Uuid::now_v7(),
        provider_id: "provider".into(),
        discover: false,
        notification_only,
        generation: 1,
        parts: vec![],
    }
}
#[tokio::test]
async fn notification_retry_preserves_unsupported_content_status() {
    let repository = Repository::default();
    repository.0.lock().unwrap().jobs.push(job(true));
    let service = InvitationExtractionService {
        repository: repository.clone(),
        provider: Provider,
        notifier: Notifier,
    };
    service.run_once().await.unwrap();
    let state = repository.0.lock().unwrap();
    assert!(
        state.saves.is_empty(),
        "notification must not rewrite Unsupported to Absent"
    );
    assert_eq!(state.notified, 1);
}
#[tokio::test]
async fn unavailable_attachment_keeps_durable_work_without_losing_valid_parts() {
    let repository = Repository::default();
    let mut work = job(false);
    work.parts = ["available", "unavailable"]
        .map(|id| PendingInvitationPart {
            part_id: id.into(),
            attachment_id: id.into(),
        })
        .to_vec();
    repository.0.lock().unwrap().jobs.push(work);
    InvitationExtractionService {
        repository: repository.clone(),
        provider: Provider,
        notifier: Notifier,
    }
    .run_once()
    .await
    .unwrap();
    let state = repository.0.lock().unwrap();
    assert_eq!(state.saves[0].0.invitations.len(), 1);
    assert_eq!(state.saves[0].1.len(), 1);
    assert_eq!(state.saves[0].1[0].attachment_id, "unavailable");
}

struct UnavailableProvider;
impl InvitationAttachmentProvider for UnavailableProvider {
    async fn discover(&self, _: Uuid, _: &str) -> Result<Vec<DiscoveredInvitationPart>, Report> {
        Err(rootcause::report!("source message unavailable"))
    }
    async fn download(&self, _: Uuid, _: &str, _: &str) -> Result<Vec<u8>, Report> {
        panic!("failed discovery cannot download attachments")
    }
}

#[tokio::test]
async fn unavailable_discovery_never_saves_or_acknowledges_extraction() {
    let repository = Repository::default();
    let mut work = job(false);
    work.discover = true;
    repository.0.lock().unwrap().jobs.push(work);
    InvitationExtractionService {
        repository: repository.clone(),
        provider: UnavailableProvider,
        notifier: Notifier,
    }
    .run_once()
    .await
    .unwrap();
    let state = repository.0.lock().unwrap();
    assert!(state.saves.is_empty());
    assert_eq!(state.notified, 0);
}
