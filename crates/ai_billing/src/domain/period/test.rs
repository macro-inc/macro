use super::*;
use chrono::Duration;

#[test]
fn billing_identities_and_rollout_configuration_are_validated() {
    for id in [
        "",
        "price_",
        "price_with space",
        "unexpected_id",
        "sub_bad\n",
    ] {
        assert!(id.parse::<BillingIdentity>().is_err());
        assert!(serde_json::from_value::<BillingIdentity>(serde_json::json!(id)).is_err());
    }
    let mut invalid = rollout();
    invalid.price_id = "prod_not_a_price".parse().unwrap();
    assert!(invalid.validate().is_err());
}

struct Bindings(Option<Vec<MacroUserIdStr<'static>>>);

impl PeriodBindingSource for Bindings {
    async fn seats(
        &self,
        _: &MacroUserIdStr<'_>,
        _: &SubscriptionPeriod,
    ) -> Result<Option<Vec<MacroUserIdStr<'static>>>> {
        Ok(self.0.clone())
    }
}

#[derive(Clone, Default)]
struct Observations(std::sync::Arc<std::sync::Mutex<Vec<(SeatPeriodObservation, bool)>>>);

impl PeriodRepo for Observations {
    async fn observe(
        &self,
        _: &UsageRollout,
        observation: SeatPeriodObservation,
        verified: bool,
    ) -> Result<PeriodDecision> {
        self.0.lock().unwrap().push((observation, verified));
        Ok(PeriodDecision::Exception(
            ActivationException::AmbiguousBinding,
        ))
    }
}

#[tokio::test]
async fn unresolved_bindings_are_quarantined_without_inventing_seats() {
    let payer = MacroUserIdStr::try_from("macro|payer@example.com".to_owned()).unwrap();
    for bindings in [None, Some(vec![])] {
        let repo = Observations::default();
        let service = PeriodService::new(Bindings(bindings), repo.clone(), rollout()).unwrap();
        service.sync(payer.clone(), baseline()).await.unwrap();
        let observations = repo.0.lock().unwrap();
        assert_eq!(observations.len(), 1);
        assert!(!observations[0].1);
        assert_eq!(observations[0].0.payer, payer);
    }
    let seat = MacroUserIdStr::try_from("macro|seat@example.com".to_owned()).unwrap();
    let repo = Observations::default();
    let service =
        PeriodService::new(Bindings(Some(vec![seat.clone()])), repo.clone(), rollout()).unwrap();
    service.sync(payer.clone(), baseline()).await.unwrap();
    let observations = repo.0.lock().unwrap();
    assert!(observations[0].1);
    assert_eq!(observations[0].0.seat, seat);
    assert_eq!(observations[0].0.payer, payer);
}

fn rollout() -> UsageRollout {
    UsageRollout {
        effective_at: DateTime::from_timestamp(1_800_000_000, 0).unwrap(),
        price_id: "price_40".parse().unwrap(),
        product_id: "prod_40".parse().unwrap(),
    }
}

fn baseline() -> SubscriptionPeriod {
    let at = rollout().effective_at;
    SubscriptionPeriod {
        event_id: "evt_baseline".parse().unwrap(),
        event_at: at,
        subscription_id: "sub_existing".parse().unwrap(),
        subscription_created_at: at - Duration::days(90),
        customer_id: "cus_payer".parse().unwrap(),
        team_id: None,
        quantity: 1,
        item_count: 1,
        item_id: "si_seat".parse().unwrap(),
        price_id: rollout().price_id,
        product_id: rollout().product_id,
        unit_amount: Some(4_000),
        currency: "usd".into(),
        monthly: true,
        activity: SubscriptionActivity::Active,
        period: BillingPeriod {
            start: at - Duration::days(10),
            end: at + Duration::days(20),
        },
        evidence: PeriodEvidence::Snapshot,
    }
}

fn renewal() -> SubscriptionPeriod {
    let mut facts = baseline();
    facts.event_id = "evt_renewal".parse().unwrap();
    facts.period.start = facts.period.end;
    facts.period.end += Duration::days(31);
    facts.event_at = facts.period.start;
    facts.evidence = PeriodEvidence::Renewal;
    facts
}

#[test]
fn existing_subscription_waits_for_verified_renewal() {
    let mut state = EligibilityState::default();
    assert_eq!(
        transition(&rollout(), &baseline(), &mut state),
        PeriodDecision::Legacy
    );
    let saved = state.clone();
    let mut ordinary = renewal();
    ordinary.evidence = PeriodEvidence::Snapshot;
    assert_eq!(
        transition(&rollout(), &ordinary, &mut state),
        PeriodDecision::Exception(ActivationException::UnverifiedRenewal)
    );
    assert_eq!(state, saved);
    assert_eq!(
        transition(&rollout(), &renewal(), &mut state),
        PeriodDecision::Activate
    );
    let activated = state.clone();
    assert_eq!(
        transition(&rollout(), &renewal(), &mut state),
        PeriodDecision::Activate
    );
    assert_eq!(state, activated);
    assert_eq!(
        transition(&rollout(), &baseline(), &mut state),
        PeriodDecision::Exception(ActivationException::Stale)
    );
    assert_eq!(state, activated);
}

