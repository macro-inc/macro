use std::str::FromStr;
use std::sync::{Arc, Mutex};

use teams::domain::model::{
    ItemChangeSettlement, ItemChangeStatus, PaymentTerms, PriceInfo, ProratedCharge,
    SubscriptionItemView, SubscriptionTerms,
};

use super::*;
use crate::domain::computer_billing::IntervalPrices;

/// One computer item add that reached the subscription.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Add {
    team_id: Uuid,
    computer_price: stripe::PriceId,
    computer_id: String,
    extra: Vec<ItemQuantityChange>,
    proration: ItemProration,
    key: String,
}

#[derive(Clone)]
struct FakeTeams {
    interval: BillingCadence,
    subscribed: bool,
    decline: bool,
    abandoned: bool,
    trialing: bool,
    items: Arc<Mutex<Vec<SubscriptionItemView>>>,
    prices: Arc<Mutex<Vec<(stripe::PriceId, String, String)>>>,
    adds: Arc<Mutex<Vec<Add>>>,
    removals: Arc<Mutex<Vec<(stripe::SubscriptionItemId, String)>>>,
    refunds: Arc<Mutex<Vec<(String, String)>>>,
    /// The purchase was paid from the team's credit balance: a credit note
    /// with no card refund.
    paid_from_balance: bool,
    /// Subscription and price reads, in order.
    reads: Arc<Mutex<Vec<&'static str>>>,
    /// The card the subscription charges.
    card: Option<teams::domain::model::PaymentCard>,
    /// The customer's credit balance.
    credit: i64,
}

impl FakeTeams {
    fn new(interval: BillingCadence) -> Self {
        Self {
            interval,
            subscribed: true,
            decline: false,
            abandoned: false,
            trialing: false,
            items: Arc::default(),
            prices: Arc::default(),
            adds: Arc::default(),
            removals: Arc::default(),
            refunds: Arc::default(),
            paid_from_balance: false,
            reads: Arc::default(),
            card: Some(teams::domain::model::PaymentCard {
                brand: teams::domain::model::CardBrand::Visa,
                last4: "4242".into(),
            }),
            credit: 0,
        }
    }
}

impl TeamSubscriptionItems for FakeTeams {
    async fn replay_subscription_item_change(
        &self,
        key: &str,
    ) -> Result<bool, TeamSubscriptionItemsError> {
        if self.abandoned {
            return Err(CustomerError::ItemChangeAbandoned.into());
        }
        Ok(self.adds.lock().unwrap().iter().any(|add| add.key == key))
    }

    async fn change_team_subscription_items(
        &self,
        _: &Uuid,
        _: Vec<ItemQuantityChange>,
        _: ItemProration,
        _: &str,
    ) -> Result<(), TeamSubscriptionItemsError> {
        unimplemented!("computers bill items of their own")
    }

    async fn create_computer_price(
        &self,
        base: &stripe::PriceId,
        computer_id: &str,
        idempotency_key: &str,
    ) -> Result<stripe::PriceId, TeamSubscriptionItemsError> {
        self.prices.lock().unwrap().push((
            base.clone(),
            computer_id.to_owned(),
            idempotency_key.to_owned(),
        ));
        Ok(stripe::PriceId::from_str(&format!("price_{computer_id}")).unwrap())
    }

    async fn add_team_computer_item(
        &self,
        team_id: &Uuid,
        computer_price: &stripe::PriceId,
        computer_id: &str,
        extra: Vec<ItemQuantityChange>,
        proration: ItemProration,
        idempotency_key: &str,
    ) -> Result<(), TeamSubscriptionItemsError> {
        if !self.subscribed {
            return Err(TeamSubscriptionItemsError::NoSubscription);
        }
        if self.decline {
            return Err(CustomerError::PaymentFailed.into());
        }
        self.items.lock().unwrap().push(SubscriptionItemView {
            id: format!("si_{computer_id}").parse().unwrap(),
            price_id: computer_price.clone(),
            quantity: 1,
            computer_id: Some(computer_id.to_owned()),
        });
        self.adds.lock().unwrap().push(Add {
            team_id: *team_id,
            computer_price: computer_price.clone(),
            computer_id: computer_id.to_owned(),
            extra,
            proration,
            key: idempotency_key.to_owned(),
        });
        Ok(())
    }

