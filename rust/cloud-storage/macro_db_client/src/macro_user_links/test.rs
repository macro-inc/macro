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

async fn insert_link(pool: &Pool<Postgres>, macro_id: &str, email: &str) -> anyhow::Result<Uuid> {
    let link_id = macro_uuid::generate_uuid_v7();
    sqlx::query!(
        r#"
        INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider)
        VALUES ($1, $2, $2, $3, 'GMAIL')
        "#,
        link_id,
        macro_id,
        email,
    )
    .execute(pool)
    .await?;

    Ok(link_id)
}

#[sqlx::test]
async fn insert_then_list_children(pool: Pool<Postgres>) -> anyhow::Result<()> {
    insert_user(&pool, "macro|primary@x.com").await?;
    insert_user(&pool, "macro|child-a@x.com").await?;
    insert_user(&pool, "macro|child-b@x.com").await?;
    let link_a = insert_link(&pool, "macro|child-a@x.com", "child-a@x.com").await?;
    let link_b = insert_link(&pool, "macro|child-b@x.com", "child-b@x.com").await?;

    insert_edge(&pool, "macro|primary@x.com", "macro|child-a@x.com", link_a).await?;
    insert_edge(&pool, "macro|primary@x.com", "macro|child-b@x.com", link_b).await?;

    let mut children = children_for_primary(&pool, "macro|primary@x.com").await?;
    children.sort();
    assert_eq!(children, vec!["macro|child-a@x.com", "macro|child-b@x.com"]);

    Ok(())
}

#[sqlx::test]
async fn insert_is_idempotent(pool: Pool<Postgres>) -> anyhow::Result<()> {
    insert_user(&pool, "macro|primary@x.com").await?;
    insert_user(&pool, "macro|child@x.com").await?;
    let link = insert_link(&pool, "macro|child@x.com", "child@x.com").await?;

    insert_edge(&pool, "macro|primary@x.com", "macro|child@x.com", link).await?;
    insert_edge(&pool, "macro|primary@x.com", "macro|child@x.com", link).await?;

    let children = children_for_primary(&pool, "macro|primary@x.com").await?;
    assert_eq!(children, vec!["macro|child@x.com"]);

    Ok(())
}

#[sqlx::test]
async fn delete_edge_removes_row(pool: Pool<Postgres>) -> anyhow::Result<()> {
    insert_user(&pool, "macro|primary@x.com").await?;
    insert_user(&pool, "macro|child@x.com").await?;
    let link = insert_link(&pool, "macro|child@x.com", "child@x.com").await?;

    insert_edge(&pool, "macro|primary@x.com", "macro|child@x.com", link).await?;
    delete_edge(&pool, "macro|primary@x.com", "macro|child@x.com", link).await?;

    let children = children_for_primary(&pool, "macro|primary@x.com").await?;
    assert!(children.is_empty());

    Ok(())
}

#[sqlx::test]
async fn edge_exists_reflects_delegation(pool: Pool<Postgres>) -> anyhow::Result<()> {
    insert_user(&pool, "macro|primary@x.com").await?;
    insert_user(&pool, "macro|child@x.com").await?;
    let link = insert_link(&pool, "macro|child@x.com", "child@x.com").await?;

    assert!(!edge_exists(&pool, "macro|primary@x.com", "macro|child@x.com", link).await?);

    insert_edge(&pool, "macro|primary@x.com", "macro|child@x.com", link).await?;
    assert!(edge_exists(&pool, "macro|primary@x.com", "macro|child@x.com", link).await?);

    // Direction matters: the reverse edge must not exist.
    assert!(!edge_exists(&pool, "macro|child@x.com", "macro|primary@x.com", link).await?);

    delete_edge(&pool, "macro|primary@x.com", "macro|child@x.com", link).await?;
    assert!(!edge_exists(&pool, "macro|primary@x.com", "macro|child@x.com", link).await?);

    Ok(())
}

#[sqlx::test]
async fn scoped_edge_does_not_grant_other_links(pool: Pool<Postgres>) -> anyhow::Result<()> {
    insert_user(&pool, "macro|primary@x.com").await?;
    insert_user(&pool, "macro|child@x.com").await?;
    let link_a = insert_link(&pool, "macro|child@x.com", "child@x.com").await?;

    insert_edge(&pool, "macro|primary@x.com", "macro|child@x.com", link_a).await?;

    // The child connects a second inbox after the edge was granted; the scoped
    // delegate must not gain access to it.
    let link_b = insert_link(&pool, "macro|child@x.com", "child-second@x.com").await?;
    assert!(edge_exists(&pool, "macro|primary@x.com", "macro|child@x.com", link_a).await?);
    assert!(!edge_exists(&pool, "macro|primary@x.com", "macro|child@x.com", link_b).await?);

    Ok(())
}

