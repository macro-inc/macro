use super::*;

const DOCUMENTS_BY_GRANT_SQL: &str = include_str!("documents_by_grant.sql");

const TEAM: &str = "7ea30000-0000-0000-0000-000000000002";
const TEAM_MEMBER: &str = "macro|plan-caller@example.test";

/// `documents` documents, each granted to the caller's team: the caller's
/// sources hold every document grant in the table.
async fn seed_team_documents(pool: &Pool<Postgres>, documents: i64) -> sqlx::Result<()> {
    sqlx::raw_sql(&format!(
        r#"
        BEGIN;
        SET LOCAL session_replication_role = 'replica';
        INSERT INTO team_user (team_id, user_id, team_role)
        VALUES ('{TEAM}', '{TEAM_MEMBER}', 'member');
        INSERT INTO "Document" (id, name, owner)
        SELECT md5('plan-doc' || n)::uuid::text, 'Document ' || n, 'macro|plan-owner@example.test'
        FROM generate_series(1, {documents}) n;
        INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
        SELECT md5('plan-doc' || n)::uuid, 'document', '{TEAM}', 'team', 'view'
        FROM generate_series(1, {documents}) n;
        COMMIT;
        ANALYZE "Document";
        ANALYZE entity_access;
        "#
    ))
    .execute(pool)
    .await?;

    Ok(())
}

async fn team_member_documents(pool: &Pool<Postgres>) -> anyhow::Result<usize> {
    let items =
        get_user_accessible_items(pool, TEAM_MEMBER, Some("document".to_string()), false).await?;

    Ok(items.len())
}

/// With a grant on every document, scanning the documents and hash-joining the
/// grants is the cheapest plan on paper. It is also the plan the planner picks,
/// wrongly, for a caller with many small sources.
#[sqlx::test]
async fn documents_are_looked_up_by_granted_id_not_scanned(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    seed_team_documents(&pool, DOCUMENT_GRANTS_LOOKED_UP_BY_ID).await?;

    let plan: Vec<String> =
        sqlx::query_scalar(&format!("EXPLAIN (COSTS OFF) {DOCUMENTS_BY_GRANT_SQL}"))
            .bind(TEAM_MEMBER)
            .bind(vec![TEAM_MEMBER.to_string(), TEAM.to_string()])
            .bind(false)
            .fetch_all(&pool)
            .await?;
    let plan_text = plan.join("\n");

    let document_nodes: Vec<&str> = plan
        .iter()
        .map(|line| line.trim_start().trim_start_matches("->").trim_start())
        .filter(|line| line.contains(r#"on "Document""#))
        .collect();
    assert!(
        !document_nodes.is_empty() && document_nodes.iter().all(|node| node.starts_with("Index")),
        "every read of Document goes through an index:\n{plan_text}"
    );
    assert!(
        plan_text.contains("Index Cond: (id = ("),
        "Document is read one granted id at a time:\n{plan_text}"
    );
    assert!(
        !plan_text.contains("Hash Join")
            && !plan_text.contains("Hash Semi Join")
            && !plan_text.contains("Merge"),
        "the grants drive a nested loop:\n{plan_text}"
    );

    assert_eq!(
        team_member_documents(&pool).await?,
        usize::try_from(DOCUMENT_GRANTS_LOOKED_UP_BY_ID)?
    );

    Ok(())
}

#[sqlx::test]
async fn a_caller_over_the_lookup_limit_gets_every_document(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let documents = DOCUMENT_GRANTS_LOOKED_UP_BY_ID + 500;
    seed_team_documents(&pool, documents).await?;

    assert_eq!(
        team_member_documents(&pool).await?,
        usize::try_from(documents)?
    );

    Ok(())
}

#[sqlx::test]
async fn a_document_granted_through_several_sources_is_listed_once(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    sqlx::raw_sql(
        r#"
        BEGIN;
        SET LOCAL session_replication_role = 'replica';
        INSERT INTO team_user (team_id, user_id, team_role)
        VALUES ('7ea30000-0000-0000-0000-000000000001', 'macro|dup-caller@example.test', 'member');
        INSERT INTO "Document" (id, name, owner, "deletedAt") VALUES
            ('d0c00000-0000-0000-0000-000000000001', 'Shared twice', 'macro|dup-owner@example.test', NULL),
            ('d0c00000-0000-0000-0000-000000000002', 'Own, shared to the team', 'macro|dup-caller@example.test', NULL),
            ('d0c00000-0000-0000-0000-000000000003', 'Deleted', 'macro|dup-owner@example.test', now());
        INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level) VALUES
            ('d0c00000-0000-0000-0000-000000000001', 'document', 'macro|dup-caller@example.test', 'user', 'view'),
            ('d0c00000-0000-0000-0000-000000000001', 'document', '7ea30000-0000-0000-0000-000000000001', 'team', 'edit'),
            ('d0c00000-0000-0000-0000-000000000002', 'document', 'macro|dup-caller@example.test', 'user', 'owner'),
            ('d0c00000-0000-0000-0000-000000000002', 'document', '7ea30000-0000-0000-0000-000000000001', 'team', 'view'),
            ('d0c00000-0000-0000-0000-000000000003', 'document', 'macro|dup-caller@example.test', 'user', 'view'),
            ('d0c00000-0000-0000-0000-000000000003', 'document', '7ea30000-0000-0000-0000-000000000001', 'team', 'view'),
            ('d0c00000-0000-0000-0000-000000000004', 'document', '7ea30000-0000-0000-0000-000000000001', 'team', 'view'),
            ('d0c00000-0000-0000-0000-000000000001', 'chat', '7ea30000-0000-0000-0000-000000000001', 'team', 'view');
        COMMIT;
        "#,
    )
    .execute(&pool)
    .await?;

    let ids = |items: Vec<UserAccessibleItem>| {
        let mut ids: Vec<String> = items.into_iter().map(|item| item.item_id).collect();
        ids.sort();
        ids
    };

    let all = get_user_accessible_items(
        &pool,
        "macro|dup-caller@example.test",
        Some("document".to_string()),
        false,
    )
    .await?;
    assert_eq!(
        ids(all),
        vec![
            "d0c00000-0000-0000-0000-000000000001",
            "d0c00000-0000-0000-0000-000000000002",
        ]
    );

    let not_owned = get_user_accessible_items(
        &pool,
        "macro|dup-caller@example.test",
        Some("document".to_string()),
        true,
    )
    .await?;
    assert_eq!(ids(not_owned), vec!["d0c00000-0000-0000-0000-000000000001"]);

    Ok(())
}
