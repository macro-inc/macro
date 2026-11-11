use super::*;
use crate::outbound::customer_repo::test::{
    form, item, mount, repo, subscription, subscription_update,
};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use serde_json::json;
use std::str::FromStr;
use wiremock::MockServer;

fn items_page(data: Vec<stripe::SubscriptionItem>) -> stripe::List<stripe::SubscriptionItem> {
    stripe::List {
        data,
        has_more: false,
        total_count: None,
        url: "/v1/subscription_items".into(),
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_computer_item_bills_its_own_price_with_the_computer_id(pool: sqlx::PgPool) {
    let server = MockServer::start().await;
    let sub = subscription();
    mount(&server, "GET", "/v1/subscriptions/sub_team", &sub, 1).await;
    mount(&server, "POST", "/v1/subscriptions/sub_team", &sub, 1).await;

    repo(&server, pool)
        .add_computer_item(
            &sub.id,
            &stripe::PriceId::from_str("price_c1").unwrap(),
            "computer-1",
            vec![ItemQuantityChange {
                price_id: stripe::PriceId::from_str("price_pro").unwrap(),
                delta: 1,
            }],
            ItemProration::InvoiceNow,
            "computer-add:computer-1",
        )
        .await
        .unwrap();

    let requests = server.received_requests().await.unwrap();
    let updates = subscription_update(&requests);
    assert_eq!(updates.len(), 1);
    assert_eq!(
        form(updates[0]),
        HashMap::from([
            ("items[0][price]".to_string(), "price_c1".to_string()),
            ("items[0][quantity]".to_string(), "1".to_string()),
            (
                "items[0][metadata][computer_id]".to_string(),
                "computer-1".to_string()
            ),
            ("items[1][id]".to_string(), "si_pro".to_string()),
            ("items[1][quantity]".to_string(), "3".to_string()),
            (
                "proration_behavior".to_string(),
                "always_invoice".to_string()
            ),
            (
                "payment_behavior".to_string(),
                "error_if_incomplete".to_string()
            ),
            (
                "metadata[macro_item_change]".to_string(),
                "computer-add:computer-1".to_string()
            ),
        ])
    );
    assert_eq!(
        updates[0].headers.get("Idempotency-Key").unwrap(),
        "computer-add:computer-1"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_computer_price_copies_the_catalog_price_with_the_computer_id(pool: sqlx::PgPool) {
    let server = MockServer::start().await;
    let base = stripe::Price {
        id: "price_standard".parse().unwrap(),
        currency: Some(stripe::Currency::USD),
        product: Some(stripe::Expandable::Id("prod_computer".parse().unwrap())),
        unit_amount: Some(4900),
        nickname: Some("Standard computer".to_owned()),
        recurring: Some(stripe::Recurring {
            interval: stripe::RecurringInterval::Month,
            interval_count: 1,
            ..Default::default()
        }),
        ..Default::default()
    };
    let created = stripe::Price {
        id: "price_c1".parse().unwrap(),
        ..base.clone()
    };
    mount(&server, "GET", "/v1/prices/price_standard", &base, 1).await;
    mount(&server, "POST", "/v1/prices", &created, 1).await;

    let price = repo(&server, pool)
        .create_computer_price(
            &stripe::PriceId::from_str("price_standard").unwrap(),
            "computer-1",
            "computer-price:computer-1",
        )
        .await
        .unwrap();

    assert_eq!(price.as_str(), "price_c1");
    let requests = server.received_requests().await.unwrap();
    let post = requests
        .iter()
        .find(|request| request.method.as_str() == "POST")
        .unwrap();
    assert_eq!(
        form(post),
        HashMap::from([
            ("currency".to_string(), "usd".to_string()),
            ("product".to_string(), "prod_computer".to_string()),
            ("unit_amount".to_string(), "4900".to_string()),
            ("recurring[interval]".to_string(), "month".to_string()),
            ("recurring[interval_count]".to_string(), "1".to_string()),
            ("nickname".to_string(), "Standard computer".to_string()),
            (
                "metadata[computer_id]".to_string(),
                "computer-1".to_string()
            ),
        ])
    );
    assert_eq!(
        post.headers.get("Idempotency-Key").unwrap(),
        "computer-price:computer-1"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn removing_a_computer_item_deletes_it_without_proration(pool: sqlx::PgPool) {
    let server = MockServer::start().await;
    let mut sub = subscription();
    sub.items.data.push(item("si_c1", "price_c1", 1));
    mount(&server, "GET", "/v1/subscriptions/sub_team", &sub, 1).await;
    mount(&server, "POST", "/v1/subscriptions/sub_team", &sub, 1).await;
    mount(
        &server,
        "GET",
        "/v1/subscription_items",
        &items_page(sub.items.data.clone()),
        1,
    )
    .await;

    let removal = repo(&server, pool)
        .remove_subscription_item(&sub.id, &"si_c1".parse().unwrap(), "computer-remove:7")
        .await
        .unwrap();

    assert_eq!(removal, ItemRemoval::Removed);
    let requests = server.received_requests().await.unwrap();
    let update = form(subscription_update(&requests)[0]);
    assert_eq!(update["items[0][id]"], "si_c1");
    assert_eq!(update["items[0][deleted]"], "true");
    assert_eq!(update["proration_behavior"], "none");
}

/// Edge case (e): an item, or a whole subscription, that is already gone
/// counts as removed instead of failing forever.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn removing_an_item_that_is_already_gone_succeeds_without_an_update(pool: sqlx::PgPool) {
    let server = MockServer::start().await;
    let sub = subscription();
    mount(&server, "GET", "/v1/subscriptions/sub_team", &sub, 1).await;
    mount(
        &server,
        "GET",
        "/v1/subscription_items",
        &items_page(sub.items.data.clone()),
        1,
    )
    .await;
    let repo = repo(&server, pool);

    let removal = repo
        .remove_subscription_item(&sub.id, &"si_gone".parse().unwrap(), "computer-remove:8")
        .await
        .unwrap();
    assert_eq!(removal, ItemRemoval::AlreadyGone);

    let ended_server = MockServer::start().await;
    let mut ended = subscription();
    ended.status = stripe::SubscriptionStatus::Canceled;
    mount(
        &ended_server,
        "GET",
        "/v1/subscriptions/sub_team",
        &ended,
        1,
    )
    .await;
    let ended_repo = CustomerRepositoryImpl {
        client: Arc::new(stripe::Client::from_url(
            ended_server.uri().as_str(),
            "sk_test",
        )),
        ..repo.clone()
    };
    assert_eq!(
        ended_repo
            .remove_subscription_item(&sub.id, &"si_max".parse().unwrap(), "computer-remove:9")
            .await
            .unwrap(),
        ItemRemoval::AlreadyGone
    );

    let requests = server.received_requests().await.unwrap();
    assert!(subscription_update(&requests).is_empty());
    let requests = ended_server.received_requests().await.unwrap();
    assert!(subscription_update(&requests).is_empty());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn subscription_items_name_their_computer_from_item_or_price_metadata(pool: sqlx::PgPool) {
    let server = MockServer::start().await;
    let mut tagged = item("si_c1", "price_c1", 1);
    tagged.metadata = Some(HashMap::from([(
        COMPUTER_ID_KEY.to_owned(),
        "computer-1".to_owned(),
    )]));
    let mut priced = item("si_c2", "price_c2", 1);
    if let Some(price) = priced.price.as_mut() {
        price.metadata = Some(HashMap::from([(
            COMPUTER_ID_KEY.to_owned(),
            "computer-2".to_owned(),
        )]));
    }
    mount(
        &server,
        "GET",
        "/v1/subscription_items",
        &items_page(vec![tagged, priced, item("si_pro", "price_pro", 2)]),
        1,
    )
    .await;

    let items = repo(&server, pool)
        .subscription_items(&"sub_team".parse().unwrap())
        .await
        .unwrap();

    assert_eq!(
        items
            .iter()
            .map(|item| (item.id.as_str(), item.computer_id.as_deref()))
            .collect::<Vec<_>>(),
        vec![
            ("si_c1", Some("computer-1")),
            ("si_c2", Some("computer-2")),
            ("si_pro", None),
        ]
    );
}

/// A change whose outcome stayed unknown is applied when its marker landed,
/// and abandoned otherwise, so no later replay can charge it.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn settling_an_unknown_change_abandons_it_unless_its_marker_landed(pool: sqlx::PgPool) {
    let server = MockServer::start().await;
    let mut sub = subscription();
    sub.metadata
        .insert(ITEM_CHANGE_KEY.to_owned(), "computer-add:landed".to_owned());
    mount(&server, "GET", "/v1/subscriptions/sub_team", &sub, 1).await;
    let repo = repo(&server, pool.clone());
    // One pending change per subscription at a time, as in production.
    for (key, expected) in [
        ("computer-add:landed", ItemChangeSettlement::Applied),
        ("computer-add:lost", ItemChangeSettlement::NotApplied),
    ] {
        sqlx::query!(
            "INSERT INTO subscription_item_change (idempotency_key, subscription_id, path, request) VALUES ($1, 'sub_team', '/subscriptions/sub_team', $2)",
            key,
            json!({"items": [{"price": "price_c1", "quantity": 1}], "metadata": {"macro_item_change": key}}),
        )
        .execute(&pool)
        .await
        .unwrap();
        assert_eq!(
            repo.settle_item_change(key).await.unwrap(),
            expected,
            "{key}"
        );
    }
    assert_eq!(
        repo.settle_item_change("computer-add:never-sent")
            .await
            .unwrap(),
        ItemChangeSettlement::NotApplied
    );

    assert!(matches!(
        repo.replay_item_change("computer-add:lost").await,
        Err(CustomerError::ItemChangeAbandoned)
    ));
    let requests = server.received_requests().await.unwrap();
    assert!(subscription_update(&requests).is_empty());
}
