use super::*;
use crate::domain::{Result as BillingResult, UsageSnapshot};
use ai_usage::domain::ports::SYSTEM_USER_ID;
use chrono::{DateTime, Utc};
use std::sync::atomic::{AtomicUsize, Ordering};

struct FakeBilling {
    decision: Option<AllowanceDecision>,
    calls: AtomicUsize,
    fail: bool,
}

impl FakeBilling {
    fn new(decision: Option<AllowanceDecision>) -> Arc<Self> {
        Arc::new(Self {
            decision,
            calls: AtomicUsize::new(0),
            fail: false,
        })
    }
}

impl BillingService for FakeBilling {
    async fn check_allowance(&self, user: &MacroUserIdStr<'_>) -> BillingResult<AllowanceDecision> {
        assert_eq!(user.as_ref(), "macro|user@example.com");
        self.calls.fetch_add(1, Ordering::SeqCst);
        if self.fail {
            return Err(crate::BillingError::Storage(anyhow::anyhow!(
                "private database credentials and diagnostics"
            )));
        }
        Ok(self.decision.expect("billing must not be called"))
    }

    async fn snapshot(&self, _: &MacroUserIdStr<'_>) -> BillingResult<UsageSnapshot> {
        panic!("admission must not call snapshot")
    }
    async fn settle(&self, _: &MacroUserIdStr<'_>) -> BillingResult<()> {
        panic!("admission must not settle")
    }
    async fn update_overage(
        &self,
        _: &MacroUserIdStr<'_>,
        _: bool,
        _: i64,
    ) -> BillingResult<UsageSnapshot> {
        panic!("admission must not change settings")
    }
    async fn update_auto_reload(
        &self,
        _: &MacroUserIdStr<'_>,
        _: bool,
        _: crate::domain::AutoReloadThresholds,
    ) -> BillingResult<UsageSnapshot> {
        panic!("admission must not change settings")
    }
    async fn create_credit_checkout(
        &self,
        _: &MacroUserIdStr<'_>,
        _: i64,
        _: String,
        _: String,
    ) -> BillingResult<String> {
        panic!("admission must not purchase credits")
    }
    async fn apply_credit_purchase(
        &self,
        _: &MacroUserIdStr<'_>,
        _: i64,
        _: &str,
    ) -> BillingResult<()> {
        panic!("admission must not apply credits")
    }
    async fn sync_period(
        &self,
        _: &MacroUserIdStr<'_>,
        _: DateTime<Utc>,
        _: DateTime<Utc>,
        _: Option<crate::domain::period::SubscriptionPeriod>,
    ) -> BillingResult<()> {
        panic!("admission must not sync periods")
    }
    async fn mark_overage_invoice(&self, _: &str, _: bool) -> BillingResult<()> {
        panic!("admission must not handle invoices")
    }
    async fn mark_credit_reload_invoice(&self, _: &str, _: bool) -> BillingResult<()> {
        panic!("admission must not handle invoices")
    }
}

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from("macro|user@example.com").unwrap()
}

#[tokio::test]
async fn disabled_exempt_and_system_work_never_calls_billing() {
    let billing = FakeBilling::new(None);
    for enforcement in [AiUsageEnforcement::Disabled, AiUsageEnforcement::Enabled] {
        let admission: Arc<dyn AiAdmissionService> =
            Arc::new(BillingAdmissionService::new(billing.clone(), enforcement));
        for feature in crate::domain::models::NON_BILLABLE_AI_FEATURES {
            admission.admit(&user(), feature).await.unwrap();
        }
        admission
            .admit(&SYSTEM_USER_ID, AiFeature::Chat)
            .await
            .unwrap();
        if !enforcement.is_enabled() {
            admission.admit(&user(), AiFeature::Chat).await.unwrap();
            admission
                .admit(&user(), AiFeature::AiEditing)
                .await
                .unwrap();
        }
    }
    assert_eq!(billing.calls.load(Ordering::SeqCst), 0);
    DisabledAiAdmissionService
        .admit(&user(), AiFeature::Chat)
        .await
        .unwrap();
}

#[tokio::test]
async fn enabled_admission_preserves_allowance_decisions() {
    for decision in [
        AllowanceDecision::Allow,
        AllowanceDecision::Deny(DenyReason::AllowanceExhausted),
        AllowanceDecision::Deny(DenyReason::OverageLimitReached),
        AllowanceDecision::Deny(DenyReason::OveragePaymentFailed),
    ] {
        let billing = FakeBilling::new(Some(decision));
        let admission = BillingAdmissionService::new(billing.clone(), AiUsageEnforcement::Enabled);
        for feature in [
            AiFeature::Chat,
            AiFeature::AiEditing,
            AiFeature::Automation,
            AiFeature::AgentRepositoryChoice,
        ] {
            let result = admission.admit(&user(), feature).await;
            match decision {
                AllowanceDecision::Allow => assert_eq!(result, Ok(())),
                AllowanceDecision::Deny(reason) => {
                    assert_eq!(result, Err(AiAdmissionError::Denied(reason)));
                    assert!(!result.unwrap_err().is_retryable());
                }
            }
        }
        assert_eq!(billing.calls.load(Ordering::SeqCst), 4);
    }
}

#[tokio::test]
async fn billing_errors_fail_closed_without_exposing_reports() {
    let billing = Arc::new(FakeBilling {
        decision: None,
        calls: AtomicUsize::new(0),
        fail: true,
    });
    let admission = BillingAdmissionService::new(billing.clone(), AiUsageEnforcement::Enabled);
    let error = admission.admit(&user(), AiFeature::Chat).await.unwrap_err();
    assert_eq!(error, AiAdmissionError::Unavailable);
    assert_eq!(error.code(), "ai_billing_unavailable");
    assert!(error.is_retryable());
    assert!(!error.to_string().contains("private"));
    assert_eq!(format!("{error:?}"), "Unavailable");
    assert_eq!(billing.calls.load(Ordering::SeqCst), 1);
}
