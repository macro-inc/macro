use super::*;
use std::sync::{Arc, Mutex};

const LINK: Uuid = Uuid::from_u128(1);
const MESSAGE: Uuid = Uuid::from_u128(2);

struct Fake {
    trace: Arc<Mutex<Vec<&'static str>>>,
    message: Option<bool>,
    schedule: Mutex<Option<ScheduleFacts>>,
    fail: Option<&'static str>,
    count: u64,
    attempt: bool,
}
struct Tx<'a> {
    fake: &'a Fake,
}
// The store must return an owned transaction, just like the real pool.
struct OwnedTx {
    fake: Arc<Fake>,
    committed: bool,
}
struct Store(Arc<Fake>);
impl Fake {
    fn ready() -> Self {
        Self {
            trace: Arc::default(),
            message: Some(false),
            schedule: Mutex::new(Some(ScheduleFacts {
                send_time: chrono::DateTime::from_timestamp(10, 0).unwrap(),
                processing: false,
                actor_id: Some("actor".into()),
                agent_correlation_id: Some(Uuid::from_u128(3)),
                delivery_claim_id: None,
                delivery_started_at: None,
                delivery_message_id: None,
                delivery_status: "ready".into(),
                approved_attachments: serde_json::json!(["file"]),
                available: true,
            })),
            fail: None,
            count: 1,
            attempt: true,
        }
    }
    fn step(&self, name: &'static str) -> anyhow::Result<()> {
        self.trace.lock().unwrap().push(name);
        anyhow::ensure!(self.fail != Some(name), "{name} failed");
        Ok(())
    }
    fn trace(&self) -> Vec<&'static str> {
        self.trace.lock().unwrap().clone()
    }
}
impl Drop for OwnedTx {
    fn drop(&mut self) {
        if !self.committed {
            self.fake.trace.lock().unwrap().push("drop");
        }
    }
}
impl ClaimStore for Store {
    type Transaction = OwnedTx;
    async fn begin(&self) -> anyhow::Result<OwnedTx> {
        self.0.step("begin")?;
        Ok(OwnedTx {
            fake: self.0.clone(),
            committed: false,
        })
    }
}
impl ClaimTransaction for OwnedTx {
    async fn message_sent(&mut self, link: Uuid, message: Uuid) -> anyhow::Result<Option<bool>> {
        assert_eq!((link, message), (LINK, MESSAGE));
        self.fake.step("message")?;
        Ok(self.fake.message)
    }
    async fn schedule(
        &mut self,
        link: Uuid,
        message: Uuid,
        lease: i32,
    ) -> anyhow::Result<Option<ScheduleFacts>> {
        assert_eq!((link, message, lease), (LINK, MESSAGE, 300));
        self.fake.step("schedule")?;
        Ok(self.fake.schedule.lock().unwrap().take())
    }
    async fn acquire(
        &mut self,
        link: Uuid,
        message: Uuid,
        token: Uuid,
        lease: i32,
        header: Option<&str>,
        legacy: bool,
    ) -> anyhow::Result<()> {
        assert_eq!((link, message, lease), (LINK, MESSAGE, 300));
        assert_ne!(token, Uuid::nil());
        self.fake
            .trace
            .lock()
            .unwrap()
            .push(if legacy { "legacy" } else { "managed" });
        self.fake.trace.lock().unwrap().push(if header.is_some() {
            "header"
        } else {
            "no_header"
        });
        self.fake.step("acquire")
    }
    async fn attempt(&mut self, link: Uuid, message: Uuid) -> anyhow::Result<Option<AttemptFacts>> {
        assert_eq!((link, message), (LINK, MESSAGE));
        self.fake.step("attempt")?;
        Ok(self.fake.attempt.then(|| AttemptFacts {
            request: Some(serde_json::json!({"approved":true})),
            prepared_content: Some(serde_json::json!({"body":"frozen"})),
        }))
    }
    async fn commit(mut self) -> anyhow::Result<()> {
        self.fake.step("commit")?;
        self.committed = true;
        Ok(())
    }
}
impl CompletionQueries for Tx<'_> {
    async fn message_sent(&mut self, link: Uuid, message: Uuid) -> anyhow::Result<Option<bool>> {
        assert_eq!((link, message), (LINK, MESSAGE));
        self.fake.step("message")?;
        Ok(self.fake.message)
    }
    async fn complete(&mut self, claim: &DeliveryClaim) -> anyhow::Result<u64> {
        assert_eq!(claim.schedule.message_id, MESSAGE);
        self.fake.step("complete")?;
        Ok(self.fake.count)
    }
}
impl DeliveryTransitions for Fake {
    async fn begin_submission(&self, claim: &DeliveryClaim, lease: i32) -> anyhow::Result<u64> {
        assert_eq!((claim.schedule.message_id, lease), (MESSAGE, 300));
        self.step("submission")?;
        Ok(self.count)
    }
    async fn release_preparation(&self, claim: &DeliveryClaim, retry: i32) -> anyhow::Result<()> {
        assert_eq!((claim.schedule.message_id, retry), (MESSAGE, 60));
        self.step("release")
    }
    async fn pause_delivery(
        &self,
        claim: &DeliveryClaim,
        unconfirmed: bool,
        retry: i32,
    ) -> anyhow::Result<()> {
        assert_eq!((claim.schedule.message_id, retry), (MESSAGE, 300));
        self.step(if unconfirmed { "unconfirmed" } else { "failed" })
    }
}
async fn claim(fake: Fake) -> (Arc<Fake>, Option<DeliveryClaim>) {
    let fake = Arc::new(fake);
    let result = claim_delivery(&Store(fake.clone()), LINK, MESSAGE, 300)
        .await
        .unwrap();
    (fake, result)
}
#[tokio::test]
async fn rejects_missing_sent_missing_schedule_and_unavailable_with_implicit_drop() {
    for message in [None, Some(true)] {
        let mut fake = Fake::ready();
        fake.message = message;
        let (fake, result) = claim(fake).await;
        assert!(result.is_none());
        assert_eq!(fake.trace(), ["begin", "message", "drop"]);
    }
    for missing in [true, false] {
        let fake = Fake::ready();
        if missing {
            *fake.schedule.lock().unwrap() = None;
        } else {
            fake.schedule.lock().unwrap().as_mut().unwrap().available = false;
        }
        let (fake, result) = claim(fake).await;
        assert!(result.is_none());
        assert_eq!(fake.trace(), ["begin", "message", "schedule", "drop"]);
    }
}
#[tokio::test]
async fn every_legacy_and_reconciliation_condition_keeps_the_existing_header_rule() {
    for (processing, owned, started, status, legacy, reconcile) in [
        (false, false, false, "ready", false, false),
        (true, true, false, "ready", false, false),
        (true, false, false, "ready", true, true),
        (false, false, true, "ready", false, true),
        (false, false, false, "unconfirmed", false, true),
    ] {
        for header in [None, Some("fixed.header@example.com")] {
            let fake = Fake::ready();
            {
                let mut guard = fake.schedule.lock().unwrap();
                let row = guard.as_mut().unwrap();
                row.processing = processing;
                row.delivery_claim_id = owned.then_some(Uuid::from_u128(4));
                row.delivery_started_at = started.then_some(row.send_time);
                row.delivery_status = status.into();
                row.delivery_message_id = header.map(str::to_owned);
            }
            let (fake, result) = claim(fake).await;
            let result = result.unwrap();
            assert_eq!(result.requires_reconciliation, reconcile);
            assert_eq!(result.schedule.actor_id.as_deref(), Some("actor"));
            assert_eq!(
                result.schedule.agent_correlation_id,
                Some(Uuid::from_u128(3))
            );
            assert_eq!(result.approved_attachments, serde_json::json!(["file"]));
            assert_eq!(
                result.approved_snapshot,
                Some(serde_json::json!({"approved":true}))
            );
            assert_eq!(
                result.prepared_content,
                Some(serde_json::json!({"body":"frozen"}))
            );
            if let Some(header) = header {
                assert_eq!(result.message_id_header.as_deref(), Some(header));
            } else if reconcile {
                assert!(result.message_id_header.is_none());
            } else {
                let header = result.message_id_header.unwrap();
                assert!(header.starts_with(&format!("{MESSAGE}.")));
                assert!(header.ends_with("@send.macro.com"));
            }
            assert_eq!(
                fake.trace(),
                [
                    "begin",
                    "message",
                    "schedule",
                    if legacy { "legacy" } else { "managed" },
                    if header.is_some() || !reconcile {
                        "header"
                    } else {
                        "no_header"
                    },
                    "acquire",
                    "attempt",
                    "commit"
                ]
            );
        }
    }
}
#[tokio::test]
async fn claim_failures_keep_the_original_error_and_never_commit_after_a_failure() {
    for fail in [
        "begin", "message", "schedule", "acquire", "attempt", "commit",
    ] {
        let mut fake = Fake::ready();
        fake.fail = Some(fail);
        let fake = Arc::new(fake);
        let error = claim_delivery(&Store(fake.clone()), LINK, MESSAGE, 300)
            .await
            .err()
            .unwrap();
        assert_eq!(error.to_string(), format!("{fail} failed"));
        let trace = fake.trace();
        assert_eq!(
            trace.last(),
            Some(if fail == "begin" { &"begin" } else { &"drop" })
        );
        if fail != "commit" {
            assert!(!trace.contains(&"commit"));
        }
    }
}
#[tokio::test]
async fn completion_and_submission_interpret_only_one_affected_row_as_success() {
    let (_, claim) = claim(Fake::ready()).await;
    let claim = claim.unwrap();
    for count in [0, 1, 2] {
        let mut fake = Fake::ready();
        fake.count = count;
        assert_eq!(
            complete_delivery(&mut Tx { fake: &fake }, &claim)
                .await
                .unwrap(),
            count == 1
        );
        assert_eq!(
            begin_submission(&fake, &claim, 300).await.unwrap(),
            count == 1
        );
    }
    for message in [None, Some(true)] {
        let mut fake = Fake::ready();
        fake.message = message;
        assert!(
            !complete_delivery(&mut Tx { fake: &fake }, &claim)
                .await
                .unwrap()
        );
        assert_eq!(fake.trace(), ["message"]);
    }
    let fake = Fake::ready();
    release_preparation(&fake, &claim, 60).await.unwrap();
    pause_delivery(&fake, &claim, false, 300).await.unwrap();
    pause_delivery(&fake, &claim, true, 300).await.unwrap();
    assert_eq!(fake.trace(), ["release", "failed", "unconfirmed"]);
}

