use super::*;
use crate::domain::ports::BillingRepo;
use crate::domain::{SeatAllowance, SettlementPolicy};
use crate::outbound::pg_billing_repo::PgBillingRepo;
use ai_usage::AiFeature;
use ai_usage::domain::ports::InvocationFunding;
use chrono::Duration;
use macro_db_migrator::MACRO_DB_MIGRATIONS;

const DOLLAR: u64 = 1_000_000_000_000;

fn rollout_observation() -> (UsageRollout, SeatPeriodObservation) {
    let window = period().period;
    let rollout = UsageRollout {
        effective_at: window.start + Duration::days(10),
        price_id: "price_40".parse().unwrap(),
        product_id: "prod_40".parse().unwrap(),
    };
    let observation = SeatPeriodObservation {
        seat: user("seat"),
        payer: user("payer"),
        subscription: crate::domain::period::SubscriptionPeriod {
            event_id: "evt_baseline".parse().unwrap(),
            event_at: rollout.effective_at,
            subscription_id: "sub_verified".parse().unwrap(),
            subscription_created_at: window.start - Duration::days(90),
            customer_id: "cus_verified".parse().unwrap(),
            team_id: None,
            quantity: 1,
            item_count: 1,
            item_id: "si_verified".parse().unwrap(),
            price_id: rollout.price_id.clone(),
            product_id: rollout.product_id.clone(),
            unit_amount: Some(4000),
            currency: "usd".into(),
            monthly: true,
            activity: crate::domain::period::SubscriptionActivity::Active,
            period: window,
            evidence: crate::domain::period::PeriodEvidence::Snapshot,
        },
    };
    (rollout, observation)
}

