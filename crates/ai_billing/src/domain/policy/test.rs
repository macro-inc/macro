use super::*;
use chrono::{TimeZone, Utc};

fn public_cents(cents: u64) -> PublicUsage {
    PublicUsage::from_units(cents * PUBLIC_UNITS_PER_CENT)
}

fn money(cents: u64) -> CustomerMoney {
    CustomerMoney::from_cents(cents).unwrap()
}

fn authorization(enabled: bool) -> AuthorizationSnapshot {
    AuthorizationSnapshot {
        id: FundingAuthorizationId::new(),
        invocation_id: InvocationId::new(),
        payer: MacroUserIdStr::try_from("macro|payer@example.com").unwrap(),
        seat: MacroUserIdStr::try_from("macro|seat@example.com").unwrap(),
        period: BillingPeriod {
            start: Utc.with_ymd_and_hms(2026, 9, 1, 0, 0, 0).unwrap(),
            end: Utc.with_ymd_and_hms(2026, 10, 1, 0, 0, 0).unwrap(),
        },
        policy: UsagePolicy::PublicAllowanceV1,
        settings_revision: AuthorizationRevision::from_raw(1),
        postpaid: if enabled {
            PostpaidAuthorization::Enabled {
                limit: money(5_000),
            }
        } else {
            PostpaidAuthorization::Disabled
        },
    }
}

fn availability(used: PublicUsage, credits: CustomerMoney) -> FundingAvailability {
    FundingAvailability {
        seat_public_used: used,
        seat_public_held: ZERO_PUBLIC,
        prepaid_available: credits,
        prepaid_held: ZERO_MONEY,
        postpaid_incurred: ZERO_MONEY,
        postpaid_held: ZERO_MONEY,
    }
}

fn position(sequence: u64, used: PublicUsage) -> AllocationPosition {
    AllocationPosition {
        next_sequence: AllocationSequence::from_raw(sequence),
        seat_public_used: used,
        prepaid_released_before: ZERO_MONEY,
    }
}

fn allocate_call(
    used: PublicUsage,
    actual: PublicUsage,
    credits: CustomerMoney,
    enabled: bool,
) -> UsageAllocation {
    let mut reservation = reserve(
        AiPricing::testing(),
        authorization(enabled),
        AllocationSequence::from_raw(0),
        actual,
        availability(used, credits),
    )
    .unwrap();
    reservation.allocate(position(0, used), actual).unwrap()
}

#[test]
fn pricing_table_and_enabled_does_not_mean_consumed() {
    for enabled in [false, true] {
        for cents in [1_900, 2_000] {
            let allocation = allocate_call(ZERO_PUBLIC, public_cents(cents), ZERO_MONEY, enabled);
            assert_eq!(allocation.included_public, public_cents(cents));
            assert_eq!(allocation.extra_public, ZERO_PUBLIC);
            assert_eq!(allocation.extra_money().unwrap(), ZERO_MONEY);
            assert_eq!(allocation.postpaid, ZERO_MONEY);
        }
    }
    for (credits, enabled, prepaid, postpaid) in [
        (0, true, 0, 1_050),
        (1_050, false, 1_050, 0),
        (1_000, true, 1_000, 50),
    ] {
        let allocation = allocate_call(ZERO_PUBLIC, public_cents(3_000), money(credits), enabled);
        assert_eq!(allocation.included_public, public_cents(2_000));
        assert_eq!(allocation.extra_public, public_cents(1_000));
        assert_eq!(allocation.prepaid, money(prepaid));
        assert_eq!(allocation.postpaid, money(postpaid));
        assert_eq!(allocation.macro_absorbed, ZERO_MONEY);
    }
}

