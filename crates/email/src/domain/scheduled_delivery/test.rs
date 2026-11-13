use super::*;
use std::sync::Mutex;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Call {
    Deletion,
    Claim,
    Prepare,
    Begin,
    Submit,
    Reconcile,
    Complete,
    Release,
    AbsentLookup,
    ReleaseForResend,
    Pause(DeliveryPause),
}

#[derive(Default, Clone, Copy)]
enum PrepareResult {
    #[default]
    Ready,
    Retry,
    Failed,
}

#[derive(Default, Clone, Copy)]
enum SubmitResult {
    #[default]
    Sent,
    Rejected,
    Uncertain,
}

#[derive(Default, Clone, Copy)]
enum ReconcileResult {
    #[default]
    Found,
    Missing,
    Error,
    Unsearchable,
}

struct Fake {
    calls: Mutex<Vec<Call>>,
    mode: Option<DeliveryMode>,
    prepare_result: PrepareResult,
    submit_result: SubmitResult,
    reconcile_result: ReconcileResult,
    lookups: LookupHistory,
    resend_result: bool,
    begin_result: bool,
    complete_error: bool,
}

impl Default for Fake {
    fn default() -> Self {
        Self {
            calls: Mutex::new(vec![]),
            mode: Some(DeliveryMode::Send),
            prepare_result: PrepareResult::Ready,
            submit_result: SubmitResult::Sent,
            reconcile_result: ReconcileResult::Found,
            lookups: LookupHistory::default(),
            resend_result: true,
            begin_result: true,
            complete_error: false,
        }
    }
}

impl Fake {
    fn record(&self, call: Call) {
        self.calls.lock().unwrap().push(call);
    }
}

impl ScheduledDeliveryRepo for Fake {
    type Claim = ();
    type Sent = ();

    async fn reconcile_deletion(&self, _: Uuid, _: Uuid) -> anyhow::Result<()> {
        self.record(Call::Deletion);
        Ok(())
    }

    async fn try_claim(&self, _: Uuid, _: Uuid) -> anyhow::Result<Option<ClaimedDelivery<()>>> {
        self.record(Call::Claim);
        // Once released for a resend, the delivery is claimed for sending.
        let released = self.calls.lock().unwrap().contains(&Call::ReleaseForResend);
        let mode = if released {
            Some(DeliveryMode::Send)
        } else {
            self.mode
        };
        Ok(mode.map(|mode| ClaimedDelivery {
            claim: (),
            mode,
            lookups: self.lookups,
        }))
    }
    async fn record_absent_lookup(&self, _: &()) -> anyhow::Result<()> {
        self.record(Call::AbsentLookup);
        Ok(())
    }
    async fn release_for_resend(&self, _: &()) -> anyhow::Result<bool> {
        self.record(Call::ReleaseForResend);
        Ok(self.resend_result)
    }
    async fn begin_send(&self, _: &()) -> anyhow::Result<bool> {
        self.record(Call::Begin);
        Ok(self.begin_result)
    }
    async fn complete(&self, _: &(), _: ()) -> anyhow::Result<()> {
        self.record(Call::Complete);
        anyhow::ensure!(!self.complete_error, "database completion failed");
        Ok(())
    }
    async fn release(&self, _: &()) -> anyhow::Result<()> {
        self.record(Call::Release);
        Ok(())
    }
    async fn pause(&self, _: &(), reason: DeliveryPause) -> anyhow::Result<()> {
        self.record(Call::Pause(reason));
        Ok(())
    }
}

impl ScheduledMessageSender<(), ()> for Fake {
    type Prepared = ();

    async fn prepare(&self, _: &()) -> Result<(), PreparationError> {
        self.record(Call::Prepare);
        match self.prepare_result {
            PrepareResult::Ready => Ok(()),
            PrepareResult::Retry => Err(PreparationError::Retry(anyhow::anyhow!("quota refused"))),
            PrepareResult::Failed => Err(PreparationError::Failed(anyhow::anyhow!(
                "attachment missing"
            ))),
        }
    }
    async fn send_prepared(&self, _: &(), _: ()) -> Result<(), SubmissionError> {
        self.record(Call::Submit);
        match self.submit_result {
            SubmitResult::Sent => Ok(()),
            SubmitResult::Rejected => Err(SubmissionError::Rejected(anyhow::anyhow!(
                "recipient rejected"
            ))),
            SubmitResult::Uncertain => {
                Err(SubmissionError::Uncertain(anyhow::anyhow!("response lost")))
            }
        }
    }
    async fn reconcile(&self, _: &()) -> anyhow::Result<SentLookup<()>> {
        self.record(Call::Reconcile);
        match self.reconcile_result {
            ReconcileResult::Found => Ok(SentLookup::Found(())),
            ReconcileResult::Missing => Ok(SentLookup::Absent),
            ReconcileResult::Unsearchable => Ok(SentLookup::Unsearchable),
            ReconcileResult::Error => anyhow::bail!("provider search unavailable"),
        }
    }
}

