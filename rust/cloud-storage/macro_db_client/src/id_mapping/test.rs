use super::*;

#[sqlx::test]
async fn test_create_and_get_id_mapping(pool: Pool<Postgres>) -> anyhow::Result<()> {
    create_id_mapping(&pool, "source-123", "target-456").await?;

    let target = get_id_mapping(&pool, "source-123").await?;
    assert_eq!(target, Some("target-456".to_string()));

    Ok(())
}

#[sqlx::test]
async fn test_get_nonexistent_mapping(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let target = get_id_mapping(&pool, "nonexistent").await?;
    assert_eq!(target, None);

    Ok(())
}

#[sqlx::test]
async fn test_upsert_id_mapping(pool: Pool<Postgres>) -> anyhow::Result<()> {
    create_id_mapping(&pool, "source-abc", "target-old").await?;
    create_id_mapping(&pool, "source-abc", "target-new").await?;

    let target = get_id_mapping(&pool, "source-abc").await?;
    assert_eq!(target, Some("target-new".to_string()));

    Ok(())
}
