use super::*;
use crate::domain::{
    AllowanceDecision, BillingPeriod, BillingSettings, Entitlement, PlanTier, Result,
    UsageSnapshot, ledger::build_snapshot,
};
use ai_usage::domain::{Result as UsageResult, UsageError};
use ai_usage::{
    AiFeature, AiUsageEnforcement, CompletionUsage, ModelPricing, SYSTEM_USER_ID, UsageApiParams,
    UsageContext,
};
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use tokio::sync::Notify;

#[derive(Clone, Default)]
struct FakeUsageRepo {
    attempts: Arc<AtomicUsize>,
    recorded: Arc<Notify>,
    counted: Arc<AtomicBool>,
    fail_first: bool,
}

impl UsageRepo for FakeUsageRepo {
    async fn insert_usage(&self, _usage: &CompletionUsage, count_usage: bool) -> UsageResult<()> {
        let attempt = self.attempts.fetch_add(1, Ordering::SeqCst);
        if self.fail_first && attempt == 0 {
            return Err(UsageError::Other(anyhow::anyhow!(
                "transient write failure"
            )));
        }
        self.counted.store(count_usage, Ordering::SeqCst);
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
        _verified: Option<crate::domain::period::SubscriptionPeriod>,
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
    settlement: AiUsageBilling,
    user: MacroUserIdStr<'static>,
    tier: PlanTier,
    unlimited: bool,
    chargeable_cents: i64,
    fail_first: bool,
) -> (usize, usize, usize) {
    record_with_policy(
        settlement,
        user,
        tier,
        unlimited,
        chargeable_cents,
        fail_first,
        (AiUsageEnforcement::Enabled, AiFeature::Chat),
    )
    .await
}

async fn record_with_policy(
    settlement: AiUsageBilling,
    user: MacroUserIdStr<'static>,
    tier: PlanTier,
    unlimited: bool,
    chargeable_cents: i64,
    fail_first: bool,
    (enforcement, feature): (AiUsageEnforcement, AiFeature),
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
        Arc::new(UsageServiceImpl::new(repo.clone()).with_enforcement(enforcement)),
        billing.clone(),
        trigger.clone(),
        settlement,
    );
    let should_count = enforcement.should_count(&user, feature);
    recorder.record(UsageContext::new(feature, user).into_event("test-model".into(), 10, 10));
    tokio::time::timeout(Duration::from_secs(2), repo.recorded.notified())
        .await
        .expect("usage must be recorded under either settlement policy, including after a retry");
    // All fake billing/trigger calls are immediately ready; let the recording task finish.
    tokio::task::yield_now().await;
    assert_eq!(repo.counted.load(Ordering::SeqCst), should_count);
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
async fn records_everywhere_but_only_requests_settlement_when_enabled() {
    for (settlement, expected) in [(AiUsageBilling::Enabled, 1), (AiUsageBilling::Disabled, 0)] {
        for fail_first in [false, true] {
            let (attempts, snapshots, requests) = record(
                settlement,
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
async fn uncounted_usage_never_reads_billing_or_requests_settlement() {
    for policy in [
        (AiUsageEnforcement::Disabled, AiFeature::Chat),
        (AiUsageEnforcement::Enabled, AiFeature::Memory),
        (AiUsageEnforcement::Enabled, AiFeature::AiProjection),
        (AiUsageEnforcement::Enabled, AiFeature::CallSummary),
        (AiUsageEnforcement::Enabled, AiFeature::Dictation),
    ] {
        for fail_first in [false, true] {
            assert_eq!(
                record_with_policy(
                    AiUsageBilling::Enabled,
                    user(),
                    PlanTier::Premium,
                    false,
                    1_000,
                    fail_first,
                    policy
                )
                .await,
                (if fail_first { 2 } else { 1 }, 0, 0)
            );
        }
    }
}

#[tokio::test]
async fn system_usage_never_requests_settlement() {
    assert_eq!(
        record(
            AiUsageBilling::Enabled,
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
async fn enabled_settlement_skips_free_unlimited_or_covered_usage() {
    for (tier, unlimited, chargeable) in [
        (PlanTier::Free, false, 1_000),
        (PlanTier::Premium, true, 1_000),
        (PlanTier::Premium, false, 0),
    ] {
        assert_eq!(
            record(
                AiUsageBilling::Enabled,
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