#[tokio::test]
async fn transition_failures_propagate_without_reinterpreting_the_cause() {
    let (_, claim) = claim(Fake::ready()).await;
    let claim = claim.unwrap();
    for fail in ["message", "complete"] {
        let mut fake = Fake::ready();
        fake.fail = Some(fail);
        assert_eq!(
            complete_delivery(&mut Tx { fake: &fake }, &claim)
                .await
                .unwrap_err()
                .to_string(),
            format!("{fail} failed")
        );
        assert_eq!(fake.trace().last(), Some(&fail));
    }
    for fail in ["submission", "release", "failed", "unconfirmed"] {
        let mut fake = Fake::ready();
        fake.fail = Some(fail);
        let result = match fail {
            "submission" => begin_submission(&fake, &claim, 300).await.map(|_| ()),
            "release" => release_preparation(&fake, &claim, 60).await,
            _ => pause_delivery(&fake, &claim, fail == "unconfirmed", 300).await,
        };
        assert_eq!(result.unwrap_err().to_string(), format!("{fail} failed"));
        assert_eq!(fake.trace(), [fail]);
    }
}

#[tokio::test]
async fn legacy_schedule_without_an_attempt_keeps_both_optional_snapshots_absent() {
    let mut fake = Fake::ready();
    fake.attempt = false;
    let (_, claim) = claim(fake).await;
    let claim = claim.unwrap();
    assert!(claim.approved_snapshot.is_none());
    assert!(claim.prepared_content.is_none());
}
