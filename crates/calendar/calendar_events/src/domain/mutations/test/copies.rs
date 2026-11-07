//! Confirming which of several inboxes' copies a caller changes.
use super::*;
use crate::domain::copies::CopyChange;
use crate::domain::models::MeetingCopy;
use crate::domain::ports::CalendarCopyConfirmation;

const ORGANIZED: Uuid = Uuid::from_u128(7);
const INVITED: Uuid = Uuid::from_u128(8);

fn copies() -> Vec<MeetingCopy> {
    vec![
        MeetingCopy {
            event_id: INVITED,
            inbox: "guest@example.com".to_string(),
            organizes: false,
            attends: true,
        },
        MeetingCopy {
            event_id: ORGANIZED,
            inbox: "owner@example.com".to_string(),
            organizes: true,
            attends: false,
        },
    ]
}

#[tokio::test]
async fn confirming_a_copy_checks_the_requesters_copies_of_the_meeting() {
    let repo = FakeRepo {
        meeting_copies: copies(),
        ..Default::default()
    };
    let service = service(
        repo,
        FakeProvider::new(FakeProviderBehavior::Echo),
        FakeTokens::ok(),
    );

    let refusal = service
        .confirm_copy(
            "macro|self@example.com",
            ORGANIZED,
            None,
            CopyChange::Delete,
        )
        .await
        .unwrap()
        .expect("two inboxes hold the meeting");
    assert!(
        refusal.message().contains("owner@example.com organizes it"),
        "{}",
        refusal.message()
    );
    assert_eq!(
        service
            .confirm_copy(
                "macro|self@example.com",
                ORGANIZED,
                Some("owner@example.com"),
                CopyChange::Delete,
            )
            .await
            .unwrap(),
        None
    );
}