fn next_renewal(mut observation: SeatPeriodObservation) -> SeatPeriodObservation {
    let facts = &mut observation.subscription;
    facts.period.start = facts.period.end;
    facts.period.end += Duration::days(31);
    facts.event_at = facts.period.start;
    facts.event_id = format!("evt_{}", facts.period.start.timestamp())
        .try_into()
        .unwrap();
    facts.evidence = crate::domain::period::PeriodEvidence::Renewal;
    observation
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn verified_renewal_freezes_history_and_preserves_shared_money(pool: PgPool) {
    let repo = PgFundingRepo::new(pool.clone(), AiPricing::testing());
    let billing = PgBillingRepo::new(pool, AiPricing::testing());
    let (rollout, baseline) = rollout_observation();
    billing
        .update_overage(&user("payer"), true, 5000)
        .await
        .unwrap();
    billing
        .record_credit_purchase(&user("payer"), 1000, "cs_before_rollout")
        .await
        .unwrap();
    let settings = billing.settings(&user("payer")).await.unwrap();
    assert_eq!(
        repo.observe(&rollout, baseline.clone(), true)
            .await
            .unwrap(),
        PeriodDecision::Legacy
    );
    let old = repo
        .period(user("seat"), baseline.subscription.period.start)
        .await
        .unwrap()
        .unwrap();
    let renewed = next_renewal(baseline.clone());
    assert_eq!(
        repo.observe(&rollout, renewed.clone(), true).await.unwrap(),
        PeriodDecision::Activate
    );
    let rate = rate();
    let mut request = request(&rate, 20 * DOLLAR);
    request.occurred_at = renewed.subscription.period.end - Duration::seconds(1);
    let funding = repo.authorize(request.clone(), rate.clone()).await.unwrap();
    let admission = AuthorizedInvocation {
        request,
        rate,
        funding,
    };
    let next = next_renewal(renewed.clone());
    assert_eq!(
        repo.observe(&rollout, next.clone(), true).await.unwrap(),
        PeriodDecision::Activate
    );
    // An invocation admitted before the boundary finishes after it, against its
    // original immutable authorization, not the newly published allowance.
    let mut record = completed(admission.clone(), 20 * DOLLAR);
    if let InvocationState::Priced { evidence, .. } = &mut record.state {
        evidence.occurred_at = next.subscription.period.start + Duration::seconds(5);
    }
    repo.finalize(record).await.unwrap();
    assert_eq!(
        repo.allocation(admission.request.invocation_id)
            .await
            .unwrap()
            .unwrap()
            .included_public
            .units(),
        20 * DOLLAR
    );
    assert_eq!(
        repo.period(user("seat"), baseline.subscription.period.start)
            .await
            .unwrap(),
        Some(old)
    );
    assert_eq!(
        billing.credit_balance_cents(&user("payer")).await.unwrap(),
        1000
    );
    let after = billing.settings(&user("payer")).await.unwrap();
    assert_eq!(after.overage_enabled, settings.overage_enabled);
    assert_eq!(after.overage_limit_cents, settings.overage_limit_cents);
    assert_eq!(
        repo.observe(&rollout, next, true).await.unwrap(),
        PeriodDecision::Activate
    );
    let mut delayed = baseline;
    delayed.subscription.event_id = "evt_delayed".parse().unwrap();
    assert_eq!(
        repo.observe(&rollout, delayed, true).await.unwrap(),
        PeriodDecision::Exception(ActivationException::Stale)
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn cancellation_departure_and_rejoin_cannot_replenish_allowance(pool: PgPool) {
    let repo = PgFundingRepo::new(pool.clone(), AiPricing::testing());
    let billing = PgBillingRepo::new(pool, AiPricing::testing());
    let (rollout, baseline) = rollout_observation();
    repo.observe(&rollout, baseline.clone(), true)
        .await
        .unwrap();
    let renewal = next_renewal(baseline);
    repo.observe(&rollout, renewal.clone(), true).await.unwrap();
    let rate = rate();
    let mut request = request(&rate, 20 * DOLLAR);
    request.occurred_at = renewal.subscription.period.start + Duration::seconds(1);
    let funding = repo.authorize(request.clone(), rate.clone()).await.unwrap();
    allocated(
        &repo,
        AuthorizedInvocation {
            request: request.clone(),
            rate: rate.clone(),
            funding,
        },
        20 * DOLLAR,
    )
    .await;
    let mut canceled = renewal.clone();
    canceled.subscription.event_id = "evt_cancel".parse().unwrap();
    canceled.subscription.activity = crate::domain::period::SubscriptionActivity::Inactive;
    assert_eq!(
        repo.observe(&rollout, canceled, true).await.unwrap(),
        PeriodDecision::Exception(ActivationException::Ineligible)
    );
    let open = renewal
        .subscription
        .period
        .open_start(request.occurred_at)
        .unwrap();
    billing
        .release_open_seat(&user("payer"), open, &user("seat"))
        .await
        .unwrap();
    let mut rejoin = renewal.clone();
    rejoin.subscription.event_id = "evt_rejoin".parse().unwrap();
    repo.observe(&rollout, rejoin, true).await.unwrap();
    request.invocation_id = InvocationId::new();
    request.token_budget = TrustedTokenUsage::from_disjoint(1, 0, 0, 0, 0);
    assert!(repo.authorize(request.clone(), rate.clone()).await.is_err());
    // Only a distinct verified renewal resets included usage.
    let next = next_renewal(renewal);
    repo.observe(&rollout, next.clone(), true).await.unwrap();
    request.invocation_id = InvocationId::new();
    request.occurred_at = next.subscription.period.start;
    assert!(repo.authorize(request, rate).await.is_ok());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn activation_exceptions_are_durable_and_mixed_policy_seats_stay_separate(pool: PgPool) {
    let repo = PgFundingRepo::new(pool.clone(), AiPricing::testing());
    let billing = PgBillingRepo::new(pool.clone(), AiPricing::testing());
    let (rollout, baseline) = rollout_observation();
    let mut delayed = baseline.clone();
    delayed.subscription.event_id = "evt_pre_rollout".parse().unwrap();
    delayed.subscription.event_at = rollout.effective_at - Duration::seconds(1);
    assert_eq!(
        repo.observe(&rollout, delayed, true).await.unwrap(),
        PeriodDecision::Exception(ActivationException::Delayed)
    );
    let mut unknown = baseline.clone();
    unknown.seat = user("max");
    unknown.subscription.price_id = "price_unknown".parse().unwrap();
    assert_eq!(
        repo.observe(&rollout, unknown, true).await.unwrap(),
        PeriodDecision::Exception(ActivationException::Ineligible)
    );
    assert_eq!(
        repo.observe(&rollout, baseline.clone(), false)
            .await
            .unwrap(),
        PeriodDecision::Exception(ActivationException::AmbiguousBinding)
    );
    let mut baseline = baseline;
    baseline.subscription.event_id = "evt_verified_baseline".parse().unwrap();
    repo.observe(&rollout, baseline.clone(), true)
        .await
        .unwrap();
    let renewal = next_renewal(baseline);
    let mut ordinary = renewal.clone();
    ordinary.subscription.event_id = "evt_update".parse().unwrap();
    ordinary.subscription.evidence = crate::domain::period::PeriodEvidence::Snapshot;
    assert_eq!(
        repo.observe(&rollout, ordinary, true).await.unwrap(),
        PeriodDecision::Exception(ActivationException::UnverifiedRenewal)
    );
    repo.observe(&rollout, renewal.clone(), true).await.unwrap();
    let seats = billing
        .legacy_seats(
            &user("payer"),
            renewal.subscription.period,
            vec![
                SeatAllowance {
                    user: user("seat"),
                    included_cents: 4000,
                },
                SeatAllowance {
                    user: user("max"),
                    included_cents: 20000,
                },
            ],
        )
        .await
        .unwrap();
    assert_eq!(seats.len(), 1);
    assert_eq!(seats[0].user, user("max"));
    let count = sqlx::query_scalar!("SELECT COUNT(*) FROM ai_billing_usage_observation")
        .fetch_one(&pool)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(count, 6);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn late_seat_uses_existing_item_proof_but_cannot_renew_it(pool: PgPool) {
    let repo = PgFundingRepo::new(pool, AiPricing::testing());
    let (rollout, baseline) = rollout_observation();
    repo.observe(&rollout, baseline.clone(), true)
        .await
        .unwrap();
    let renewal = next_renewal(baseline);
    repo.observe(&rollout, renewal.clone(), true).await.unwrap();
    let mut joining = renewal.clone();
    joining.seat = user("joining");
    joining.subscription.event_id = "evt_join".parse().unwrap();
    joining.subscription.evidence = crate::domain::period::PeriodEvidence::Snapshot;
    assert_eq!(
        repo.observe(&rollout, joining.clone(), true).await.unwrap(),
        PeriodDecision::Activate
    );
    assert_eq!(
        repo.period(user("joining"), renewal.subscription.period.start)
            .await
            .unwrap()
            .unwrap()
            .period,
        renewal.subscription.period
    );
    let mut next = next_renewal(joining);
    next.subscription.evidence = crate::domain::period::PeriodEvidence::Snapshot;
    assert_eq!(
        repo.observe(&rollout, next, true).await.unwrap(),
        PeriodDecision::Exception(ActivationException::UnverifiedRenewal)
    );
    let mut changed_rollout = rollout;
    changed_rollout.effective_at += Duration::days(1);
    assert!(repo.observe(&changed_rollout, renewal, true).await.is_err());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn delayed_renewal_does_not_convert_a_legacy_period_already_in_use(pool: PgPool) {
    let repo = PgFundingRepo::new(pool.clone(), AiPricing::testing());
    let billing = PgBillingRepo::new(pool, AiPricing::testing());
    let (rollout, baseline) = rollout_observation();
    repo.observe(&rollout, baseline.clone(), true)
        .await
        .unwrap();
    let renewal = next_renewal(baseline);
    let period = renewal.subscription.period;
    let seats = vec![SeatAllowance {
        user: user("seat"),
        included_cents: 4000,
    }];
    billing
        .store_open_allowance(
            &user("payer"),
            period.open_start(period.start).unwrap(),
            &seats,
            Default::default(),
        )
        .await
        .unwrap();
    let old = billing
        .period_allowance(&user("payer"), period.start)
        .await
        .unwrap();
    assert_eq!(
        repo.observe(&rollout, renewal, true).await.unwrap(),
        PeriodDecision::Exception(ActivationException::LegacyPeriodInUse)
    );
    assert!(
        repo.period(user("seat"), period.start)
            .await
            .unwrap()
            .is_none()
    );
    assert_eq!(
        billing
            .period_allowance(&user("payer"), period.start)
            .await
            .unwrap(),
        old
    );
    // Older starts remain ignored; a same-period end correction changes only
    // the legacy anchor, never the retained allowance or activation history.
    billing
        .set_period(&user("payer"), period.start, period.end)
        .await
        .unwrap();
    billing
        .set_period(
            &user("payer"),
            period.start - Duration::days(31),
            period.start,
        )
        .await
        .unwrap();
    billing
        .set_period(&user("payer"), period.start, period.end + Duration::days(1))
        .await
        .unwrap();
    assert_eq!(
        billing
            .settings(&user("payer"))
            .await
            .unwrap()
            .period_anchor,
        Some((period.start, period.end + Duration::days(1)))
    );
    assert_eq!(
        billing
            .period_allowance(&user("payer"), period.start)
            .await
            .unwrap(),
        old
    );
    assert!(
        repo.period(user("seat"), period.start)
            .await
            .unwrap()
            .is_none()
    );
}

fn user(name: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(format!("macro|{name}@example.com")).unwrap()
}

fn period() -> FundingPeriod {
    let start = DateTime::from_timestamp(1_800_000_000, 0).unwrap();
    FundingPeriod {
        seat: user("seat"),
        payer: user("payer"),
        subscription: FundingSubscription::new("sub_verified".into()).unwrap(),
        period: BillingPeriod {
            start,
            end: start + Duration::days(30),
        },
        policy: UsagePolicy::PublicAllowanceV1,
    }
}

fn rate() -> RateSnapshot {
    RateSnapshot {
        version: RateVersion::new(),
        model: ProviderModel::new("test", "model").unwrap(),
        effective_at: period().period.start,
        tokens: TokenRates {
            input: 1,
            output: 0,
            cache_read: 0,
            cache_write: 0,
            reasoning: 0,
        },
    }
}

fn request(rate: &RateSnapshot, maximum: u64) -> BeginInvocation {
    BeginInvocation {
        run_id: RunId::new(),
        invocation_id: InvocationId::new(),
        user: user("seat"),
        feature: AiFeature::Chat,
        entity: None,
        model: rate.model.clone(),
        occurred_at: period().period.start + Duration::seconds(1),
        token_budget: TrustedTokenUsage::from_disjoint(maximum, 0, 0, 0, 0),
    }
}

async fn setup(
    pool: &PgPool,
    credits: i64,
    enabled: bool,
    cap: i64,
) -> (PgFundingRepo, PgBillingRepo) {
    let funding = PgFundingRepo::new(pool.clone(), AiPricing::testing());
    let billing = PgBillingRepo::new(pool.clone(), AiPricing::testing());
    funding.record_period(period()).await.unwrap();
    billing
        .update_overage(&user("payer"), enabled, cap)
        .await
        .unwrap();
    if credits > 0 {
        billing
            .record_credit_purchase(&user("payer"), credits, "cs_initial")
            .await
            .unwrap();
    }
    (funding, billing)
}

async fn admit(repo: &PgFundingRepo, maximum: u64) -> AuthorizedInvocation {
    let rate = rate();
    let request = request(&rate, maximum);
    let funding = repo.authorize(request.clone(), rate.clone()).await.unwrap();
    AuthorizedInvocation {
        request,
        rate,
        funding,
    }
}

fn completed(admission: AuthorizedInvocation, actual: u64) -> InvocationRecord {
    let evidence = FinalizeInvocation {
        invocation_id: admission.request.invocation_id,
        occurred_at: admission.request.occurred_at + Duration::seconds(1),
        provider_request_id: None,
        outcome: ProviderOutcome::Succeeded,
        usage: UsageEvidence::Reported(TrustedTokenUsage::from_disjoint(actual, 0, 0, 0, 0)),
    };
    InvocationRecord {
        admission,
        state: InvocationState::Priced {
            evidence,
            public_usage: PublicUsage::from_units(actual),
        },
    }
}

async fn allocated(
    repo: &PgFundingRepo,
    admission: AuthorizedInvocation,
    actual: u64,
) -> UsageAllocation {
    let id = admission.request.invocation_id;
    repo.finalize(completed(admission, actual)).await.unwrap();
    repo.allocation(id).await.unwrap().unwrap()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn threshold_split_is_credit_first_and_not_double_billed(pool: PgPool) {
    let (repo, billing) = setup(&pool, 1_000, true, 5_000).await;
    let invocation = admit(&repo, 30 * DOLLAR).await;
    let record = completed(invocation.clone(), 30 * DOLLAR);
    repo.finalize(record.clone()).await.unwrap();
    // Simulate a lost acknowledgement and replay after settings/purchases change.
    billing
        .update_overage(&user("payer"), false, 1)
        .await
        .unwrap();
    billing
        .record_credit_purchase(&user("payer"), 2_500, "cs_later")
        .await
        .unwrap();
    repo.finalize(record).await.unwrap();
    let allocation = repo
        .allocation(invocation.request.invocation_id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(allocation.included_public.units(), 20 * DOLLAR);
    assert_eq!(allocation.extra_public.units(), 10 * DOLLAR);
    assert_eq!(
        allocation.prepaid,
        CustomerMoney::from_cents(1_000).unwrap()
    );
    assert_eq!(allocation.postpaid, CustomerMoney::from_cents(50).unwrap());
    assert_eq!(allocation.macro_absorbed.units(), 0);
    assert_eq!(
        allocation.extra_money().unwrap(),
        CustomerMoney::from_cents(1_050).unwrap()
    );
    assert_eq!(
        billing.credit_balance_cents(&user("payer")).await.unwrap(),
        2_500
    );
    assert_eq!(
        billing
            .period_ledger(&user("payer"), period().period.start)
            .await
            .unwrap()
            .credits_consumed_cents,
        0
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn opt_out_credit_only_and_exhaustion(pool: PgPool) {
    let (repo, billing) = setup(&pool, 1_050, false, 5_000).await;
    let first = admit(&repo, 30 * DOLLAR).await;
    let denied_rate = rate();
    let denied = request(&denied_rate, 1);
    assert!(
        repo.authorize(denied.clone(), denied_rate.clone())
            .await
            .is_err()
    );
    let allocation = allocated(&repo, first, 30 * DOLLAR).await;
    assert_eq!(
        allocation.prepaid,
        CustomerMoney::from_cents(1_050).unwrap()
    );
    assert_eq!(allocation.postpaid.units(), 0);
    // Enabling cannot create an allocation for an invocation never authorized.
    billing
        .update_overage(&user("payer"), true, 5_000)
        .await
        .unwrap();
    assert!(
        repo.authorize(denied.clone(), denied_rate.clone())
            .await
            .is_err()
    );
    let fresh = request(&denied_rate, 1);
    assert!(repo.authorize(fresh, denied_rate.clone()).await.is_ok());
    let unknown = AuthorizedInvocation {
        request: denied,
        rate: denied_rate,
        funding: FundingAuthorization {
            id: FundingAuthorizationId::new(),
            invocation_id: InvocationId::new(),
            maximum_public_usage: PublicUsage::from_units(1),
        },
    };
    assert!(repo.finalize(completed(unknown, 1)).await.is_err());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn reversed_completions_release_allowance_before_pricing(pool: PgPool) {
    let (repo, billing) = setup(&pool, 0, true, 5_000).await;
    let first = admit(&repo, 20 * DOLLAR).await;
    let second = admit(&repo, 10 * DOLLAR).await;
    let second_id = second.request.invocation_id;
    repo.finalize(completed(second, 10 * DOLLAR)).await.unwrap();
    assert!(repo.allocation(second_id).await.unwrap().is_none());
    // This toggle/cap reduction must not change the already captured authorization.
    billing
        .update_overage(&user("payer"), false, 1)
        .await
        .unwrap();
    allocated(&repo, first, 5 * DOLLAR).await;
    let allocation = repo.allocation(second_id).await.unwrap().unwrap();
    assert_eq!(allocation.included_public.units(), 10 * DOLLAR);
    assert_eq!(allocation.extra_money().unwrap().units(), 0);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn earlier_credit_releases_replace_only_eligible_postpaid(pool: PgPool) {
    let (repo, billing) = setup(&pool, 1_050, true, 5_000).await;
    let included = admit(&repo, 20 * DOLLAR).await;
    allocated(&repo, included, 20 * DOLLAR).await;
    let first = admit(&repo, 10 * DOLLAR).await;
    let second = admit(&repo, 10 * DOLLAR).await;
    let second_id = second.request.invocation_id;
    allocated(&repo, first, 0).await;
    // Released money is still owed to second, not spendable by newer attempts.
    let third = admit(&repo, 10 * DOLLAR).await;
    let third_id = third.request.invocation_id;
    repo.finalize(completed(third, 10 * DOLLAR)).await.unwrap();
    allocated(&repo, second, 10 * DOLLAR).await;
    let second = repo.allocation(second_id).await.unwrap().unwrap();
    let third = repo.allocation(third_id).await.unwrap().unwrap();
    assert_eq!(second.prepaid, CustomerMoney::from_cents(1_050).unwrap());
    assert_eq!(second.reclaimed_prepaid, second.prepaid);
    assert_eq!(second.postpaid.units(), 0);
    assert_eq!(third.prepaid.units(), 0);
    assert_eq!(third.postpaid, CustomerMoney::from_cents(1_050).unwrap());
    assert_eq!(
        billing.credit_balance_cents(&user("payer")).await.unwrap(),
        0
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn later_purchase_and_disable_do_not_reclassify_authorized_liability(pool: PgPool) {
    let (repo, billing) = setup(&pool, 0, true, 2_000).await;
    let invocation = admit(&repo, 30 * DOLLAR).await;
    billing
        .update_overage(&user("payer"), false, 0)
        .await
        .unwrap();
    billing
        .record_credit_purchase(&user("payer"), 2_500, "cs_later")
        .await
        .unwrap();
    let allocation = allocated(&repo, invocation, 30 * DOLLAR).await;
    assert_eq!(allocation.prepaid.units(), 0);
    assert_eq!(
        allocation.postpaid,
        CustomerMoney::from_cents(1_050).unwrap()
    );
    assert_eq!(
        billing.credit_balance_cents(&user("payer")).await.unwrap(),
        2_500
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn unfunded_overshoot_is_absorbed_not_debt(pool: PgPool) {
    let (repo, _) = setup(&pool, 0, false, 5_000).await;
    let invocation = admit(&repo, 20 * DOLLAR).await;
    let allocation = allocated(&repo, invocation, 30 * DOLLAR).await;
    assert_eq!(allocation.prepaid.units(), 0);
    assert_eq!(allocation.postpaid.units(), 0);
    assert_eq!(
        allocation.macro_absorbed,
        CustomerMoney::from_cents(1_050).unwrap()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn pending_evidence_blocks_watermark_and_is_discoverable(pool: PgPool) {
    let (repo, _) = setup(&pool, 0, true, 5_000).await;
    let first = admit(&repo, 20 * DOLLAR).await;
    let first_id = first.request.invocation_id;
    let second = admit(&repo, DOLLAR).await;
    let second_id = second.request.invocation_id;
    let evidence = FinalizeInvocation {
        invocation_id: first_id,
        occurred_at: first.request.occurred_at,
        provider_request_id: None,
        outcome: ProviderOutcome::Unknown,
        usage: UsageEvidence::Missing(UnresolvedReason::Interrupted),
    };
    repo.finalize(InvocationRecord {
        admission: first,
        state: InvocationState::Unresolved { evidence },
    })
    .await
    .unwrap();
    repo.finalize(completed(second, DOLLAR)).await.unwrap();
    repo.reconcile(user("payer")).await.unwrap();
    assert!(repo.allocation(second_id).await.unwrap().is_none());
    let pending = repo
        .pending(PendingInvocations {
            after: None,
            before: Utc::now() + Duration::days(1),
            limit: 100.try_into().unwrap(),
        })
        .await
        .unwrap();
    assert!(pending.contains(&first_id));
    assert!(pending.contains(&second_id));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn bounded_reconciliation_resumes_after_restart(pool: PgPool) {
    let (repo, _) = setup(&pool, 0, false, 0).await;
    let mut admissions = Vec::new();
    for _ in 0..105 {
        admissions.push(admit(&repo, 1).await);
    }
    let last = admissions.last().unwrap().request.invocation_id;
    for admission in admissions.into_iter().rev() {
        repo.finalize(completed(admission, 1)).await.unwrap();
    }
    assert!(repo.allocation(last).await.unwrap().is_none());
    let restarted = PgFundingRepo::new(pool, AiPricing::testing());
    let pending = restarted
        .pending(PendingInvocations {
            after: None,
            before: Utc::now() + Duration::days(1),
            limit: 100.try_into().unwrap(),
        })
        .await
        .unwrap();
    assert_eq!(pending.len(), 5);
    restarted.reconcile(user("payer")).await.unwrap();
    assert_eq!(
        restarted
            .allocation(last)
            .await
            .unwrap()
            .unwrap()
            .included_public
            .units(),
        1
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn admission_and_completion_conflicting_replays_fail(pool: PgPool) {
    let (repo, billing) = setup(&pool, 0, false, 0).await;
    let invocation = admit(&repo, DOLLAR).await;
    let replay = repo
        .authorize(invocation.request.clone(), invocation.rate.clone())
        .await
        .unwrap();
    assert_eq!(replay, invocation.funding);
    let mut changed = invocation.request.clone();
    changed.run_id = RunId::new();
    assert!(
        repo.authorize(changed, invocation.rate.clone())
            .await
            .is_err()
    );
    allocated(&repo, invocation.clone(), DOLLAR).await;
    assert!(
        repo.finalize(completed(invocation.clone(), 0))
            .await
            .is_err()
    );
    billing
        .update_overage(&user("payer"), true, 1_000)
        .await
        .unwrap();
    assert_eq!(
        repo.authorize(invocation.request, invocation.rate)
            .await
            .unwrap(),
        replay
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn fractional_credit_cannot_be_spent_by_legacy_or_a_later_invocation(pool: PgPool) {
    let (repo, billing) = setup(&pool, 1, false, 0).await;
    let included = admit(&repo, 20 * DOLLAR).await;
    allocated(&repo, included, 20 * DOLLAR).await;
    let public = 1_000_000_000; // $.001 public = .105 cents customer money.
    let first = admit(&repo, public).await;
    allocated(&repo, first, public).await;
    let policy = SettlementPolicy {
        overage_active: false,
        overage_limit_cents: 0,
        charge_threshold_cents: 1_000,
        period_ended: false,
    };
    assert_eq!(
        billing
            .apply_settlement(&user("payer"), period().period.start, 1, policy)
            .await
            .unwrap()
            .consumed_credits_cents,
        0
    );
    for _ in 0..8 {
        let attempt = admit(&repo, public).await;
        allocated(&repo, attempt, public).await;
    }
    let rate = rate();
    assert!(repo.authorize(request(&rate, public), rate).await.is_err());
    let mut conn = pool.acquire().await.unwrap();
    assert_eq!(
        credit_commitments(&mut conn, user("payer").as_ref())
            .await
            .unwrap()
            .remainder
            .units(),
        945_000_000_000
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn racing_admissions_share_allowance_credits_and_cap(pool: PgPool) {
    let (repo, _) = setup(&pool, 1_050, false, 0).await;
    let mut tasks = tokio::task::JoinSet::new();
    for _ in 0..12 {
        let repo = repo.clone();
        tasks.spawn(async move {
            let rate = rate();
            repo.authorize(request(&rate, 10 * DOLLAR), rate)
                .await
                .is_ok()
        });
    }
    let mut admitted = 0;
    while let Some(result) = tasks.join_next().await {
        admitted += usize::from(result.unwrap());
    }
    assert_eq!(admitted, 3);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn duplicate_admissions_reserve_once_even_after_lost_acknowledgement(pool: PgPool) {
    let (repo, _) = setup(&pool, 0, false, 0).await;
    let rate = rate();
    let request = request(&rate, 20 * DOLLAR);
    let mut tasks = tokio::task::JoinSet::new();
    for _ in 0..8 {
        let (repo, request, rate) = (repo.clone(), request.clone(), rate.clone());
        tasks.spawn(async move { repo.authorize(request, rate).await.unwrap() });
    }
    let first = tasks.join_next().await.unwrap().unwrap();
    while let Some(result) = tasks.join_next().await {
        assert_eq!(result.unwrap(), first);
    }
    assert_eq!(
        repo.pending(PendingInvocations {
            after: None,
            before: Utc::now() + Duration::days(1),
            limit: 100.try_into().unwrap(),
        })
        .await
        .unwrap(),
        vec![request.invocation_id]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn collected_new_liability_is_neither_legacy_coverage_nor_a_second_cap_debit(pool: PgPool) {
    let (repo, billing) = setup(&pool, 0, true, 210).await;
    let first = admit(&repo, 21 * DOLLAR).await;
    let allocation = allocated(&repo, first, 21 * DOLLAR).await;
    assert_eq!(allocation.postpaid, CustomerMoney::from_cents(105).unwrap());
    let payer = user("payer");
    sqlx::query!(
        "INSERT INTO ai_overage_charge (id, user_id, period_start, amount_cents, status, accounting_policy)
         VALUES ($1, $2, $3, 105, 'paid', 'public_allowance_v1')",
        macro_uuid::generate_uuid_v7(), payer.as_ref(), period().period.start,
    ).execute(&pool).await.unwrap();
    let ledger = billing
        .period_ledger(&user("payer"), period().period.start)
        .await
        .unwrap();
    assert_eq!(ledger.overage_charged_cents, 0);
    let next = admit(&repo, DOLLAR).await;
    assert_eq!(
        allocated(&repo, next, DOLLAR).await.postpaid,
        CustomerMoney::from_cents(105).unwrap()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn racing_postpaid_admissions_never_exceed_the_cap(pool: PgPool) {
    let (repo, _) = setup(&pool, 0, true, 105).await;
    let included = admit(&repo, 20 * DOLLAR).await;
    allocated(&repo, included, 20 * DOLLAR).await;
    let mut tasks = tokio::task::JoinSet::new();
    for _ in 0..8 {
        let repo = repo.clone();
        tasks.spawn(async move {
            let rate = rate();
            repo.authorize(request(&rate, DOLLAR), rate).await.is_ok()
        });
    }
    let mut admitted = 0;
    while let Some(result) = tasks.join_next().await {
        admitted += usize::from(result.unwrap());
    }
    assert_eq!(admitted, 1);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn legacy_settlement_cannot_spend_new_holds_or_cap(pool: PgPool) {
    let (repo, billing) = setup(&pool, 1_050, true, 1_050).await;
    let _held = admit(&repo, 40 * DOLLAR).await;
    let policy = SettlementPolicy {
        overage_active: true,
        overage_limit_cents: 1_050,
        charge_threshold_cents: 1_000,
        period_ended: false,
    };
    let outcome = billing
        .apply_settlement(&user("payer"), period().period.start, 5_000, policy)
        .await
        .unwrap();
    assert_eq!(outcome.consumed_credits_cents, 0);
    assert!(outcome.pending_charge.is_none());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn mixed_policy_seats_and_immutable_period_binding(pool: PgPool) {
    let (repo, billing) = setup(&pool, 0, false, 0).await;
    let seats = vec![
        SeatAllowance {
            user: user("seat"),
            included_cents: 2_000,
        },
        SeatAllowance {
            user: user("legacy"),
            included_cents: 2_000,
        },
    ];
    let legacy = billing
        .legacy_seats(&user("payer"), period().period, seats)
        .await
        .unwrap();
    assert_eq!(legacy.len(), 1);
    assert_eq!(legacy[0].user, user("legacy"));
    repo.record_period(period()).await.unwrap();
    let mut changed = period();
    changed.payer = user("new-payer");
    assert!(repo.record_period(changed).await.is_err());
    let mut overlap = period();
    overlap.period.start += Duration::days(1);
    assert!(repo.record_period(overlap).await.is_err());
    assert!(
        repo.period(user("seat"), period().period.end)
            .await
            .unwrap()
            .is_none()
    );
    // A missing verified renewal must not fall back to a guessed monthly period.
    let rate = rate();
    let mut request = request(&rate, DOLLAR);
    request.occurred_at = period().period.end;
    assert!(repo.authorize(request, rate).await.is_err());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn purchases_toggles_cap_reductions_and_admission_use_the_same_lock(pool: PgPool) {
    let (repo, billing) = setup(&pool, 0, false, 1_050).await;
    let mut tx = pool.begin().await.unwrap();
    lock_payer(&mut tx, user("payer").as_ref()).await.unwrap();

    let purchase_repo = billing.clone();
    let purchase = tokio::spawn(async move {
        purchase_repo
            .record_credit_purchase(&user("payer"), 1_050, "cs_race")
            .await
            .unwrap()
    });
    let toggle_repo = billing.clone();
    let toggle = tokio::spawn(async move {
        toggle_repo
            .update_overage(&user("payer"), true, 1_050)
            .await
            .unwrap()
    });
    let cap_repo = billing.clone();
    let cap = tokio::spawn(async move {
        cap_repo
            .update_overage(&user("payer"), false, 0)
            .await
            .unwrap()
    });
    let funding_repo = repo.clone();
    let admission = tokio::spawn(async move { admit(&funding_repo, 20 * DOLLAR).await });
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    assert!(!purchase.is_finished());
    assert!(!toggle.is_finished());
    assert!(!cap.is_finished());
    assert!(!admission.is_finished());
    tx.commit().await.unwrap();
    assert!(purchase.await.unwrap());
    toggle.await.unwrap();
    cap.await.unwrap();
    let admitted = admission.await.unwrap();
    let captured = sqlx::query!(
        r#"SELECT admission AS "admission: Json<AdmissionData>" FROM ai_funding_reservation WHERE invocation_id = $1"#,
        admitted.request.invocation_id.as_uuid(),
    ).fetch_one(&pool).await.unwrap().admission;
    assert_eq!(captured.policy, UsagePolicy::PublicAllowanceV1);
    assert_eq!(
        captured.overage_enabled,
        matches!(captured.postpaid, PostpaidData::Enabled(_))
    );
    assert!(captured.revision <= 3);
    billing
        .update_overage(&user("payer"), false, 0)
        .await
        .unwrap();
    assert_eq!(
        allocated(&repo, admitted, 20 * DOLLAR)
            .await
            .extra_money()
            .unwrap()
            .units(),
        0
    );
    assert_eq!(
        billing.credit_balance_cents(&user("payer")).await.unwrap(),
        1_050
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn renewal_expires_only_allowance_and_preserves_old_authorizations(pool: PgPool) {
    let (repo, billing) = setup(&pool, 1_050, false, 0).await;
    let old = admit(&repo, 30 * DOLLAR).await;
    let mut renewal = period();
    renewal.period.start = renewal.period.end;
    renewal.period.end += Duration::days(30);
    repo.record_period(renewal.clone()).await.unwrap();
    let rate = rate();
    let mut request = request(&rate, 20 * DOLLAR);
    request.occurred_at = renewal.period.start;
    let funding = repo.authorize(request.clone(), rate.clone()).await.unwrap();
    let new = AuthorizedInvocation {
        request,
        rate,
        funding,
    };
    let new_id = new.request.invocation_id;
    repo.finalize(completed(new, 20 * DOLLAR)).await.unwrap();
    assert!(repo.allocation(new_id).await.unwrap().is_none());
    // Unused old holds do not consume rolled-over credits, nor transfer old allowance.
    allocated(&repo, old, 20 * DOLLAR).await;
    assert_eq!(
        repo.allocation(new_id)
            .await
            .unwrap()
            .unwrap()
            .included_public
            .units(),
        20 * DOLLAR
    );
    assert_eq!(
        billing.credit_balance_cents(&user("payer")).await.unwrap(),
        1_050
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn domain_facade_rejects_exemption_and_exclusion_on_billable_funding(pool: PgPool) {
    let (repo, _) = setup(&pool, 0, false, 0).await;
    let service = FundingService::new(repo.clone());
    let rate = rate();
    let mut request = request(&rate, DOLLAR);
    request.feature = crate::domain::models::NON_BILLABLE_AI_FEATURES[0];
    assert!(service.authorize(request, rate).await.is_err());
    let admission = admit(&repo, DOLLAR).await;
    let mut record = completed(admission, DOLLAR);
    let InvocationState::Priced { evidence, .. } = record.state else {
        unreachable!()
    };
    record.state = InvocationState::Excluded {
        evidence,
        reason: ExclusionReason::LegacyPolicy,
    };
    assert!(service.finalize(record).await.is_err());
}
