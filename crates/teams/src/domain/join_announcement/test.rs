use std::{collections::HashSet, sync::Mutex};

use notification::domain::{
    models::{Notification, NotificationResult, request::SendNotificationRequest},
    service::SendNotificationError,
};
use serde_json::json;

use super::*;

const TEAM: Uuid = Uuid::from_u128(0x1111_1111_1111_1111_1111_1111_1111_1111);

fn user(email: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email(email).unwrap()
}

fn announce(candidates: &[&str]) -> AnnounceJoin {
    AnnounceJoin {
        team_id: TEAM,
        joined: user("alice@acme.com"),
        joined_name: Some("Alice Example".to_owned()),
        candidates: candidates.iter().map(|email| user(email)).collect(),
    }
}

fn strings(values: &[&str]) -> Vec<String> {
    values.iter().map(|value| value.to_string()).collect()
}

/// Accepts each eligible address once, as the ledger does.
#[derive(Default)]
struct FakeRepository {
    eligible: HashSet<String>,
    fail_claims: bool,
    claimed: Mutex<HashSet<String>>,
    claim_calls: Mutex<Vec<Vec<String>>>,
    released: Mutex<Vec<String>>,
}

impl FakeRepository {
    fn eligible(emails: &[&str]) -> Self {
        Self {
            eligible: strings(emails).into_iter().collect(),
            ..Self::default()
        }
    }
}

