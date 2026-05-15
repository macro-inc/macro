use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::{Pool, Postgres, Row};

///! Tests for the team_repo implementation for teams
use super::*;

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("teams"))
)]
async fn test_get_stripe_customer_id(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let team_repo = TeamRepositoryImpl::new(pool);

    let stripe_customer_id = team_repo
        .get_stripe_customer_id(&MacroUserIdStr::parse_from_str("macro|user@user.com")?)
        .await?;

    let expected_stripe_customer_id = stripe::CustomerId::from_str("cus_1234").unwrap();

    assert_eq!(stripe_customer_id, Some(expected_stripe_customer_id));

    let stripe_customer_id = team_repo
        .get_stripe_customer_id(&MacroUserIdStr::parse_from_str("macro|user2@user.com")?)
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

    let user_id = MacroUserIdStr::parse_from_str("macro|user3@user.com")?;
    let result = team_repo.create_team(&user_id, "team1").await?;

    assert!(!result.id.to_string().is_empty());
    assert_eq!(result.name, "team1");
    assert_eq!(result.owner_id.0.as_ref(), "macro|user3@user.com");

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

    let user_id = MacroUserIdStr::parse_from_str("macro|user@user.com")?;

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

/// Re-inviting an already-invited user within the 5-minute window should not
/// return them (rate limited), so the result should be empty.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("teams"))
)]
async fn test_invite_existing_user_within_rate_limit(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let team_repo = TeamRepositoryImpl::new(pool);
    let user_id = MacroUserIdStr::parse_from_str("macro|user@user.com")?;
    let team_id = macro_uuid::string_to_uuid("11111111-1111-1111-1111-111111111111")?;

    // invite@macro.com already has an invite with last_sent_at = NOW() in the fixture
    let invites = vec![Email::parse_from_str("invite@macro.com")?.lowercase()];
    let invites = non_empty::NonEmpty::new(invites.as_slice())?;

    let invited = team_repo
        .invite_users_to_team(&team_id, &user_id, invites)
        .await?;

    // Rate limit blocks re-send, no new invite created either
    assert!(invited.is_empty());

    Ok(())
}

/// Re-inviting an already-invited user after the 5-minute window has passed
/// should return them (re-sent).
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("teams"))
)]
async fn test_invite_existing_user_after_rate_limit(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let team_repo = TeamRepositoryImpl::new(pool.clone());
    let user_id = MacroUserIdStr::parse_from_str("macro|user@user.com")?;
    let team_id = macro_uuid::string_to_uuid("11111111-1111-1111-1111-111111111111")?;

    // Push last_sent_at back 10 minutes so the rate limit window has passed
    sqlx::query!(
        r#"UPDATE team_invite SET last_sent_at = NOW() - INTERVAL '10 minutes' WHERE team_id = $1 AND email = 'invite@macro.com'"#,
        &team_id,
    )
    .execute(&pool)
    .await?;

    let invites = vec![Email::parse_from_str("invite@macro.com")?.lowercase()];
    let invites = non_empty::NonEmpty::new(invites.as_slice())?;

    let invited = team_repo
        .invite_users_to_team(&team_id, &user_id, invites)
        .await?;

    assert_eq!(invited.len(), 1);
    assert_eq!(invited[0].email.as_ref(), "invite@macro.com");

    Ok(())
}