#[test]
fn opt_out_stops_at_exact_funded_capacity() {
    let available = availability(ZERO_PUBLIC, money(1_000));
    let capacity = funded_capacity(
        AiPricing::testing(),
        &authorization(false),
        public_cents(3_000),
        available,
    )
    .unwrap();
    assert_eq!(capacity.units(), 29_523_809_523_809);
    assert!(matches!(
        reserve(AiPricing::testing(), authorization(false), AllocationSequence::from_raw(0), public_cents(3_000), available),
        Err(PolicyError::InsufficientFunding { maximum_public_usage }) if maximum_public_usage == capacity
    ));
    let allocation = allocate_call(ZERO_PUBLIC, capacity, money(1_000), false);
    assert!(allocation.prepaid <= money(1_000));
    assert_eq!(allocation.postpaid, ZERO_MONEY);
    assert!(matches!(
        reserve(AiPricing::testing(), authorization(false), AllocationSequence::from_raw(0), PublicUsage::from_units(1), availability(public_cents(2_000), ZERO_MONEY)),
        Err(PolicyError::InsufficientFunding { maximum_public_usage }) if maximum_public_usage == ZERO_PUBLIC
    ));
}

#[test]
fn threshold_crossing_and_fractional_credit_boundary_are_lossless() {
    let allocation = allocate_call(
        public_cents(1_999),
        public_cents(2),
        CustomerMoney::from_units(1),
        true,
    );
    assert_eq!(allocation.included_public, public_cents(1));
    assert_eq!(allocation.extra_public, public_cents(1));
    assert_eq!(allocation.prepaid.units(), 1);
    assert_eq!(allocation.postpaid.units(), 1_050_000_000_000 - 1);
    let tiny = allocate_call(
        PublicUsage::from_units(included_public_usage(AiPricing::testing()).units() - 1),
        PublicUsage::from_units(2),
        ZERO_MONEY,
        true,
    );
    assert_eq!(tiny.included_public.units(), 1);
    assert_eq!(tiny.extra_public.units(), 1);
    assert_eq!(tiny.postpaid.units(), 105);
    assert_eq!(
        tiny.funding_portions()[0].category(),
        PricingCategory::Included
    );
    assert_eq!(tiny.funding_portions()[2].source, FundingSource::Postpaid);
}

#[test]
fn unused_holds_never_turn_included_usage_into_extra() {
    for credits in [ZERO_MONEY, money(1_050)] {
        let mut available = availability(ZERO_PUBLIC, credits);
        available.seat_public_held = included_public_usage(AiPricing::testing());
        let mut later = reserve(
            AiPricing::testing(),
            authorization(true),
            AllocationSequence::from_raw(1),
            public_cents(1_000),
            available,
        )
        .unwrap();
        assert_eq!(later.holds().prepaid, credits);
        assert_eq!(
            later.holds().postpaid,
            money(1_050).checked_sub(credits).unwrap()
        );
        assert!(matches!(
            later.allocate(position(0, ZERO_PUBLIC), public_cents(1_000)),
            Err(PolicyError::OutOfOrder)
        ));
        // Earlier attempt released its hold without execution, or finalized measured zero.
        let allocation = later
            .allocate(position(1, ZERO_PUBLIC), public_cents(1_000))
            .unwrap();
        assert_eq!(allocation.included_public, public_cents(1_000));
        assert_eq!(allocation.extra_money().unwrap(), ZERO_MONEY);
        assert_eq!(allocation.customer_liability(), ZERO_MONEY);
        assert_eq!(later.released_holds().unwrap(), later.holds());
    }
}

#[test]
fn release_is_terminal_and_unresolved_attempts_must_keep_their_holds() {
    let mut reservation = reserve(
        AiPricing::testing(),
        authorization(false),
        AllocationSequence::from_raw(0),
        public_cents(100),
        availability(ZERO_PUBLIC, ZERO_MONEY),
    )
    .unwrap();
    assert_eq!(reservation.state(), ReservationState::Held);
    assert!(matches!(
        reservation.released_holds(),
        Err(PolicyError::UnresolvedReservation)
    ));
    let holds = reservation.release_without_execution().unwrap();
    assert_eq!(holds.included_public, public_cents(100));
    assert_eq!(reservation.state(), ReservationState::Released);
    assert!(matches!(
        reservation.release_without_execution(),
        Err(PolicyError::ReservationResolved)
    ));
    assert!(matches!(
        reservation.allocate(position(0, ZERO_PUBLIC), public_cents(1)),
        Err(PolicyError::ReservationResolved)
    ));
}

