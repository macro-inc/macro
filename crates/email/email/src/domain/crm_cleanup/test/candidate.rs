use super::*;
use crm::domain::model::CrmError;

#[tokio::test]
async fn a_duplicate_claim_still_checks_and_removes_the_stored_links_contribution() {
    let (service, fake) = setup();
    let stored = uuid::Uuid::from_u128(45);
    {
        let mut s = fake.0.lock().unwrap();
        s.claimed = false;
        s.link.as_mut().unwrap().id = stored;
    }
    super::super::process_candidate::process_candidate(&service, LINK, EMAIL)
        .await
        .unwrap();
    assert_eq!(
        fake.calls(),
        [
            Call::Claim(LINK, EMAIL.into()),
            Call::Link(LINK),
            Call::Team("macro|owner@example.com".into()),
            Call::Target(TEAM, EMAIL.into()),
            Call::Messages(stored, EMAIL.into()),
            Call::Depopulate(TEAM, stored, EMAIL.into())
        ]
    );
}

#[tokio::test]
async fn each_candidate_guard_stops_at_its_own_boundary() {
    for step in ["link", "team", "target", "messages"] {
        let (service, fake) = setup();
        {
            let mut s = fake.0.lock().unwrap();
            match step {
                "link" => s.link = None,
                "team" => s.team = None,
                "target" => s.target = false,
                "messages" => s.messages = true,
                _ => unreachable!(),
            }
        }
        super::super::process_candidate::process_candidate(&service, LINK, EMAIL)
            .await
            .unwrap();
        let all = [
            Call::Claim(LINK, EMAIL.into()),
            Call::Link(LINK),
            Call::Team("macro|owner@example.com".into()),
            Call::Target(TEAM, EMAIL.into()),
            Call::Messages(LINK, EMAIL.into()),
        ];
        let count = match step {
            "link" => 2,
            "team" => 3,
            "target" => 4,
            _ => 5,
        };
        assert_eq!(fake.calls(), all[..count]);
    }
}

#[tokio::test]
async fn every_candidate_failure_is_retryable_with_the_original_context_and_cause() {
    for (name, context, index) in [
        ("claim", "Failed to claim crm cleanup candidate", 1),
        ("link", "Failed to fetch link for crm cleanup", 2),
        ("team", "Failed to look up team for link.macro_id", 3),
        (
            "target",
            "Failed to check for a CRM contact to tear down",
            4,
        ),
        (
            "messages",
            "Failed to check remaining messages with contact",
            5,
        ),
        ("depopulate", "Failed to depopulate CRM contact", 6),
    ] {
        let (service, fake) = setup();
        fake.0.lock().unwrap().fault = Some((name, 1));
        let detail = retryable(
            super::super::process_candidate::process_candidate(&service, LINK, EMAIL).await,
            FailureReason::DatabaseQueryFailed,
            context,
        );
        if ["team", "target", "depopulate"].contains(&name) {
            assert!(detail.source.downcast_ref::<CrmError>().is_some());
        } else {
            assert_eq!(detail.source.downcast_ref::<Fault>().unwrap().0, name);
        }
        assert_eq!(fake.calls().len(), index);
    }
}
