use super::*;
use crate::domain::{
    AllowanceDecision, BillingPeriod, BillingSettings, Entitlement, PlanTier, Result,
    UsageSnapshot, ledger::build_snapshot,
};
use ai_usage::domain::{Result as UsageResult, UsageError};
use ai_usage::{AiFeature, CompletionUsage, ModelPricing, UsageApiParams, UsageContext};
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use std::sync::atomic::{AtomicUsize, Ordering};
use tokio::sync::Notify;

#[derive(Clone, Default)]
struct FakeUsageRepo {
    attempts: Arc<AtomicUsize>,
    recorded: Arc<Notify>,
    fail_first: bool,
}

impl UsageRepo for FakeUsageRepo {
    async fn insert_usage(&self, _usage: &CompletionUsage) -> UsageResult<()> {
        let attempt = self.attempts.fetch_add(1, Ordering::SeqCst);
        if self.fail_first && attempt == 0 {
            return Err(UsageError::Other(anyhow::anyhow!(
                "transient write failure"
            )));
        }
        self.recorded.notify_one();
        Ok(())
    }

    async fn get_pricing(&self, _model: &str) -> UsageResult<Option<ModelPricing>> {
        Ok(None)
    }

    async fn set_pricing(&self, _model: &str, _pricing: ModelPricing) -> UsageResult<()> {
        unreachable!()
    }

    async fn query_usage(&self, _params: &UsageApiParams) -> UsageResult<Vec<CompletionUsage>> {
        unreachable!()
    }
}

struct FakeBilling {
    snapshots: AtomicUsize,
    snapshot: UsageSnapshot,
}

impl BillingService for FakeBilling {
    async fn snapshot(&self, _user: &MacroUserIdStr<'_>) -> Result<UsageSnapshot> {
        self.snapshots.fetch_add(1, Ordering::SeqCst);
        Ok(self.snapshot.clone())
    }

    async fn check_allowance(&self, _user: &MacroUserIdStr<'_>) -> Result<AllowanceDecision> {
        unreachable!()
    }

    async fn settle(&self, _user: &MacroUserIdStr<'_>) -> Result<()> {
        unreachable!("the recorder must use the settlement trigger")
    }

    async fn update_overage(
        &self,
        _user: &MacroUserIdStr<'_>,
        _enabled: bool,
        _limit_cents: i64,
    ) -> Result<UsageSnapshot> {
        unreachable!()
    }

    async fn create_credit_checkout(
        &self,
        _user: &MacroUserIdStr<'_>,
        _amount_cents: i64,
        _success_url: String,
        _cancel_url: String,
    ) -> Result<String> {
        unreachable!()
    }

    async fn apply_credit_purchase(
        &self,
        _payer: &MacroUserIdStr<'_>,
        _amount_cents: i64,
        _stripe_reference: &str,
    ) -> Result<()> {
        unreachable!()
    }

    async fn sync_period(
        &self,
        _payer: &MacroUserIdStr<'_>,
        _start: DateTime<Utc>,
        _end: DateTime<Utc>,
    ) -> Result<()> {
        unreachable!()
    }

    async fn mark_overage_invoice(&self, _stripe_invoice_id: &str, _paid: bool) -> Result<()> {
        unreachable!()
    }
}

#[derive(Clone, Default)]
struct FakeTrigger(Arc<AtomicUsize>);

impl SettlementTrigger for FakeTrigger {
    fn request_settlement(&self, _payer: MacroUserIdStr<'static>) {
        self.0.fetch_add(1, Ordering::SeqCst);
    }
}

async fn record(
    environment: Environment,
    user: MacroUserIdStr<'static>,
    tier: PlanTier,
    unlimited: bool,
    chargeable_cents: i64,
    fail_first: bool,
) -> (usize, usize, usize) {
    let repo = FakeUsageRepo {
        fail_first,
        ..Default::default()
    };
    let mut entitlement = Entitlement::personal(user.clone(), tier);
    entitlement.unlimited = unlimited;
    let billing = Arc::new(FakeBilling {
        snapshots: AtomicUsize::new(0),
        snapshot: build_snapshot(
            &user,
            &entitlement,
            &BillingSettings::default(),
            BillingPeriod::current(None, Utc::now()),
            5_000,
            chargeable_cents,
            Default::default(),
            0,
        ),
    });
    let trigger = FakeTrigger::default();
    let recorder = SettlingUsageRecorder::new(
        Arc::new(UsageServiceImpl::new(repo.clone())),
        billing.clone(),
        trigger.clone(),
        environment,
    );
    recorder.record(UsageContext::new(AiFeature::Chat, user).into_event(
        "test-model".into(),
        10,
        10,
    ));
    tokio::time::timeout(Duration::from_secs(2), repo.recorded.notified())
        .await
        .expect("usage must be recorded in every environment, including after a retry");
    // All fake billing/trigger calls are immediately ready; let the recording task finish.
    tokio::task::yield_now().await;
    (
        repo.attempts.load(Ordering::SeqCst),
        billing.snapshots.load(Ordering::SeqCst),
        trigger.0.load(Ordering::SeqCst),
    )
}

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from("macro|payer@example.com".to_string()).unwrap()
}

#[tokio::test]
async fn records_everywhere_but_only_requests_settlement_in_dev() {
    for (environment, expected) in [
        (Environment::Develop, 1),
        (Environment::Production, 0),
        (Environment::Local, 0),
    ] {
        for fail_first in [false, true] {
            let (attempts, snapshots, requests) = record(
                environment,
                user(),
                PlanTier::Premium,
                false,
                1_000,
                fail_first,
            )
            .await;
            assert_eq!(attempts, if fail_first { 2 } else { 1 });
            assert_eq!(snapshots, expected);
            assert_eq!(requests, expected);
        }
    }
}

#[tokio::test]
async fn system_usage_never_requests_settlement() {
    assert_eq!(
        record(
            Environment::Develop,
            SYSTEM_USER_ID.clone(),
            PlanTier::Premium,
            false,
            1_000,
            false,
        )
        .await,
        (1, 0, 0)
    );
}

#[tokio::test]
async fn dev_does_not_settle_free_unlimited_or_covered_usage() {
    for (tier, unlimited, chargeable) in [
        (PlanTier::Free, false, 1_000),
        (PlanTier::Premium, true, 1_000),
        (PlanTier::Premium, false, 0),
    ] {
        assert_eq!(
            record(
                Environment::Develop,
                user(),
                tier,
                unlimited,
                chargeable,
                false,
            )
            .await,
            (1, 1, 0)
        );
    }
}