#[test]
fn overshoot_is_macro_absorbed_not_unauthorized_debt() {
    let mut reservation = reserve(
        AiPricing::testing(),
        authorization(false),
        AllocationSequence::from_raw(0),
        public_cents(2_000),
        availability(ZERO_PUBLIC, ZERO_MONEY),
    )
    .unwrap();
    let allocation = reservation
        .allocate(position(0, ZERO_PUBLIC), public_cents(3_000))
        .unwrap();
    assert_eq!(allocation.macro_absorbed, money(1_050));
    assert_eq!(allocation.customer_liability(), ZERO_MONEY);
    assert_eq!(allocation.extra_money().unwrap(), money(1_050));
}

#[test]
fn holds_and_incurred_liability_reduce_only_postpaid_cap_not_prepaid() {
    let mut auth = authorization(true);
    auth.postpaid = PostpaidAuthorization::Enabled { limit: money(500) };
    let mut available = availability(included_public_usage(AiPricing::testing()), money(105));
    available.postpaid_incurred = money(300);
    available.postpaid_held = money(200);
    let mut reservation = reserve(
        AiPricing::testing(),
        auth,
        AllocationSequence::from_raw(0),
        public_cents(100),
        available,
    )
    .unwrap();
    assert_eq!(reservation.holds().prepaid, money(105));
    assert_eq!(reservation.holds().postpaid, ZERO_MONEY);
    let allocation = reservation
        .allocate(
            position(0, included_public_usage(AiPricing::testing())),
            public_cents(200),
        )
        .unwrap();
    assert_eq!(allocation.prepaid, money(105));
    assert_eq!(allocation.postpaid, ZERO_MONEY);
    assert_eq!(allocation.macro_absorbed, money(105));
}

#[test]
fn captured_authorization_survives_toggle_changes_without_retroactive_funding() {
    let mut auth = authorization(true);
    let mut reservation = reserve(
        AiPricing::testing(),
        auth.clone(),
        AllocationSequence::from_raw(0),
        public_cents(100),
        availability(included_public_usage(AiPricing::testing()), ZERO_MONEY),
    )
    .unwrap();
    auth.postpaid = PostpaidAuthorization::Disabled;
    let allocation = reservation
        .allocate(
            position(0, included_public_usage(AiPricing::testing())),
            public_cents(100),
        )
        .unwrap();
    assert_eq!(allocation.postpaid, money(105));
    assert!(matches!(
        reserve(
            AiPricing::testing(),
            auth,
            AllocationSequence::from_raw(1),
            public_cents(100),
            availability(included_public_usage(AiPricing::testing()), ZERO_MONEY)
        ),
        Err(PolicyError::InsufficientFunding { .. })
    ));
    assert_eq!(
        reservation.authorization().postpaid,
        authorization(true).postpaid
    );
}

#[test]
fn released_earlier_credits_replace_provisional_postpaid_not_finalized_liability() {
    let mut available = availability(included_public_usage(AiPricing::testing()), ZERO_MONEY);
    available.prepaid_held = money(105);
    let mut later = reserve(
        AiPricing::testing(),
        authorization(true),
        AllocationSequence::from_raw(1),
        public_cents(100),
        available,
    )
    .unwrap();
    assert_eq!(later.holds().postpaid, money(105));
    assert_eq!(later.prepaid_reclaim_limit(), money(105));
    let mut at_turn = position(1, included_public_usage(AiPricing::testing()));
    at_turn.prepaid_released_before = money(105);
    let allocation = later.allocate(at_turn, public_cents(200)).unwrap();
    assert_eq!(allocation.prepaid, money(105));
    assert_eq!(allocation.reclaimed_prepaid, money(105));
    assert_eq!(allocation.postpaid, ZERO_MONEY);
    // Reclaimed credits substitute the captured budget, never expand it for overshoot.
    assert_eq!(allocation.macro_absorbed, money(105));
    assert_eq!(later.released_holds().unwrap().postpaid, money(105));
    assert_eq!(later.released_holds().unwrap().prepaid, ZERO_MONEY);
    assert_eq!(later.state(), ReservationState::Consumed);
    assert_eq!(
        later.allocation_state(),
        &AllocationState::Allocated(allocation)
    );
    assert!(matches!(
        later.allocate(at_turn, public_cents(200)),
        Err(PolicyError::ReservationResolved)
    ));
}

