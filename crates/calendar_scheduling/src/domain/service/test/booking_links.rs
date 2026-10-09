use super::*;
use crate::domain::booking_links::{BookingLinkDraft, BookingLinks};

const USER: &str = "macro|booking-host@example.com";

#[tokio::test]
async fn discovery_is_read_only_and_finds_paused_links_by_public_text() {
    let memory = Arc::new(Memory::default());
    let service = TestService::new(memory.clone(), Arc::new(Calendar::default()), Members);
    assert!(
        service
            .list_links(USER, None, None)
            .await
            .unwrap()
            .links
            .is_empty()
    );
    assert!(memory.profiles.lock().unwrap().is_empty());
    let mut paused = draft();
    paused.event.enabled = false;
    paused.event.description = "Qualification conversation".into();
    service.create_link(USER, None, paused).await.unwrap();
    let matches = service
        .list_links(USER, None, Some("QUALIFICATION"))
        .await
        .unwrap();
    assert_eq!(matches.links.len(), 1);
    assert!(!matches.links[0].draft.event.enabled);
    assert!(
        service
            .public_profile(matches.profile_id)
            .await
            .unwrap()
            .event_types
            .is_empty()
    );
    assert!(
        service
            .list_links(USER, None, Some("no match"))
            .await
            .unwrap()
            .links
            .is_empty()
    );
    assert!(matches!(
        service.list_links(USER, Some(Uuid::now_v7()), None).await,
        Err(Error::Forbidden)
    ));
}

fn draft() -> BookingLinkDraft {
    let profile = profile(None);
    let mut draft = BookingLinkDraft::from_parts(&profile.event_types[0], &profile.schedules[0]);
    draft.event.hosts = vec![USER.into()];
    draft
}

#[tokio::test]
async fn link_is_retry_safe_and_usable_by_normal_booking_workflow() {
    let memory = Arc::new(Memory::default());
    let calendar = Arc::new(Calendar::default());
    let service = TestService::new(memory, calendar.clone(), Members);
    let link = service.create_link(USER, None, draft()).await.unwrap();
    let retry = service.create_link(USER, None, draft()).await.unwrap();
    assert_eq!(link.event_type_id, retry.event_type_id);
    assert_eq!(link.revision, retry.revision);
    assert_eq!(calendar.creates.load(Ordering::SeqCst), 0);
    let public = service.public_profile(link.profile_id).await.unwrap();
    assert_eq!(public.event_types[0].id, link.event_type_id);
    let booking = service
        .book(link.profile_id, link.event_type_id, request())
        .await
        .unwrap();
    assert_eq!(booking.booking.status, BookingStatus::Confirmed);
}

#[tokio::test]
async fn edit_preserves_other_links_hours_and_profile_and_rejects_stale_changes() {
    let service = TestService::new(
        Arc::new(Memory::default()),
        Arc::new(Calendar::default()),
        Members,
    );
    let first = service.create_link(USER, None, draft()).await.unwrap();
    let mut second_draft = draft();
    second_draft.event.slug = "second".into();
    let second = service.create_link(USER, None, second_draft).await.unwrap();
    let before = service.settings(USER, None).await.unwrap();
    let mut edited = first.draft.clone();
    edited.event.title = "Edited meeting".into();
    edited.schedule.weekly[1].windows.clear();
    let saved = service
        .edit_link(
            USER,
            None,
            first.event_type_id,
            second.revision,
            edited.clone(),
        )
        .await
        .unwrap();
    let after = service.settings(USER, None).await.unwrap();
    assert_eq!(before.name, after.name);
    assert_eq!(before.default_schedule_id, after.default_schedule_id);
    assert_eq!(before.schedules[0], after.schedules[0]);
    assert_eq!(before.event_types[1], after.event_types[1]);
    assert_eq!(saved.draft, edited);
    assert_eq!(
        service
            .edit_link(
                USER,
                None,
                first.event_type_id,
                second.revision,
                edited.clone()
            )
            .await
            .unwrap()
            .revision,
        saved.revision
    );
    edited.event.title = "Stale".into();
    assert!(matches!(
        service
            .edit_link(USER, None, first.event_type_id, second.revision, edited)
            .await,
        Err(Error::Conflict)
    ));
    assert!(matches!(
        service
            .edit_link(
                "macro|other@example.com",
                None,
                first.event_type_id,
                saved.revision,
                draft()
            )
            .await,
        Err(Error::NotFound)
    ));
}

#[tokio::test]
async fn invalid_drafts_and_team_non_admins_do_not_write() {
    let memory = Arc::new(Memory::default());
    let service = TestService::new(memory.clone(), Arc::new(Calendar::default()), Members);
    let mut invalid = draft();
    invalid.event.duration_minutes = 0;
    assert!(matches!(
        service.create_link(USER, None, invalid).await,
        Err(Error::Invalid(_))
    ));
    let mut forged = draft();
    forged.event.hosts = vec!["macro|other@example.com".into()];
    assert!(matches!(
        service.create_link(USER, None, forged).await,
        Err(Error::Invalid(_))
    ));
    assert!(matches!(
        service
            .create_link("member", Some(Uuid::now_v7()), draft())
            .await,
        Err(Error::Forbidden)
    ));
    assert!(memory.profiles.lock().unwrap().is_empty());
}
