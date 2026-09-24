//! Cross-surface tests use real billing arithmetic and PostgreSQL usage/ledger
//! adapters, plus production entitlement/composition wiring. No provider or Stripe
//! is used; fixed entitlements isolate the ledger edge-case matrix.
use super::*;
use ai_billing::domain::{
    AllowanceDecision, BillingAdmissionService, BillingRepo, BillingService, BillingServiceImpl,
    Entitlement, EntitlementSource, PayerScope, PlanTier, QUOTA_EXEMPT_FEATURES, UsageSnapshot,
};
use ai_billing::outbound::{NoOpPaymentGateway, PgBillingRepo, PgUsageReader};
use ai_usage::outbound::PgUsageRepo;
use ai_usage::{CompletionUsage, ModelPricing, Price, Usage, UsageAmount, UsageRepo};
use chrono::{Duration, Utc};

#[derive(Clone)]
struct FixedEntitlement(Entitlement);

impl EntitlementSource for FixedEntitlement {
    async fn entitlement(
        &self,
        user: &MacroUserIdStr<'_>,
    ) -> ai_billing::domain::Result<Entitlement> {
        assert!(self.0.billed_users.iter().any(|seat| seat == user));
        Ok(self.0.clone())
    }

    async fn stripe_customer_id(
        &self,
        _: &MacroUserIdStr<'_>,
    ) -> ai_billing::domain::Result<Option<String>> {
        panic!("admission and credit-only recovery must not contact Stripe")
    }
}

type TestBilling =
    BillingServiceImpl<FixedEntitlement, PgUsageReader, PgBillingRepo, NoOpPaymentGateway>;

pub(crate) struct BillingFixture {
    pub pool: sqlx::PgPool,
    billing: TestBilling,
    pub admission: Arc<dyn AiAdmissionService>,
    pub user: MacroUserIdStr<'static>,
    repo: PgBillingRepo,
}

impl BillingFixture {
    pub async fn personal(pool: sqlx::PgPool, tier: PlanTier) -> Self {
        Self::new(pool, Entitlement::personal(actor(), tier)).await
    }

    async fn new(pool: sqlx::PgPool, entitlement: Entitlement) -> Self {
        let repo = PgBillingRepo::new(pool.clone());
        // Stable window away from calendar boundaries; each sqlx test owns its DB.
        repo.set_period(
            &entitlement.payer,
            Utc::now() - Duration::days(1),
            Utc::now() + Duration::days(29),
        )
        .await
        .unwrap();
        let billing = BillingServiceImpl::new(
            FixedEntitlement(entitlement),
            PgUsageReader::new(pool.clone()),
            repo.clone(),
            NoOpPaymentGateway,
        );
        Self {
            pool,
            admission: Arc::new(BillingAdmissionService::new(billing.clone())),
            billing,
            user: actor(),
            repo,
        }
    }

    pub async fn record(&self, user: &MacroUserIdStr<'static>, feature: AiFeature, cost: f32) {
        PgUsageRepo::new(self.pool.clone())
            .insert_usage(&CompletionUsage {
                feature,
                user: user.clone(),
                entity: None,
                cost: Usage {
                    amount: UsageAmount::Tokens {
                        input: 1_000_000,
                        output: 0,
                    },
                    model: "quota-regression-model".to_string(),
                    price: Some(Price {
                        pricing: ModelPricing::Tokens {
                            input: cost,
                            output: 0.0,
                        },
                        total: cost,
                    }),
                    created_at: Utc::now(),
                },
            })
            .await
            .unwrap();
    }

    async fn assert_position(&self, reason: Option<DenyReason>) -> UsageSnapshot {
        let snapshot = self.billing.snapshot(&self.user).await.unwrap();
        assert_eq!(snapshot.blocked_reason, reason);
        let expected = reason.map_or(AllowanceDecision::Allow, AllowanceDecision::Deny);
        assert_eq!(
            self.billing.check_allowance(&self.user).await.unwrap(),
            expected
        );
        for feature in [
            AiFeature::Chat,
            AiFeature::DynamicCompletionsApi,
            AiFeature::AgentSession,
        ] {
            let result = self.admission.admit(&self.user, feature).await;
            match reason {
                Some(expected) => assert!(
                    matches!(result, Err(AiAdmissionError::Denied(actual)) if actual == expected)
                ),
                None => result.unwrap(),
            }
        }
        snapshot
    }

