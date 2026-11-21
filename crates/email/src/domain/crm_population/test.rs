mod fakes;

use super::*;
use ::crm::domain::{
    email_policy_work::{
        EmailPolicyHistoryContact, EmailPolicyHistoryCursor, EmailPolicyHistoryPage,
    },
    email_privacy::EmailContributionMailbox,
    model::CrmError,
};
use fakes::*;
use models_email::service::crm_population::{CrmPopulationContact, CrmPopulationMessage};
use std::time::Duration;
use uuid::Uuid;

fn delivered(email: &str) -> CrmPopulationMessage {
    CrmPopulationMessage::Contact(CrmPopulationContact {
        link_id: LINK,
        claim: CLAIM,
        contact: contact(email),
    })
}

fn hints(last_at: i64, is_sent: bool) -> ContactHints {
    ContactHints {
        first_at: at(50),
        last_at: at(last_at),
        is_sent,
        name: Some("Buyer".into()),
    }
}

fn retried_within(disposition: PopulationDisposition, low: Duration, high: Duration) {
    let PopulationDisposition::Retry { after } = disposition else {
        panic!("retried: {disposition:?}")
    };
    assert!(
        (low..=high).contains(&after),
        "{after:?} not in {low:?}..={high:?}"
    );
}

#[tokio::test]
async fn requests_send_only_for_correspondents_without_a_queued_message() {
    let fake = Fake::default();
    fake.0.lock().unwrap().record = Some(vec![false, true]);
    let requests = fake.service().requests;

    requests
        .request(
            LINK,
            vec![contact("queued@example.com"), contact("new@example.com")],
        )
        .await
        .unwrap();

    assert_eq!(fake.calls(), ["record", "send"]);
    let state = fake.0.lock().unwrap();
    let claim = state.recorded_claims[1];
    let [(deduplication, CrmPopulationMessage::Contact(sent))] = state.sent.as_slice() else {
        panic!("one message: {:?}", state.sent)
    };
    assert_eq!(
        (*deduplication, sent.claim, sent.link_id),
        (claim, claim, LINK)
    );
    assert_eq!(sent.contact.contact_email, "new@example.com");
}

#[tokio::test]
async fn requests_give_back_their_claims_when_sending_fails() {
    let fake = Fake::default();
    fake.0.lock().unwrap().record = Some(vec![true]);
    fake.fail("send");

    let result = fake
        .service()
        .requests
        .request(LINK, vec![contact("new@example.com")])
        .await;

    assert!(result.is_err());
    assert_eq!(fake.calls(), ["record", "send", "release_claims"]);
    let state = fake.0.lock().unwrap();
    assert_eq!(state.released, state.recorded_claims);
}

#[tokio::test]
async fn requests_are_each_sent_with_the_claim_they_asked_for_when_the_record_answer_is_lost() {
    let fake = Fake::default();
    fake.fail("record");

    fake.service()
        .requests
        .request(
            LINK,
            vec![contact("a@example.com"), contact("b@example.com")],
        )
        .await
        .unwrap();

    // A record that went through gave these claims their entries.
    let state = fake.0.lock().unwrap();
    let sent: Vec<Uuid> = state.sent.iter().map(|(claim, _)| *claim).collect();
    assert_eq!(sent, state.recorded_claims);
    assert_eq!(sent.len(), 2);
}

#[tokio::test]
async fn a_population_runs_on_its_merged_hints_inside_a_team_slot() {
    let fake = Fake::default();
    fake.0.lock().unwrap().taken = PendingContact::Claimed(hints(900, true));

    let disposition = fake
        .service()
        .process(&delivered("buyer@example.com"), 1)
        .await;

    assert_eq!(disposition, PopulationDisposition::Done);
    assert_eq!(
        fake.calls(),
        [
            "link",
            "team",
            "team_slot",
            "hold",
            "take",
            "populate",
            "settle",
            "release"
        ]
    );
    let state = fake.0.lock().unwrap();
    let [populated] = state.populated.as_slice() else {
        panic!("one population")
    };
    assert_eq!(
        (populated.first_at, populated.last_at, populated.is_sent),
        (at(50), at(900), true)
    );
    assert_eq!(populated.contact_name.as_deref(), Some("Buyer"));
    assert_eq!(populated.contact_email, "buyer@example.com");
}

