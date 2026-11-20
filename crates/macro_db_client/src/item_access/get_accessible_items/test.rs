use super::*;
use uuid::Uuid;

const DOCUMENTS_BY_ID_SQL: &str = include_str!("documents_by_id.sql");

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
/// wrongly, for a caller with many small sources. The statement may run as a
/// cached prepared statement, so its generic plan must keep the shape too.
#[sqlx::test]
async fn documents_are_looked_up_by_granted_id_not_scanned(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    seed_team_documents(&pool, DOCUMENT_GRANTS_LOOKED_UP_BY_ID).await?;
    let granted: Vec<Uuid> =
        sqlx::query_scalar("SELECT entity_id FROM entity_access WHERE source_id = $1")
            .bind(TEAM)
            .fetch_all(&pool)
            .await?;

    for plan_cache_mode in ["force_custom_plan", "force_generic_plan"] {
        let mut connection = pool.acquire().await?;
        sqlx::raw_sql(&format!("SET plan_cache_mode = {plan_cache_mode}"))
            .execute(&mut *connection)
            .await?;
        let plan: Vec<String> =
            sqlx::query_scalar(&format!("EXPLAIN (COSTS OFF) {DOCUMENTS_BY_ID_SQL}"))
                .bind(&granted)
                .fetch_all(&mut *connection)
                .await?;
        let plan_text = plan.join("\n");

        let document_nodes: Vec<&str> = plan
            .iter()
            .map(|line| line.trim_start().trim_start_matches("->").trim_start())
            .filter(|line| line.contains(r#"on "Document""#))
            .collect();
        assert!(
            !document_nodes.is_empty()
                && document_nodes.iter().all(|node| node.starts_with("Index")),
            "every read of Document goes through an index ({plan_cache_mode}):\n{plan_text}"
        );
        assert!(
            plan_text.contains("Index Cond: (id = ("),
            "Document is read one granted id at a time ({plan_cache_mode}):\n{plan_text}"
        );
        assert!(
            !plan_text.contains("Hash Join")
                && !plan_text.contains("Hash Semi Join")
                && !plan_text.contains("Merge"),
            "the ids drive a nested loop ({plan_cache_mode}):\n{plan_text}"
        );
    }

    assert_eq!(
        team_member_documents(&pool).await?,
        usize::try_from(DOCUMENT_GRANTS_LOOKED_UP_BY_ID)?
    );

    Ok(())
}

const CHECK_TEAM: &str = "7ea30000-0000-0000-0000-000000000003";
const CHECK_CALLER: &str = "macro|check-caller@example.test";

async fn caller_documents(
    pool: &Pool<Postgres>,
    exclude_owned: bool,
) -> anyhow::Result<Vec<String>> {
    let items = get_user_accessible_items(
        pool,
        CHECK_CALLER,
        Some("document".to_string()),
        exclude_owned,
    )
    .await?;
    let mut ids: Vec<String> = items.into_iter().map(|item| item.item_id).collect();
    ids.sort();

    Ok(ids)
}

/// Two documents shared with the caller's team (one of them theirs) and one
/// shared with nobody yet.
async fn seed_checked_documents(pool: &Pool<Postgres>) -> sqlx::Result<()> {
    sqlx::raw_sql(&format!(
        r#"
        BEGIN;
        SET LOCAL session_replication_role = 'replica';
        INSERT INTO team_user (team_id, user_id, team_role)
        VALUES ('{CHECK_TEAM}', '{CHECK_CALLER}', 'member');
        INSERT INTO "Document" (id, name, owner) VALUES
            ('c4ec0000-0000-0000-0000-000000000001', 'Shared', 'macro|check-owner@example.test'),
            ('c4ec0000-0000-0000-0000-000000000002', 'Own', '{CHECK_CALLER}'),
            ('c4ec0000-0000-0000-0000-000000000003', 'Not shared yet', 'macro|check-owner@example.test');
        INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level) VALUES
            ('c4ec0000-0000-0000-0000-000000000001', 'document', '{CHECK_TEAM}', 'team', 'view'),
            ('c4ec0000-0000-0000-0000-000000000002', 'document', '{CHECK_TEAM}', 'team', 'view');
        COMMIT;
        "#
    ))
    .execute(pool)
    .await?;

    Ok(())
}

#[sqlx::test]
async fn a_lookup_reads_only_the_documents_its_caller_has_not_had_checked(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    seed_checked_documents(&pool).await?;
    let granted = |ids: &[&str]| -> anyhow::Result<Vec<Uuid>> {
        Ok(ids
            .iter()
            .map(|id| Uuid::parse_str(id))
            .collect::<Result<_, _>>()?)
    };
    let first_two = granted(&[
        "c4ec0000-0000-0000-0000-000000000001",
        "c4ec0000-0000-0000-0000-000000000002",
    ])?;

    let mut connection = pool.acquire().await?;
    let (ids, counts) = checked_documents::accessible_document_ids(
        &mut connection,
        DatabaseKey::of(&pool),
        CHECK_CALLER,
        first_two.clone(),
        false,
    )
    .await?;
    assert_eq!(
        ids,
        vec![
            "c4ec0000-0000-0000-0000-000000000001",
            "c4ec0000-0000-0000-0000-000000000002",
        ]
    );
    assert_eq!(
        counts,
        checked_documents::CheckCounts {
            checked: 2,
            reused: 0
        }
    );

    // The other variant of the lookup answers from the same checks.
    let (ids, counts) = checked_documents::accessible_document_ids(
        &mut connection,
        DatabaseKey::of(&pool),
        CHECK_CALLER,
        first_two.clone(),
        true,
    )
    .await?;
    assert_eq!(ids, vec!["c4ec0000-0000-0000-0000-000000000001"]);
    assert_eq!(
        counts,
        checked_documents::CheckCounts {
            checked: 0,
            reused: 2
        }
    );

    let mut all_three = first_two;
    all_three.extend(granted(&["c4ec0000-0000-0000-0000-000000000003"])?);
    let (ids, counts) = checked_documents::accessible_document_ids(
        &mut connection,
        DatabaseKey::of(&pool),
        CHECK_CALLER,
        all_three,
        true,
    )
    .await?;
    assert_eq!(
        ids,
        vec![
            "c4ec0000-0000-0000-0000-000000000001",
            "c4ec0000-0000-0000-0000-000000000003",
        ]
    );
    assert_eq!(
        counts,
        checked_documents::CheckCounts {
            checked: 1,
            reused: 2
        }
    );

    Ok(())
}

/// Grants are read on every lookup, so a revoked share leaves the list at
/// once and a new one joins it. A checked document's Trash state counts only
/// once its check expires.
#[sqlx::test]
async fn grants_count_at_once_and_document_checks_are_reused(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    seed_checked_documents(&pool).await?;
    assert_eq!(
        caller_documents(&pool, false).await?,
        vec![
            "c4ec0000-0000-0000-0000-000000000001",
            "c4ec0000-0000-0000-0000-000000000002",
        ]
    );

    sqlx::raw_sql(&format!(
        r#"
        BEGIN;
        SET LOCAL session_replication_role = 'replica';
        UPDATE "Document" SET "deletedAt" = now() WHERE id = 'c4ec0000-0000-0000-0000-000000000001';
        UPDATE "Document" SET "deletedAt" = now() WHERE id = 'c4ec0000-0000-0000-0000-000000000003';
        DELETE FROM entity_access WHERE entity_id = 'c4ec0000-0000-0000-0000-000000000002';
        INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
        VALUES ('c4ec0000-0000-0000-0000-000000000003', 'document', '{CHECK_TEAM}', 'team', 'view');
        COMMIT;
        "#
    ))
    .execute(&pool)
    .await?;

    // The revoked document is gone, the newly granted one is checked and found
    // in the Trash, and the already checked one stays listed.
    assert_eq!(
        caller_documents(&pool, false).await?,
        vec!["c4ec0000-0000-0000-0000-000000000001"]
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
