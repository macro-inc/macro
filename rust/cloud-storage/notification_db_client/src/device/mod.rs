use model_notifications::DeviceType;
use std::collections::HashMap;

/// Gets the device endpoint for a given device token
#[tracing::instrument(skip(db))]
pub async fn get_device_endpoint(
    db: &sqlx::Pool<sqlx::Postgres>,
    device_token: &str,
) -> anyhow::Result<Option<String>> {
    let result = sqlx::query!(
        r#"
        SELECT d.device_endpoint
        FROM user_device_registration d
        WHERE d.device_token = $1
        LIMIT 1
        "#,
        device_token
    )
    .map(|row| row.device_endpoint)
    .fetch_optional(db)
    .await?;

    Ok(result)
}

/// Upserts a user device registration
#[tracing::instrument(skip(db))]
pub async fn upsert_user_device(
    db: &sqlx::Pool<sqlx::Postgres>,
    user_id: &str,
    device_token: &str,
    device_endpoint: &str,
    device_type: &DeviceType,
) -> anyhow::Result<()> {
    let id = macro_uuid::generate_uuid_v7();
    sqlx::query!(
        r#"
        INSERT INTO user_device_registration (id, user_id, device_token, device_endpoint, device_type)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (device_endpoint) DO UPDATE SET user_id = $2, device_token = $3, device_type = $5, updated_at = NOW()
        "#,
        id,
        user_id,
        device_token,
        device_endpoint,
        device_type as _,
    )
    .execute(db)
    .await?;

    Ok(())
}

/// Gets all device endpoints for a list of users
/// Returns a map of user_id to device_endpoints
#[tracing::instrument(skip(db))]
pub async fn get_users_device_endpoints(
    db: &sqlx::Pool<sqlx::Postgres>,
    user_ids: &[String],
) -> anyhow::Result<HashMap<String, Vec<String>>> {
    // initialize hashmap
    // we need to initialize the hashmap here with *all* user ids so we can ensure we have empty
    // vectors for users that don't have any device endpoints
    let mut result: HashMap<String, Vec<String>> =
        user_ids.iter().map(|id| (id.clone(), Vec::new())).collect();

    let device_endpoints: Vec<(String, String)> = sqlx::query!(
        r#"
        SELECT d.device_endpoint,
        d.user_id
        FROM user_device_registration d
        WHERE d.user_id = ANY($1)
        "#,
        user_ids
    )
    .map(|row| (row.user_id, row.device_endpoint))
    .fetch_all(db)
    .await?;

    for (user_id, device_endpoint) in device_endpoints {
        result.entry(user_id).or_default().push(device_endpoint);
    }

    Ok(result)
}

/// Gets all device endpoints for a given user
#[tracing::instrument(skip(db))]
pub async fn get_user_device_endpoints(
    db: &sqlx::Pool<sqlx::Postgres>,
    user_id: &str,
) -> anyhow::Result<Vec<String>> {
    let result: Vec<String> = sqlx::query!(
        r#"
        SELECT d.device_endpoint
        FROM user_device_registration d
        WHERE d.user_id = $1
        "#,
        user_id
    )
    .map(|row| row.device_endpoint)
    .fetch_all(db)
    .await?;

    Ok(result)
}

/// Deletes a user device registration
#[tracing::instrument(skip(db))]
pub async fn delete_user_device_token(
    db: &sqlx::Pool<sqlx::Postgres>,
    device_token: &str,
    device_type: &DeviceType,
) -> anyhow::Result<String> {
    let result = sqlx::query!(
        r#"
        DELETE FROM user_device_registration
        WHERE device_token = $1 AND device_type = $2
        RETURNING device_endpoint
        "#,
        device_token,
        device_type as _,
    )
    .fetch_one(db)
    .await?;

    Ok(result.device_endpoint)
}

#[tracing::instrument(skip(db))]
pub async fn delete_user_device_by_endpoint(
    db: &sqlx::Pool<sqlx::Postgres>,
    device_endpoint: &str,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        DELETE FROM user_device_registration
        WHERE device_endpoint = $1
        "#,
        device_endpoint
    )
    .execute(db)
    .await?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::{Pool, Postgres};

    #[sqlx::test]
    async fn test_upsert_new_user_device(pool: Pool<Postgres>) -> anyhow::Result<()> {
        let user_id = "macro|tester@macro-test.com";
        let device_token = "test_token_47295";
        let device_endpoint = "test_endpoint_89937";
        let device_type = DeviceType::Ios;

        upsert_user_device(&pool, user_id, device_token, device_endpoint, &device_type).await?;

        let result = sqlx::query!(
            r#"
            SELECT id, user_id, device_token, device_endpoint, device_type as "device_type:DeviceType" 
            FROM user_device_registration 
            WHERE device_endpoint = $1
            "#,
            device_endpoint
        )
        .fetch_optional(&pool)
        .await?;

        assert!(result.is_some());
        assert_eq!(result.as_ref().unwrap().user_id, user_id);
        assert_eq!(result.as_ref().unwrap().device_token, device_token);
        assert_eq!(result.as_ref().unwrap().device_type, device_type);
        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("user_devices")))]
    async fn test_upsert_existing_user_device(pool: Pool<Postgres>) -> anyhow::Result<()> {
        let new_token = "new_token_123";
        let result = sqlx::query!(
            r#"
            SELECT id, user_id, device_token, device_endpoint, device_type as "device_type:DeviceType" 
            FROM user_device_registration 
            WHERE id = '017d85a8-c7c6-7c40-b4f3-a6c1b3c0d1e2'
            "#
        )
        .fetch_optional(&pool)
        .await?;

        assert!(result.is_some());
        assert_eq!(
            result.as_ref().unwrap().device_token,
            "ios_device_token_123"
        );
        assert_ne!(result.as_ref().unwrap().device_token, new_token);

        upsert_user_device(
            &pool,
            &result.as_ref().unwrap().user_id,
            &new_token,
            &result.as_ref().unwrap().device_endpoint,
            &result.as_ref().unwrap().device_type,
        )
        .await?;

        let result = sqlx::query!(
            r#"
            SELECT id, user_id, device_token, device_endpoint, device_type as "device_type:DeviceType" 
            FROM user_device_registration 
            WHERE id = '017d85a8-c7c6-7c40-b4f3-a6c1b3c0d1e2'
            "#
        )
        .fetch_optional(&pool)
        .await?;

        assert_eq!(result.as_ref().unwrap().device_token, new_token);
        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("user_devices")))]
    async fn test_delete_user_device(pool: Pool<Postgres>) -> anyhow::Result<()> {
        let result = sqlx::query!(
            r#"
            SELECT id, user_id, device_token, device_endpoint, device_type as "device_type:DeviceType" 
            FROM user_device_registration 
            WHERE id = '017d85a8-c7c6-7c40-b4f3-a6c1b3c0d1e4'
            "#
        )
        .fetch_optional(&pool)
        .await?;

        assert!(result.is_some());

        delete_user_device_token(
            &pool,
            &result.as_ref().unwrap().device_token,
            &result.as_ref().unwrap().device_type,
        )
        .await?;

        let result = sqlx::query!(
            r#"
            SELECT id, user_id, device_token, device_endpoint, device_type as "device_type:DeviceType" 
            FROM user_device_registration 
            WHERE device_token = $1 AND device_type = $2
            "#,
            result.as_ref().unwrap().device_token,
            result.as_ref().unwrap().device_type as _,
        )
        .fetch_optional(&pool)
        .await?;

        assert!(result.is_none());

        Ok(())
    }
}