impl JoinAnnouncementRepository for FakeRepository {
    async fn claim(
        &self,
        _team_id: Uuid,
        candidates: &[MacroUserIdStr<'static>],
    ) -> Result<Vec<ClaimedJoinEmail>, Report<JoinAnnouncementError>> {
        self.claim_calls.lock().unwrap().push(
            candidates
                .iter()
                .map(|candidate| candidate.email_str().to_owned())
                .collect(),
        );
        if self.fail_claims {
            return Err(Report::new(JoinAnnouncementError::Storage));
        }
        let mut claimed = self.claimed.lock().unwrap();
        Ok(candidates
            .iter()
            .filter(|candidate| {
                self.eligible.contains(candidate.email_str())
                    && claimed.insert(candidate.email_str().to_owned())
            })
            .map(|candidate| ClaimedJoinEmail {
                recipient: candidate.clone(),
                team_name: "Acme".to_owned(),
            })
            .collect())
    }

    async fn release(
        &self,
        _team_id: Uuid,
        recipient: &MacroUserIdStr<'_>,
    ) -> Result<(), Report<JoinAnnouncementError>> {
        self.claimed.lock().unwrap().remove(recipient.email_str());
        self.released
            .lock()
            .unwrap()
            .push(recipient.email_str().to_owned());
        Ok(())
    }
}

/// Records every request and rejects the ones addressed to `failing` recipients.
#[derive(Default)]
struct FakeIngress {
    failing: HashSet<String>,
    requests: Mutex<Vec<serde_json::Value>>,
}

impl FakeIngress {
    fn failing_for(recipient_id: &str) -> Self {
        Self {
            failing: HashSet::from([recipient_id.to_owned()]),
            ..Self::default()
        }
    }
}

impl NotificationIngress for FakeIngress {
    fn send_notification<
        'a,
        T: Notification + Clone + 'static,
        U: serde::Serialize + Send + Sync + 'static,
    >(
        &'a self,
        req: SendNotificationRequest<'a, T, U>,
    ) -> impl Future<Output = Result<Option<NotificationResult<'a>>, Report<SendNotificationError>>> + Send
    {
        let request = serde_json::to_value(&req).unwrap();
        let fails = request["req"]["recipient_ids"]
            .as_array()
            .unwrap()
            .iter()
            .any(|recipient| self.failing.contains(recipient.as_str().unwrap()));
        self.requests.lock().unwrap().push(request);
        async move {
            if fails {
                Err(Report::new(SendNotificationError::Other))
            } else {
                Ok(None)
            }
        }
    }
}

#[tokio::test]
async fn nobody_claimed_means_no_email() {
    let service =
        JoinAnnouncementServiceImpl::new(FakeRepository::default(), FakeIngress::default());

    let report = service
        .announce_join(announce(&["bob@acme.com"]))
        .await
        .unwrap();

    assert_eq!(report, AnnounceReport::default());
    assert_eq!(
        *service.repository.claim_calls.lock().unwrap(),
        vec![strings(&["bob@acme.com"])]
    );
    assert!(service.ingress.requests.lock().unwrap().is_empty());
}

#[tokio::test]
async fn the_joiner_and_duplicates_are_dropped_before_the_claim() {
    let service =
        JoinAnnouncementServiceImpl::new(FakeRepository::default(), FakeIngress::default());

    service
        .announce_join(announce(&[
            "carol@acme.com",
            "ALICE@acme.com",
            "Bob@Acme.com",
            "carol@acme.com",
            "bob@acme.com",
        ]))
        .await
        .unwrap();

    assert_eq!(
        *service.repository.claim_calls.lock().unwrap(),
        vec![strings(&["bob@acme.com", "carol@acme.com"])]
    );
}

#[tokio::test]
async fn a_claimed_colleague_gets_one_email_from_the_joiner() {
    let service = JoinAnnouncementServiceImpl::new(
        FakeRepository::eligible(&["bob@acme.com"]),
        FakeIngress::default(),
    );

    let report = service
        .announce_join(announce(&["bob@acme.com", "dave@other.com"]))
        .await
        .unwrap();

    assert_eq!(
        report,
        AnnounceReport {
            claimed: 1,
            sent: 1,
            released: 0
        }
    );
    let requests = service.ingress.requests.lock().unwrap();
    let [request] = requests.as_slice() else {
        panic!("expected one request, got {requests:?}");
    };
    assert_eq!(
        request["uuid_to_write"],
        "aaf6d3a5-abab-5fea-8baa-01aa7a385f8d"
    );
    assert_eq!(
        request["req"]["notification_entity"],
        json!({"entity_type": "team", "entity_id": "11111111-1111-1111-1111-111111111111"})
    );
    assert_eq!(
        request["req"]["secondary_notification_entity"],
        serde_json::Value::Null
    );
    assert_eq!(request["req"]["sender_id"], "macro|alice@acme.com");
    assert_eq!(
        request["req"]["recipient_ids"],
        json!(["macro|bob@acme.com"])
    );
    assert_eq!(
        request["req"]["notification"],
        json!({
            "tag": "colleague_joined_macro",
            "content": {
                "team_name": "Acme",
                "joined_by": "macro|alice@acme.com",
                "joined_name": "Alice Example",
                "recipient_email": "bob@acme.com",
            },
        })
    );
    assert_eq!(
        request["build_email"]["content"]["subject"],
        "Alice Example joined Macro"
    );
    assert_eq!(request["build_apns"], serde_json::Value::Null);
    assert_eq!(request["send_conn_gateway"], false);
}

#[tokio::test]
async fn a_failed_enqueue_releases_only_that_claim() {
    let service = JoinAnnouncementServiceImpl::new(
        FakeRepository::eligible(&["bob@acme.com", "carol@acme.com"]),
        FakeIngress::failing_for("macro|bob@acme.com"),
    );

    let report = service
        .announce_join(announce(&["bob@acme.com", "carol@acme.com"]))
        .await
        .unwrap();

    assert_eq!(
        report,
        AnnounceReport {
            claimed: 2,
            sent: 1,
            released: 1
        }
    );
    assert_eq!(
        *service.repository.released.lock().unwrap(),
        strings(&["bob@acme.com"])
    );
    assert_eq!(
        *service.repository.claimed.lock().unwrap(),
        HashSet::from(["carol@acme.com".to_owned()])
    );
}

#[tokio::test]
async fn large_candidate_lists_are_claimed_in_chunks_of_fifty() {
    let service =
        JoinAnnouncementServiceImpl::new(FakeRepository::default(), FakeIngress::default());
    let emails: Vec<String> = (0..120).map(|i| format!("user{i:03}@acme.com")).collect();
    let candidates: Vec<&str> = emails.iter().map(String::as_str).collect();

    service.announce_join(announce(&candidates)).await.unwrap();

    let chunk_sizes: Vec<usize> = service
        .repository
        .claim_calls
        .lock()
        .unwrap()
        .iter()
        .map(Vec::len)
        .collect();
    assert_eq!(chunk_sizes, vec![50, 50, 20]);
}

#[tokio::test]
async fn a_storage_failure_is_an_error_and_sends_nothing() {
    let service = JoinAnnouncementServiceImpl::new(
        FakeRepository {
            fail_claims: true,
            ..FakeRepository::eligible(&["bob@acme.com"])
        },
        FakeIngress::default(),
    );

    let error = service
        .announce_join(announce(&["bob@acme.com"]))
        .await
        .unwrap_err();

    assert_eq!(*error.current_context(), JoinAnnouncementError::Storage);
    assert!(service.ingress.requests.lock().unwrap().is_empty());
}