#[test]
fn new_credits_cannot_reclassify_captured_or_settled_sources() {
    let mut reservation = reserve(
        AiPricing::testing(),
        authorization(true),
        AllocationSequence::from_raw(0),
        public_cents(100),
        availability(included_public_usage(AiPricing::testing()), ZERO_MONEY),
    )
    .unwrap();
    // No earlier credits existed at admission, so even an erroneous release input
    // cannot use a subsequent purchase to displace the captured postpaid funding.
    let mut at_turn = position(0, included_public_usage(AiPricing::testing()));
    at_turn.prepaid_released_before = money(105);
    let allocation = reservation.allocate(at_turn, public_cents(100)).unwrap();
    assert_eq!(allocation.prepaid, ZERO_MONEY);
    assert_eq!(allocation.postpaid, money(105));
    assert!(matches!(
        reservation.release_without_execution(),
        Err(PolicyError::ReservationResolved)
    ));
}

#[test]
fn captured_suspension_and_zero_cap_deny_only_new_postpaid() {
    let mut settings = BillingSettings {
        overage_enabled: true,
        overage_limit_cents: 500,
        ..Default::default()
    };
    assert_eq!(
        PostpaidAuthorization::from_settings(&settings).unwrap(),
        PostpaidAuthorization::Enabled { limit: money(500) }
    );
    settings.overage_suspended_at = Some(Utc::now());
    let mut auth = authorization(true);
    auth.postpaid = PostpaidAuthorization::from_settings(&settings).unwrap();
    assert_eq!(auth.postpaid, PostpaidAuthorization::Suspended);
    assert!(matches!(
        reserve(
            AiPricing::testing(),
            auth.clone(),
            AllocationSequence::from_raw(0),
            public_cents(100),
            availability(included_public_usage(AiPricing::testing()), ZERO_MONEY)
        ),
        Err(PolicyError::InsufficientFunding { .. })
    ));
    let prepaid = reserve(
        AiPricing::testing(),
        auth,
        AllocationSequence::from_raw(0),
        public_cents(100),
        availability(included_public_usage(AiPricing::testing()), money(105)),
    )
    .unwrap();
    assert_eq!(prepaid.holds().prepaid, money(105));
    settings.overage_suspended_at = None;
    for cap in [0, -1] {
        settings.overage_limit_cents = cap;
        assert_eq!(
            PostpaidAuthorization::from_settings(&settings).unwrap(),
            PostpaidAuthorization::Disabled
        );
    }
    settings.overage_limit_cents = 500;
    settings.overage_enabled = false;
    assert_eq!(
        PostpaidAuthorization::from_settings(&settings).unwrap(),
        PostpaidAuthorization::Disabled
    );
}