#[tokio::test]
async fn claim_loser_cannot_prepare_submit_or_release_another_worker() {
    let fake = Fake {
        mode: None,
        ..Default::default()
    };
    deliver_scheduled(&fake, &fake, Uuid::nil(), Uuid::nil())
        .await
        .unwrap();
    assert_eq!(*fake.calls.lock().unwrap(), [Call::Deletion, Call::Claim]);
}

#[tokio::test]
async fn successful_send_records_submission_after_preparation_before_provider() {
    let fake = Fake::default();
    deliver_scheduled(&fake, &fake, Uuid::nil(), Uuid::nil())
        .await
        .unwrap();
    assert_eq!(
        *fake.calls.lock().unwrap(),
        [
            Call::Deletion,
            Call::Claim,
            Call::Prepare,
            Call::Begin,
            Call::Submit,
            Call::Complete
        ]
    );
}

#[tokio::test]
async fn transient_preparation_failure_releases_without_crossing_provider_boundary() {
    let fake = Fake {
        prepare_result: PrepareResult::Retry,
        ..Default::default()
    };
    assert!(
        deliver_scheduled(&fake, &fake, Uuid::nil(), Uuid::nil())
            .await
            .is_err()
    );
    assert_eq!(
        *fake.calls.lock().unwrap(),
        [Call::Deletion, Call::Claim, Call::Prepare, Call::Release]
    );
}

#[tokio::test]
async fn invalid_attachments_pause_for_review_without_submitting() {
    let fake = Fake {
        prepare_result: PrepareResult::Failed,
        ..Default::default()
    };
    deliver_scheduled(&fake, &fake, Uuid::nil(), Uuid::nil())
        .await
        .unwrap();
    assert_eq!(
        *fake.calls.lock().unwrap(),
        [
            Call::Deletion,
            Call::Claim,
            Call::Prepare,
            Call::Pause(DeliveryPause::Failed)
        ]
    );
}

#[tokio::test]
async fn worker_that_lost_its_lease_during_preparation_never_submits() {
    let fake = Fake {
        begin_result: false,
        ..Default::default()
    };
    deliver_scheduled(&fake, &fake, Uuid::nil(), Uuid::nil())
        .await
        .unwrap();
    assert_eq!(
        *fake.calls.lock().unwrap(),
        [Call::Deletion, Call::Claim, Call::Prepare, Call::Begin]
    );
}

#[tokio::test]
async fn provider_rejection_and_ambiguity_pause_without_granting_another_send() {
    for (submit_result, pause) in [
        (SubmitResult::Rejected, DeliveryPause::Failed),
        (SubmitResult::Uncertain, DeliveryPause::Unconfirmed),
    ] {
        let fake = Fake {
            submit_result,
            ..Default::default()
        };
        deliver_scheduled(&fake, &fake, Uuid::nil(), Uuid::nil())
            .await
            .unwrap();
        assert_eq!(
            *fake.calls.lock().unwrap(),
            [
                Call::Deletion,
                Call::Claim,
                Call::Prepare,
                Call::Begin,
                Call::Submit,
                Call::Pause(pause)
            ]
        );
    }
}

#[tokio::test]
async fn failed_completion_does_not_release_a_successful_provider_submission() {
    let fake = Fake {
        complete_error: true,
        ..Default::default()
    };
    assert!(
        deliver_scheduled(&fake, &fake, Uuid::nil(), Uuid::nil())
            .await
            .is_err()
    );
    assert_eq!(
        *fake.calls.lock().unwrap(),
        [
            Call::Deletion,
            Call::Claim,
            Call::Prepare,
            Call::Begin,
            Call::Submit,
            Call::Complete
        ]
    );
}

