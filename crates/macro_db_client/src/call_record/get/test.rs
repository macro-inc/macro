use super::*;
use sqlx::PgPool;

const REQUESTER: &str = "macro|call-list-requester@corp.test";
const SAME_TEAM_OWNER: &str = "macro|call-list-same-team-owner@corp.test";
const OTHER_TEAM_OWNER: &str = "macro|call-list-other-team-owner@corp.test";
const OWNER_WITHOUT_TEAM: &str = "macro|call-list-owner-without-team@corp.test";
const REQUESTER_TEAM: Uuid = Uuid::from_u128(0x00000000000000000000000000001101);
const OTHER_TEAM: Uuid = Uuid::from_u128(0x00000000000000000000000000001102);

async fn insert_user(pool: &PgPool, user_id: &str) -> anyhow::Result<()> {
    let macro_user_id = Uuid::new_v4();
    let email = user_id.strip_prefix("macro|").unwrap_or(user_id);

    sqlx::query!(
        r#"
        INSERT INTO macro_user (id, username, email, stripe_customer_id)
        VALUES ($1, $2, $3, $2)
        "#,
        macro_user_id,
        user_id,
        email,
    )
    .execute(pool)
    .await?;

    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, $2, $3)"#,
        user_id,
        email,
        macro_user_id,
    )
    .execute(pool)
    .await?;

    Ok(())
}

async fn insert_team(
    pool: &PgPool,
    team_id: Uuid,
    owner_id: &str,
    member_ids: &[&str],
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"INSERT INTO team (id, name, owner_id) VALUES ($1, $2, $3)"#,
        team_id,
        format!("Call listing team {team_id}"),
        owner_id,
    )
    .execute(pool)
    .await?;

    for member_id in member_ids {
        sqlx::query!(
            r#"
            INSERT INTO team_user (user_id, team_id, team_role)
            VALUES ($1, $2, 'member')
            "#,
            member_id,
            team_id,
        )
        .execute(pool)
        .await?;
    }

    Ok(())
}

async fn insert_call_record(
    pool: &PgPool,
    owner_id: &str,
    link_share: Option<&str>,
) -> anyhow::Result<Uuid> {
    let call_id = Uuid::new_v4();
    let channel_id = Uuid::new_v4();
    let share_permission_id = Uuid::new_v4().to_string();

    sqlx::query!(
        r#"
        INSERT INTO comms_channels (id, name, channel_type, org_id, owner_id)
        VALUES ($1, 'Call listing test', 'public', NULL, $2)
        "#,
        channel_id,
        owner_id,
    )
    .execute(pool)
    .await?;

    sqlx::query!(
        r#"
        INSERT INTO "SharePermission" (
            id,
            "linkShare",
            "linkShareAccessLevel"
        )
        VALUES (
            $1,
            $2::text,
            CASE WHEN $2::text IS NULL THEN NULL ELSE 'view'::"AccessLevel" END
        )
        "#,
        share_permission_id,
        link_share,
    )
    .execute(pool)
    .await?;

    sqlx::query!(
        r#"
        INSERT INTO call_records (
            id,
            channel_id,
            room_name,
            created_by,
            started_at,
            ended_at,
            duration_ms,
            share_permission_id
        )
        VALUES ($1, $2, 'call-listing-test', $3, NOW(), NOW(), 0, $4)
        "#,
        call_id,
        channel_id,
        owner_id,
        share_permission_id,
    )
    .execute(pool)
    .await?;

    Ok(call_id)
}

fn assert_visibility(call_ids: &[Uuid], call_id: Uuid, visible: bool, case: &str) {
    assert_eq!(
        call_ids.contains(&call_id),
        visible,
        "unexpected visibility for {case} call record",
    );
}

#[sqlx::test]
async fn filters_link_shared_call_records_by_owner_team(pool: PgPool) -> anyhow::Result<()> {
    for user_id in [
        REQUESTER,
        SAME_TEAM_OWNER,
        OTHER_TEAM_OWNER,
        OWNER_WITHOUT_TEAM,
    ] {
        insert_user(&pool, user_id).await?;
    }

    insert_team(
        &pool,
        REQUESTER_TEAM,
        SAME_TEAM_OWNER,
        &[REQUESTER, SAME_TEAM_OWNER],
    )
    .await?;
    insert_team(&pool, OTHER_TEAM, OTHER_TEAM_OWNER, &[OTHER_TEAM_OWNER]).await?;

    let public = insert_call_record(&pool, OTHER_TEAM_OWNER, Some("PUBLIC")).await?;
    let no_link = insert_call_record(&pool, SAME_TEAM_OWNER, None).await?;
    let same_team = insert_call_record(&pool, SAME_TEAM_OWNER, Some("TEAM")).await?;
    let other_team = insert_call_record(&pool, OTHER_TEAM_OWNER, Some("TEAM")).await?;
    let owner_without_team = insert_call_record(&pool, OWNER_WITHOUT_TEAM, Some("TEAM")).await?;

    let call_ids = get_accessible_call_ids(&pool, REQUESTER, &[]).await?;

    assert_visibility(&call_ids, public, true, "PUBLIC");
    assert_visibility(&call_ids, no_link, false, "NULL");
    assert_visibility(&call_ids, same_team, true, "same-team TEAM");
    assert_visibility(&call_ids, other_team, false, "other-team TEAM");
    assert_visibility(
        &call_ids,
        owner_without_team,
        false,
        "TEAM with an owner without a team",
    );
    assert_eq!(call_ids.len(), 2);

    Ok(())
}

