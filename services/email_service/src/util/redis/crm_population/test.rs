use super::*;
use chrono::TimeZone;

#[expect(
    clippy::disallowed_methods,
    reason = "tests point at the Redis the developer runs, as label_write_sim does"
)]
fn client() -> RedisClient {
    let url = std::env::var("REDIS_URI").unwrap_or_else(|_| "redis://127.0.0.1:6379".to_string());
    RedisClient::new(redis::Client::open(url).unwrap(), 60)
}

/// A mailbox of its own, so tests never share entries.
fn mailbox() -> Uuid {
    Uuid::now_v7()
}

fn request(email: &str, at: i64, is_sent: bool, name: Option<&str>) -> PopulateCrmContactPayload {
    PopulateCrmContactPayload {
        live_mail: true,
        contact_email: email.into(),
        contact_name: name.map(str::to_owned),
        first_at: Utc.timestamp_opt(at, 0).unwrap(),
        last_at: Utc.timestamp_opt(at, 0).unwrap(),
        is_sent,
    }
}

/// Records `contacts`, each with a new claim: the claim when it took its
/// entry, `None` when a queued message absorbed it.
async fn record(
    redis: &RedisClient,
    link: Uuid,
    contacts: &[PopulateCrmContactPayload],
) -> anyhow::Result<Vec<Option<Uuid>>> {
    let requests: Vec<(Uuid, PopulateCrmContactPayload)> = contacts
        .iter()
        .map(|contact| (Uuid::now_v7(), contact.clone()))
        .collect();
    let held = redis.record_crm_population(link, &requests).await?;
    Ok(requests
        .into_iter()
        .zip(held)
        .map(|((claim, _), held)| held.then_some(claim))
        .collect())
}

fn claimed(claims: &[Option<Uuid>]) -> Uuid {
    claims[0].expect("claimed")
}

#[tokio::test]
async fn requests_for_a_queued_correspondent_merge_into_its_hints() {
    let redis = client();
    let link = mailbox();
    let first = request("buyer@example.com", 200, false, Some("Buyer"));

    let claims = record(&redis, link, std::slice::from_ref(&first))
        .await
        .unwrap();
    let claim = claimed(&claims);
    let absorbed = record(
        &redis,
        link,
        &[
            request("buyer@example.com", 100, true, None),
            request("buyer@example.com", 300, false, Some("Buyer B")),
        ],
    )
    .await
    .unwrap();

    assert_eq!(absorbed, [None, None]);
    assert_eq!(
        redis
            .take_crm_population(link, &first, claim)
            .await
            .unwrap(),
        PendingContact::Claimed(ContactHints {
            first_at: Utc.timestamp_opt(100, 0).unwrap(),
            last_at: Utc.timestamp_opt(300, 0).unwrap(),
            is_sent: true,
            name: Some("Buyer B".into()),
        })
    );
    assert_eq!(
        redis
            .take_crm_population(link, &first, Uuid::now_v7())
            .await
            .unwrap(),
        PendingContact::Superseded,
        "another claim does not own the entry"
    );
}

#[tokio::test]
async fn a_finished_run_clears_its_entry_so_the_next_request_sends_again() {
    let redis = client();
    let link = mailbox();
    let contact = request("buyer@example.com", 200, false, None);
    let claim = claimed(
        &record(&redis, link, std::slice::from_ref(&contact))
            .await
            .unwrap(),
    );

    redis
        .take_crm_population(link, &contact, claim)
        .await
        .unwrap();
    let settled = redis
        .settle_crm_population(link, &contact, claim, Uuid::now_v7())
        .await
        .unwrap();

    assert_eq!(settled, SettledContact::Cleared);
    assert_eq!(
        redis
            .take_crm_population(link, &contact, claim)
            .await
            .unwrap(),
        PendingContact::Missing
    );
    let again = record(&redis, link, &[contact]).await.unwrap();
    assert!(again[0].is_some(), "a new message is needed");
}

