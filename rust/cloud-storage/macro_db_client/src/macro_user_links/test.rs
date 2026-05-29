use super::*;

async fn insert_user(pool: &Pool<Postgres>, id: &str) -> anyhow::Result<()> {
    let macro_user_id = macro_uuid::generate_uuid_v7();
    let stripe_customer_id = format!("cus_{macro_user_id}");
    sqlx::query!(
        r#"
        INSERT INTO macro_user (id, username, email, stripe_customer_id)
        VALUES ($1, $2, $3, $4)
        "#,
        &macro_user_id,
        id,
        id,
        stripe_customer_id,
    )
    .execute(pool)
    .await?;

    sqlx::query!(
        r#"
        INSERT INTO "User" (id, email, macro_user_id)
        VALUES ($1, $2, $3)
        "#,
        id,
        id,
        &macro_user_id,
    )
    .execute(pool)
    .await?;

    Ok(())
}

#[sqlx::test]
async fn insert_then_list_children(pool: Pool<Postgres>) -> anyhow::Result<()> {
    insert_user(&pool, "macro|primary@x.com").await?;
    insert_user(&pool, "macro|child-a@x.com").await?;
    insert_user(&pool, "macro|child-b@x.com").await?;

    insert_edge(&pool, "macro|primary@x.com", "macro|child-a@x.com").await?;
    insert_edge(&pool, "macro|primary@x.com", "macro|child-b@x.com").await?;

    let mut children = children_for_primary(&pool, "macro|primary@x.com").await?;
    children.sort();
    assert_eq!(children, vec!["macro|child-a@x.com", "macro|child-b@x.com"]);

    Ok(())
}

#[sqlx::test]
async fn insert_is_idempotent(pool: Pool<Postgres>) -> anyhow::Result<()> {
    insert_user(&pool, "macro|primary@x.com").await?;
    insert_user(&pool, "macro|child@x.com").await?;

    insert_edge(&pool, "macro|primary@x.com", "macro|child@x.com").await?;
    insert_edge(&pool, "macro|primary@x.com", "macro|child@x.com").await?;

    let children = children_for_primary(&pool, "macro|primary@x.com").await?;
    assert_eq!(children, vec!["macro|child@x.com"]);

    Ok(())
}

#[sqlx::test]
async fn delete_edge_removes_row(pool: Pool<Postgres>) -> anyhow::Result<()> {
    insert_user(&pool, "macro|primary@x.com").await?;
    insert_user(&pool, "macro|child@x.com").await?;

    insert_edge(&pool, "macro|primary@x.com", "macro|child@x.com").await?;
    delete_edge(&pool, "macro|primary@x.com", "macro|child@x.com").await?;

    let children = children_for_primary(&pool, "macro|primary@x.com").await?;
    assert!(children.is_empty());

    Ok(())
}

#[sqlx::test]
async fn self_referential_edge_rejected(pool: Pool<Postgres>) -> anyhow::Result<()> {
    insert_user(&pool, "macro|primary@x.com").await?;

    let result = insert_edge(&pool, "macro|primary@x.com", "macro|primary@x.com").await;
    assert!(
        result.is_err(),
        "self-referential edge should be rejected by CHECK constraint"
    );

    Ok(())
}
