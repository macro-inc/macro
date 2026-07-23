use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::{Pool, Postgres};

async fn insert_link(pool: &Pool<Postgres>, link_id: Uuid) {
    sqlx::query!(
        r#"INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider)
           VALUES ($1, $2, $2, $3, 'GMAIL')"#,
        link_id,
        "macro|cleanup@corp.test",
        "cleanup@corp.test",
    )
    .execute(pool)
    .await
    .unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn insert_candidates_dedupes_pairs(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let link_id = Uuid::new_v4();
    insert_link(&pool, link_id).await;

    let emails = vec!["a@ext.test".to_string(), "b@ext.test".to_string()];
    let inserted = insert_candidates(&pool, link_id, &emails).await?;
    assert_eq!(inserted, 2);

    // Re-inserting the same pairs (plus one new) only adds the new row.
    let emails = vec![
        "a@ext.test".to_string(),
        "b@ext.test".to_string(),
        "c@ext.test".to_string(),
    ];
    let inserted = insert_candidates(&pool, link_id, &emails).await?;
    assert_eq!(inserted, 1);

    let (_, count) = get_max_id_and_count(&pool).await?.unwrap();
    assert_eq!(count, 3);

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn insert_candidates_empty_is_noop(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let link_id = Uuid::new_v4();
    insert_link(&pool, link_id).await;

    let inserted = insert_candidates(&pool, link_id, &[]).await?;
    assert_eq!(inserted, 0);
    assert!(get_max_id_and_count(&pool).await?.is_none());

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn list_candidates_page_keyset_survives_deletes(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let link_id = Uuid::new_v4();
    insert_link(&pool, link_id).await;

    let emails: Vec<String> = (0..6).map(|i| format!("c{i}@ext.test")).collect();
    insert_candidates(&pool, link_id, &emails).await?;

    let (max_id, count) = get_max_id_and_count(&pool).await?.unwrap();
    assert_eq!(count, 6);

    let first_page = list_candidates_page(&pool, 0, max_id, 3).await?;
    assert_eq!(first_page.len(), 3);
    let cursor = first_page.last().unwrap().id;

    // Consumers delete processed rows behind the cursor; the next page is unaffected.
    for c in &first_page {
        assert!(claim_candidate(&pool, c.link_id, &c.contact_email).await?);
    }

    let second_page = list_candidates_page(&pool, cursor, max_id, 3).await?;
    assert_eq!(second_page.len(), 3);
    assert!(second_page.iter().all(|c| c.id > cursor && c.id <= max_id));

    let third_page = list_candidates_page(&pool, second_page.last().unwrap().id, max_id, 3).await?;
    assert!(third_page.is_empty());

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn list_candidates_page_respects_max_id_snapshot(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let link_id = Uuid::new_v4();
    insert_link(&pool, link_id).await;

    insert_candidates(&pool, link_id, &["a@ext.test".to_string()]).await?;
    let (max_id, _) = get_max_id_and_count(&pool).await?.unwrap();

    // A row inserted after the snapshot gets a higher id and is excluded.
    insert_candidates(&pool, link_id, &["late@ext.test".to_string()]).await?;

    let page = list_candidates_page(&pool, 0, max_id, 10).await?;
    assert_eq!(page.len(), 1);
    assert_eq!(page[0].contact_email, "a@ext.test");

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn claim_candidate_is_idempotent(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let link_id = Uuid::new_v4();
    insert_link(&pool, link_id).await;

    insert_candidates(&pool, link_id, &["a@ext.test".to_string()]).await?;

    assert!(claim_candidate(&pool, link_id, "a@ext.test").await?);
    // Second claim (duplicate dispatch) finds nothing and is harmless.
    assert!(!claim_candidate(&pool, link_id, "a@ext.test").await?);

    Ok(())
}