#[tokio::test]
async fn a_busy_team_hides_the_message_without_touching_the_database_any_further() {
    let fake = Fake::default();
    fake.0.lock().unwrap().slot = false;

    let disposition = fake
        .service()
        .process(&delivered("buyer@example.com"), 1)
        .await;

    retried_within(
        disposition,
        Duration::from_millis(2500),
        Duration::from_secs(5),
    );
    assert_eq!(fake.calls(), ["link", "team", "team_slot"]);

    let fake = Fake::default();
    fake.fail("team_slot");
    let disposition = fake
        .service()
        .process(&delivered("buyer@example.com"), 20)
        .await;
    // A team paused for long backs each mailbox off for up to an hour.
    retried_within(
        disposition,
        Duration::from_secs(1800),
        Duration::from_secs(3600),
    );
}

#[tokio::test]
async fn a_failed_population_backs_off_by_its_attempts_then_is_given_up() {
    let fake = Fake::default();
    fake.0.lock().unwrap().populate = Some(|| CrmError::Contended);

    let first = fake
        .service()
        .process(&delivered("buyer@example.com"), 1)
        .await;
    retried_within(first, Duration::from_secs(15), Duration::from_secs(30));
    assert!(!fake.calls().contains(&"settle"));

    for _ in 2..MAX_ATTEMPTS {
        fake.service()
            .process(&delivered("buyer@example.com"), 1)
            .await;
    }
    let last = fake
        .service()
        .process(&delivered("buyer@example.com"), 1)
        .await;

    assert_eq!(last, PopulationDisposition::Done);
    assert_eq!(fake.0.lock().unwrap().attempts, MAX_ATTEMPTS);
    assert_eq!(
        fake.calls()
            .iter()
            .filter(|call| **call == "settle")
            .count(),
        1
    );
}

#[tokio::test]
async fn a_population_the_crm_refuses_is_dropped() {
    let fake = Fake::default();
    fake.0.lock().unwrap().populate = Some(|| CrmError::InvalidRequest("bad".into()));

    let disposition = fake
        .service()
        .process(&delivered("buyer@example.com"), 1)
        .await;

    assert_eq!(disposition, PopulationDisposition::Done);
    assert!(fake.calls().contains(&"settle"));
    assert!(!fake.calls().contains(&"count_failure"));
}

#[tokio::test]
async fn a_superseded_message_hands_its_hints_to_the_queued_one_without_populating() {
    let fake = Fake::default();
    fake.0.lock().unwrap().taken = PendingContact::Superseded;
    fake.0.lock().unwrap().record = Some(vec![false]);

    let disposition = fake
        .service()
        .process(&delivered("buyer@example.com"), 1)
        .await;

    assert_eq!(disposition, PopulationDisposition::Done);
    assert!(!fake.calls().contains(&"populate"));
    let state = fake.0.lock().unwrap();
    assert_eq!(state.recorded, [vec![contact("buyer@example.com")]]);
    assert!(state.sent.is_empty());
}

#[tokio::test]
async fn a_message_whose_entry_is_gone_skips_the_changes_nothing_shortcut() {
    let fake = Fake::default();
    let before = chrono::Utc::now();

    fake.service()
        .process(&delivered("buyer@example.com"), 1)
        .await;

    let state = fake.0.lock().unwrap();
    let [populated] = state.populated.as_slice() else {
        panic!("one population")
    };
    assert!(populated.last_at >= before);
    assert!(!populated.is_sent);
    assert_eq!(populated.first_at, at(100));
}