#[tokio::test]
async fn reconciliation_records_delivery_or_keeps_the_outcome_unconfirmed() {
    for (reconcile_result, last_call, should_error) in [
        (ReconcileResult::Found, Call::Complete, false),
        (ReconcileResult::Missing, Call::AbsentLookup, false),
        (
            ReconcileResult::Unsearchable,
            Call::Pause(DeliveryPause::Unconfirmed),
            false,
        ),
        (
            ReconcileResult::Error,
            Call::Pause(DeliveryPause::Unconfirmed),
            true,
        ),
    ] {
        let fake = Fake {
            mode: Some(DeliveryMode::Reconcile),
            reconcile_result,
            ..Default::default()
        };
        let result = deliver_scheduled(&fake, &fake, Uuid::nil(), Uuid::nil()).await;
        assert_eq!(result.is_err(), should_error);
        assert_eq!(
            *fake.calls.lock().unwrap(),
            [Call::Deletion, Call::Claim, Call::Reconcile, last_call]
        );
    }
}

#[tokio::test]
async fn a_send_gmail_never_received_is_sent_again_once_lookups_confirm_it() {
    let fake = Fake {
        mode: Some(DeliveryMode::Reconcile),
        reconcile_result: ReconcileResult::Missing,
        lookups: LookupHistory {
            absent_lookups: ABSENT_LOOKUPS_BEFORE_RESEND - 1,
            resends: 0,
        },
        ..Default::default()
    };
    deliver_scheduled(&fake, &fake, Uuid::nil(), Uuid::nil())
        .await
        .unwrap();
    assert_eq!(
        *fake.calls.lock().unwrap(),
        [
            Call::Deletion,
            Call::Claim,
            Call::Reconcile,
            Call::ReleaseForResend,
            Call::Claim,
            Call::Prepare,
            Call::Begin,
            Call::Submit,
            Call::Complete
        ]
    );
}

#[tokio::test]
async fn a_send_gmail_may_have_received_is_never_sent_again() {
    for reconcile_result in [
        ReconcileResult::Found,
        ReconcileResult::Unsearchable,
        ReconcileResult::Error,
    ] {
        let fake = Fake {
            mode: Some(DeliveryMode::Reconcile),
            reconcile_result,
            lookups: LookupHistory {
                absent_lookups: ABSENT_LOOKUPS_BEFORE_RESEND,
                resends: 0,
            },
            ..Default::default()
        };
        let _ = deliver_scheduled(&fake, &fake, Uuid::nil(), Uuid::nil()).await;
        let calls = fake.calls.lock().unwrap();
        assert!(!calls.contains(&Call::ReleaseForResend), "{calls:?}");
        assert!(!calls.contains(&Call::Submit), "{calls:?}");
    }
}

#[tokio::test]
async fn one_lookup_that_finds_nothing_waits_for_the_next() {
    let fake = Fake {
        mode: Some(DeliveryMode::Reconcile),
        reconcile_result: ReconcileResult::Missing,
        ..Default::default()
    };
    deliver_scheduled(&fake, &fake, Uuid::nil(), Uuid::nil())
        .await
        .unwrap();
    assert_eq!(
        *fake.calls.lock().unwrap(),
        [
            Call::Deletion,
            Call::Claim,
            Call::Reconcile,
            Call::AbsentLookup
        ]
    );
}

#[tokio::test]
async fn a_message_already_sent_again_is_not_sent_a_third_time() {
    let fake = Fake {
        mode: Some(DeliveryMode::Reconcile),
        reconcile_result: ReconcileResult::Missing,
        lookups: LookupHistory {
            absent_lookups: ABSENT_LOOKUPS_BEFORE_RESEND,
            resends: MAX_AUTOMATIC_RESENDS,
        },
        ..Default::default()
    };
    deliver_scheduled(&fake, &fake, Uuid::nil(), Uuid::nil())
        .await
        .unwrap();
    assert_eq!(
        *fake.calls.lock().unwrap(),
        [
            Call::Deletion,
            Call::Claim,
            Call::Reconcile,
            Call::AbsentLookup
        ]
    );
}

#[tokio::test]
async fn a_worker_that_lost_its_claim_during_the_lookup_never_sends_again() {
    let fake = Fake {
        mode: Some(DeliveryMode::Reconcile),
        reconcile_result: ReconcileResult::Missing,
        lookups: LookupHistory {
            absent_lookups: ABSENT_LOOKUPS_BEFORE_RESEND - 1,
            resends: 0,
        },
        resend_result: false,
        ..Default::default()
    };
    deliver_scheduled(&fake, &fake, Uuid::nil(), Uuid::nil())
        .await
        .unwrap();
    assert_eq!(
        *fake.calls.lock().unwrap(),
        [
            Call::Deletion,
            Call::Claim,
            Call::Reconcile,
            Call::ReleaseForResend
        ]
    );
}
