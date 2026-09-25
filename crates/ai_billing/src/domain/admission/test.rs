use super::*;
use crate::domain::UsageSnapshot;
use chrono::{DateTime, Utc};
use macro_user_id::cowlike::CowLike;
use std::sync::{Arc, Mutex};

#[derive(Clone)]
struct FakeBilling {
    decision: AllowanceDecision,
    unavailable: bool,
    calls: Arc<Mutex<Vec<MacroUserIdStr<'static>>>>,
}

impl FakeBilling {
    fn new(decision: AllowanceDecision) -> Self {
        Self {
            decision,
            unavailable: false,
            calls: Default::default(),
        }
    }
}

impl BillingService for FakeBilling {
    async fn check_allowance(
        &self,
        user: &MacroUserIdStr<'_>,
    ) -> crate::domain::Result<AllowanceDecision> {
        self.calls.lock().unwrap().push(user.clone().into_owned());
        if self.unavailable {
            return Err(crate::domain::BillingError::Entitlement(anyhow::anyhow!(
                "private entitlement lookup details"
            )));
        }
        Ok(self.decision)
    }

    async fn snapshot(&self, _: &MacroUserIdStr<'_>) -> crate::domain::Result<UsageSnapshot> {
        panic!("admission must only call check_allowance")
    }

    async fn settle(&self, _: &MacroUserIdStr<'_>) -> crate::domain::Result<()> {
        panic!("admission must not settle")
    }

    async fn update_overage(
        &self,
        _: &MacroUserIdStr<'_>,
        _: bool,
        _: i64,
    ) -> crate::domain::Result<UsageSnapshot> {
        panic!("admission must not update overage")
    }

    async fn create_credit_checkout(
        &self,
        _: &MacroUserIdStr<'_>,
        _: i64,
        _: String,
        _: String,
    ) -> crate::domain::Result<String> {
        panic!("admission must not create a checkout")
    }

    async fn apply_credit_purchase(
        &self,
        _: &MacroUserIdStr<'_>,
        _: i64,
        _: &str,
    ) -> crate::domain::Result<()> {
        panic!("admission must not purchase credits")
    }

    async fn sync_period(
        &self,
        _: &MacroUserIdStr<'_>,
        _: DateTime<Utc>,
        _: DateTime<Utc>,
    ) -> crate::domain::Result<()> {
        panic!("admission must not sync a period")
    }

    async fn mark_overage_invoice(&self, _: &str, _: bool) -> crate::domain::Result<()> {
        panic!("admission must not update an invoice")
    }
}

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from("macro|actor@macro.com".to_string()).unwrap()
}

#[tokio::test]
async fn delegates_once_with_the_trusted_actor_and_preserves_every_decision() {
    for decision in [
        AllowanceDecision::Allow,
        AllowanceDecision::Deny(DenyReason::AllowanceExhausted),
        AllowanceDecision::Deny(DenyReason::OverageLimitReached),
        AllowanceDecision::Deny(DenyReason::OveragePaymentFailed),
    ] {
        let billing = FakeBilling::new(decision);
        let admission: Arc<dyn AiAdmissionService> =
            Arc::new(BillingAdmissionService::new(billing.clone()));
        let result = admission.admit(&user(), AiFeature::Chat).await;
        match decision {
            AllowanceDecision::Allow => result.unwrap(),
            AllowanceDecision::Deny(expected) => {
                assert!(
                    matches!(result, Err(AiAdmissionError::Denied(reason)) if reason == expected)
                );
            }
        }
        // An ordinary staff-domain address is not an exemption.
        assert_eq!(*billing.calls.lock().unwrap(), vec![user()]);
    }
}

