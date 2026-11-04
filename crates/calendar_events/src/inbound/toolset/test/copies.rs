use super::*;

const ORGANIZED: Uuid = Uuid::from_u128(7);
const INVITED: Uuid = Uuid::from_u128(8);

fn copy(event_id: Uuid, inbox: &str, organizes: bool) -> MeetingCopy {
    MeetingCopy {
        event_id,
        inbox: inbox.to_string(),
        organizes,
        attends: true,
    }
}

/// One meeting on two of the user's inboxes: one organizes it, the other is
/// a guest.
fn two_inboxes() -> Vec<MeetingCopy> {
    vec![
        copy(INVITED, "guest@example.com", false),
        copy(ORGANIZED, "owner@example.com", true),
    ]
}

fn occurrences_with(copies: Vec<MeetingCopy>) -> MockOccurrences {
    MockOccurrences {
        rows: Mutex::new(Vec::new()),
        status: CalendarSyncStatus::Ready,
        copies: Mutex::new(copies),
    }
}

fn delete(event_id: Uuid, inbox: Option<&str>) -> DeleteCalendarEvent {
    serde_json::from_value(serde_json::json!({
        "eventId": event_id,
        "inbox": inbox,
    }))
    .unwrap()
}

fn update(args: serde_json::Value) -> UpdateCalendarEvent {
    let mut base = serde_json::json!({ "scope": "all" });
    base.as_object_mut()
        .unwrap()
        .extend(args.as_object().unwrap().clone());
    serde_json::from_value(base).unwrap()
}

#[tokio::test]
async fn deleting_one_of_several_inboxes_copies_asks_which() {
    let (mutations, context) = context(MockMutations::default(), occurrences_with(two_inboxes()));

    let error = delete(ORGANIZED, None)
        .call(context, request_context())
        .await
        .unwrap_err();

    assert!(mutations.deleted.lock().unwrap().is_empty());
    let description = &error.description;
    assert!(
        description.contains("2 of the user's inboxes"),
        "{description}"
    );
    assert!(
        description.contains(&format!(
            "owner@example.com organizes it (eventId {ORGANIZED})"
        )),
        "{description}"
    );
    assert!(
        description.contains(&format!("guest@example.com is a guest (eventId {INVITED})")),
        "{description}"
    );
    assert!(description.contains("cancels the meeting"), "{description}");
}

#[tokio::test]
async fn a_confirmed_inbox_lets_the_deletion_through() {
    let (mutations, context) = context(MockMutations::default(), occurrences_with(two_inboxes()));

    delete(INVITED, Some(" Guest@Example.com "))
        .call(context, request_context())
        .await
        .unwrap();

    assert_eq!(mutations.deleted.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn an_inbox_that_does_not_hold_the_copy_is_refused() {
    let (mutations, context) = context(MockMutations::default(), occurrences_with(two_inboxes()));

    let error = delete(ORGANIZED, Some("guest@example.com"))
        .call(context, request_context())
        .await
        .unwrap_err();

    assert!(mutations.deleted.lock().unwrap().is_empty());
    assert!(
        error.description.contains(&format!(
            "The copy on guest@example.com is eventId {INVITED}"
        )),
        "{}",
        error.description
    );
}

#[tokio::test]
async fn a_meeting_on_one_inbox_needs_no_confirmation() {
    let (mutations, context) = context(
        MockMutations::default(),
        occurrences_with(vec![copy(ORGANIZED, "owner@example.com", true)]),
    );

    delete(ORGANIZED, None)
        .call(context, request_context())
        .await
        .unwrap();

    assert_eq!(mutations.deleted.lock().unwrap().len(), 1);
}

/// A copy held through an inbox the user doesn't own, such as a delegated
/// one, is not among their copies and has nothing to tell apart.
#[tokio::test]
async fn a_copy_outside_the_users_own_inboxes_is_not_checked() {
    let (mutations, context) = context(MockMutations::default(), occurrences_with(two_inboxes()));

    delete(Uuid::from_u128(99), Some("delegated@example.com"))
        .call(context, request_context())
        .await
        .unwrap();

    assert_eq!(mutations.deleted.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn a_guest_list_change_suggests_the_copy_the_user_organizes() {
    let (mutations, context) = context(MockMutations::default(), occurrences_with(two_inboxes()));

    let error = update(serde_json::json!({
        "eventId": INVITED,
        "attendees": [{ "email": "new@example.com" }],
    }))
    .call(context, request_context())
    .await
    .unwrap_err();

    assert!(mutations.updated.lock().unwrap().is_empty());
    assert!(
        error
            .description
            .contains("To change the guest list, suggest owner@example.com"),
        "{}",
        error.description
    );
}

#[tokio::test]
async fn a_detail_change_asks_which_copy() {
    let (mutations, context) = context(MockMutations::default(), occurrences_with(two_inboxes()));

    let error = update(serde_json::json!({ "eventId": ORGANIZED, "title": "Renamed" }))
        .call(context, request_context())
        .await
        .unwrap_err();

    assert!(mutations.updated.lock().unwrap().is_empty());
    assert!(
        error
            .description
            .contains("\"Which inbox's copy should I change: "),
        "{}",
        error.description
    );
}

#[tokio::test]
async fn a_confirmed_detail_change_goes_through() {
    let (mutations, context) = context(MockMutations::default(), occurrences_with(two_inboxes()));

    update(serde_json::json!({
        "eventId": ORGANIZED,
        "inbox": "owner@example.com",
        "title": "Renamed",
    }))
    .call(context, request_context())
    .await
    .unwrap();

    assert_eq!(mutations.updated.lock().unwrap().len(), 1);
}

/// Reminders and the user's own answer belong to one copy, so the agent may
/// pick it without asking.
#[tokio::test]
async fn reminders_and_answers_need_no_confirmation() {
    let (mutations, tool_context) =
        context(MockMutations::default(), occurrences_with(two_inboxes()));
    update(serde_json::json!({
        "eventId": INVITED,
        "reminders": { "useDefault": false, "overrides": [{ "method": "popup", "minutes": 10 }] },
    }))
    .call(tool_context, request_context())
    .await
    .unwrap();
    assert_eq!(mutations.updated.lock().unwrap().len(), 1);

    let (answers, answer_context) =
        context(MockMutations::default(), occurrences_with(two_inboxes()));
    update(serde_json::json!({ "eventId": INVITED, "rsvp": "accepted" }))
        .call(answer_context, request_context())
        .await
        .unwrap();
    assert_eq!(answers.answered.lock().unwrap().len(), 1);
}

#[test]
fn only_reminders_and_availability_stay_on_one_copy() {
    let reminders = CalendarEventPatch {
        reminders: Some(EventReminders::default()),
        transparency: Some(EventTransparency::Transparent),
        ..Default::default()
    };
    assert!(!reminders.reaches_meeting());
    let title = CalendarEventPatch {
        title: Some("Renamed".to_string()),
        ..Default::default()
    };
    assert!(title.reaches_meeting());
    let guests = CalendarEventPatch {
        attendees: Some(Vec::new()),
        ..Default::default()
    };
    assert!(guests.reaches_meeting());
}