    pub async fn assert_rejected(&self, status: StatusCode, code: &str) {
        // Keep billing live but make downstream chat/message persistence impossible.
        // Extract authentication first, then close only the request's pool.
        let request_pool = sqlx::PgPool::connect_with((*self.pool.connect_options()).clone())
            .await
            .unwrap();
        let mut ctx = (*crate::api::context::test_api_context(request_pool.clone()).await).clone();
        ctx.tool_service_context.admission = self.admission.clone();
        ctx.stream_repo = Arc::new(NoStreams);
        ctx.tool_service_context.recorder = Arc::new(NoUsage);
        let (chat_access, chat_user) = internal_extractors(&ctx).await;
        let (structured_access, structured_user) = internal_extractors(&ctx).await;
        request_pool.close().await;

        let request = serde_json::from_value(serde_json::json!({
            "content": "quota regression",
            "model": chat::domain::models::FREE_MODEL,
        }))
        .unwrap();
        let error = send_chat_message(
            State(ctx.clone()),
            chat_access,
            chat_user,
            Extension(BearerToken(String::new())),
            Json(request),
        )
        .await
        .unwrap_err();
        assert_eq!(error.status, Some(status));
        assert_eq!(error.code.as_deref(), Some(code));
        // A billing rejection returns before the provider path, not a provider
        // error after execution. NoStreams/NoUsage also fail on downstream work.
        assert!(error.stream_id.is_some());
        let request = serde_json::from_value(serde_json::json!({
            "prompt": "quota regression",
            "model": chat::domain::models::FREE_MODEL,
            "output_schema": {"name": "Answer", "schema": {"type": "object", "properties": {}}},
        }))
        .unwrap();
        let error = crate::api::structured_completion::structured_completion(
            State(ctx),
            structured_access,
            structured_user,
            Json(request),
        )
        .await
        .unwrap_err();
        assert_eq!(error.status, status);
        assert_eq!(error.code.as_deref(), Some(code));
        let response = error.into_response();
        assert_eq!(response.status(), status);
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(body["code"], code);
        assert!(!body["error"].as_str().unwrap().contains("pool"));
    }
}

struct NoUsage;

impl ai_usage::UsageRecorder for NoUsage {
    fn record(&self, _: ai_usage::UsageEvent) {
        panic!("rejected requests must not invoke a provider or record a completion")
    }
}