#[tokio::test]
async fn lookup_failure_is_unavailable_with_private_diagnostics() {
    let mut billing = FakeBilling::new(AllowanceDecision::Allow);
    billing.unavailable = true;
    let admission = BillingAdmissionService::new(billing.clone());
    let error = admission.admit(&user(), AiFeature::Chat).await.unwrap_err();
    assert!(matches!(error, AiAdmissionError::Unavailable(_)));
    assert_eq!(
        error.to_string(),
        "AI billing is unavailable. Please try again."
    );
    assert!(format!("{error:?}").contains("private entitlement lookup details"));
    assert_eq!(*billing.calls.lock().unwrap(), vec![user()]);
}

#[tokio::test]
async fn exempt_features_skip_billing_even_when_unavailable() {
    let mut billing = FakeBilling::new(AllowanceDecision::Deny(DenyReason::AllowanceExhausted));
    billing.unavailable = true;
    let admission = BillingAdmissionService::new(billing.clone());
    assert_eq!(
        QUOTA_EXEMPT_FEATURES,
        [
            AiFeature::AiProjection,
            AiFeature::AiEditing,
            AiFeature::Dictation
        ]
    );
    for feature in QUOTA_EXEMPT_FEATURES {
        assert!(is_quota_exempt(feature));
        admission.admit(&user(), feature).await.unwrap();
    }
    assert!(billing.calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn every_billable_feature_requires_allowance() {
    let billing = FakeBilling::new(AllowanceDecision::Deny(DenyReason::AllowanceExhausted));
    let admission = BillingAdmissionService::new(billing.clone());
    for feature in [
        AiFeature::Chat,
        AiFeature::Memory,
        AiFeature::Automation,
        AiFeature::DynamicCompletionsApi,
        AiFeature::ChatRename,
        AiFeature::CallSummary,
        AiFeature::ChannelBot,
        AiFeature::Import,
        AiFeature::AgentSession,
        AiFeature::AgentRepositoryChoice,
    ] {
        assert!(!is_quota_exempt(feature));
        assert!(matches!(
            admission.admit(&user(), feature).await,
            Err(AiAdmissionError::Denied(DenyReason::AllowanceExhausted))
        ));
    }
    assert_eq!(billing.calls.lock().unwrap().len(), 10);
}

#[tokio::test]
async fn only_the_reserved_system_identity_skips_billing() {
    let mut billing = FakeBilling::new(AllowanceDecision::Allow);
    billing.unavailable = true;
    let admission = BillingAdmissionService::new(billing.clone());
    admission
        .admit(&SYSTEM_USER_ID, AiFeature::Chat)
        .await
        .unwrap();
    assert!(billing.calls.lock().unwrap().is_empty());
    let other = MacroUserIdStr::try_from("macro|ai-system@example.com".to_string()).unwrap();
    assert!(matches!(
        admission.admit(&other, AiFeature::Chat).await,
        Err(AiAdmissionError::Unavailable(_))
    ));
    assert_eq!(*billing.calls.lock().unwrap(), vec![other]);
}

#[test]
fn public_codes_cover_every_admission_failure() {
    for (reason, code) in [
        (DenyReason::AllowanceExhausted, "ai_allowance_exhausted"),
        (DenyReason::OverageLimitReached, "ai_overage_limit_reached"),
        (
            DenyReason::OveragePaymentFailed,
            "ai_overage_payment_failed",
        ),
    ] {
        assert_eq!(AiAdmissionError::Denied(reason).code(), code);
    }
    assert_eq!(
        AiAdmissionError::Unavailable(rootcause::report!("private failure")).code(),
        "ai_billing_unavailable"
    );
}

#[tokio::test]
async fn unconfigured_service_always_fails_closed() {
    let admission: Arc<dyn AiAdmissionService> = Arc::new(UnconfiguredAiAdmissionService);
    for actor in [user(), SYSTEM_USER_ID.clone()] {
        for feature in [AiFeature::Chat, AiFeature::AiEditing] {
            assert!(matches!(
                admission.admit(&actor, feature).await,
                Err(AiAdmissionError::Unavailable(_))
            ));
        }
    }
}