#[test]
fn collection_cadence_remainders_and_restore_preserve_existing_thresholds() {
    for (cents, open, ended) in [
        (0, CollectionPlan::Wait, CollectionPlan::Wait),
        (
            49,
            CollectionPlan::Wait,
            CollectionPlan::Forgive { cents: 49 },
        ),
        (
            50,
            CollectionPlan::Wait,
            CollectionPlan::Collect { cents: 50 },
        ),
        (
            999,
            CollectionPlan::Wait,
            CollectionPlan::Collect { cents: 999 },
        ),
        (
            1_000,
            CollectionPlan::Collect { cents: 1_000 },
            CollectionPlan::Collect { cents: 1_000 },
        ),
    ] {
        let mut collection = CumulativeCollection::restore(money(cents), 0).unwrap();
        assert_eq!(collection.plan(false).unwrap(), open);
        assert_eq!(collection.plan(true).unwrap(), ended);
        collection.book(cents).unwrap();
        assert_eq!(collection.plan(true).unwrap(), CollectionPlan::Wait);
        assert_eq!(
            CumulativeCollection::restore(collection.exact_total(), collection.booked_cents())
                .unwrap(),
            collection
        );
    }
    assert!(CumulativeCollection::restore(ZERO_MONEY, 1).is_err());
}

#[test]
fn checked_arithmetic_fails_without_partial_allocation_or_collection() {
    assert!(matches!(
        AllocationSequence::from_raw(u64::MAX).next(),
        Err(PolicyError::SequenceOverflow)
    ));
    assert!(matches!(
        reserve(
            AiPricing::testing(),
            authorization(true),
            AllocationSequence::from_raw(0),
            ZERO_PUBLIC,
            availability(ZERO_PUBLIC, ZERO_MONEY)
        ),
        Err(PolicyError::EmptyBudget)
    ));
    let mut reservation = reserve(
        AiPricing::testing(),
        authorization(true),
        AllocationSequence::from_raw(0),
        public_cents(1),
        availability(included_public_usage(AiPricing::testing()), ZERO_MONEY),
    )
    .unwrap();
    assert!(matches!(
        reservation.allocate(
            position(0, included_public_usage(AiPricing::testing())),
            PublicUsage::from_units(u64::MAX)
        ),
        Err(PolicyError::Arithmetic(_))
    ));
    assert_eq!(reservation.state(), ReservationState::Held);
    assert!(matches!(
        extra_price(AiPricing::testing(), PublicUsage::from_units(u64::MAX)),
        Err(PolicyError::Arithmetic(_))
    ));
    let mut collection =
        CumulativeCollection::restore(CustomerMoney::from_units(u64::MAX), 0).unwrap();
    assert!(collection.accrue(CustomerMoney::from_units(1)).is_err());
    assert_eq!(collection.exact_total().units(), u64::MAX);
    // Measured zero is allocated, not silently treated as non-execution.
    let zero = reservation
        .allocate(
            position(0, included_public_usage(AiPricing::testing())),
            ZERO_PUBLIC,
        )
        .unwrap();
    assert_eq!(zero.extra_money().unwrap(), ZERO_MONEY);
    assert_eq!(reservation.state(), ReservationState::Consumed);
    assert_eq!(reservation.released_holds().unwrap(), reservation.holds());
}

#[test]
fn unequal_seats_do_not_pool_allowance() {
    let heavy = allocate_call(ZERO_PUBLIC, public_cents(3_000), ZERO_MONEY, true);
    let light = allocate_call(ZERO_PUBLIC, public_cents(1_000), ZERO_MONEY, true);
    assert_eq!(heavy.postpaid, money(1_050));
    assert_eq!(light.postpaid, ZERO_MONEY);
    assert_eq!(light.included_public, public_cents(1_000));
}

#[test]
fn request_and_collection_partitioning_cannot_increase_charges() {
    let total = public_cents(3_003);
    let credits = CustomerMoney::from_units(money(1_000).units() + 17);
    let unsplit = allocate_call(ZERO_PUBLIC, total, credits, true);
    for partitions in [1, 2, 3, 7, 101, 1_003] {
        let mut used = ZERO_PUBLIC;
        let mut remaining_credit = credits;
        let mut collection = CumulativeCollection::new();
        let mut prepaid = ZERO_MONEY;
        let mut charged = 0;
        for index in 0..partitions {
            let units = total.units() / partitions + u64::from(index < total.units() % partitions);
            let usage = PublicUsage::from_units(units);
            let allocation = allocate_call(used, usage, remaining_credit, true);
            used = used.checked_add(usage).unwrap();
            remaining_credit = remaining_credit.checked_sub(allocation.prepaid).unwrap();
            prepaid = prepaid.checked_add(allocation.prepaid).unwrap();
            collection.accrue(allocation.postpaid).unwrap();
            let delta = collection.unbooked_cents().unwrap();
            collection.book(delta).unwrap();
            charged += delta;
        }
        assert_eq!(prepaid, unsplit.prepaid);
        assert_eq!(collection.exact_total(), unsplit.postpaid);
        assert_eq!(charged, round_half_up(unsplit.postpaid));
        assert_eq!(collection.unbooked_cents().unwrap(), 0);
        assert_eq!(collection.remainder(), unsplit.postpaid.split_cents());
    }
}

