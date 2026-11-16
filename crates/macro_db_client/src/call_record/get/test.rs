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

const IMPORT_PARTICIPANT: Uuid = Uuid::from_u128(0x2101);
const IMPORT_TRANSCRIPT: Uuid = Uuid::from_u128(0x2102);

/// An imported meeting with its owner's grant, a public link (which must not
/// make it findable), one attendee, and two segments: one labelled with the
/// attendee's name, one with an unknown speaker.
async fn insert_imported_call(
    pool: &PgPool,
    owner_id: &str,
    call_id: Uuid,
    started_at: DateTime<Utc>,
) -> anyhow::Result<()> {
    use entity_access_db_utils::{AccessLevel, EntityAccessSourceType, EntityType};

    let mut tx = pool.begin().await?;
    sqlx::query!(
        r#"INSERT INTO "SharePermission" (id, "linkShare", "linkShareAccessLevel")
        VALUES ($1, 'PUBLIC', 'view')"#,
        call_id.to_string(),
    )
    .execute(tx.as_mut())
    .await?;
    sqlx::query!(
        r#"
        INSERT INTO call_entities (id, user_id, title, created_via, started_at, share_permission_id)
        VALUES ($1, $2, 'Pricing review', 'import', $3, $4)
        "#,
        call_id,
        owner_id,
        started_at,
        call_id.to_string(),
    )
    .execute(tx.as_mut())
    .await?;
    entity_access_db_utils::insert_entity_access_row(
        &mut tx,
        &call_id,
        EntityType::Call,
        owner_id,
        EntityAccessSourceType::User,
        AccessLevel::Owner,
    )
    .await?;
    sqlx::query!(
        r#"
        INSERT INTO call_entity_participants (call_id, id, display_name) VALUES ($1, $2, 'Ada');
        "#,
        call_id,
        IMPORT_PARTICIPANT,
    )
    .execute(tx.as_mut())
    .await?;
    sqlx::query!(
        "INSERT INTO call_entity_transcripts (call_id, id) VALUES ($1, $2)",
        call_id,
        IMPORT_TRANSCRIPT,
    )
    .execute(tx.as_mut())
    .await?;
    sqlx::query!(
        r#"
        INSERT INTO call_entity_transcript_segments
            (call_id, transcript_id, sequence_num, speaker_label, content, start_ms)
        VALUES
            ($1, $2, 0, 'ada', 'The renewal quote is ready', 0),
            ($1, $2, 1, 'Someone else', 'Send it over', 2000)
        "#,
        call_id,
        IMPORT_TRANSCRIPT,
    )
    .execute(tx.as_mut())
    .await?;
    tx.commit().await?;
    Ok(())
}

#[sqlx::test]
async fn imported_call_is_found_only_by_its_owner_and_individual_grantees(
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
    let call_id = Uuid::from_u128(0x2001);
    insert_imported_call(&pool, SAME_TEAM_OWNER, call_id, Utc::now()).await?;

    let mut tx = pool.begin().await?;
    entity_access_db_utils::insert_entity_access_row(
        &mut tx,
        &call_id,
        EntityType::Call,
        &REQUESTER_TEAM.to_string(),
        EntityAccessSourceType::Team,
        AccessLevel::View,
    )
    .await?;
    tx.commit().await?;

    assert_eq!(
        get_accessible_call_ids(&pool, SAME_TEAM_OWNER, &["ATTENDED".to_string()]).await?,
        vec![call_id],
    );
    // Neither the team grant nor the public link makes it findable.
    assert!(
        get_accessible_call_ids(&pool, REQUESTER, &[])
            .await?
            .is_empty()
    );

    let mut tx = pool.begin().await?;
    entity_access_db_utils::insert_entity_access_row(
        &mut tx,
        &call_id,
        EntityType::Call,
        REQUESTER,
        EntityAccessSourceType::User,
        AccessLevel::View,
    )
    .await?;
    tx.commit().await?;
    assert_eq!(
        get_accessible_call_ids(&pool, REQUESTER, &["UNATTENDED".to_string()]).await?,
        vec![call_id],
    );
    let metadata = get_call_records_metadata(&pool, REQUESTER, &[call_id]).await?;
    assert_eq!(metadata[0].custom_name.as_deref(), Some("Pricing review"));
    Ok(())
}

#[sqlx::test]
async fn imported_call_search_payload_matches_the_detail_view(pool: PgPool) -> anyhow::Result<()> {
    insert_user(&pool, REQUESTER).await?;
    let call_id = Uuid::from_u128(0x2001);
    let started_at = Utc::now();
    insert_imported_call(&pool, REQUESTER, call_id, started_at).await?;

    let payload = get_call_record_search_payload(&pool, &call_id)
        .await?
        .expect("imported call exists");
    assert_eq!(payload.custom_name.as_deref(), Some("Pricing review"));
    let segments = &payload.segments;
    assert_eq!(segments[0].content, "The renewal quote is ready");
    // The label names the attendee, so the segment is theirs.
    assert_eq!(segments[0].speaker_id, IMPORT_PARTICIPANT.to_string());
    assert_eq!(segments[1].speaker_id, "Someone else");
    assert_eq!(
        segments[1].started_at,
        started_at + chrono::Duration::milliseconds(2_000)
    );
    Ok(())
}