#[test]
fn delayed_pre_rollout_events_cannot_establish_a_baseline() {
    let mut facts = baseline();
    facts.event_at -= Duration::seconds(1);
    let mut state = EligibilityState::default();
    assert_eq!(
        transition(&rollout(), &facts, &mut state),
        PeriodDecision::Exception(ActivationException::Delayed)
    );
    assert_eq!(state, EligibilityState::default());
    assert_eq!(
        transition(&rollout(), &renewal(), &mut state),
        PeriodDecision::Exception(ActivationException::MissingBaseline)
    );
}

#[test]
fn new_subscriptions_use_first_verified_period_not_an_update() {
    let mut facts = renewal();
    facts.subscription_created_at = facts.period.start;
    facts.evidence = PeriodEvidence::Initial;
    let mut state = EligibilityState::default();
    assert_eq!(
        transition(&rollout(), &facts, &mut state),
        PeriodDecision::Activate
    );
    assert_eq!(state.effective_start, Some(facts.period.start));
}

#[test]
fn role_only_unknown_custom_and_canceled_subscriptions_are_ineligible() {
    let mut cases = vec![baseline(); 7];
    cases[0].price_id = "price_custom".parse().unwrap();
    cases[1].product_id = "prod_other".parse().unwrap();
    cases[2].monthly = false;
    cases[3].unit_amount = None;
    cases[4].activity = SubscriptionActivity::Inactive;
    cases[5].unit_amount = Some(20_000);
    cases[6].currency = "eur".into();
    for facts in cases {
        let mut state = EligibilityState::default();
        assert_eq!(
            transition(&rollout(), &facts, &mut state),
            PeriodDecision::Exception(ActivationException::Ineligible)
        );
        assert_eq!(state, EligibilityState::default());
    }
}

#[test]
fn explicit_rollout_inventory_can_seed_the_next_renewal_before_launch() {
    let mut facts = baseline();
    facts.event_at -= Duration::days(1);
    facts.evidence = PeriodEvidence::RolloutBaseline;
    let mut state = EligibilityState::default();
    assert_eq!(
        transition(&rollout(), &facts, &mut state),
        PeriodDecision::Legacy
    );
    assert_eq!(
        transition(&rollout(), &renewal(), &mut state),
        PeriodDecision::Activate
    );
}

#[test]
fn trial_promotions_preserve_the_baseline_until_the_first_paid_renewal() {
    let mut facts = baseline();
    facts.activity = SubscriptionActivity::Trialing;
    let mut state = EligibilityState::default();
    assert_eq!(
        transition(&rollout(), &facts, &mut state),
        PeriodDecision::Legacy
    );
    let mut trial = renewal();
    trial.activity = SubscriptionActivity::Trialing;
    assert_eq!(
        transition(&rollout(), &trial, &mut state),
        PeriodDecision::Exception(ActivationException::Ineligible)
    );
    assert_eq!(
        transition(&rollout(), &renewal(), &mut state),
        PeriodDecision::Activate
    );
}

#[test]
fn legacy_use_prevents_retroactive_period_conversion() {
    assert_eq!(
        PeriodDecision::Activate.preserve_legacy(true),
        PeriodDecision::Exception(ActivationException::LegacyPeriodInUse)
    );
    assert_eq!(
        PeriodDecision::Legacy.preserve_legacy(true),
        PeriodDecision::Legacy
    );
    assert_eq!(
        PeriodDecision::Activate.preserve_legacy(false),
        PeriodDecision::Activate
    );
}

#[test]
fn event_outside_its_claimed_period_cannot_activate() {
    let mut facts = renewal();
    facts.subscription_created_at = facts.period.start;
    facts.event_at = facts.period.end;
    assert_eq!(
        transition(&rollout(), &facts, &mut EligibilityState::default()),
        PeriodDecision::Exception(ActivationException::Delayed)
    );
}

#[test]
fn cancellation_preserves_effective_policy_and_baseline() {
    let mut state = EligibilityState::default();
    transition(&rollout(), &baseline(), &mut state);
    transition(&rollout(), &renewal(), &mut state);
    let saved = state.clone();
    let mut canceled = renewal();
    canceled.activity = SubscriptionActivity::Inactive;
    assert_eq!(
        transition(&rollout(), &canceled, &mut state),
        PeriodDecision::Exception(ActivationException::Ineligible)
    );
    assert_eq!(saved, state);
}