#[sqlx::test]
async fn preserves_explicit_access_and_status_filtering(pool: PgPool) -> anyhow::Result<()> {
    insert_user(&pool, REQUESTER).await?;
    insert_user(&pool, OWNER_WITHOUT_TEAM).await?;
    let call_id = insert_call_record(&pool, OWNER_WITHOUT_TEAM, None).await?;

    sqlx::query!(
        r#"
        INSERT INTO entity_access (
            entity_id,
            entity_type,
            source_id,
            source_type,
            access_level
        )
        VALUES ($1, 'call', $2, 'user', 'view')
        "#,
        call_id,
        REQUESTER,
    )
    .execute(&pool)
    .await?;

    assert_eq!(
        get_accessible_call_ids(&pool, REQUESTER, &[]).await?,
        vec![call_id],
    );
    assert_eq!(
        get_accessible_call_ids(&pool, REQUESTER, &["UNATTENDED".to_string()]).await?,
        vec![call_id],
    );
    assert!(
        get_accessible_call_ids(&pool, REQUESTER, &["ATTENDED".to_string()])
            .await?
            .is_empty(),
    );

    Ok(())
}

#[sqlx::test]
async fn standalone_record_metadata_and_search_payload_do_not_require_a_channel(
    pool: PgPool,
) -> anyhow::Result<()> {
    insert_user(&pool, REQUESTER).await?;
    let call_id = insert_call_record(&pool, REQUESTER, None).await?;
    sqlx::query!(
        "UPDATE call_records SET channel_id = NULL, custom_name = 'Customer review' WHERE id = $1",
        call_id,
    )
    .execute(&pool)
    .await?;

    let metadata = get_call_records_metadata(&pool, REQUESTER, &[call_id]).await?;
    assert_eq!(metadata.len(), 1);
    assert_eq!(metadata[0].channel_id, None);
    assert_eq!(metadata[0].custom_name.as_deref(), Some("Customer review"));
    let payload = get_call_record_search_payload(&pool, &call_id)
        .await?
        .expect("standalone recording exists");
    assert_eq!(payload.channel_id, None);
    assert_eq!(payload.channel_name, None);
    assert_eq!(payload.custom_name.as_deref(), Some("Customer review"));
    Ok(())
}

#[sqlx::test]
async fn standalone_search_requires_individual_access_even_with_team_or_public_sharing(
    pool: PgPool,
) -> anyhow::Result<()> {
    use entity_access_db_utils::{AccessLevel, EntityAccessSourceType, EntityType};

    insert_user(&pool, REQUESTER).await?;
    insert_user(&pool, SAME_TEAM_OWNER).await?;
    insert_team(
        &pool,
        REQUESTER_TEAM,
        SAME_TEAM_OWNER,
        &[REQUESTER, SAME_TEAM_OWNER],
    )
    .await?;
    let public = insert_call_record(&pool, SAME_TEAM_OWNER, Some("PUBLIC")).await?;
    let team_link = insert_call_record(&pool, SAME_TEAM_OWNER, Some("TEAM")).await?;
    let team_grant = insert_call_record(&pool, SAME_TEAM_OWNER, None).await?;
    let call_ids = [public, team_link, team_grant];

    let mut tx = pool.begin().await?;
    for call_id in call_ids {
        sqlx::query!(
            "UPDATE call_records SET channel_id = NULL WHERE id = $1",
            call_id,
        )
        .execute(tx.as_mut())
        .await?;
        entity_access_db_utils::insert_entity_access_row(
            &mut tx,
            &call_id,
            EntityType::Call,
            SAME_TEAM_OWNER,
            EntityAccessSourceType::User,
            AccessLevel::Owner,
        )
        .await?;
    }
    entity_access_db_utils::insert_entity_access_row(
        &mut tx,
        &team_grant,
        EntityType::Call,
        &REQUESTER_TEAM.to_string(),
        EntityAccessSourceType::Team,
        AccessLevel::View,
    )
    .await?;
    tx.commit().await?;

    assert!(
        get_accessible_call_ids(&pool, REQUESTER, &[])
            .await?
            .is_empty()
    );
    assert_eq!(
        get_accessible_call_ids(&pool, SAME_TEAM_OWNER, &[])
            .await?
            .len(),
        call_ids.len(),
    );

    let mut tx = pool.begin().await?;
    for call_id in call_ids {
        entity_access_db_utils::insert_entity_access_row(
            &mut tx,
            &call_id,
            EntityType::Call,
            REQUESTER,
            EntityAccessSourceType::User,
            AccessLevel::View,
        )
        .await?;
    }
    tx.commit().await?;
    assert_eq!(
        get_accessible_call_ids(&pool, REQUESTER, &[]).await?.len(),
        call_ids.len(),
    );
    Ok(())
}

