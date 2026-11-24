use super::*;
use crate::domain::booking_links::BookingLinks;

#[tokio::test]
async fn a_link_on_another_account_books_there_and_its_bookings_stay_after_a_change() {
    let calendar = Arc::new(Calendar::default());
    let service = TestService::new(Arc::new(Memory::default()), calendar.clone(), Members);
    let mut p = profile(None);
    p.event_types[0].email_link_id = Some(WORK_INBOX);
    let mut p = service.save("admin", None, p).await.unwrap();

    let record = service
        .book(p.id, p.event_types[0].id, request())
        .await
        .unwrap();
    assert_eq!(record.booking.status, BookingStatus::Confirmed);
    assert_eq!(
        record.calendar_id,
        Some(pinned_calendar("admin", Some(WORK_INBOX)))
    );
    assert_eq!(
        calendar.busy_inboxes.lock().unwrap().as_slice(),
        [Some(WORK_INBOX)],
        "availability requires the chosen account to take the booking"
    );

    // Moving the link to another account leaves its existing bookings where
    // they were made.
    p.event_types[0].email_link_id = Some(SIDE_INBOX);
    service.save("admin", None, p).await.unwrap();
    let date = record.booking.starts_at.date_naive();
    let slots = service
        .replacement_slots(record.booking.id, record.token, date, None)
        .await
        .unwrap();
    assert_eq!(
        calendar.busy_inboxes.lock().unwrap().last(),
        Some(&Some(WORK_INBOX))
    );
    let moved = service
        .reschedule(record.booking.id, record.token, slots[1].starts_at)
        .await
        .unwrap();
    assert_eq!(moved.calendar_id, record.calendar_id);
    assert_eq!(moved.event.email_link_id, Some(WORK_INBOX));
}

#[tokio::test]
async fn only_personal_links_choose_an_account() {
    let service = TestService::new(
        Arc::new(Memory::default()),
        Arc::new(Calendar::default()),
        Members,
    );
    let team = Some(Uuid::new_v4());
    let mut team_profile = profile(team);
    team_profile.event_types[0].email_link_id = Some(WORK_INBOX);
    assert!(matches!(
        service.save("admin", team, team_profile).await,
        Err(Error::Invalid(_))
    ));

    let personal = service.list_links("admin", None, None).await.unwrap();
    assert_eq!(personal.accounts.len(), 2);
    assert_eq!(personal.accounts[0].email_link_id, WORK_INBOX);
    assert!(
        service
            .list_links("admin", team, None)
            .await
            .unwrap()
            .accounts
            .is_empty()
    );
}

#[tokio::test]
async fn a_link_books_only_on_an_account_that_can_take_its_bookings() {
    let memory = Arc::new(Memory::default());
    let service = TestService::new(memory.clone(), Arc::new(Calendar::default()), Members);
    let removed = Uuid::from_u128(0x9);
    let mut p = profile(None);
    p.event_types[0].email_link_id = Some(removed);
    assert!(matches!(
        service.save("admin", None, p.clone()).await,
        Err(Error::Invalid(_))
    ));

    p.event_types[0].email_link_id = Some(SIDE_INBOX);
    p.event_types[0].google_meet = true;
    assert!(
        matches!(
            service.save("admin", None, p.clone()).await,
            Err(Error::Invalid(message)) if message.contains("side@example.com")
        ),
        "a video meeting needs an account that can add one"
    );
    p.event_types[0].google_meet = false;
    service.save("admin", None, p).await.unwrap();

    // An account removed after it was chosen does not block saving the
    // profile's other changes, or turning its video meeting off; the link
    // just takes no bookings.
    for owned in memory.profiles.lock().unwrap().values_mut() {
        owned.profile.event_types[0].email_link_id = Some(removed);
        owned.profile.event_types[0].google_meet = true;
    }
    let mut renamed = service.settings("admin", None).await.unwrap();
    renamed.name = "Renamed".into();
    let renamed = service.save("admin", None, renamed).await.unwrap();
    let mut video_off = renamed;
    video_off.event_types[0].google_meet = false;
    let video_off = service.save("admin", None, video_off).await.unwrap();
    let mut video_on = video_off;
    video_on.event_types[0].google_meet = true;
    assert!(
        matches!(
            service.save("admin", None, video_on).await,
            Err(Error::Invalid(_))
        ),
        "asking a removed account for a video meeting is a new choice"
    );
}
