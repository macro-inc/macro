use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::{Pool, Postgres};

const USER_ID: &str = "macro-user-1";
const OTHER_USER_ID: &str = "macro-user-2";

fn encrypted(seed: u8) -> EncryptedCursorApiKey {
    EncryptedCursorApiKey {
        key_ciphertext: vec![seed, 0, 255, seed.wrapping_add(1)],
        encryption_version: 1,
        kms_key_id: format!("arn:aws:kms:us-east-1:123456789012:key/{seed}"),
    }
}

/// The table's foreign key means a key needs a real user to belong to.
///
/// A Macro user is two rows: `macro_user` holds the identity and `"User"` the
/// profile that references it. `cursor_configs` keys on `"User"."id"`, the
/// text id that `MacroUserIdStr` carries — not the `macro_user_id` uuid.
async fn insert_user(pool: &Pool<Postgres>, user_id: &str) -> anyhow::Result<()> {
    let email = format!("{user_id}@example.com");
    sqlx::query!(
        r#"
        WITH new_macro_user AS (
            INSERT INTO macro_user (id, username, email, stripe_customer_id)
            VALUES (gen_random_uuid(), $2, $2, $3)
            RETURNING id
        )
        INSERT INTO "User" ("id", "email", "macro_user_id")
        SELECT $1, $2, new_macro_user.id FROM new_macro_user
        "#,
        user_id,
        email,
        format!("stripe_{user_id}"),
    )
    .execute(pool)
    .await?;
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_registered_key_round_trips(pool: Pool<Postgres>) -> anyhow::Result<()> {
    insert_user(&pool, USER_ID).await?;
    let encrypted = encrypted(1);

    let inserted = upsert_cursor_api_key(&pool, USER_ID, &encrypted).await?;
    let fetched = get_cursor_api_key(&pool, USER_ID)
        .await?
        .expect("the key was just registered");

    assert_eq!(inserted, fetched);
    assert_eq!(fetched.encrypted, encrypted);
    Ok(())
}

/// Registering again replaces the key rather than failing: that is what
/// pasting a rotated key looks like.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn registering_again_replaces_the_key_and_keeps_created_at(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    insert_user(&pool, USER_ID).await?;

    let first = upsert_cursor_api_key(&pool, USER_ID, &encrypted(1)).await?;
    let second = upsert_cursor_api_key(&pool, USER_ID, &encrypted(2)).await?;

    assert_eq!(second.encrypted, encrypted(2));
    assert_eq!(
        second.created_at, first.created_at,
        "created_at records when the user first connected, not the last rotation"
    );
    assert!(second.updated_at >= first.updated_at);
    Ok(())
}

/// A user with no key is `None`, not an error: it is the ordinary state.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_user_without_a_key_reads_as_none(pool: Pool<Postgres>) -> anyhow::Result<()> {
    insert_user(&pool, USER_ID).await?;
    assert!(get_cursor_api_key(&pool, USER_ID).await?.is_none());
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn keys_are_scoped_to_their_owner(pool: Pool<Postgres>) -> anyhow::Result<()> {
    insert_user(&pool, USER_ID).await?;
    insert_user(&pool, OTHER_USER_ID).await?;

    upsert_cursor_api_key(&pool, USER_ID, &encrypted(1)).await?;
    upsert_cursor_api_key(&pool, OTHER_USER_ID, &encrypted(2)).await?;

    assert_eq!(
        get_cursor_api_key(&pool, USER_ID)
            .await?
            .expect("present")
            .encrypted,
        encrypted(1)
    );
    assert_eq!(
        get_cursor_api_key(&pool, OTHER_USER_ID)
            .await?
            .expect("present")
            .encrypted,
        encrypted(2)
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn deleting_reports_whether_there_was_a_key(pool: Pool<Postgres>) -> anyhow::Result<()> {
    insert_user(&pool, USER_ID).await?;
    upsert_cursor_api_key(&pool, USER_ID, &encrypted(1)).await?;

    assert!(delete_cursor_api_key(&pool, USER_ID).await?);
    assert!(get_cursor_api_key(&pool, USER_ID).await?.is_none());
    assert!(
        !delete_cursor_api_key(&pool, USER_ID).await?,
        "deleting a key that is already gone is false, not an error"
    );
    Ok(())
}

/// Deleting the user takes the key with it, which the Microsoft grants table
/// does not do — it keys on the FusionAuth id with no foreign key, so its rows
/// outlive their users.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn deleting_the_user_cascades_to_the_key(pool: Pool<Postgres>) -> anyhow::Result<()> {
    insert_user(&pool, USER_ID).await?;
    upsert_cursor_api_key(&pool, USER_ID, &encrypted(1)).await?;

    sqlx::query!(r#"DELETE FROM "User" WHERE "id" = $1"#, USER_ID)
        .execute(&pool)
        .await?;

    assert!(get_cursor_api_key(&pool, USER_ID).await?.is_none());
    Ok(())
}

/// A key cannot be registered for a user that does not exist.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_key_for_an_unknown_user_is_refused(pool: Pool<Postgres>) -> anyhow::Result<()> {
    assert!(
        upsert_cursor_api_key(&pool, "nobody", &encrypted(1))
            .await
            .is_err()
    );
    Ok(())
}

/// A freshly registered key has no default model: the user gets the
/// deployment's built-in default until they choose one.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_new_key_has_no_default_model(pool: Pool<Postgres>) -> anyhow::Result<()> {
    insert_user(&pool, USER_ID).await?;
    let stored = upsert_cursor_api_key(&pool, USER_ID, &encrypted(1)).await?;
    assert_eq!(stored.default_model_id, None);
    Ok(())
}

/// The chosen model round-trips, and clearing it with `None` reverts to the
/// deployment default.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_default_model_round_trips_and_clears(pool: Pool<Postgres>) -> anyhow::Result<()> {
    insert_user(&pool, USER_ID).await?;
    upsert_cursor_api_key(&pool, USER_ID, &encrypted(1)).await?;

    assert!(set_default_model_id(&pool, USER_ID, Some("grok-4.6")).await?);
    assert_eq!(
        get_cursor_api_key(&pool, USER_ID)
            .await?
            .expect("present")
            .default_model_id
            .as_deref(),
        Some("grok-4.6")
    );

    assert!(set_default_model_id(&pool, USER_ID, None).await?);
    assert_eq!(
        get_cursor_api_key(&pool, USER_ID)
            .await?
            .expect("present")
            .default_model_id,
        None
    );
    Ok(())
}

/// Rotating the key leaves the chosen model alone — a new paste is not a reset.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn rotating_the_key_keeps_the_default_model(pool: Pool<Postgres>) -> anyhow::Result<()> {
    insert_user(&pool, USER_ID).await?;
    upsert_cursor_api_key(&pool, USER_ID, &encrypted(1)).await?;
    set_default_model_id(&pool, USER_ID, Some("claude-opus-5")).await?;

    let rotated = upsert_cursor_api_key(&pool, USER_ID, &encrypted(2)).await?;
    assert_eq!(rotated.default_model_id.as_deref(), Some("claude-opus-5"));
    Ok(())
}

/// Choosing a model before connecting is not an error, just a no-op: there is
/// no row to hold it, and no session would use it.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn setting_a_model_without_a_key_is_a_noop(pool: Pool<Postgres>) -> anyhow::Result<()> {
    insert_user(&pool, USER_ID).await?;
    assert!(!set_default_model_id(&pool, USER_ID, Some("grok-4.6")).await?);
    Ok(())
}