    async fn remove_team_subscription_item(
        &self,
        _: &Uuid,
        item_id: &stripe::SubscriptionItemId,
        idempotency_key: &str,
    ) -> Result<ItemRemoval, TeamSubscriptionItemsError> {
        let mut items = self.items.lock().unwrap();
        let before = items.len();
        items.retain(|item| &item.id != item_id);
        if items.len() == before {
            return Ok(ItemRemoval::AlreadyGone);
        }
        self.removals
            .lock()
            .unwrap()
            .push((item_id.clone(), idempotency_key.to_owned()));
        Ok(ItemRemoval::Removed)
    }

    async fn refund_computer_purchase(
        &self,
        _: &Uuid,
        computer_id: ComputerId,
        idempotency_key: &str,
    ) -> Result<Option<teams::domain::model::ComputerPurchaseCredit>, TeamSubscriptionItemsError>
    {
        if !self.subscribed {
            return Err(TeamSubscriptionItemsError::NoSubscription);
        }
        self.refunds
            .lock()
            .unwrap()
            .push((computer_id.to_string(), idempotency_key.to_owned()));
        Ok(Some(teams::domain::model::ComputerPurchaseCredit {
            credit_note: "cn_1".parse().unwrap(),
            refund: (!self.paid_from_balance).then(|| "re_1".parse().unwrap()),
        }))
    }

    async fn team_subscription_items(
        &self,
        _: &Uuid,
    ) -> Result<Vec<SubscriptionItemView>, TeamSubscriptionItemsError> {
        if !self.subscribed {
            return Err(TeamSubscriptionItemsError::NoSubscription);
        }
        Ok(self.items.lock().unwrap().clone())
    }

    async fn subscription_item_change_status(
        &self,
        idempotency_key: &str,
    ) -> Result<Option<ItemChangeStatus>, TeamSubscriptionItemsError> {
        Ok(self
            .adds
            .lock()
            .unwrap()
            .iter()
            .any(|add| add.key == idempotency_key)
            .then_some(ItemChangeStatus::Applied))
    }

    async fn settle_subscription_item_change(
        &self,
        _: &Uuid,
        idempotency_key: &str,
    ) -> Result<ItemChangeSettlement, TeamSubscriptionItemsError> {
        Ok(
            if self
                .adds
                .lock()
                .unwrap()
                .iter()
                .any(|add| add.key == idempotency_key)
            {
                ItemChangeSettlement::Applied
            } else {
                ItemChangeSettlement::NotApplied
            },
        )
    }

    async fn team_subscription_terms(
        &self,
        _: &Uuid,
    ) -> Result<SubscriptionTerms, TeamSubscriptionItemsError> {
        self.reads.lock().unwrap().push("subscription");
        if !self.subscribed {
            return Err(TeamSubscriptionItemsError::NoSubscription);
        }
        Ok(SubscriptionTerms {
            current_period_end: DateTime::from_timestamp(1_802_678_400, 0).unwrap(),
            interval: self.interval,
            currency: "usd".into(),
            trialing: self.trialing,
        })
    }

    async fn team_payment_terms(
        &self,
        team_id: &Uuid,
    ) -> Result<PaymentTerms, TeamSubscriptionItemsError> {
        let terms = self.team_subscription_terms(team_id).await?;
        Ok(PaymentTerms {
            terms,
            card: self.card.clone(),
            credit: self.credit,
        })
    }

    async fn preview_item_prorations(
        &self,
        _: &Uuid,
        prices: &[stripe::PriceId],
    ) -> Result<Vec<ProratedCharge>, TeamSubscriptionItemsError> {
        self.reads.lock().unwrap().push("preview");
        Ok(prices
            .iter()
            .map(|price_id| ProratedCharge {
                price_id: price_id.clone(),
                // A third of the period is left.
                amount: match price_id.as_str() {
                    "price_standard_month" => 667,
                    other => panic!("unexpected price {other}"),
                },
            })
            .collect())
    }