const VISIBLE_CALLS_FIXTURE: &str = include_str!("fixtures/visible_calls.sql");
const ACCESSIBLE_CALL_IDS_SQL: &str = include_str!("accessible_call_ids.sql");

const VIEWER: &str = "macro|visible-viewer@example.test";
const TEAMMATE: &str = "macro|visible-teammate@example.test";
const OTHER_OWNER: &str = "macro|visible-other-owner@example.test";
const OUTSIDER: &str = "macro|visible-outsider@example.test";

/// The fixture's call ids end in `ca` and two digits.
fn calls(suffixes: &[u128]) -> Vec<Uuid> {
    let mut ids: Vec<Uuid> = suffixes
        .iter()
        .map(|suffix| Uuid::from_u128(0xca00 + suffix))
        .collect();
    ids.sort();
    ids
}

async fn visible_calls(
    pool: &PgPool,
    user_id: &str,
    statuses: &[&str],
) -> anyhow::Result<Vec<Uuid>> {
    let statuses: Vec<String> = statuses.iter().map(ToString::to_string).collect();
    let mut ids = get_accessible_call_ids(pool, user_id, &statuses).await?;
    ids.sort();
    Ok(ids)
}

#[sqlx::test]
async fn each_grant_and_link_share_shape_under_every_status_filter(
    pool: PgPool,
) -> anyhow::Result<()> {
    sqlx::raw_sql(VISIBLE_CALLS_FIXTURE).execute(&pool).await?;

    let cases: [(&str, &[&str], &[u128]); 11] = [
        (
            VIEWER,
            &[],
            &[0x01, 0x02, 0x03, 0x05, 0x06, 0x11, 0x16, 0x21, 0x22, 0x31],
        ),
        (VIEWER, &["ATTENDED"], &[0x01, 0x06, 0x16]),
        (VIEWER, &["MISSED"], &[0x02, 0x22]),
        (VIEWER, &["UNATTENDED"], &[0x03, 0x05, 0x11, 0x21, 0x31]),
        (
            VIEWER,
            &["MISSED", "UNATTENDED"],
            &[0x02, 0x03, 0x05, 0x11, 0x21, 0x22, 0x31],
        ),
        (TEAMMATE, &[], &[0x03, 0x06, 0x21, 0x22, 0x31]),
        (TEAMMATE, &["ATTENDED"], &[]),
        (OTHER_OWNER, &[], &[0x21, 0x22, 0x32, 0x42]),
        (OTHER_OWNER, &["UNATTENDED"], &[0x21, 0x22, 0x32, 0x42]),
        (OUTSIDER, &[], &[0x21, 0x22]),
        (OUTSIDER, &["MISSED"], &[]),
    ];
    for (user_id, statuses, expected) in cases {
        assert_eq!(
            visible_calls(&pool, user_id, statuses).await?,
            calls(expected),
            "{user_id} with statuses {statuses:?}",
        );
    }

    Ok(())
}

