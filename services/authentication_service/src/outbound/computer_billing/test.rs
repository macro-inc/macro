use std::sync::{Arc, Mutex};

use teams::domain::model::{PriceInfo, SubscriptionTerms};

use super::*;
use crate::domain::computer_billing::IntervalPrices;

type Change = (Uuid, Vec<ItemQuantityChange>, String);

#[derive(Clone)]
struct FakeTeams {
    interval: BillingCadence,
    subscribed: bool,
    decline: bool,
    changes: Arc<Mutex<Vec<Change>>>,
}

impl FakeTeams {
    fn new(interval: BillingCadence) -> Self {
        Self {
            interval,
            subscribed: true,
            decline: false,
            changes: Arc::default(),
        }
    }
}

impl TeamSubscriptionItems for FakeTeams {
    async fn replay_subscription_item_change(
        &self,
        key: &str,
    ) -> Result<bool, TeamSubscriptionItemsError> {
        Ok(self
            .changes
            .lock()
            .unwrap()
            .iter()
            .any(|(_, _, applied)| applied == key))
    }

    async fn change_team_subscription_items(
        &self,
        team_id: &Uuid,
        changes: Vec<ItemQuantityChange>,
        idempotency_key: &str,
    ) -> Result<(), TeamSubscriptionItemsError> {
        if !self.subscribed {
            return Err(TeamSubscriptionItemsError::NoSubscription);
        }
        if self.decline {
            return Err(CustomerError::PaymentFailed.into());
        }
        self.changes
            .lock()
            .unwrap()
            .push((*team_id, changes, idempotency_key.to_string()));
        Ok(())
    }

    async fn team_subscription_terms(
        &self,
        _: &Uuid,
    ) -> Result<SubscriptionTerms, TeamSubscriptionItemsError> {
        if !self.subscribed {
            return Err(TeamSubscriptionItemsError::NoSubscription);
        }
        Ok(SubscriptionTerms {
            current_period_end: DateTime::from_timestamp(1_802_678_400, 0).unwrap(),
            interval: self.interval,
            currency: "usd".into(),
        })
    }

    async fn price(
        &self,
        price_id: &stripe_price_id::StripePriceId,
    ) -> Result<PriceInfo, TeamSubscriptionItemsError> {
        let amount = match price_id.as_str() {
            "price_standard_month" => 2000,
            "price_standard_year" => 20000,
            other => panic!("unexpected price {other}"),
        };
        Ok(PriceInfo {
            amount,
            currency: "usd".into(),
            interval: Some(self.interval),
        })
    }
}

fn prices() -> ComputerPrices {
    ComputerPrices {
        standard: IntervalPrices {
            monthly: Some(stripe_price_id::StripePriceId::parse("price_standard_month").unwrap()),
            yearly: Some(stripe_price_id::StripePriceId::parse("price_standard_year").unwrap()),
        },
        large: IntervalPrices {
            monthly: Some(stripe_price_id::StripePriceId::parse("price_large_month").unwrap()),
            yearly: None,
        },
        xl: IntervalPrices {
            monthly: None,
            yearly: None,
        },
    }
}

#[tokio::test]
async fn a_quote_is_the_size_price_at_the_subscription_interval() {
    let billing = TeamComputerBilling::new(FakeTeams::new(BillingCadence::Year), prices());

    let quote = billing
        .quote(Uuid::nil(), ComputerSize::Standard)
        .await
        .unwrap();

    assert_eq!(
        quote,
        Quote {
            size: ComputerSize::Standard,
            price_id: StripePriceId::parse("price_standard_year").unwrap(),
            amount: 20000,
            currency: "usd".into(),
            interval: BillingInterval::Year,
        }
    );
}

#[tokio::test]
async fn a_size_without_a_price_at_the_interval_is_not_sold() {
    let billing = TeamComputerBilling::new(FakeTeams::new(BillingCadence::Year), prices());

    let result = billing.quote(Uuid::nil(), ComputerSize::Large).await;

    assert!(
        matches!(
            result,
            Err(BillingError::IntervalNotSold(BillingInterval::Year))
        ),
        "{result:?}"
    );
}

#[tokio::test]
async fn adding_a_computer_joins_its_item_and_the_extra_items_in_one_change() {
    let teams = FakeTeams::new(BillingCadence::Month);
    let billing = TeamComputerBilling::new(teams.clone(), prices());
    let team_id = Uuid::now_v7();

    billing
        .add_computer(
            team_id,
            ComputerSize::Standard,
            &[SubscriptionItem {
                price_id: StripePriceId::parse("price_pro").unwrap(),
                quantity: 2,
            }],
            "computer-1",
        )
        .await
        .unwrap();
    billing
        .remove_computer(team_id, ComputerSize::Standard, "computer-1-release")
        .await
        .unwrap();

    assert_eq!(
        *teams.changes.lock().unwrap(),
        vec![
            (
                team_id,
                vec![
                    ItemQuantityChange {
                        price_id: stripe_price_id::StripePriceId::parse("price_standard_month")
                            .unwrap(),
                        delta: 1,
                    },
                    ItemQuantityChange {
                        price_id: stripe_price_id::StripePriceId::parse("price_pro").unwrap(),
                        delta: 2,
                    },
                ],
                "computer-1".to_string(),
            ),
            (
                team_id,
                vec![ItemQuantityChange {
                    price_id: stripe_price_id::StripePriceId::parse("price_standard_month")
                        .unwrap(),
                    delta: -1,
                }],
                "computer-1-release".to_string(),
            ),
        ]
    );
}

#[tokio::test]
async fn declines_and_missing_subscriptions_keep_their_meaning() {
    let mut declined = FakeTeams::new(BillingCadence::Month);
    declined.decline = true;
    let result = TeamComputerBilling::new(declined, prices())
        .add_computer(Uuid::nil(), ComputerSize::Standard, &[], "computer-2")
        .await;
    assert!(
        matches!(result, Err(BillingError::PaymentFailed)),
        "{result:?}"
    );

    let mut unsubscribed = FakeTeams::new(BillingCadence::Month);
    unsubscribed.subscribed = false;
    let result = TeamComputerBilling::new(unsubscribed, prices())
        .period_end(Uuid::nil())
        .await;
    assert!(
        matches!(result, Err(BillingError::NoSubscription)),
        "{result:?}"
    );
}

#[tokio::test]
async fn a_successful_purchase_replays_before_subscription_or_price_lookup() {
    let team_id = Uuid::nil();
    let mut teams = FakeTeams::new(BillingCadence::Month);
    TeamComputerBilling::new(teams.clone(), prices())
        .add_computer(
            team_id,
            ComputerSize::Standard,
            &[],
            "computer-add:confirmed",
        )
        .await
        .unwrap();
    teams.subscribed = false;
    let mut unavailable_prices = prices();
    unavailable_prices.standard.monthly = None;
    let billing = TeamComputerBilling::new(teams.clone(), unavailable_prices);
    billing
        .add_computer(
            team_id,
            ComputerSize::Standard,
            &[],
            "computer-add:confirmed",
        )
        .await
        .unwrap();
    assert_eq!(teams.changes.lock().unwrap().len(), 1);
}