#[tokio::test]
async fn requests_made_during_a_run_get_one_new_message_or_wait_for_redelivery() {
    let fake = Fake::default();
    fake.0.lock().unwrap().settled = SettledContact::Handed(hints(1_000, false));

    let disposition = fake
        .service()
        .process(&delivered("buyer@example.com"), 1)
        .await;

    assert_eq!(disposition, PopulationDisposition::Done);
    {
        let state = fake.0.lock().unwrap();
        let [(next, CrmPopulationMessage::Contact(handed))] = state.sent.as_slice() else {
            panic!("one handed message: {:?}", state.sent)
        };
        assert_eq!(handed.claim, *next);
        assert_ne!(handed.claim, CLAIM);
        assert_eq!(handed.contact.last_at, at(1_000));
    }

    let fake = Fake::default();
    fake.0.lock().unwrap().settled = SettledContact::Handed(hints(1_000, false));
    fake.fail("send");

    let disposition = fake
        .service()
        .process(&delivered("buyer@example.com"), 1)
        .await;

    assert_eq!(disposition, PopulationDisposition::LeaveForRedelivery);
    let (claim, _) = fake.0.lock().unwrap().restored.expect("restored");
    assert_eq!(claim, CLAIM);
}

#[tokio::test]
async fn a_settle_whose_answer_is_lost_gives_any_hand_off_back_to_the_claim() {
    let fake = Fake::default();
    fake.fail("settle");

    let disposition = fake
        .service()
        .process(&delivered("buyer@example.com"), 1)
        .await;

    // The settle may have handed the entry to a claim no message carries.
    assert_eq!(disposition, PopulationDisposition::LeaveForRedelivery);
    let state = fake.0.lock().unwrap();
    let (claim, _) = state.restored.expect("restored");
    assert_eq!(claim, CLAIM);
    assert!(state.sent.is_empty());
}

#[tokio::test]
async fn a_gone_mailbox_or_teamless_owner_ends_the_population_with_its_entry() {
    let fake = Fake::default();
    fake.0.lock().unwrap().link = None;
    let disposition = fake
        .service()
        .process(&delivered("buyer@example.com"), 1)
        .await;
    assert_eq!(disposition, PopulationDisposition::Done);
    assert_eq!(fake.calls(), ["link", "discard"]);

    let fake = Fake::default();
    fake.0.lock().unwrap().team = None;
    let disposition = fake
        .service()
        .process(&delivered("buyer@example.com"), 1)
        .await;
    assert_eq!(disposition, PopulationDisposition::Done);
    assert_eq!(fake.calls(), ["link", "team", "discard"]);
}

#[tokio::test]
async fn a_history_page_checkpoints_only_after_every_contact_inside_a_team_slot() {
    let fake = Fake::default();
    fake.0.lock().unwrap().history = Some(EmailPolicyHistoryPage {
        mailbox: EmailContributionMailbox {
            link_id: LINK,
            email_address: "owner@example.com".into(),
        },
        cursor: EmailPolicyHistoryCursor::default(),
        contacts: ["first@example.org", "second@example.org"]
            .map(|address| EmailPolicyHistoryContact {
                address: address.into(),
                name: None,
            })
            .into(),
    });
    let message = CrmPopulationMessage::PolicyPage(page());

    assert_eq!(
        fake.service().process(&message, 1).await,
        PopulationDisposition::Done
    );
    assert_eq!(
        fake.calls(),
        [
            "team_slot",
            "hold",
            "history_page",
            "history_contact",
            "history_contact",
            "history_finish",
            "release"
        ]
    );

    let fake = Fake::default();
    fake.0.lock().unwrap().history = Some(EmailPolicyHistoryPage {
        mailbox: EmailContributionMailbox {
            link_id: LINK,
            email_address: "owner@example.com".into(),
        },
        cursor: EmailPolicyHistoryCursor::default(),
        contacts: vec![EmailPolicyHistoryContact {
            address: "first@example.org".into(),
            name: None,
        }],
    });
    fake.fail("history_contact");
    retried_within(
        fake.service().process(&message, 1).await,
        Duration::from_secs(15),
        Duration::from_secs(30),
    );
    assert!(!fake.calls().contains(&"history_finish"));
    // Deliveries count a busy team's refusals too, so a page is not given up
    // at the attempts a contact is.
    assert!(matches!(
        fake.service().process(&message, MAX_ATTEMPTS).await,
        PopulationDisposition::Retry { .. }
    ));
    assert_eq!(
        fake.service().process(&message, MAX_DELIVERIES).await,
        PopulationDisposition::Done
    );
}
