use super::*;

const ORGANIZED: Uuid = Uuid::from_u128(7);
const INVITED: Uuid = Uuid::from_u128(8);

fn copy(event_id: Uuid, inbox: &str, organizes: bool) -> MeetingCopy {
    MeetingCopy {
        event_id,
        inbox: inbox.to_string(),
        organizes,
        attends: !organizes,
    }
}

fn two_inboxes() -> Vec<MeetingCopy> {
    vec![
        copy(INVITED, "guest@example.com", false),
        copy(ORGANIZED, "owner@example.com", true),
    ]
}

#[test]
fn a_copy_of_several_inboxes_needs_its_inbox() {
    let refusal = check_copy(&two_inboxes(), ORGANIZED, None, CopyChange::Delete)
        .expect("two inboxes hold the meeting");
    let message = refusal.message();
    assert!(message.contains("2 of the user's inboxes"), "{message}");
    assert!(
        message.contains(&format!(
            "owner@example.com organizes it (eventId {ORGANIZED})"
        )),
        "{message}"
    );
    assert!(
        message.contains(&format!("guest@example.com is a guest (eventId {INVITED})")),
        "{message}"
    );
    assert!(message.contains("cancels the meeting"), "{message}");
    assert!(
        message.contains("Never choose between the user's inboxes yourself"),
        "{message}"
    );
    assert!(
        message.ends_with(
            "Ask the user exactly this and wait for the answer: \"Which inbox's copy should I \
             delete: guest@example.com (guest) or owner@example.com (organizer)?\""
        ),
        "{message}"
    );
}

#[test]
fn a_guest_list_change_is_asked_as_a_change_not_an_addition() {
    let refusal = check_copy(
        &two_inboxes(),
        INVITED,
        None,
        CopyChange::Update {
            changes_guests: true,
        },
    )
    .expect("two inboxes hold the meeting");
    let message = refusal.message();
    assert!(
        message.contains("To change the guest list, suggest owner@example.com"),
        "{message}"
    );
    assert!(
        message.ends_with(
            "\"Which inbox's copy should I change the guests on: owner@example.com (organizer) \
             or guest@example.com (guest)?\""
        ),
        "{message}"
    );
}

#[test]
fn the_question_names_each_inbox_once() {
    let mut copies = two_inboxes();
    copies.push(copy(Uuid::from_u128(9), "Guest@Example.com", false));
    copies.push(copy(Uuid::from_u128(10), "outlook@example.com", false));
    let refusal = check_copy(
        &copies,
        ORGANIZED,
        None,
        CopyChange::Update {
            changes_guests: false,
        },
    )
    .expect("three inboxes hold the meeting");
    assert!(
        refusal.message().contains(
            "\"Which inbox's copy should I change: guest@example.com (guest), owner@example.com \
             (organizer) or outlook@example.com (guest)?\""
        ),
        "{}",
        refusal.message()
    );
}

#[test]
fn the_addressed_copys_inbox_confirms_it() {
    assert_eq!(
        check_copy(
            &two_inboxes(),
            INVITED,
            Some(" Guest@Example.com "),
            CopyChange::Delete
        ),
        None
    );
}

#[test]
fn another_copys_inbox_is_refused_with_that_copys_id() {
    let refusal = check_copy(
        &two_inboxes(),
        ORGANIZED,
        Some("guest@example.com"),
        CopyChange::Update {
            changes_guests: false,
        },
    )
    .expect("the inbox holds a different copy");
    assert!(
        refusal.message().contains(&format!(
            "The copy on guest@example.com is eventId {INVITED}"
        )),
        "{}",
        refusal.message()
    );
}

#[test]
fn adding_guests_suggests_the_copy_the_user_organizes() {
    let refusal = check_copy(&two_inboxes(), INVITED, None, CopyChange::InviteGuests)
        .expect("two inboxes hold the meeting");
    assert!(
        refusal
            .message()
            .contains("To add guests, suggest owner@example.com"),
        "{}",
        refusal.message()
    );
    assert!(
        refusal.message().contains(
            "\"Which inbox's copy should I add the guests from: owner@example.com (organizer) \
             or guest@example.com (guest)?\""
        ),
        "{}",
        refusal.message()
    );
}

#[test]
fn one_inbox_or_a_copy_outside_the_users_inboxes_passes() {
    let one_inbox = vec![
        copy(ORGANIZED, "owner@example.com", true),
        copy(INVITED, "Owner@Example.com", true),
    ];
    assert_eq!(
        check_copy(&one_inbox, ORGANIZED, None, CopyChange::Delete),
        None
    );
    assert_eq!(
        check_copy(
            &two_inboxes(),
            Uuid::from_u128(99),
            Some("delegated@example.com"),
            CopyChange::Delete
        ),
        None
    );
}