fn actor() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(ACTING_USER.to_string()).unwrap()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn premium_and_max_exact_exhaustion_and_credit_recovery(pool: sqlx::PgPool) {
    for tier in [PlanTier::Premium, PlanTier::Max] {
        let fixture = BillingFixture::personal(pool.clone(), tier).await;
        assert!(fixture.assert_position(None).await.remaining_cents > 0);
        // Add only the difference when upgrading the same disposable account.
        let provider_cost = if tier == PlanTier::Premium {
            16.0
        } else {
            64.0
        };
        fixture
            .record(&fixture.user, AiFeature::Chat, provider_cost)
            .await;
        let snapshot = fixture
            .assert_position(Some(DenyReason::AllowanceExhausted))
            .await;
        assert_eq!(snapshot.used_cents, tier.included_ai_cents_per_seat());
        assert_eq!(snapshot.remaining_cents, 0);
        fixture
            .assert_rejected(
                StatusCode::PAYMENT_REQUIRED,
                DenyReason::AllowanceExhausted.code(),
            )
            .await;
    }
    let fixture = BillingFixture::personal(pool, PlanTier::Max).await;
    fixture.record(&fixture.user, AiFeature::Chat, 4.0).await;
    fixture
        .assert_position(Some(DenyReason::AllowanceExhausted))
        .await;
    // Billing recovery is not itself quota gated. The first purchase exactly
    // covers unsettled usage; only the second leaves room for another request.
    fixture
        .billing
        .apply_credit_purchase(&fixture.user, 1_000, "cs_exact")
        .await
        .unwrap();
    fixture
        .assert_position(Some(DenyReason::AllowanceExhausted))
        .await;
    fixture
        .billing
        .apply_credit_purchase(&fixture.user, 1_000, "cs_recovery")
        .await
        .unwrap();
    let recovered = fixture.assert_position(None).await;
    assert_eq!(recovered.remaining_cents, 1_000);
    fixture
        .billing
        .apply_credit_purchase(&fixture.user, 1_000, "cs_recovery")
        .await
        .unwrap();
    assert_eq!(fixture.assert_position(None).await.remaining_cents, 1_000);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn production_entitlements_and_factory_agree_with_http_admission(pool: sqlx::PgPool) {
    use roles_and_permissions::domain::model::RoleId;
    use roles_and_permissions::domain::port::UserRolesAndPermissionsRepository;
    use roles_and_permissions::outbound::pgpool::MacroDB;

    let user_id = macro_db_client::user::create_user::create_user(
        &pool,
        &macro_uuid::generate_uuid_v7().to_string(),
        "Quota regression",
        "paid-without-professional@example.com",
        true,
        "cus_quota_regression",
        None,
        Default::default(),
    )
    .await
    .unwrap();
    assert_eq!(user_id, ACTING_USER);
    let ctx = crate::api::context::test_api_context(pool.clone()).await;
    let roles = MacroDB::new(pool.clone());
    let mut fixture = BillingFixture::personal(pool.clone(), PlanTier::Premium).await;
    fixture.admission = ai_billing::composition::ai_admission_service(pool);
    fixture.record(&fixture.user, AiFeature::Chat, 16.0).await;

    assert_eq!(
        ctx.ai_billing.snapshot(&fixture.user).await.unwrap().tier,
        PlanTier::Free
    );
    fixture
        .admission
        .admit(&fixture.user, AiFeature::Chat)
        .await
        .unwrap();
    // Subscription roles deliberately omit the separate professional permission.
    roles
        .add_roles_to_user(&fixture.user, &[RoleId::SubOpus])
        .await
        .unwrap();
    let premium = ctx.ai_billing.snapshot(&fixture.user).await.unwrap();
    assert_eq!(premium.tier, PlanTier::Premium);
    assert_eq!(premium.blocked_reason, Some(DenyReason::AllowanceExhausted));
    fixture
        .assert_rejected(
            StatusCode::PAYMENT_REQUIRED,
            DenyReason::AllowanceExhausted.code(),
        )
        .await;

    roles
        .add_roles_to_user(&fixture.user, &[RoleId::SubMax])
        .await
        .unwrap();
    let upgraded = ctx.ai_billing.snapshot(&fixture.user).await.unwrap();
    assert_eq!(upgraded.tier, PlanTier::Max);
    assert_eq!(upgraded.remaining_cents, 16_000);
    assert_eq!(upgraded.blocked_reason, None);
    fixture
        .admission
        .admit(&fixture.user, AiFeature::Chat)
        .await
        .unwrap();
    fixture
        .record(&fixture.user, AiFeature::AgentSession, 64.0)
        .await;
    assert_eq!(
        ctx.ai_billing
            .snapshot(&fixture.user)
            .await
            .unwrap()
            .blocked_reason,
        Some(DenyReason::AllowanceExhausted)
    );
    fixture
        .assert_rejected(
            StatusCode::PAYMENT_REQUIRED,
            DenyReason::AllowanceExhausted.code(),
        )
        .await;
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn mixed_team_seats_share_credits_not_included_allowance(pool: sqlx::PgPool) {
    let owner = MacroUserIdStr::try_from("macro|quota-team-owner@example.com".to_string()).unwrap();
    let fixture = BillingFixture::new(
        pool,
        Entitlement {
            tier: PlanTier::Premium,
            seat_tiers: vec![PlanTier::Max, PlanTier::Premium],
            unlimited: false,
            payer: owner.clone(),
            billed_users: vec![owner.clone(), actor()],
            scope: PayerScope::TeamMember {
                team_id: macro_uuid::generate_uuid_v7(),
            },
        },
    )
    .await;
    fixture.record(&fixture.user, AiFeature::Chat, 16.0).await;
    // The owner's untouched Max allowance cannot rescue the exhausted member.
    fixture
        .assert_position(Some(DenyReason::AllowanceExhausted))
        .await;
    fixture
        .repo
        .record_credit_purchase(&owner, 1_000, "cs_team")
        .await
        .unwrap();
    let snapshot = fixture.assert_position(None).await;
    assert_eq!(snapshot.payer, owner);
    assert!(!snapshot.can_manage_billing);
    assert_eq!(snapshot.remaining_cents, 1_000);
    fixture.record(&owner, AiFeature::AgentSession, 84.0).await;
    let exhausted = fixture
        .assert_position(Some(DenyReason::AllowanceExhausted))
        .await;
    assert_eq!(exhausted.credit_balance_cents, 1_000);
    assert_eq!(exhausted.uncovered_cents, 1_000);
    fixture
        .assert_rejected(
            StatusCode::PAYMENT_REQUIRED,
            DenyReason::AllowanceExhausted.code(),
        )
        .await;
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn overage_cap_payment_failure_and_recovery_controls(pool: sqlx::PgPool) {
    let fixture = BillingFixture::personal(pool, PlanTier::Premium).await;
    fixture.record(&fixture.user, AiFeature::Chat, 20.0).await;
    fixture
        .repo
        .update_overage(&fixture.user, true, 1_000)
        .await
        .unwrap();
    fixture
        .assert_position(Some(DenyReason::OverageLimitReached))
        .await;
    fixture
        .assert_rejected(
            StatusCode::PAYMENT_REQUIRED,
            DenyReason::OverageLimitReached.code(),
        )
        .await;
    fixture
        .repo
        .update_overage(&fixture.user, true, 2_000)
        .await
        .unwrap();
    assert_eq!(fixture.assert_position(None).await.remaining_cents, 1_000);
    // The repository operation used by failed-payment handling suspends overage.
    fixture.repo.suspend_overage(&fixture.user).await.unwrap();
    fixture
        .assert_position(Some(DenyReason::OveragePaymentFailed))
        .await;
    fixture
        .assert_rejected(
            StatusCode::PAYMENT_REQUIRED,
            DenyReason::OveragePaymentFailed.code(),
        )
        .await;
    fixture
        .billing
        .update_overage(&fixture.user, false, 0)
        .await
        .unwrap();
    fixture
        .billing
        .apply_credit_purchase(&fixture.user, 2_000, "cs_after_failure")
        .await
        .unwrap();
    assert_eq!(fixture.assert_position(None).await.remaining_cents, 1_000);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn period_rollover_and_quota_exempt_features(pool: sqlx::PgPool) {
    let fixture = BillingFixture::personal(pool, PlanTier::Premium).await;
    fixture.record(&fixture.user, AiFeature::Chat, 20.0).await;
    for feature in QUOTA_EXEMPT_FEATURES {
        fixture.record(&fixture.user, feature, 80.0).await;
        fixture
            .admission
            .admit(&fixture.user, feature)
            .await
            .unwrap();
    }
    assert_eq!(
        fixture
            .assert_position(Some(DenyReason::AllowanceExhausted))
            .await
            .used_cents,
        5_000
    );
    fixture
        .assert_rejected(
            StatusCode::PAYMENT_REQUIRED,
            DenyReason::AllowanceExhausted.code(),
        )
        .await;
    // Simulate the subscription webhook advancing the window past old usage.
    fixture
        .billing
        .sync_period(&fixture.user, Utc::now(), Utc::now() + Duration::days(30))
        .await
        .unwrap();
    let snapshot = fixture.assert_position(None).await;
    assert_eq!(snapshot.used_cents, 0);
    assert_eq!(snapshot.remaining_cents, 4_000);
    let recorded = PgUsageRepo::new(fixture.pool.clone())
        .query_usage(&ai_usage::UsageApiParams {
            include_users: vec![fixture.user.clone()],
            ..Default::default()
        })
        .await
        .unwrap();
    assert_eq!(
        recorded.len(),
        4,
        "rollover/exemptions preserve cost telemetry"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn free_and_enterprise_preserve_billing_exemptions(pool: sqlx::PgPool) {
    for unlimited in [false, true] {
        let tier = if unlimited {
            PlanTier::Premium
        } else {
            PlanTier::Free
        };
        let mut entitlement = Entitlement::personal(actor(), tier);
        entitlement.unlimited = unlimited;
        let fixture = BillingFixture::new(pool.clone(), entitlement).await;
        fixture.record(&fixture.user, AiFeature::Chat, 100.0).await;
        let snapshot = fixture.assert_position(None).await;
        assert_eq!(snapshot.unlimited, unlimited);
    }
}
