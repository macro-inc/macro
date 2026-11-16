use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;

const OWNER: &str = "macro|owner@corp.test";

async fn insert_user(pool: &PgPool, user_id: &str) {
    let macro_uuid = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $2, $2)",
        macro_uuid,
        user_id,
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, $1, $2)"#,
        user_id,
        macro_uuid,
    )
    .execute(pool)
    .await
    .unwrap();
}

/// A team owned by a new user (a user owns at most one team).
async fn insert_team(pool: &PgPool) -> Uuid {
    let team_id = Uuid::now_v7();
    let owner = format!("macro|{team_id}@corp.test");
    insert_user(pool, &owner).await;
    sqlx::query!(
        "INSERT INTO team (id, name, owner_id) VALUES ($1, 'Team', $2)",
        team_id,
        owner,
    )
    .execute(pool)
    .await
    .unwrap();
    team_id
}

async fn insert_channel(pool: &PgPool, team_id: Option<Uuid>) -> Uuid {
    let channel_id = Uuid::now_v7();
    let channel_type = if team_id.is_some() { "team" } else { "public" };
    sqlx::query!(
        r#"
        INSERT INTO comms_channels (id, name, channel_type, owner_id, team_id)
        VALUES ($1, 'Channel', $2::text::comms_channel_type, $3, $4)
        "#,
        channel_id,
        channel_type,
        OWNER,
        team_id,
    )
    .execute(pool)
    .await
    .unwrap();
    channel_id
}

async fn grant(pool: &PgPool, entity_id: Uuid, source_type: &str, source_id: &str, level: &str) {
    sqlx::query!(
        r#"
        INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
        VALUES ($1, 'document', $2, $3::text::entity_access_source_type, $4::text::"AccessLevel")
        "#,
        entity_id,
        source_id,
        source_type,
        level,
    )
    .execute(pool)
    .await
    .unwrap();
}

/// A team grant and a grant to a team's own channel give the team access; a
/// member's grant and a grant to a channel no team owns do not.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn teams_count_only_through_their_own_grants(pool: PgPool) {
    insert_user(&pool, OWNER).await;
    let granted = insert_team(&pool).await;
    let through_channel = insert_team(&pool).await;
    let ungranted = insert_team(&pool).await;
    let team_channel = insert_channel(&pool, Some(through_channel)).await;
    let plain_channel = insert_channel(&pool, None).await;
    let document = Uuid::now_v7();
    grant(&pool, document, "user", OWNER, "owner").await;
    grant(&pool, document, "team", &granted.to_string(), "view").await;
    grant(
        &pool,
        document,
        "channel",
        &team_channel.to_string(),
        "edit",
    )
    .await;
    grant(
        &pool,
        document,
        "channel",
        &plain_channel.to_string(),
        "edit",
    )
    .await;

    let mut expected = vec![granted, through_channel];
    expected.sort();
    assert_eq!(
        granted_teams(&pool, &document, EntityType::Document, None)
            .await
            .unwrap(),
        expected
    );
    assert_eq!(
        granted_teams(
            &pool,
            &document,
            EntityType::Document,
            Some(AccessLevel::Edit)
        )
        .await
        .unwrap(),
        vec![through_channel],
        "a floor counts only grants at or above it"
    );
    assert!(!expected.contains(&ungranted));

    sqlx::query!(
        "DELETE FROM entity_access WHERE entity_id = $1 AND source_type = 'team'",
        document,
    )
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(
        granted_teams(&pool, &document, EntityType::Document, None)
            .await
            .unwrap(),
        vec![through_channel],
        "a revoked team grant stops counting at once"
    );
    assert!(
        granted_teams(&pool, &Uuid::now_v7(), EntityType::Document, None)
            .await
            .unwrap()
            .is_empty()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_team_channel_belongs_to_its_team_only(pool: PgPool) {
    insert_user(&pool, OWNER).await;
    let team = insert_team(&pool).await;
    let team_channel = insert_channel(&pool, Some(team)).await;
    let plain_channel = insert_channel(&pool, None).await;

    assert_eq!(
        channel_team(&pool, &team_channel).await.unwrap(),
        Some(team)
    );
    assert_eq!(channel_team(&pool, &plain_channel).await.unwrap(), None);
    assert_eq!(channel_team(&pool, &Uuid::now_v7()).await.unwrap(), None);
}

const CRM_TEAM: Uuid = Uuid::from_u128(0x000000000000000000000000000ea001);

/// The fixture team's user with `role`.
async fn team_user(pool: &PgPool, role: &str) -> String {
    sqlx::query_scalar!(
        "SELECT user_id FROM team_user WHERE team_id = $1 AND team_role = $2::text::team_role",
        CRM_TEAM,
        role,
    )
    .fetch_one(pool)
    .await
    .unwrap()
}

/// A CRM record belongs to its team while some member may see it. Which
/// members may is per person, as `crm_entity_users` decides: CRM access
/// (`crm_access`, or a role above member), and admins only once hidden.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("user_team"))
)]
async fn crm_records_reach_only_members_with_crm_access(pool: PgPool) {
    let mut companies = Vec::new();
    for hidden in [false, true] {
        let company = Uuid::now_v7();
        sqlx::query!(
            "INSERT INTO crm_companies (id, team_id, hidden, first_interaction, last_interaction)
            VALUES ($1, $2, $3, now(), now())",
            company,
            CRM_TEAM,
            hidden,
        )
        .execute(&pool)
        .await
        .unwrap();
        companies.push(company);
    }
    let [visible, hidden] = companies[..] else {
        unreachable!("two companies were inserted");
    };
    let contact = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO crm_contacts (id, company_id, email, hidden, first_interaction, last_interaction)
        VALUES ($1, $2, 'contact@example.com', false, now(), now())",
        contact,
        hidden,
    )
    .execute(&pool)
    .await
    .unwrap();

    let admin = team_user(&pool, "admin").await;
    let member = team_user(&pool, "member").await;
    let asked = vec![admin.clone(), member.clone()];
    let viewers = |entity_id: Uuid, entity_type: EntityType| {
        let pool = pool.clone();
        let asked = asked.clone();
        async move {
            let mut viewers = crm_team_viewers(&pool, &entity_id, entity_type, &CRM_TEAM, &asked)
                .await
                .unwrap();
            viewers.sort();
            viewers
        }
    };

    for record in [visible, hidden] {
        assert_eq!(
            crm_team(&pool, &record, EntityType::CrmCompany)
                .await
                .unwrap(),
            Some(CRM_TEAM),
            "admins see even a hidden record"
        );
    }
    assert_eq!(
        crm_team(&pool, &contact, EntityType::CrmContact)
            .await
            .unwrap(),
        Some(CRM_TEAM)
    );
    assert_eq!(
        viewers(visible, EntityType::CrmCompany).await,
        vec![admin.clone(), member.clone()]
    );
    assert_eq!(
        viewers(hidden, EntityType::CrmCompany).await,
        vec![admin.clone()]
    );
    assert_eq!(
        viewers(contact, EntityType::CrmContact).await,
        vec![admin.clone()],
        "a contact of a hidden company is admins-only"
    );

    sqlx::query!(
        "UPDATE team_user SET crm_access = false WHERE user_id = $1",
        member,
    )
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(
        viewers(visible, EntityType::CrmCompany).await,
        vec![admin.clone()]
    );
    assert_eq!(
        viewers(Uuid::now_v7(), EntityType::CrmPipeline).await,
        vec![admin.clone()],
        "a pipeline needs CRM access too"
    );
    assert!(
        viewers(visible, EntityType::Document).await.is_empty(),
        "only CRM records are gated here"
    );
}