/// Inviting a mix of new users and existing users (past rate limit) should
/// return both.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("teams"))
)]
async fn test_invite_mix_new_and_existing(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let team_repo = TeamRepositoryImpl::new(pool.clone());
    let user_id = MacroUserIdStr::parse_from_str("macro|user@user.com")?;
    let team_id = macro_uuid::string_to_uuid("11111111-1111-1111-1111-111111111111")?;

    // Push existing invite past the rate limit window
    sqlx::query!(
        r#"UPDATE team_invite SET last_sent_at = NOW() - INTERVAL '10 minutes' WHERE team_id = $1 AND email = 'invite@macro.com'"#,
        &team_id,
    )
    .execute(&pool)
    .await?;

    let invites = vec![
        Email::parse_from_str("brand-new@macro.com")?.lowercase(),
        Email::parse_from_str("invite@macro.com")?.lowercase(),
    ];
    let invites = non_empty::NonEmpty::new(invites.as_slice())?;

    let invited = team_repo
        .invite_users_to_team(&team_id, &user_id, invites)
        .await?;

    assert_eq!(invited.len(), 2);

    let emails: Vec<&str> = invited.iter().map(|i| i.email.as_ref()).collect();
    assert!(emails.contains(&"brand-new@macro.com"));
    assert!(emails.contains(&"invite@macro.com"));

    Ok(())
}

/// Re-inviting updates last_sent_at (via mark_invites_sent) so a second
/// immediate re-invite is rate limited.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("teams"))
)]
async fn test_reinvite_updates_last_sent_at(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let team_repo = TeamRepositoryImpl::new(pool.clone());
    let user_id = MacroUserIdStr::parse_from_str("macro|user@user.com")?;
    let team_id = macro_uuid::string_to_uuid("11111111-1111-1111-1111-111111111111")?;

    // Push past rate limit
    sqlx::query!(
        r#"UPDATE team_invite SET last_sent_at = NOW() - INTERVAL '10 minutes' WHERE team_id = $1 AND email = 'invite@macro.com'"#,
        &team_id,
    )
    .execute(&pool)
    .await?;

    // First re-invite should succeed
    let invites = vec![Email::parse_from_str("invite@macro.com")?.lowercase()];
    let invites = non_empty::NonEmpty::new(invites.as_slice())?;
    let invited = team_repo
        .invite_users_to_team(&team_id, &user_id, invites)
        .await?;
    assert_eq!(invited.len(), 1);

    // Mark the invite as sent (simulating successful notification delivery)
    let sent_ids: Vec<uuid::Uuid> = invited.iter().map(|i| i.team_invite_id).collect();
    team_repo.mark_invites_sent(&sent_ids).await?;

    // Second immediate re-invite should be rate limited
    let invites = vec![Email::parse_from_str("invite@macro.com")?.lowercase()];
    let invites = non_empty::NonEmpty::new(invites.as_slice())?;
    let invited = team_repo
        .invite_users_to_team(&team_id, &user_id, invites)
        .await?;
    assert!(invited.is_empty());

    Ok(())
}

/// invite_users_to_team does NOT update last_sent_at by itself; without a
/// subsequent mark_invites_sent call, the invite remains eligible for resend.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("teams"))
)]
async fn test_resend_without_mark_sent_stays_eligible(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let team_repo = TeamRepositoryImpl::new(pool.clone());
    let user_id = MacroUserIdStr::parse_from_str("macro|user@user.com")?;
    let team_id = macro_uuid::string_to_uuid("11111111-1111-1111-1111-111111111111")?;

    // Push past rate limit
    sqlx::query!(
        r#"UPDATE team_invite SET last_sent_at = NOW() - INTERVAL '10 minutes' WHERE team_id = $1 AND email = 'invite@macro.com'"#,
        &team_id,
    )
    .execute(&pool)
    .await?;

    // First re-invite returns the invite
    let invites = vec![Email::parse_from_str("invite@macro.com")?.lowercase()];
    let invites = non_empty::NonEmpty::new(invites.as_slice())?;
    let invited = team_repo
        .invite_users_to_team(&team_id, &user_id, invites)
        .await?;
    assert_eq!(invited.len(), 1);

    // Do NOT call mark_invites_sent (simulating failed notification delivery)

    // Second re-invite should still return the invite because last_sent_at was not updated
    let invites = vec![Email::parse_from_str("invite@macro.com")?.lowercase()];
    let invites = non_empty::NonEmpty::new(invites.as_slice())?;
    let invited = team_repo
        .invite_users_to_team(&team_id, &user_id, invites)
        .await?;
    assert_eq!(invited.len(), 1);

    Ok(())
}