/// Calls the viewer's team holds grants on, among filler calls and grants on
/// other entities, so the tables are large enough for the planner to weigh
/// scans against lookups.
async fn seed_plan_data(pool: &PgPool) -> anyhow::Result<()> {
    sqlx::raw_sql(VISIBLE_CALLS_FIXTURE).execute(pool).await?;
    sqlx::raw_sql(
        r#"
        BEGIN;
        SET LOCAL session_replication_role = 'replica';
        INSERT INTO "SharePermission" (id, "linkShare", "linkShareAccessLevel")
        SELECT 'sp-plan-' || n, NULL, NULL FROM generate_series(1, 3000) n;
        INSERT INTO call_records (id, channel_id, room_name, created_by, started_at, ended_at, duration_ms, share_permission_id)
        SELECT md5('plan-call' || n)::uuid, md5('plan-channel' || (n % 300))::uuid, 'plan',
               'macro|plan-owner@example.test', now(), now(), 0, 'sp-plan-' || n
        FROM generate_series(1, 3000) n;
        INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
        SELECT md5('plan-call' || n)::uuid, 'call', md5('plan-channel' || (n % 300))::uuid::text,
               'channel'::entity_access_source_type, 'view'::"AccessLevel"
        FROM generate_series(1, 3000) n
        UNION ALL
        SELECT md5('plan-call' || n)::uuid, 'call', '00000000-0000-0000-0000-0000000000a1', 'team', 'view'
        FROM generate_series(1, 300) n
        UNION ALL
        SELECT md5('plan-doc' || n)::uuid, 'document', 'macro|plan-owner' || (n % 500) || '@example.test', 'user', 'owner'
        FROM generate_series(1, 30000) n;
        COMMIT;
        ANALYZE call_records;
        ANALYZE entity_access;
        ANALYZE "SharePermission";
        ANALYZE comms_channel_participants;
        ANALYZE team_user;
        "#,
    )
    .execute(pool)
    .await?;

    Ok(())
}

async fn explain_accessible_call_ids(
    connection: &mut sqlx::PgConnection,
    plan_cache_mode: &str,
) -> anyhow::Result<Vec<String>> {
    use sqlx::Row;

    sqlx::raw_sql(&format!("SET plan_cache_mode = {plan_cache_mode}"))
        .execute(&mut *connection)
        .await?;
    let rows = sqlx::raw_sql(&format!(
        "EXPLAIN (COSTS OFF) EXECUTE accessible_call_ids('{VIEWER}', '{{}}')"
    ))
    .fetch_all(&mut *connection)
    .await?;

    rows.iter()
        .map(|row| Ok(row.try_get::<String, _>(0)?))
        .collect()
}

/// The previous statement scanned every call and, for each, compared every
/// grant on it with every one of the caller's sources: seconds for a caller in
/// a few thousand channels. Under custom and generic plans alike, the grants
/// must be read by source and each granted call looked up by id.
#[sqlx::test]
async fn grants_are_read_by_source_and_granted_calls_looked_up_by_id(
    pool: PgPool,
) -> anyhow::Result<()> {
    seed_plan_data(&pool).await?;
    let mut connection = pool.acquire().await?;
    sqlx::raw_sql(&format!(
        "PREPARE accessible_call_ids(text, text[]) AS {ACCESSIBLE_CALL_IDS_SQL}"
    ))
    .execute(&mut *connection)
    .await?;

    for plan_cache_mode in ["force_custom_plan", "force_generic_plan"] {
        let plan = explain_accessible_call_ids(&mut connection, plan_cache_mode).await?;
        let plan_text = plan.join("\n");
        let nodes: Vec<&str> = plan
            .iter()
            .map(|line| line.trim_start().trim_start_matches("->").trim_start())
            .collect();

        // An index-only scan, or a bitmap scan when the visibility map is not
        // set yet: either reads the grants by source.
        let grants_by_source = nodes.windows(2).any(|pair| {
            pair[0].contains("idx_entity_access_source_type_entity_plain")
                && pair[1].starts_with("Index Cond: ((source_id = ANY")
        });
        assert!(
            grants_by_source,
            "{plan_cache_mode}: the caller's grants are read by source:\n{plan_text}"
        );
        assert!(
            nodes
                .iter()
                .any(|node| node.starts_with("Index Scan using call_records_pkey on call_records")),
            "{plan_cache_mode}: granted calls are looked up by id:\n{plan_text}"
        );
        assert!(
            nodes
                .iter()
                .filter(|node| node.contains(r#" on "SharePermission""#))
                .all(|node| node.starts_with(r#"Index Scan using "SharePermission_pkey""#)),
            "{plan_cache_mode}: share permissions are read by key:\n{plan_text}"
        );
        assert!(
            !plan_text.contains("Hash Join")
                && !plan_text.contains("Hash Semi Join")
                && !plan_text.contains("Merge Join")
                && !plan_text.contains("Nested Loop Semi Join"),
            "{plan_cache_mode}: no join compares grants with sources:\n{plan_text}"
        );
    }

    let mut expected = calls(&[0x01, 0x02, 0x03, 0x05, 0x06, 0x11, 0x16, 0x21, 0x22, 0x31]);
    expected.extend(
        sqlx::query_scalar!(
            r#"SELECT md5('plan-call' || n)::uuid AS "id!" FROM generate_series(1, 300) n"#
        )
        .fetch_all(&pool)
        .await?,
    );
    expected.sort();
    assert_eq!(visible_calls(&pool, VIEWER, &[]).await?, expected);

    Ok(())
}
