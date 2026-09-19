use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::{Pool, Postgres};

const OWNER_ID: &str = "fusionauth-user-1";

fn encrypted_grant(seed: u8) -> EncryptedMicrosoftOAuthGrant {
    EncryptedMicrosoftOAuthGrant::new(
        vec![seed, 0, 255, seed.wrapping_add(1)],
        vec![seed.wrapping_add(2), 0, 128],
        vec![seed; 12],
        i32::from(seed) + 1,
        format!("arn:aws:kms:us-east-1:123456789012:key/{seed}"),
    )
}

fn assert_envelopes_equal(
    actual: &EncryptedMicrosoftOAuthGrant,
    expected: &EncryptedMicrosoftOAuthGrant,
) {
    assert_eq!(
        actual.refresh_token_ciphertext(),
        expected.refresh_token_ciphertext()
    );
    assert_eq!(actual.encrypted_data_key(), expected.encrypted_data_key());
    assert_eq!(actual.nonce(), expected.nonce());
    assert_eq!(actual.encryption_version(), expected.encryption_version());
    assert_eq!(actual.kms_key_id(), expected.kms_key_id());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn normalizes_email_addresses_for_upsert_and_fetch(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let envelope = encrypted_grant(1);

    let inserted =
        upsert_microsoft_oauth_grant(&pool, OWNER_ID, "Mailbox@Example.COM", &envelope).await?;
    let fetched = get_microsoft_oauth_grant(&pool, OWNER_ID, "MAILBOX@EXAMPLE.COM")
        .await?
        .expect("normalized grant should exist");

    assert_eq!(inserted.email_address(), "mailbox@example.com");
    assert_eq!(fetched.email_address(), "mailbox@example.com");

    let uppercase_update = sqlx::query!(
        r#"
            UPDATE microsoft_oauth_grants
            SET email_address = 'Mailbox@Example.COM'
            WHERE fusionauth_user_id = $1
              AND email_address = 'mailbox@example.com'
        "#,
        OWNER_ID,
    )
    .execute(&pool)
    .await;
    assert!(
        uppercase_update.is_err(),
        "the database must reject non-normalized mailbox keys"
    );

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn first_insert_stores_encrypted_envelope_and_metadata(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let before_insert = Utc::now();
    let envelope = encrypted_grant(2);

    let inserted =
        upsert_microsoft_oauth_grant(&pool, OWNER_ID, "mailbox@example.com", &envelope).await?;

    assert_eq!(inserted.fusionauth_user_id(), OWNER_ID);
    assert_envelopes_equal(inserted.encrypted_grant(), &envelope);
    assert!(inserted.created_at() >= before_insert);
    assert_eq!(inserted.updated_at(), inserted.created_at());
    assert_eq!(inserted.last_refreshed_at(), inserted.created_at());

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn reconnect_atomically_replaces_the_complete_envelope(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let initial = encrypted_grant(3);
    let replacement = encrypted_grant(20);
    let first =
        upsert_microsoft_oauth_grant(&pool, OWNER_ID, "mailbox@example.com", &initial).await?;

    tokio::time::sleep(std::time::Duration::from_millis(2)).await;
    let reconnected =
        upsert_microsoft_oauth_grant(&pool, OWNER_ID, "mailbox@example.com", &replacement).await?;

    assert_eq!(reconnected.created_at(), first.created_at());
    assert!(reconnected.updated_at() > first.updated_at());
    assert!(reconnected.last_refreshed_at() > first.last_refreshed_at());
    assert_envelopes_equal(reconnected.encrypted_grant(), &replacement);
    assert_ne!(
        reconnected.encrypted_grant().refresh_token_ciphertext(),
        initial.refresh_token_ciphertext()
    );
    assert_ne!(
        reconnected.encrypted_grant().encrypted_data_key(),
        initial.encrypted_data_key()
    );
    assert_ne!(reconnected.encrypted_grant().nonce(), initial.nonce());
    assert_ne!(
        reconnected.encrypted_grant().encryption_version(),
        initial.encryption_version()
    );
    assert_ne!(
        reconnected.encrypted_grant().kms_key_id(),
        initial.kms_key_id()
    );

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn owner_and_normalized_mailbox_form_a_unique_key(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let owner_one_envelope = encrypted_grant(4);
    let owner_two_envelope = encrypted_grant(5);

    upsert_microsoft_oauth_grant(
        &pool,
        "fusionauth-user-1",
        "shared@example.com",
        &owner_one_envelope,
    )
    .await?;
    upsert_microsoft_oauth_grant(
        &pool,
        "fusionauth-user-2",
        "shared@example.com",
        &owner_two_envelope,
    )
    .await?;

    let duplicate_result = sqlx::query!(
        r#"
            INSERT INTO microsoft_oauth_grants (
                fusionauth_user_id,
                email_address,
                refresh_token_ciphertext,
                encrypted_data_key,
                nonce,
                encryption_version,
                kms_key_id
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7)
        "#,
        "fusionauth-user-1",
        "shared@example.com",
        owner_one_envelope.refresh_token_ciphertext,
        owner_one_envelope.encrypted_data_key,
        owner_one_envelope.nonce,
        owner_one_envelope.encryption_version,
        owner_one_envelope.kms_key_id,
    )
    .execute(&pool)
    .await;

    assert!(duplicate_result.is_err(), "duplicate owner key must fail");
    let grant_count = sqlx::query_scalar!(
        r#"
            SELECT COUNT(*) AS "count!"
            FROM microsoft_oauth_grants
            WHERE email_address = 'shared@example.com'
        "#
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(grant_count, 2, "ownership must be scoped to the user");

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn opaque_binary_values_round_trip_without_interpretation(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let envelope = EncryptedMicrosoftOAuthGrant::new(
        vec![0, 255, 0, 17, 128, 42],
        vec![255, 254, 0, 1, 2],
        vec![0, 1, 2, 3, 4, 5, 255, 128, 10, 11, 12, 13],
        i32::MAX,
        "alias/microsoft-oauth-grants".to_string(),
    );

    upsert_microsoft_oauth_grant(&pool, OWNER_ID, "binary@example.com", &envelope).await?;
    let fetched = get_microsoft_oauth_grant(&pool, OWNER_ID, "binary@example.com")
        .await?
        .expect("grant should exist");

    assert_envelopes_equal(fetched.encrypted_grant(), &envelope);

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn schema_has_no_plaintext_secret_columns(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let columns = sqlx::query_scalar!(
        r#"
            SELECT column_name AS "column_name!"
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'microsoft_oauth_grants'
            ORDER BY ordinal_position
        "#
    )
    .fetch_all(&pool)
    .await?;

    assert_eq!(
        columns,
        vec![
            "fusionauth_user_id",
            "email_address",
            "refresh_token_ciphertext",
            "encrypted_data_key",
            "nonce",
            "encryption_version",
            "kms_key_id",
            "created_at",
            "updated_at",
            "last_refreshed_at",
        ]
    );
    assert!(!columns.iter().any(|column| {
        matches!(
            column.as_str(),
            "refresh_token" | "plaintext_refresh_token" | "data_key"
        )
    }));

    Ok(())
}