/// mark_invites_sent updates last_sent_at for the specified invite IDs.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("teams"))
)]
async fn test_mark_invites_sent(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let team_repo = TeamRepositoryImpl::new(pool.clone());
    let team_id = macro_uuid::string_to_uuid("11111111-1111-1111-1111-111111111111")?;
    let invite_id = macro_uuid::string_to_uuid("11111111-1111-1111-1111-111111111111")?;

    // Push last_sent_at back so it's past the rate limit
    sqlx::query!(
        r#"UPDATE team_invite SET last_sent_at = NOW() - INTERVAL '10 minutes' WHERE id = $1"#,
        &invite_id,
    )
    .execute(&pool)
    .await?;

    // Verify the invite is past rate limit by reading last_sent_at
    let before = sqlx::query!(
        r#"SELECT last_sent_at FROM team_invite WHERE id = $1"#,
        &invite_id,
    )
    .fetch_one(&pool)
    .await?;

    team_repo.mark_invites_sent(&[invite_id]).await?;

    let after = sqlx::query!(
        r#"SELECT last_sent_at FROM team_invite WHERE id = $1"#,
        &invite_id,
    )
    .fetch_one(&pool)
    .await?;

    // last_sent_at should have been updated to a more recent timestamp
    assert!(after.last_sent_at > before.last_sent_at);

    // The invite should now be rate limited
    let user_id = MacroUserIdStr::parse_from_str("macro|user@user.com")?;
    let invites = vec![Email::parse_from_str("invite@macro.com")?.lowercase()];
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

    let user_id = MacroUserIdStr::parse_from_str("macro|user2@user.com")?;

    team_repo.remove_user_from_team(&team_id, &user_id).await?;

    // Try to remove user that isn't on team
    let user_id = MacroUserIdStr::parse_from_str("macro|user3@user.com")?;

    let err = team_repo
        .remove_user_from_team(&team_id, &user_id)
        .await
        .err()
        .unwrap();

    assert!(err.to_string().contains("not in the team"));

    // Try to remove owner
    let user_id = MacroUserIdStr::parse_from_str("macro|user@user.com")?;

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

    let user_id = MacroUserIdStr::parse_from_str("macro|user3@user.com")?;

    let accepted_invite = team_repo
        .accept_team_invite(&team_invite_id, &user_id)
        .await?;
    let team_member = accepted_invite.member;

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
async fn test_rollback_accept_team_invite(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let team_repo = TeamRepositoryImpl::new(pool.clone());

    let team_id = macro_uuid::string_to_uuid("11111111-1111-1111-1111-111111111111")?;
    let team_invite_id = macro_uuid::string_to_uuid("22222222-2222-2222-2222-222222222222")?;
    let user_id = MacroUserIdStr::parse_from_str("macro|user3@user.com")?;

    let accepted_invite = team_repo
        .accept_team_invite(&team_invite_id, &user_id)
        .await?;

    team_repo
        .rollback_accept_team_invite(&accepted_invite)
        .await?;

    let member = sqlx::query(
        r#"
        SELECT 1
        FROM team_user
        WHERE team_id = $1 AND user_id = $2
        "#,
    )
    .bind(team_id)
    .bind(user_id.as_ref())
    .fetch_optional(&pool)
    .await?;
    assert!(member.is_none());

    let invite = sqlx::query(
        r#"
        SELECT email, team_role
        FROM team_invite
        WHERE id = $1
        "#,
    )
    .bind(team_invite_id)
    .fetch_one(&pool)
    .await?;
    assert_eq!(invite.try_get::<String, _>("email")?, "user3@user.com");
    assert_eq!(
        invite.try_get::<TeamRole, _>("team_role")?,
        TeamRole::Member
    );

    let team = sqlx::query(r#"SELECT seat_count FROM team WHERE id = $1"#)
        .bind(team_id)
        .fetch_one(&pool)
        .await?;
    assert_eq!(team.try_get::<i32, _>("seat_count")?, 3);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("teams"))
)]
async fn test_rollback_remove_user_from_team(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let team_repo = TeamRepositoryImpl::new(pool.clone());

    let team_id = macro_uuid::string_to_uuid("11111111-1111-1111-1111-111111111111")?;
    let user_id = MacroUserIdStr::parse_from_str("macro|user2@user.com")?;

    team_repo
        .patch_team_user_role(&team_id, &user_id, TeamRole::Admin)
        .await?;

    let removed_member = team_repo.remove_user_from_team(&team_id, &user_id).await?;
    assert_eq!(removed_member.role, TeamRole::Admin);

    team_repo
        .rollback_remove_user_from_team(&removed_member)
        .await?;

    let member = team_repo.get_team_member(&team_id, &user_id).await?;
    assert_eq!(member.role, TeamRole::Admin);

    let team = sqlx::query(r#"SELECT seat_count FROM team WHERE id = $1"#)
        .bind(team_id)
        .fetch_one(&pool)
        .await?;
    assert_eq!(team.try_get::<i32, _>("seat_count")?, 3);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("teams"))
)]
async fn test_is_user_member_of_team(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let team_repo = TeamRepositoryImpl::new(pool);

    // user@user.com is an owner on team1
    let user_id = MacroUserIdStr::parse_from_str("macro|user@user.com")?;
    let is_member = team_repo.is_user_member_of_team(&user_id).await?;
    assert!(is_member);

    // user2@user.com is a member of team1
    let user_id = MacroUserIdStr::parse_from_str("macro|user2@user.com")?;
    let is_member = team_repo.is_user_member_of_team(&user_id).await?;
    assert!(is_member);

    // user3@user.com is not in any team
    let user_id = MacroUserIdStr::parse_from_str("macro|user3@user.com")?;
    let is_member = team_repo.is_user_member_of_team(&user_id).await?;
    assert!(!is_member);

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

    assert_eq!(members.len(), 2);

    let expected = vec!["macro|user2@user.com", "macro|user@user.com"];

    let mut results = members
        .iter()
        .map(|m| m.user_id.as_ref())
        .collect::<Vec<&str>>();

    results.sort();

    assert_eq!(results, expected);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("teams"))
)]
async fn test_bump_seat_count_positive(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let team_id = macro_uuid::string_to_uuid("11111111-1111-1111-1111-111111111111")?;

    let mut transaction = pool.begin().await?;
    TeamRepositoryImpl::bump_seat_count(&mut transaction, &team_id, 2).await?;
    transaction.commit().await?;

    let row = sqlx::query!(r#"SELECT seat_count FROM team WHERE id = $1"#, &team_id,)
        .fetch_one(&pool)
        .await?;

    assert_eq!(row.seat_count, 5); // 3 + 2

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("teams"))
)]
async fn test_bump_seat_count_negative(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let team_id = macro_uuid::string_to_uuid("11111111-1111-1111-1111-111111111111")?;

    let mut transaction = pool.begin().await?;
    TeamRepositoryImpl::bump_seat_count(&mut transaction, &team_id, -1).await?;
    transaction.commit().await?;

    let row = sqlx::query!(r#"SELECT seat_count FROM team WHERE id = $1"#, &team_id,)
        .fetch_one(&pool)
        .await?;

    assert_eq!(row.seat_count, 2); // 3 - 1

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("teams"))
)]
async fn test_get_team_seat_count(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let team_repo = TeamRepositoryImpl::new(pool);

    let team_id = macro_uuid::string_to_uuid("11111111-1111-1111-1111-111111111111")?;
    let seat_count = team_repo.get_team_seat_count(&team_id).await?;
    assert_eq!(seat_count, 3);

    let missing_team_id = macro_uuid::string_to_uuid("63333333-3333-3333-3333-333333333333")?;
    let err = team_repo
        .get_team_seat_count(&missing_team_id)
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
async fn test_get_team_plan(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let team_repo = TeamRepositoryImpl::new(pool);

    let team_id = macro_uuid::string_to_uuid("11111111-1111-1111-1111-111111111111")?;

    let plan = team_repo.get_team_plan(&team_id).await?;
    assert_eq!(plan, None);

    team_repo
        .patch_team_plan(&team_id, TeamPlan::SeriesA)
        .await?;

    let plan = team_repo.get_team_plan(&team_id).await?;
    assert_eq!(plan, Some(TeamPlan::SeriesA));

    let missing_team_id = macro_uuid::string_to_uuid("63333333-3333-3333-3333-333333333333")?;
    let err = team_repo
        .get_team_plan(&missing_team_id)
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
async fn test_patch_team_plan(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let team_repo = TeamRepositoryImpl::new(pool.clone());

    let team_id = macro_uuid::string_to_uuid("11111111-1111-1111-1111-111111111111")?;

    team_repo.patch_team_plan(&team_id, TeamPlan::Seed).await?;

    let row = sqlx::query!(
        r#"SELECT plan::text AS "plan!" FROM team WHERE id = $1"#,
        &team_id,
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(row.plan, "seed");

    team_repo
        .patch_team_plan(&team_id, TeamPlan::Growth)
        .await?;

    let row = sqlx::query!(
        r#"SELECT plan::text AS "plan!" FROM team WHERE id = $1"#,
        &team_id,
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(row.plan, "growth");

    let missing_team_id = macro_uuid::string_to_uuid("63333333-3333-3333-3333-333333333333")?;
    let err = team_repo
        .patch_team_plan(&missing_team_id, TeamPlan::Idea)
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
async fn test_get_team_member(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let team_repo = TeamRepositoryImpl::new(pool);

    let team_id = macro_uuid::string_to_uuid("11111111-1111-1111-1111-111111111111")?;

    // Get existing member
    let user_id = MacroUserIdStr::parse_from_str("macro|user2@user.com")?;
    let member = team_repo.get_team_member(&team_id, &user_id).await?;

    assert_eq!(member.user_id.as_ref(), "macro|user2@user.com");
    assert_eq!(member.team_id, team_id);
    assert_eq!(member.role, TeamRole::Member);

    // Get owner
    let owner_id = MacroUserIdStr::parse_from_str("macro|user@user.com")?;
    let member = team_repo.get_team_member(&team_id, &owner_id).await?;

    assert_eq!(member.user_id.as_ref(), "macro|user@user.com");
    assert_eq!(member.role, TeamRole::Owner);

    // Get non-existent member
    let missing_id = MacroUserIdStr::parse_from_str("macro|user3@user.com")?;
    let err = team_repo
        .get_team_member(&team_id, &missing_id)
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
async fn test_patch_team_user_role(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let team_repo = TeamRepositoryImpl::new(pool);

    let team_id = macro_uuid::string_to_uuid("11111111-1111-1111-1111-111111111111")?;
    let user_id = MacroUserIdStr::parse_from_str("macro|user2@user.com")?;

    // Promote to Admin
    team_repo
        .patch_team_user_role(&team_id, &user_id, TeamRole::Admin)
        .await?;

    let member = team_repo.get_team_member(&team_id, &user_id).await?;
    assert_eq!(member.role, TeamRole::Admin);

    // Demote back to Member
    team_repo
        .patch_team_user_role(&team_id, &user_id, TeamRole::Member)
        .await?;

    let member = team_repo.get_team_member(&team_id, &user_id).await?;
    assert_eq!(member.role, TeamRole::Member);

    // Patch role for non-existent member
    let missing_id = MacroUserIdStr::parse_from_str("macro|user3@user.com")?;
    let err = team_repo
        .patch_team_user_role(&team_id, &missing_id, TeamRole::Admin)
        .await
        .err()
        .unwrap();

    assert!(err.to_string().contains("member not found"));

    Ok(())
}