#[test]
fn rounding_is_cumulative_half_up_with_signed_carry_preserved() {
    let half = CustomerMoney::UNITS_PER_CENT / 2;
    assert_eq!(round_half_up(CustomerMoney::from_units(half - 1)), 0);
    assert_eq!(round_half_up(CustomerMoney::from_units(half)), 1);
    assert_eq!(round_half_up(CustomerMoney::from_units(half + 1)), 1);
    let mut collection = CumulativeCollection::new();
    for index in 1..=10 {
        collection.accrue(CustomerMoney::from_units(half)).unwrap();
        let delta = collection.unbooked_cents().unwrap();
        assert_eq!(delta, index % 2);
        collection.book(delta).unwrap();
    }
    assert_eq!(collection.booked_cents(), 5);
    assert!(collection.book(1).is_err());
}

#[test]
fn legacy_free_enterprise_and_exempt_features_keep_their_paths() {
    let user = MacroUserIdStr::try_from("macro|seat@example.com").unwrap();
    let mut entitlement = Entitlement::personal(user, PlanTier::Premium);
    assert_eq!(
        accounting_route(UsagePolicy::Legacy, AiFeature::Chat, &entitlement),
        AccountingRoute::Legacy
    );
    assert_eq!(
        accounting_route(
            UsagePolicy::PublicAllowanceV1,
            AiFeature::Chat,
            &entitlement
        ),
        AccountingRoute::PublicAllowanceV1
    );
    for feature in NON_BILLABLE_AI_FEATURES {
        assert_eq!(
            accounting_route(UsagePolicy::PublicAllowanceV1, feature, &entitlement),
            AccountingRoute::ExemptFeature
        );
    }
    entitlement.tier = PlanTier::Free;
    assert_eq!(
        accounting_route(
            UsagePolicy::PublicAllowanceV1,
            AiFeature::Chat,
            &entitlement
        ),
        AccountingRoute::Unmetered
    );
    entitlement.tier = PlanTier::Max;
    entitlement.unlimited = true;
    assert_eq!(
        accounting_route(
            UsagePolicy::PublicAllowanceV1,
            AiFeature::Chat,
            &entitlement
        ),
        AccountingRoute::Unmetered
    );
    assert_eq!(PlanTier::Premium.monthly_price_cents(), 4_000);
    // Both accounting paths read the same configured Premium allowance.
    let pricing = AiPricing::testing();
    let allowance = pricing.included_allowance_cents();
    assert_eq!(
        PlanTier::Premium.included_ai_cents_per_seat(pricing),
        allowance
    );
    assert_eq!(
        PlanTier::Max.included_ai_cents_per_seat(pricing),
        pricing.included_allowance_cents_for(PlanTier::Max)
    );
    assert_eq!(
        included_public_usage(pricing),
        public_cents(allowance as u64)
    );
    let mut auth = authorization(true);
    auth.policy = UsagePolicy::Legacy;
    assert!(matches!(
        reserve(
            AiPricing::testing(),
            auth,
            AllocationSequence::from_raw(0),
            public_cents(100),
            availability(ZERO_PUBLIC, ZERO_MONEY)
        ),
        Err(PolicyError::WrongPolicy)
    ));
}