    async fn price(
        &self,
        price_id: &stripe::PriceId,
    ) -> Result<PriceInfo, TeamSubscriptionItemsError> {
        self.reads.lock().unwrap().push("price");
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

const COMPUTER: ComputerId = ComputerId::new_from_uuid(Uuid::from_u128(1));

fn prices() -> ComputerPrices {
    ComputerPrices {
        standard: IntervalPrices {
            monthly: Some(stripe::PriceId::from_str("price_standard_month").unwrap()),
            yearly: Some(stripe::PriceId::from_str("price_standard_year").unwrap()),
        },
        large: IntervalPrices {
            monthly: Some(stripe::PriceId::from_str("price_large_month").unwrap()),
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
            price_id: stripe::PriceId::from_str("price_standard_year").unwrap(),
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
async fn a_computer_bills_its_own_price_with_its_extra_items_in_one_change() {
    let teams = FakeTeams::new(BillingCadence::Month);
    let billing = TeamComputerBilling::new(teams.clone(), prices());
    let team_id = Uuid::now_v7();

    let item = billing
        .add_computer(
            team_id,
            COMPUTER,
            &stripe::PriceId::from_str("price_standard_month").unwrap(),
            &[SubscriptionItem {
                price_id: stripe::PriceId::from_str("price_pro").unwrap(),
                quantity: 2,
            }],
            ItemCharge::Prorated,
            "computer-add:1",
        )
        .await
        .unwrap();

    let computer_id = COMPUTER.to_string();
    assert_eq!(item.as_str(), format!("si_{computer_id}"));
    assert_eq!(
        *teams.prices.lock().unwrap(),
        vec![(
            stripe::PriceId::from_str("price_standard_month").unwrap(),
            computer_id.clone(),
            "computer-add:1:price".to_owned(),
        )]
    );
    assert_eq!(
        *teams.adds.lock().unwrap(),
        vec![Add {
            team_id,
            computer_price: stripe::PriceId::from_str(&format!("price_{computer_id}")).unwrap(),
            computer_id,
            extra: vec![ItemQuantityChange {
                price_id: stripe::PriceId::from_str("price_pro").unwrap(),
                delta: 2,
            }],
            proration: ItemProration::InvoiceNow,
            key: "computer-add:1".to_owned(),
        }]
    );

    billing
        .remove_computer(team_id, &item, "computer-remove:1")
        .await
        .unwrap();
    assert_eq!(
        *teams.removals.lock().unwrap(),
        vec![(item, "computer-remove:1".to_owned())]
    );
}

/// Edge case (e), adapter side: an item already gone counts as removed.
#[tokio::test]
async fn removing_an_item_already_gone_succeeds() {
    let teams = FakeTeams::new(BillingCadence::Month);
    let billing = TeamComputerBilling::new(teams.clone(), prices());

    billing
        .remove_computer(
            Uuid::nil(),
            &"si_gone".parse().unwrap(),
            "computer-remove:2",
        )
        .await
        .unwrap();

    assert!(teams.removals.lock().unwrap().is_empty());
}

#[tokio::test]
async fn declines_abandoned_changes_and_missing_subscriptions_keep_their_meaning() {
    let mut declined = FakeTeams::new(BillingCadence::Month);
    declined.decline = true;
    let result = TeamComputerBilling::new(declined, prices())
        .add_computer(
            Uuid::nil(),
            COMPUTER,
            &stripe::PriceId::from_str("price_standard_month").unwrap(),
            &[],
            ItemCharge::Prorated,
            "computer-add:2",
        )
        .await;
    assert!(
        matches!(result, Err(BillingError::PaymentFailed)),
        "{result:?}"
    );

    let mut abandoned = FakeTeams::new(BillingCadence::Month);
    abandoned.abandoned = true;
    let result = TeamComputerBilling::new(abandoned, prices())
        .add_computer(
            Uuid::nil(),
            COMPUTER,
            &stripe::PriceId::from_str("price_standard_month").unwrap(),
            &[],
            ItemCharge::Prorated,
            "computer-add:3",
        )
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
async fn a_replayed_purchase_creates_no_second_price_or_item() {
    let team_id = Uuid::nil();
    let teams = FakeTeams::new(BillingCadence::Month);
    let billing = TeamComputerBilling::new(teams.clone(), prices());
    let first = billing
        .add_computer(
            team_id,
            COMPUTER,
            &stripe::PriceId::from_str("price_standard_month").unwrap(),
            &[],
            ItemCharge::Prorated,
            "computer-add:confirmed",
        )
        .await
        .unwrap();

    let again = billing
        .add_computer(
            team_id,
            COMPUTER,
            &stripe::PriceId::from_str("price_standard_month").unwrap(),
            &[],
            ItemCharge::Prorated,
            "computer-add:confirmed",
        )
        .await
        .unwrap();

    assert_eq!(again, first);
    assert_eq!(teams.prices.lock().unwrap().len(), 1);
    assert_eq!(teams.adds.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn settling_returns_the_computers_item_only_if_the_subscription_has_one() {
    let teams = FakeTeams::new(BillingCadence::Month);
    let billing = TeamComputerBilling::new(teams.clone(), prices());
    assert_eq!(
        billing
            .settle_computer_add(Uuid::nil(), COMPUTER, "computer-add:never")
            .await
            .unwrap(),
        None
    );
    let item = billing
        .add_computer(
            Uuid::nil(),
            COMPUTER,
            &stripe::PriceId::from_str("price_standard_month").unwrap(),
            &[],
            ItemCharge::Prorated,
            "computer-add:landed",
        )
        .await
        .unwrap();
    assert_eq!(
        billing
            .settle_computer_add(Uuid::nil(), COMPUTER, "computer-add:landed")
            .await
            .unwrap(),
        Some(item)
    );
}

#[tokio::test]
async fn no_prices_rejects_sales_before_contacting_the_subscription_provider() {
    let mut teams = FakeTeams::new(BillingCadence::Month);
    teams.subscribed = false;
    let mut unavailable = prices();
    for interval in [
        &mut unavailable.standard,
        &mut unavailable.large,
        &mut unavailable.xl,
    ] {
        interval.monthly = None;
        interval.yearly = None;
    }
    let billing = TeamComputerBilling::new(teams, unavailable);
    for size in ComputerSize::ALL {
        assert!(matches!(
            billing.quote(Uuid::nil(), size).await,
            Err(BillingError::NotAvailable)
        ));
    }
}

#[tokio::test]
async fn a_purchase_price_reads_the_subscription_once_and_no_price() {
    let teams = FakeTeams::new(BillingCadence::Month);
    let billing = TeamComputerBilling::new(teams.clone(), prices());

    assert_eq!(
        billing
            .purchase_price(Uuid::nil(), ComputerSize::Standard)
            .await
            .unwrap(),
        stripe::PriceId::from_str("price_standard_month").unwrap()
    );
    assert_eq!(*teams.reads.lock().unwrap(), vec!["subscription"]);

    let trialing = TeamComputerBilling::new(
        FakeTeams {
            trialing: true,
            ..FakeTeams::new(BillingCadence::Month)
        },
        prices(),
    );
    assert!(matches!(
        trialing
            .purchase_price(Uuid::nil(), ComputerSize::Standard)
            .await,
        Err(BillingError::TeamOnTrial)
    ));
    assert!(matches!(
        billing.purchase_price(Uuid::nil(), ComputerSize::Xl).await,
        Err(BillingError::IntervalNotSold(BillingInterval::Month))
    ));
}

#[tokio::test]
async fn a_trialing_team_is_refused_computers() {
    let billing = TeamComputerBilling::new(
        FakeTeams {
            trialing: true,
            ..FakeTeams::new(BillingCadence::Month)
        },
        prices(),
    );
    assert!(matches!(
        billing.require_paid_plan(Uuid::nil()).await,
        Err(BillingError::TeamOnTrial)
    ));
    assert!(
        TeamComputerBilling::new(FakeTeams::new(BillingCadence::Month), prices())
            .require_paid_plan(Uuid::nil())
            .await
            .is_ok()
    );
}

#[tokio::test]
async fn a_purchase_refund_records_its_credit_note_and_card_refund() {
    let teams = FakeTeams::new(BillingCadence::Month);
    let billing = TeamComputerBilling::new(teams.clone(), prices());
    let computer_id = ComputerId::new_from_uuid(Uuid::from_u128(7));

    let refund = billing
        .refund_computer_purchase(Uuid::nil(), computer_id, "computer-refund:7")
        .await
        .unwrap();

    assert_eq!(
        refund,
        Some(hosted_runtimes::domain::lifecycle::PurchaseRefund {
            credit_note: "cn_1".parse().unwrap(),
            refund: Some("re_1".parse().unwrap()),
        })
    );
    assert_eq!(
        *teams.refunds.lock().unwrap(),
        vec![(computer_id.to_string(), "computer-refund:7".to_owned())]
    );
}

#[tokio::test]
async fn refunding_a_team_with_no_subscription_is_typed() {
    let teams = FakeTeams {
        subscribed: false,
        ..FakeTeams::new(BillingCadence::Month)
    };

    let refused = TeamComputerBilling::new(teams, prices())
        .refund_computer_purchase(
            Uuid::nil(),
            ComputerId::new_from_uuid(Uuid::from_u128(7)),
            "computer-refund:7",
        )
        .await;

    assert!(matches!(refused, Err(BillingError::NoSubscription)));
}

#[test]
fn a_change_still_in_flight_is_its_own_billing_error() {
    assert!(matches!(
        billing_error(TeamSubscriptionItemsError::Customer(
            CustomerError::ItemChangeInFlight
        )),
        BillingError::ChangeInFlight
    ));
}

#[tokio::test]
async fn purchase_terms_read_the_subscription_once_and_preview_once() {
    let teams = FakeTeams::new(BillingCadence::Month);
    let billing = TeamComputerBilling::new(teams.clone(), prices());

    assert_eq!(
        billing
            .purchase_terms(
                Uuid::nil(),
                &[ComputerSize::Standard],
                &PurchaseBilling::Stripe
            )
            .await
            .unwrap(),
        PurchaseTerms {
            quotes: vec![PurchaseQuote {
                quote: Quote {
                    size: ComputerSize::Standard,
                    price_id: stripe::PriceId::from_str("price_standard_month").unwrap(),
                    amount: 2000,
                    currency: "usd".into(),
                    interval: BillingInterval::Month,
                },
                due_today: 667,
            }],
            renews_at: DateTime::from_timestamp(1_802_678_400, 0).unwrap(),
            card: Some(PaymentCard {
                brand: CardBrand::Visa,
                last4: "4242".into(),
            }),
        }
    );
    assert_eq!(
        *teams.reads.lock().unwrap(),
        vec!["subscription", "price", "preview"]
    );
}

#[tokio::test]
async fn comped_purchase_terms_preview_nothing_and_charge_nothing_today() {
    let teams = FakeTeams {
        trialing: true,
        ..FakeTeams::new(BillingCadence::Month)
    };
    let billing = TeamComputerBilling::new(teams.clone(), prices());

    let terms = billing
        .purchase_terms(
            Uuid::nil(),
            &[ComputerSize::Standard],
            &PurchaseBilling::Comped {
                reason: "internal team".into(),
            },
        )
        .await
        .unwrap();

    assert_eq!(terms.quotes[0].due_today, 0);
    assert_eq!(terms.card, None);
    assert_eq!(*teams.reads.lock().unwrap(), vec!["subscription", "price"]);
}

#[tokio::test]
async fn a_trialing_team_paying_by_stripe_gets_no_purchase_terms() {
    let teams = FakeTeams {
        trialing: true,
        ..FakeTeams::new(BillingCadence::Month)
    };
    let billing = TeamComputerBilling::new(teams.clone(), prices());

    assert!(matches!(
        billing
            .purchase_terms(
                Uuid::nil(),
                &[ComputerSize::Standard],
                &PurchaseBilling::Stripe
            )
            .await,
        Err(BillingError::TeamOnTrial)
    ));
    assert_eq!(*teams.reads.lock().unwrap(), vec!["subscription"]);
}

#[tokio::test]
async fn the_customers_credit_comes_off_what_a_purchase_charges_today() {
    for (credit, due_today) in [(500, 167), (667, 0), (5000, 0)] {
        let billing = TeamComputerBilling::new(
            FakeTeams {
                credit,
                ..FakeTeams::new(BillingCadence::Month)
            },
            prices(),
        );
        let terms = billing
            .purchase_terms(
                Uuid::nil(),
                &[ComputerSize::Standard],
                &PurchaseBilling::Stripe,
            )
            .await
            .unwrap();
        assert_eq!(terms.quotes[0].due_today, due_today, "credit {credit}");
    }
}
