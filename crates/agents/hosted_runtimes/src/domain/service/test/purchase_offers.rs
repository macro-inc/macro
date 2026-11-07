use super::*;
use crate::domain::models::{CardBrand, PaymentCard, PurchaseOffers, PurchaseSizeOffer};

struct TeamCompPolicy;

impl CompPolicy for TeamCompPolicy {
    type Err = std::convert::Infallible;

    async fn comp_reason(&self, team_id: Uuid) -> Result<Option<String>, Self::Err> {
        Ok((team_id == TEAM).then(|| "internal team".to_owned()))
    }
}

fn admin() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from("macro|admin@example.com".to_owned()).unwrap()
}

fn visa() -> PaymentCard {
    PaymentCard {
        brand: CardBrand::Visa,
        last4: "4242".into(),
    }
}

#[tokio::test]
async fn purchase_offers_say_what_each_size_charges_today_from_one_billing_read() {
    let service = ComputerService::new(
        FakeRepo {
            sold_units: 12,
            awake_units: Some(4),
            ..FakeRepo::default()
        },
        FakeBilling {
            card: Some(visa()),
            ..FakeBilling::default()
        },
        FixedClock,
        StaticFleetAttachment(FleetAttachment::Attached),
    )
    .with_rollout(rollout::enabled_rollout());

    let purchase_offers = service.purchase_offers(TEAM, admin()).await.unwrap();

    assert_eq!(
        *service.billing.calls.lock().unwrap(),
        vec!["purchase_terms"]
    );
    let offers = service.offers(TEAM, admin()).await.unwrap();
    assert_eq!(
        purchase_offers,
        PurchaseOffers {
            sizes: offers
                .into_iter()
                .map(|offer| PurchaseSizeOffer {
                    due_today: offer.quote.amount / 3,
                    offer,
                })
                .collect(),
            renews_at: DateTime::from_timestamp(1_802_678_400, 0).unwrap(),
            card: Some(visa()),
        }
    );
    assert_eq!(purchase_offers.sizes.len(), 3);
}

#[tokio::test]
async fn comped_purchase_offers_charge_nothing_today_or_later() {
    let service = ComputerService::new(
        FakeRepo {
            sold_units: 9,
            ..FakeRepo::default()
        },
        // The team has a card, but a comped purchase charges none.
        FakeBilling {
            card: Some(visa()),
            ..FakeBilling::default()
        },
        FixedClock,
        StaticFleetAttachment(FleetAttachment::Attached),
    )
    .with_comp_policy(TeamCompPolicy)
    .with_rollout(rollout::enabled_rollout());

    let offers = service.purchase_offers(TEAM, admin()).await.unwrap();

    assert!(!offers.sizes.is_empty());
    for size in &offers.sizes {
        assert_eq!((size.offer.quote.amount, size.due_today), (0, 0));
    }
    assert_eq!(offers.card, None);
}

#[tokio::test]
async fn purchase_offers_keep_the_offers_fields_and_add_their_own() {
    let service = ComputerService::new(
        FakeRepo {
            sold_units: 9,
            awake_units: Some(1),
            ..FakeRepo::default()
        },
        FakeBilling {
            card: Some(visa()),
            ..FakeBilling::default()
        },
        FixedClock,
        StaticFleetAttachment(FleetAttachment::Attached),
    )
    .with_rollout(rollout::enabled_rollout());

    let offers = service.offers(TEAM, admin()).await.unwrap();
    let purchase_offers = service.purchase_offers(TEAM, admin()).await.unwrap();

    let mut size = serde_json::to_value(&offers[0]).unwrap();
    size["dueToday"] = serde_json::json!(666);
    assert_eq!(
        serde_json::to_value(&purchase_offers).unwrap(),
        serde_json::json!({
            "sizes": [size],
            "renewsAt": "2027-02-15T08:00:00Z",
            "card": { "brand": "visa", "last4": "4242" },
        })
    );
}

#[tokio::test]
async fn purchase_offers_refuse_what_offers_refuse() {
    let service = ComputerService::new(
        FakeRepo {
            sold_units: 9,
            ..FakeRepo::default()
        },
        FakeBilling {
            no_subscription: true,
            ..FakeBilling::default()
        },
        FixedClock,
        StaticFleetAttachment(FleetAttachment::Attached),
    )
    .with_rollout(rollout::enabled_rollout());

    assert!(matches!(
        service.purchase_offers(TEAM, admin()).await,
        Err(ComputerError::Billing(BillingError::NoSubscription))
    ));
}