#[tokio::test]
async fn a_request_during_a_run_hands_the_entry_to_a_new_claim() {
    let redis = client();
    let link = mailbox();
    let contact = request("buyer@example.com", 200, false, None);
    let claim = claimed(
        &record(&redis, link, std::slice::from_ref(&contact))
            .await
            .unwrap(),
    );
    redis
        .take_crm_population(link, &contact, claim)
        .await
        .unwrap();

    let during = record(
        &redis,
        link,
        &[request("buyer@example.com", 500, true, None)],
    )
    .await
    .unwrap();
    assert_eq!(during, [None], "the running claim absorbs it");
    let next = Uuid::now_v7();
    let settled = redis
        .settle_crm_population(link, &contact, claim, next)
        .await
        .unwrap();

    let SettledContact::Handed(hints) = settled else {
        panic!("handed: {settled:?}")
    };
    assert_eq!(hints.last_at, Utc.timestamp_opt(500, 0).unwrap());
    assert!(hints.is_sent);
    assert!(matches!(
        redis
            .take_crm_population(link, &contact, next)
            .await
            .unwrap(),
        PendingContact::Claimed(_)
    ));

    // A hand-off whose message could not be sent goes back to the old claim.
    redis
        .restore_crm_population(link, &contact, claim, next)
        .await
        .unwrap();
    assert!(matches!(
        redis
            .take_crm_population(link, &contact, claim)
            .await
            .unwrap(),
        PendingContact::Claimed(_)
    ));
}

#[tokio::test]
async fn failures_count_per_claim_and_a_released_claim_is_sent_again() {
    let redis = client();
    let link = mailbox();
    let contact = request("buyer@example.com", 200, false, None);
    let claim = claimed(
        &record(&redis, link, std::slice::from_ref(&contact))
            .await
            .unwrap(),
    );

    assert_eq!(
        redis
            .fail_crm_population(link, &contact, claim)
            .await
            .unwrap(),
        Some(1)
    );
    assert_eq!(
        redis
            .fail_crm_population(link, &contact, claim)
            .await
            .unwrap(),
        Some(2)
    );
    assert_eq!(
        redis
            .fail_crm_population(link, &contact, Uuid::now_v7())
            .await
            .unwrap(),
        None
    );

    redis
        .release_crm_population(link, &[(claim, contact.clone())])
        .await
        .unwrap();
    let resent = record(&redis, link, std::slice::from_ref(&contact))
        .await
        .unwrap();
    assert!(resent[0].is_some(), "released entries are claimed again");

    // History requests are separate entries from live ones.
    let history = PopulateCrmContactPayload {
        live_mail: false,
        ..contact
    };
    assert!(record(&redis, link, &[history]).await.unwrap()[0].is_some());
}

/// Marks the entry's claim as last taken long ago, as when its message was
/// dead-lettered or lost before it was sent.
async fn age(redis: &RedisClient, link: Uuid, contact: &PopulateCrmContactPayload) {
    let mut connection = redis
        .inner
        .get_multiplexed_async_connection()
        .await
        .unwrap();
    let _: i64 = redis::cmd("HSET")
        .arg(key(link, contact))
        .arg("claimed_at")
        .arg(0)
        .query_async(&mut connection)
        .await
        .unwrap();
}

#[tokio::test]
async fn a_claim_whose_message_never_ran_is_taken_over() {
    let redis = client();
    let link = mailbox();
    let contact = request("buyer@example.com", 200, false, None);
    let orphan = claimed(
        &record(&redis, link, std::slice::from_ref(&contact))
            .await
            .unwrap(),
    );

    age(&redis, link, &contact).await;
    let again = record(&redis, link, std::slice::from_ref(&contact))
        .await
        .unwrap();
    let replacement = again[0].expect("a stale claim no longer absorbs requests");
    assert_ne!(replacement, orphan);
    assert!(matches!(
        redis
            .take_crm_population(link, &contact, replacement)
            .await
            .unwrap(),
        PendingContact::Claimed(_)
    ));
    assert_eq!(
        redis
            .take_crm_population(link, &contact, orphan)
            .await
            .unwrap(),
        PendingContact::Superseded,
        "a live claim keeps its entry"
    );

    // A message that finds the entry's claim stale adopts it.
    age(&redis, link, &contact).await;
    assert!(matches!(
        redis
            .take_crm_population(link, &contact, orphan)
            .await
            .unwrap(),
        PendingContact::Claimed(_)
    ));
}

#[tokio::test]
async fn a_discarded_entry_lets_the_next_request_send_again() {
    let redis = client();
    let link = mailbox();
    let contact = request("buyer@example.com", 200, false, None);
    let claim = claimed(
        &record(&redis, link, std::slice::from_ref(&contact))
            .await
            .unwrap(),
    );

    redis
        .discard_crm_population(link, &contact, Uuid::now_v7())
        .await
        .unwrap();
    assert!(
        record(&redis, link, std::slice::from_ref(&contact))
            .await
            .unwrap()[0]
            .is_none(),
        "only the claim's own message discards it"
    );

    redis
        .discard_crm_population(link, &contact, claim)
        .await
        .unwrap();
    assert!(
        record(&redis, link, std::slice::from_ref(&contact))
            .await
            .unwrap()[0]
            .is_some()
    );
}
