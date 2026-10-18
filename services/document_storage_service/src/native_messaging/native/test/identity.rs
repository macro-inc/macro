use super::*;
use meta_messaging::domain::events::IdentityUpdate;

fn message(
    c: &Connection,
    id: &str,
    customer: &str,
    phone: Option<&str>,
    at: chrono::DateTime<Utc>,
) -> IncomingMessage {
    let mut m = incoming(c, id);
    m.customer_id = customer.to_owned().try_into().unwrap();
    m.customer_phone = phone.map(|p| p.to_owned().try_into().unwrap());
    m.timestamp = at;
    m
}

fn update(
    c: &Connection,
    previous: &str,
    current: &str,
    at: chrono::DateTime<Utc>,
) -> IdentityUpdate {
    IdentityUpdate {
        provenance: Provenance::Customer,
        account_id: c.account_id.clone(),
        previous: previous.to_owned().try_into().unwrap(),
        current: current.to_owned().try_into().unwrap(),
        previous_phone: None,
        phone: None,
        timestamp: at,
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn phone_only_upgrades_to_bsuid_without_changing_native_history(pool: PgPool) {
    let (native, c, _) = setup(&pool, Provider::Whatsapp).await;
    let repo = PgMessagingRepository::new(pool.clone());
    let at = Utc::now();
    let legacy = message(&c, "legacy", "15550000001", Some("15550000001"), at);
    native.ingest(&c, &legacy, vec![]).await.unwrap();
    let target = repo.message_target(c.id, "legacy").await.unwrap();
    let sender = sqlx::query_scalar!(
        "SELECT external_sender_id FROM meta_messaging_conversation WHERE channel_id=$1",
        target.0
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    let current = message(&c, "current", "US.A", Some("15550000001"), at);
    native.ingest(&c, &current, vec![]).await.unwrap();
    assert_eq!(
        repo.message_target(c.id, "current").await.unwrap().0,
        target.0
    );
    assert_eq!(repo.message_target(c.id, "legacy").await.unwrap(), target);
    let conversation = repo.conversation(target.0).await.unwrap().unwrap();
    assert_eq!(conversation.customer_id.as_str(), "US.A");
    assert_eq!(conversation.customer_phone.as_deref(), Some("15550000001"));
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT external_sender_id FROM meta_messaging_conversation WHERE channel_id=$1",
            target.0
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        sender
    );
    assert_eq!(sqlx::query_scalar!("SELECT count(*) FROM meta_messaging_customer_alias WHERE connection_id=$1 AND identifier=$2",c.id,"15550000001")
        .fetch_one(&pool).await.unwrap(), Some(0));
    native.ingest(&c, &legacy, vec![]).await.unwrap();
    assert_eq!(repo.message_target(c.id, "legacy").await.unwrap(), target);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn bsuid_only_creates_one_conversation(pool: PgPool) {
    let (native, c, _) = setup(&pool, Provider::Whatsapp).await;
    let repo = PgMessagingRepository::new(pool);
    let m = message(&c, "hidden", "US.A", None, Utc::now());
    native.ingest(&c, &m, vec![]).await.unwrap();
    let target = repo.message_target(c.id, "hidden").await.unwrap();
    native.ingest(&c, &m, vec![]).await.unwrap();
    assert_eq!(repo.message_target(c.id, "hidden").await.unwrap(), target);
    let conversation = repo.conversation(target.0).await.unwrap().unwrap();
    assert_eq!(conversation.customer_id.as_str(), "US.A");
    assert_eq!(conversation.customer_phone, None);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn user_id_update_rekeys_or_retains_separate_histories(pool: PgPool) {
    let (native, c, _) = setup(&pool, Provider::Whatsapp).await;
    let repo = PgMessagingRepository::new(pool.clone());
    let at = Utc::now();
    let first = message(&c, "first", "US.A", None, at);
    native.ingest(&c, &first, vec![]).await.unwrap();
    let target = repo.message_target(c.id, "first").await.unwrap();
    let revision = IncomingRevision {
        provenance: Provenance::Customer,
        account_id: c.account_id.clone(),
        customer_id: first.customer_id.clone(),
        message_id: "pending".to_owned().try_into().unwrap(),
        direction: Direction::Inbound,
        timestamp: at,
        change: MessageRevision::Deleted,
    };
    native.revise(&c, &revision).await.unwrap();
    let edge = update(&c, "US.A", "US.B", at);
    repo.update_identity(&c, &edge).await.unwrap();
    repo.update_identity(&c, &edge).await.unwrap();
    assert_eq!(
        repo.conversation(target.0)
            .await
            .unwrap()
            .unwrap()
            .customer_id
            .as_str(),
        "US.B"
    );
    let mut unrelated = revision.clone();
    unrelated.customer_id = "US.OTHER".to_owned().try_into().unwrap();
    unrelated.message_id = first.message_id.clone();
    let error = native.revise(&c, &unrelated).await.unwrap_err();
    assert!(matches!(
        error.current_context(),
        MessagingError::IdentityConflict
    ));
    let other = message(&c, "other", "US.C", None, at);
    native.ingest(&c, &other, vec![]).await.unwrap();
    let other_target = repo.message_target(c.id, "other").await.unwrap();
    repo.update_identity(&c, &update(&c, "US.B", "US.C", at))
        .await
        .unwrap();
    let pending = message(&c, "pending", "US.A", None, at);
    native.ingest(&c, &pending, vec![]).await.unwrap();
    let deleted = repo.message_target(c.id, "pending").await.unwrap();
    assert!(
        PgMessageRepository::new(pool.clone())
            .get(&MessageParent::Channel(deleted.0), deleted.1)
            .await
            .unwrap()
            .unwrap()
            .deleted_at
            .is_some()
    );
    assert_ne!(target.0, other_target.0);
    assert_eq!(repo.message_target(c.id, "first").await.unwrap(), target);
    native.ingest(&c, &first, vec![]).await.unwrap();
    let late = message(&c, "late", "US.A", None, at);
    native.ingest(&c, &late, vec![]).await.unwrap();
    assert_eq!(
        repo.message_target(c.id, "late").await.unwrap().0,
        other_target.0
    );
    let old = repo.conversation(target.0).await.unwrap().unwrap();
    let lease = meta_messaging::domain::ports::Lease {
        id: Uuid::now_v7(),
        token: Uuid::now_v7(),
    };
    let error = repo
        .prepare_send(&lease, &(&c).into(), &old, "blocked")
        .await
        .unwrap_err();
    assert!(matches!(
        error.current_context(),
        MessagingError::IdentityConflict
    ));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn recycled_phone_moves_only_the_latest_attribute(pool: PgPool) {
    let (native, c, _) = setup(&pool, Provider::Whatsapp).await;
    let repo = PgMessagingRepository::new(pool);
    let at = Utc::now();
    let old = message(&c, "old", "US.A", Some("15550000001"), at);
    let new = message(
        &c,
        "new",
        "US.B",
        Some("15550000001"),
        at + chrono::Duration::seconds(2),
    );
    native.ingest(&c, &old, vec![]).await.unwrap();
    native.ingest(&c, &new, vec![]).await.unwrap();
    let old_channel = repo.message_target(c.id, "old").await.unwrap().0;
    let new_channel = repo.message_target(c.id, "new").await.unwrap().0;
    assert_ne!(old_channel, new_channel);
    let stale = message(&c, "stale", "US.A", Some("15550000001"), at);
    native.ingest(&c, &stale, vec![]).await.unwrap();
    assert_eq!(
        repo.message_target(c.id, "stale").await.unwrap().0,
        old_channel
    );
    assert_eq!(
        repo.conversation(old_channel)
            .await
            .unwrap()
            .unwrap()
            .customer_phone,
        None
    );
    assert_eq!(
        repo.conversation(new_channel)
            .await
            .unwrap()
            .unwrap()
            .customer_phone
            .as_deref(),
        Some("15550000001")
    );
    let ambiguous = message(&c, "ambiguous", "15550000001", Some("15550000001"), at);
    let error = native.ingest(&c, &ambiguous, vec![]).await.unwrap_err();
    assert!(matches!(
        error.current_context(),
        MessagingError::IdentityConflict
    ));
    let legacy = message(&c, "legacy", "15550000002", Some("15550000002"), at);
    native.ingest(&c, &legacy, vec![]).await.unwrap();
    let legacy_channel = repo.message_target(c.id, "legacy").await.unwrap().0;
    let pair = message(
        &c,
        "pair",
        "US.B",
        Some("15550000002"),
        at + chrono::Duration::seconds(3),
    );
    native.ingest(&c, &pair, vec![]).await.unwrap();
    let superseded = repo.conversation(legacy_channel).await.unwrap().unwrap();
    assert_eq!(superseded.customer_phone, None);
    let lease = meta_messaging::domain::ports::Lease {
        id: Uuid::now_v7(),
        token: Uuid::now_v7(),
    };
    let error = repo
        .prepare_send(&lease, &(&c).into(), &superseded, "blocked")
        .await
        .unwrap_err();
    assert!(matches!(
        error.current_context(),
        MessagingError::IdentityConflict
    ));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn late_old_bsuid_keeps_the_channel_without_restoring_its_phone(pool: PgPool) {
    let (native, c, _) = setup(&pool, Provider::Whatsapp).await;
    let repo = PgMessagingRepository::new(pool);
    let at = Utc::now();
    let m = message(&c, "first", "US.A", Some("15550000001"), at);
    native.ingest(&c, &m, vec![]).await.unwrap();
    let channel = repo.message_target(c.id, "first").await.unwrap().0;
    let mut edge = update(&c, "US.A", "US.B", at + chrono::Duration::seconds(1));
    edge.phone = Some("15550000002".to_owned().try_into().unwrap());
    repo.update_identity(&c, &edge).await.unwrap();
    let late = message(&c, "late", "US.A", Some("15550000001"), at);
    native.ingest(&c, &late, vec![]).await.unwrap();
    assert_eq!(repo.message_target(c.id, "late").await.unwrap().0, channel);
    let conversation = repo.conversation(channel).await.unwrap().unwrap();
    assert_eq!(conversation.customer_id.as_str(), "US.B");
    assert_eq!(conversation.customer_phone.as_deref(), Some("15550000002"));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn aliases_are_isolated_by_connection(pool: PgPool) {
    let (native, c, _) = setup(&pool, Provider::Whatsapp).await;
    let repo = PgMessagingRepository::new(pool);
    let mut other = c.clone();
    other.id = Uuid::now_v7();
    other.account_id = "another-account".to_owned().try_into().unwrap();
    let other = repo.connect(&other, b"fixture", None).await.unwrap();
    let at = Utc::now();
    repo.update_identity(&c, &update(&c, "US.A", "US.B", at))
        .await
        .unwrap();
    let first = message(&c, "same", "US.A", None, at);
    let second = message(&other, "same", "US.A", None, at);
    native.ingest(&c, &first, vec![]).await.unwrap();
    native.ingest(&other, &second, vec![]).await.unwrap();
    let a = repo.message_target(c.id, "same").await.unwrap().0;
    let b = repo.message_target(other.id, "same").await.unwrap().0;
    assert_ne!(a, b);
    assert_eq!(
        repo.conversation(a)
            .await
            .unwrap()
            .unwrap()
            .customer_id
            .as_str(),
        "US.B"
    );
    assert_eq!(
        repo.conversation(b)
            .await
            .unwrap()
            .unwrap()
            .customer_id
            .as_str(),
        "US.A"
    );
}