#[sqlx::test]
async fn deleting_link_cascades_scoped_edge(pool: Pool<Postgres>) -> anyhow::Result<()> {
    insert_user(&pool, "macro|primary@x.com").await?;
    insert_user(&pool, "macro|child@x.com").await?;
    let link = insert_link(&pool, "macro|child@x.com", "child@x.com").await?;

    insert_edge(&pool, "macro|primary@x.com", "macro|child@x.com", link).await?;

    sqlx::query!(r#"DELETE FROM email_links WHERE id = $1"#, link)
        .execute(&pool)
        .await?;

    assert!(!edge_exists(&pool, "macro|primary@x.com", "macro|child@x.com", link).await?);
    assert!(
        children_for_primary(&pool, "macro|primary@x.com")
            .await?
            .is_empty()
    );

    Ok(())
}

#[sqlx::test]
async fn get_primaries_for_child_returns_all_grantees(pool: Pool<Postgres>) -> anyhow::Result<()> {
    insert_user(&pool, "macro|primary-a@x.com").await?;
    insert_user(&pool, "macro|primary-b@x.com").await?;
    insert_user(&pool, "macro|owner@x.com").await?;
    insert_user(&pool, "macro|lonely@x.com").await?;
    let owner_link = insert_link(&pool, "macro|owner@x.com", "owner@x.com").await?;

    insert_edge(
        &pool,
        "macro|primary-a@x.com",
        "macro|owner@x.com",
        owner_link,
    )
    .await?;
    insert_edge(
        &pool,
        "macro|primary-b@x.com",
        "macro|owner@x.com",
        owner_link,
    )
    .await?;

    let mut primaries = get_primaries_for_child(&pool, "macro|owner@x.com").await?;
    primaries.sort();
    assert_eq!(
        primaries,
        vec!["macro|primary-a@x.com", "macro|primary-b@x.com"]
    );

    // A child nobody delegates from yields no primaries.
    assert!(
        get_primaries_for_child(&pool, "macro|lonely@x.com")
            .await?
            .is_empty()
    );

    // Direction matters: querying a primary as if it were a child returns nothing.
    assert!(
        get_primaries_for_child(&pool, "macro|primary-a@x.com")
            .await?
            .is_empty()
    );

    Ok(())
}

#[sqlx::test]
async fn get_primaries_for_link_honors_scope(pool: Pool<Postgres>) -> anyhow::Result<()> {
    insert_user(&pool, "macro|primary-a@x.com").await?;
    insert_user(&pool, "macro|primary-b@x.com").await?;
    insert_user(&pool, "macro|owner@x.com").await?;
    let link_a = insert_link(&pool, "macro|owner@x.com", "owner@x.com").await?;
    let link_b = insert_link(&pool, "macro|owner@x.com", "owner-second@x.com").await?;

    insert_edge(&pool, "macro|primary-a@x.com", "macro|owner@x.com", link_a).await?;
    insert_edge(&pool, "macro|primary-b@x.com", "macro|owner@x.com", link_b).await?;

    assert_eq!(
        get_primaries_for_link(&pool, "macro|owner@x.com", link_a).await?,
        vec!["macro|primary-a@x.com"]
    );
    assert_eq!(
        get_primaries_for_link(&pool, "macro|owner@x.com", link_b).await?,
        vec!["macro|primary-b@x.com"]
    );

    Ok(())
}

#[sqlx::test]
async fn insert_edge_within_transaction_commits(pool: Pool<Postgres>) -> anyhow::Result<()> {
    insert_user(&pool, "macro|primary@x.com").await?;
    insert_user(&pool, "macro|child@x.com").await?;
    let link = insert_link(&pool, "macro|child@x.com", "child@x.com").await?;

    let mut tx = pool.begin().await?;
    insert_edge(&mut *tx, "macro|primary@x.com", "macro|child@x.com", link).await?;
    // Not visible outside the transaction until commit.
    assert!(!edge_exists(&pool, "macro|primary@x.com", "macro|child@x.com", link).await?);
    tx.commit().await?;

    assert!(edge_exists(&pool, "macro|primary@x.com", "macro|child@x.com", link).await?);

    Ok(())
}

#[sqlx::test]
async fn self_referential_edge_rejected(pool: Pool<Postgres>) -> anyhow::Result<()> {
    insert_user(&pool, "macro|primary@x.com").await?;
    let link = insert_link(&pool, "macro|primary@x.com", "primary@x.com").await?;

    let result = insert_edge(&pool, "macro|primary@x.com", "macro|primary@x.com", link).await;
    assert!(
        result.is_err(),
        "self-referential edge should be rejected by CHECK constraint"
    );

    Ok(())
}
