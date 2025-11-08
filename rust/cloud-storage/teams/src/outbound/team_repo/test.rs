use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::{Pool, Postgres};

///! Tests for the team_repo implementation for teams
use super::*;

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("teams"))
)]
async fn test_get_stripe_customer_id(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let team_repo = TeamRepositoryImpl::new(pool);

    let stripe_customer_id = team_repo
        .get_stripe_customer_id(&MacroUserId::parse_from_str("macro|user@user.com")?.lowercase())
        .await?;

    let expected_stripe_customer_id = stripe::CustomerId::from_str("cus_1234").unwrap();

    assert_eq!(stripe_customer_id, Some(expected_stripe_customer_id));

    let stripe_customer_id = team_repo
        .get_stripe_customer_id(&MacroUserId::parse_from_str("macro|user2@user.com")?.lowercase())
        .await?;

    assert!(stripe_customer_id.is_none());

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("teams"))
)]
async fn test_get_team_subscription_id(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let team_repo = TeamRepositoryImpl::new(pool);

    let subscription_id = team_repo
        .get_team_subscription_id(&macro_uuid::string_to_uuid(
            "11111111-1111-1111-1111-111111111111",
        )?)
        .await?;

    assert_eq!(
        subscription_id.map(|s| s.to_string()),
        Some("sub_1".to_string())
    );

    let subscription_id = team_repo
        .get_team_subscription_id(&macro_uuid::string_to_uuid(
            "22222222-2222-2222-2222-222222222222",
        )?)
        .await?;

    assert!(subscription_id.is_none());

    let err = team_repo
        .get_team_subscription_id(&macro_uuid::string_to_uuid(
            "63333333-3333-3333-3333-333333333333",
        )?)
        .await
        .err()
        .unwrap();

    assert!(err.to_string().contains("does not exist"));

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("teams"))
)]
async fn test_create_team(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let team_repo = TeamRepositoryImpl::new(pool);

    let user_id = MacroUserId::parse_from_str("macro|user@user.com")?.lowercase();
    let result = team_repo.create_team(&user_id, "team1").await?;

    assert!(!result.id.to_string().is_empty());
    assert_eq!(result.name, "team1");
    assert_eq!(result.owner_id, "macro|user@user.com");

    // Create team with too large a name
    let err = team_repo
        .create_team(&user_id, "12345678901234567890123456789012345678901234567890123456789000000000000000000000000000000000000000000000")
        .await
        .err()
        .unwrap();

    assert!(err.to_string().contains("team name is invalid"));

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("teams"))
)]
async fn test_invite_users_to_team(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let team_repo = TeamRepositoryImpl::new(pool);

    let user_id = MacroUserId::parse_from_str("macro|user@user.com")?.lowercase();

    let team_id = macro_uuid::string_to_uuid("11111111-1111-1111-1111-111111111111")?;

    let invites = vec![Email::parse_from_str("new@macro.com")?.lowercase()];
    let invites = non_empty::NonEmpty::new(invites.as_slice())?;

    let invited = team_repo
        .invite_users_to_team(&team_id, &user_id, invites)
        .await?;

    assert_eq!(invited.len(), 1);
    assert_eq!(invited[0].email.as_ref(), "new@macro.com");

    let invites = vec![
        Email::parse_from_str("invite@macro.com")?.lowercase(),
        Email::parse_from_str("user2@user.com")?.lowercase(),
    ];
    let invites = non_empty::NonEmpty::new(invites.as_slice())?;

    let invited = team_repo
        .invite_users_to_team(&team_id, &user_id, invites)
        .await?;

    assert!(invited.is_empty());

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("teams"))
)]
async fn test_remove_user_from_team(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let team_repo = TeamRepositoryImpl::new(pool);

    let team_id = macro_uuid::string_to_uuid("11111111-1111-1111-1111-111111111111")?;

    let user_id = MacroUserId::parse_from_str("macro|user2@user.com")?.lowercase();

    team_repo.remove_user_from_team(&team_id, &user_id).await?;

    // Try to remove user that isn't on team
    let user_id = MacroUserId::parse_from_str("macro|user3@user.com")?.lowercase();

    let err = team_repo
        .remove_user_from_team(&team_id, &user_id)
        .await
        .err()
        .unwrap();

    assert!(err.to_string().contains("not in the team"));

    // Try to remove owner
    let user_id = MacroUserId::parse_from_str("macro|user@user.com")?.lowercase();

    let err = team_repo
        .remove_user_from_team(&team_id, &user_id)
        .await
        .err()
        .unwrap();

    assert!(err.to_string().contains("Cannot remove owner"));

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("teams"))
)]
async fn test_get_team_invite_by_id(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let team_repo = TeamRepositoryImpl::new(pool);

    let invite_id = macro_uuid::string_to_uuid("11111111-1111-1111-1111-111111111111")?;
    let team_invite = team_repo.get_team_invite_by_id(&invite_id).await?;

    assert_eq!(team_invite.email.as_ref(), "invite@macro.com");

    let invite_id = macro_uuid::string_to_uuid("33333333-3333-3333-3333-333333333333")?;
    let err = team_repo
        .get_team_invite_by_id(&invite_id)
        .await
        .err()
        .unwrap();

    assert!(err.to_string().contains("The team invite does not exist"));

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("teams"))
)]
async fn test_delete_team_invite(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let team_repo = TeamRepositoryImpl::new(pool);
    let team_id = macro_uuid::string_to_uuid("11111111-1111-1111-1111-111111111111")?;

    // delete invite that exists
    team_repo
        .delete_team_invite(
            &team_id,
            &macro_uuid::string_to_uuid("11111111-1111-1111-1111-111111111111")?,
        )
        .await?;

    // delete invite that does not exist
    let err = team_repo
        .delete_team_invite(
            &team_id,
            &macro_uuid::string_to_uuid("33333333-3333-3333-3333-333333333333")?,
        )
        .await
        .err()
        .unwrap();

    println!("{}", err.to_string());
    assert!(err.to_string().contains("The team invite does not exist"));

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("teams"))
)]
async fn test_update_team_subscription(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let team_repo = TeamRepositoryImpl::new(pool.clone());

    let team_id = macro_uuid::string_to_uuid("11111111-1111-1111-1111-111111111111")?;

    let subscription_id = stripe::SubscriptionId::from_str("sub_1")?;

    team_repo
        .update_team_subscription(&team_id, &subscription_id)
        .await?;

    let team = sqlx::query!(
        r#"
        SELECT subscription_id as "subscription_id!"
        FROM team
        WHERE id = $1
        "#,
        &team_id,
    )
    .fetch_one(&pool)
    .await?;

    assert_eq!(team.subscription_id, "sub_1");

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("teams"))
)]
async fn test_delete_team(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let team_repo = TeamRepositoryImpl::new(pool.clone());

    let team_id = macro_uuid::string_to_uuid("11111111-1111-1111-1111-111111111111")?;

    team_repo.delete_team(&team_id).await?;

    let team = sqlx::query!(
        r#"
        SELECT id as id
        FROM team
        WHERE id = $1
        "#,
        &team_id,
    )
    .fetch_optional(&pool)
    .await?;

    assert!(team.is_none());

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("teams"))
)]
async fn test_get_all_team_members(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let team_repo = TeamRepositoryImpl::new(pool);

    let team_id = macro_uuid::string_to_uuid("11111111-1111-1111-1111-111111111111")?;

    let members = team_repo.get_all_team_members(&team_id).await?;

    assert_eq!(members.len(), 2);

    let results = vec![
        ("macro|user@user.com", TeamRole::Owner),
        ("macro|user2@user.com", TeamRole::Member),
    ];

    assert_eq!(
        members
            .iter()
            .map(|m| (m.user_id.as_ref(), m.role))
            .collect::<Vec<_>>(),
        results
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("teams"))
)]
async fn test_accept_team_invite(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let team_repo = TeamRepositoryImpl::new(pool);

    let team_invite_id = macro_uuid::string_to_uuid("22222222-2222-2222-2222-222222222222")?;

    let user_id = MacroUserId::parse_from_str("macro|user3@user.com")?.lowercase();

    let team_member = team_repo
        .accept_team_invite(&team_invite_id, &user_id)
        .await?;

    assert_eq!(team_member.user_id.as_ref(), "macro|user3@user.com");
    assert_eq!(team_member.role, TeamRole::Member);

    let team_invite_id = macro_uuid::string_to_uuid("33333333-3333-3333-3333-333333333333")?;
    let err = team_repo
        .accept_team_invite(&team_invite_id, &user_id)
        .await
        .err()
        .unwrap();

    assert!(err.to_string().contains("The team does not exist"));

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("teams"))
)]
async fn test_is_user_member_of_team(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let team_repo = TeamRepositoryImpl::new(pool);

    let user_id = MacroUserId::parse_from_str("macro|user@user.com")?.lowercase();

    let is_member = team_repo.is_user_member_of_team(&user_id).await?;

    assert!(!is_member);

    let user_id = MacroUserId::parse_from_str("macro|user2@user.com")?.lowercase();

    let is_member = team_repo.is_user_member_of_team(&user_id).await?;

    assert!(is_member);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("teams"))
)]
async fn test_get_team_members(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let team_repo = TeamRepositoryImpl::new(pool);

    let team_id = macro_uuid::string_to_uuid("11111111-1111-1111-1111-111111111111")?;

    let members = team_repo.get_team_members(&team_id).await?;

    assert_eq!(members.len(), 1);

    let results = vec![("macro|user2@user.com", TeamRole::Member)];

    assert_eq!(
        members
            .iter()
            .map(|m| (m.user_id.as_ref(), m.role))
            .collect::<Vec<_>>(),
        results
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("teams"))
)]
async fn test_bulk_is_member_of_other_team(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let team_repo = TeamRepositoryImpl::new(pool);

    let ignore_team_ids = vec![macro_uuid::string_to_uuid(
        "11111111-1111-1111-1111-111111111111",
    )?];

    let users = vec![
        MacroUserId::parse_from_str("macro|user@user.com")?.lowercase(),
        MacroUserId::parse_from_str("macro|user2@user.com")?.lowercase(),
    ];

    let ignore_team_ids = non_empty::NonEmpty::new(ignore_team_ids.as_slice())?;
    let users = non_empty::NonEmpty::new(users.as_slice())?;

    let result = team_repo
        .bulk_is_member_of_other_team(ignore_team_ids, users)
        .await?;

    assert_eq!(result.len(), 1);
    assert_eq!(result[0].as_ref(), "macro|user2@user.com");

    let ignore_team_ids = vec![macro_uuid::string_to_uuid(
        "33333333-3333-3333-3333-333333333333",
    )?];

    let users = vec![MacroUserId::parse_from_str("macro|user4@user.com")?.lowercase()];

    let ignore_team_ids = non_empty::NonEmpty::new(ignore_team_ids.as_slice())?;
    let users = non_empty::NonEmpty::new(users.as_slice())?;

    let result = team_repo
        .bulk_is_member_of_other_team(ignore_team_ids, users)
        .await?;

    assert!(result.is_empty());

    Ok(())
}
