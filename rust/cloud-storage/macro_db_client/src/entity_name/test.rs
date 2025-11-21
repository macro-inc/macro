use super::*;

#[sqlx::test(fixtures(path = "../../fixtures", scripts("get_entity_name")))]
async fn test_get_entity_name(pool: sqlx::Pool<sqlx::Postgres>) -> anyhow::Result<()> {
    let entity_id = uuid::Uuid::parse_str("11111111-1111-1111-1111-111111111111")?;
    let entity_name = get_entity_name(&pool, &entity_id, &SearchEntityType::Documents).await?;
    assert_eq!(entity_name, Some("document".to_string()));

    let entity_name = get_entity_name(&pool, &entity_id, &SearchEntityType::Chats).await?;
    assert_eq!(entity_name, Some("chat".to_string()));

    let entity_name = get_entity_name(&pool, &entity_id, &SearchEntityType::Channels).await?;
    assert_eq!(entity_name, Some("channel".to_string()));

    let entity_name = get_entity_name(&pool, &entity_id, &SearchEntityType::Emails).await?;
    assert_eq!(entity_name, Some("subject".to_string()));

    let result = get_entity_name(&pool, &entity_id, &SearchEntityType::Projects).await;
    assert!(result.is_err());
    assert_eq!(result.unwrap_err().to_string(), "entity type not supported");

    let result = get_entity_name(
        &pool,
        &macro_uuid::generate_uuid_v7(),
        &SearchEntityType::Documents,
    )
    .await;

    assert!(result.is_err());
    assert_eq!(
        result.unwrap_err().to_string(),
        "no rows returned by a query that expected to return at least one row"
    );

    Ok(())
}
