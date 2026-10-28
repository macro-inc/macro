use std::sync::{Arc, Mutex};

use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use slack_integration::domain::{
    models::ImportError,
    ports::{JoinAnnouncement, JoinAnnouncer},
};
use teams::domain::join_announcement::{
    AnnounceJoin, AnnounceReport, JoinAnnouncementError, JoinAnnouncementService,
};
use uuid::Uuid;

use super::WorkerJoinAnnouncer;

#[derive(Clone, Default)]
struct RecordingService {
    calls: Arc<Mutex<Vec<AnnounceJoin>>>,
    fail: bool,
}

impl JoinAnnouncementService for RecordingService {
    async fn announce_join(
        &self,
        request: AnnounceJoin,
    ) -> Result<AnnounceReport, Report<JoinAnnouncementError>> {
        self.calls.lock().unwrap().push(request);
        if self.fail {
            Err(Report::new(JoinAnnouncementError::Storage))
        } else {
            Ok(AnnounceReport {
                claimed: 1,
                sent: 1,
                released: 0,
            })
        }
    }
}

fn announcement() -> JoinAnnouncement {
    JoinAnnouncement {
        team_id: Uuid::from_u128(1).try_into().unwrap(),
        joined: MacroUserIdStr::try_from_email("t17@example.com").unwrap(),
        joined_name: Some("Admin".to_owned()),
        members: vec![
            MacroUserIdStr::try_from_email("t17@example.com").unwrap(),
            MacroUserIdStr::try_from_email("external@example.com").unwrap(),
        ],
    }
}

#[tokio::test]
async fn disabled_announcer_drops_the_offer() {
    let service = RecordingService::default();
    let announcer = WorkerJoinAnnouncer::new(service.clone(), false);
    announcer.announce(announcement()).await.unwrap();
    assert!(service.calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn enabled_announcer_maps_the_offer_unchanged() {
    let service = RecordingService::default();
    let announcer = WorkerJoinAnnouncer::new(service.clone(), true);
    let announcement = announcement();
    announcer.announce(announcement.clone()).await.unwrap();
    let calls = service.calls.lock().unwrap();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].team_id, Uuid::from(announcement.team_id));
    assert_eq!(calls[0].joined, announcement.joined);
    assert_eq!(calls[0].joined_name.as_deref(), Some("Admin"));
    assert_eq!(calls[0].candidates, announcement.members);
}

#[tokio::test]
async fn service_storage_error_becomes_internal() {
    let service = RecordingService {
        fail: true,
        ..RecordingService::default()
    };
    let announcer = WorkerJoinAnnouncer::new(service, true);
    let error = announcer.announce(announcement()).await.unwrap_err();
    assert_eq!(error.into_current_context(), ImportError::Internal);
}
