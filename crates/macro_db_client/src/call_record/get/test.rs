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
