use super::*;
use ::crm::domain::{email_policy_work::*, email_privacy::EmailContributionMailbox};

fn request() -> PopulateCrmPolicyPayload {
    PopulateCrmPolicyPayload {
        team_id: TEAM,
        macro_id: macro_user_id::user_id::MacroUserIdStr::try_from("macro|owner@example.com")
            .unwrap(),
        link_id: LINK,
        work_id: Uuid::from_u128(40),
        consent_incarnation: Uuid::from_u128(50),
        policy_version: 7,
    }
}
fn page() -> EmailPolicyHistoryPage {
    EmailPolicyHistoryPage {
        mailbox: EmailContributionMailbox {
            link_id: LINK,
            email_address: "owner@example.com".into(),
        },
        cursor: EmailPolicyHistoryCursor::default(),
        contacts: vec![
            EmailPolicyHistoryContact {
                address: "first@example.org".into(),
                name: None,
            },
            EmailPolicyHistoryContact {
                address: "second@example.org".into(),
                name: None,
            },
        ],
    }
}

#[tokio::test]
async fn modern_page_retains_the_original_envelope_and_checkpoints_only_after_all_effects() {
    let (service, fake) = setup();
    fake.0.lock().unwrap().policy_page = Some(page());
    let request = request();
    let data = input(BackfillOperation::PopulateCrmPolicy(request.clone()));
    assert!(matches!(
        service.process(&data).await,
        BackfillDisposition::DoneDelete
    ));
    assert_eq!(
        fake.calls(),
        [
            "acquire",
            "hold",
            "policy_page",
            "policy_contact",
            "policy_contact",
            "policy_finish",
            "release"
        ]
    );
    assert!(
        fake.0
            .lock()
            .unwrap()
            .policy_requests
            .iter()
            .all(|r| r == &request)
    );
}

#[tokio::test]
async fn failed_contact_keeps_the_page_retryable_and_never_advances_its_cursor() {
    let (service, fake) = setup();
    fake.0.lock().unwrap().policy_page = Some(page());
    fake.fail("policy_contact");
    fake.0.lock().unwrap().crm_contended = false;
    let data = input(BackfillOperation::PopulateCrmPolicy(request()));
    assert!(matches!(
        service.process(&data).await,
        BackfillDisposition::LeaveForRedelivery(_)
    ));
    assert_eq!(
        fake.calls(),
        [
            "acquire",
            "hold",
            "policy_page",
            "policy_contact",
            "release"
        ]
    );
}

#[tokio::test]
async fn missing_or_replaced_generation_does_no_contact_work() {
    let (service, fake) = setup();
    let data = input(BackfillOperation::PopulateCrmPolicy(request()));
    assert!(matches!(
        service.process(&data).await,
        BackfillDisposition::DoneDelete
    ));
    assert_eq!(fake.calls(), ["acquire", "hold", "policy_page", "release"]);
}
