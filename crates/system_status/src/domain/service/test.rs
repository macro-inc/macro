use macro_user_id::user_id::MacroUserIdStr;

use super::SystemStatusServiceImpl;
use crate::domain::{
    fakes::{FakeBroadcaster, FakeRepo},
    models::{CurrentSystemStatus, StatusMessage, SystemStatus, SystemStatusError},
    ports::SystemStatusService,
};

fn staff() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|oncall@macro.com").unwrap()
}

fn degraded(message: &str) -> SystemStatus {
    SystemStatus::Degraded {
        message: StatusMessage::try_from(message.to_owned()).unwrap(),
    }
}

#[tokio::test]
async fn current_status_is_operational_before_any_update() {
    let service = SystemStatusServiceImpl::new(FakeRepo::default(), FakeBroadcaster::default());

    let current = service.current_status().await.unwrap();

    assert_eq!(
        current,
        CurrentSystemStatus {
            status: SystemStatus::Operational,
            id: None,
            updated_at: None,
        }
    );
}

#[tokio::test]
async fn set_status_stores_it_as_current_and_broadcasts_it() {
    let service = SystemStatusServiceImpl::new(FakeRepo::default(), FakeBroadcaster::default());

    let update = service
        .set_status(&staff(), degraded("Search is slow"))
        .await
        .unwrap();

    let expected = CurrentSystemStatus {
        status: degraded("Search is slow"),
        id: Some(update.id),
        updated_at: Some(update.created_at),
    };
    assert_eq!(service.current_status().await.unwrap(), expected);
    assert_eq!(*service.broadcaster.sent.lock().unwrap(), vec![expected]);
}

#[tokio::test]
async fn newest_update_wins_and_history_keeps_every_update() {
    let service = SystemStatusServiceImpl::new(FakeRepo::default(), FakeBroadcaster::default());

    service
        .set_status(&staff(), degraded("Search is slow"))
        .await
        .unwrap();
    service
        .set_status(&staff(), SystemStatus::Operational)
        .await
        .unwrap();

    assert_eq!(
        service.current_status().await.unwrap().status,
        SystemStatus::Operational
    );
    let history: Vec<SystemStatus> = service
        .history(&staff())
        .await
        .unwrap()
        .into_iter()
        .map(|update| update.status)
        .collect();
    assert_eq!(
        history,
        vec![SystemStatus::Operational, degraded("Search is slow")]
    );
}

#[tokio::test]
async fn set_status_succeeds_when_the_broadcast_fails() {
    let service = SystemStatusServiceImpl::new(
        FakeRepo::default(),
        FakeBroadcaster {
            fail: true,
            ..FakeBroadcaster::default()
        },
    );

    service
        .set_status(&staff(), degraded("Search is slow"))
        .await
        .unwrap();

    assert_eq!(
        service.current_status().await.unwrap().status,
        degraded("Search is slow")
    );
}

#[tokio::test]
async fn non_staff_cannot_set_status_or_read_history() {
    let service = SystemStatusServiceImpl::new(FakeRepo::default(), FakeBroadcaster::default());
    let outsider = MacroUserIdStr::parse_from_str("macro|someone@example.com").unwrap();

    let set = service
        .set_status(&outsider, degraded("Search is slow"))
        .await;
    let history = service.history(&outsider).await;

    assert!(matches!(set, Err(SystemStatusError::Forbidden)));
    assert!(matches!(history, Err(SystemStatusError::Forbidden)));
    assert!(service.repo.updates.lock().unwrap().is_empty());
    assert!(service.broadcaster.sent.lock().unwrap().is_empty());
}

#[test]
fn messages_are_trimmed_and_bounded() {
    assert_eq!(
        StatusMessage::try_from("  Search is slow \n".to_owned())
            .unwrap()
            .as_str(),
        "Search is slow"
    );
    assert!(StatusMessage::try_from("   ".to_owned()).is_err());
    assert!(StatusMessage::try_from("a".repeat(501)).is_err());
    assert!(StatusMessage::try_from("a".repeat(500)).is_ok());
}

#[test]
fn wire_shape_is_flat_and_omits_message_when_operational() {
    let degraded = serde_json::to_value(CurrentSystemStatus {
        status: degraded("Search is slow"),
        id: None,
        updated_at: None,
    })
    .unwrap();
    let operational = serde_json::to_value(CurrentSystemStatus {
        status: SystemStatus::Operational,
        id: None,
        updated_at: None,
    })
    .unwrap();

    assert_eq!(
        degraded,
        serde_json::json!({ "status": "degraded", "message": "Search is slow", "id": null, "updatedAt": null })
    );
    assert_eq!(
        operational,
        serde_json::json!({ "status": "operational", "id": null, "updatedAt": null })
    );
    assert!(
        serde_json::from_value::<SystemStatus>(
            serde_json::json!({ "status": "major_outage", "message": " " })
        )
        .is_err()
    );
}
