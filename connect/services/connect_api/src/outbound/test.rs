use super::*;

fn cipher() -> EnvelopeCipher {
    EnvelopeCipher::new(Arc::new(
        LocalKeyWrapper::from_base64(&STANDARD.encode([9_u8; 32])).unwrap(),
    ))
}

#[tokio::test]
async fn grant_cipher_round_trips_and_rejects_tampering_or_wrong_owner() {
    let cipher = cipher();
    let customer = Uuid::now_v7();
    let connection = Uuid::now_v7();
    let grant = Grant {
        access_token: "access-secret".into(),
        refresh_token: Some("refresh-secret".into()),
        token_type: "Bearer".into(),
        expires_at: Some(Utc::now() + chrono::Duration::hours(1)),
        scopes: vec!["read".into()],
    };
    assert!(!format!("{grant:?}").contains("access-secret"));
    assert!(!format!("{grant:?}").contains("refresh-secret"));
    let mut envelope = cipher.seal(customer, connection, &grant).await.unwrap();
    let opened = cipher.open(customer, connection, &envelope).await.unwrap();
    assert_eq!(opened.access_token, "access-secret");
    assert_eq!(opened.refresh_token.as_deref(), Some("refresh-secret"));
    assert!(
        cipher
            .open(Uuid::now_v7(), connection, &envelope)
            .await
            .is_err()
    );
    assert!(
        cipher
            .open(customer, Uuid::now_v7(), &envelope)
            .await
            .is_err()
    );
    envelope.ciphertext[0] ^= 1;
    assert!(cipher.open(customer, connection, &envelope).await.is_err());
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn repository_queries_are_customer_scoped(pool: PgPool) {
    let repository = PostgresRepository::new(pool);
    let owner_key = repository.create_customer("Owner").await.unwrap();
    assert!(!format!("{owner_key:?}").contains(owner_key.as_str()));
    let other_key = repository.create_customer("Other").await.unwrap();
    let owner = repository.authenticate(&owner_key).await.unwrap();
    let other = repository.authenticate(&other_key).await.unwrap();
    assert!(matches!(
        repository.authenticate("ck_bad_secret").await,
        Err(Error::InvalidKey)
    ));
    let id = Uuid::now_v7();
    let grant = Grant {
        access_token: "access".into(),
        refresh_token: None,
        token_type: "Bearer".into(),
        expires_at: None,
        scopes: vec!["read".into()],
    };
    let envelope = cipher().seal(owner, id, &grant).await.unwrap();
    repository
        .insert_connection(id, owner, "user-a", "notion", &grant.scopes, &envelope)
        .await
        .unwrap();
    assert_eq!(repository.list(owner, "user-a").await.unwrap().len(), 1);
    assert!(repository.list(other, "user-a").await.unwrap().is_empty());
    assert!(
        repository
            .grant(other, "user-a", "notion")
            .await
            .unwrap()
            .is_none()
    );
    assert!(
        repository
            .grant(owner, "user-a", "notion")
            .await
            .unwrap()
            .is_some()
    );
    assert!(!repository.delete(other, "user-a", "notion").await.unwrap());
    assert!(repository.delete(owner, "user-a", "notion").await.unwrap());
    assert!(
        repository
            .grant(owner, "user-a", "notion")
            .await
            .unwrap()
            .is_none()
    );
}
