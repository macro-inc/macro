use super::*;

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("teams"))
)]
async fn crm_access_is_admin_managed_and_cannot_lock_out_admins(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let team = uuid::Uuid::from_u128(0x11111111111111111111111111111111);
    let repo = TeamRepositoryImpl::new(pool.clone());
    let roster = repo.get_team_by_id(&team).await?;
    let user_with_role = |role| {
        roster
            .members
            .iter()
            .find(|member| member.role == role)
            .unwrap()
            .user_id
            .clone()
    };
    let owner = user_with_role(TeamRole::Owner);
    let member = user_with_role(TeamRole::Member);
    let other_team = uuid::Uuid::from_u128(0x22222222222222222222222222222222);
    let outsider = repo.get_team_by_id(&other_team).await?.members[0]
        .user_id
        .clone();
    assert!(repo.get_team_by_id(&team).await?.crm_member_access[member.as_ref()]);
    for enabled in [false, true] {
        repo.set_member_crm_access(team, &owner, &member, enabled)
            .await?;
        assert_eq!(
            repo.get_team_by_id(&team).await?.crm_member_access[member.as_ref()],
            enabled
        );
        assert!(
            repo.set_member_crm_access(team, &member, &member, !enabled)
                .await
                .is_err()
        );
        assert!(
            repo.set_member_crm_access(team, &outsider, &member, !enabled)
                .await
                .is_err()
        );
    }
    assert!(
        repo.set_member_crm_access(team, &owner, &owner, false)
            .await
            .is_err()
    );
    sqlx::query!(
        "UPDATE team_user SET team_role = 'admin' WHERE team_id = $1 AND user_id = $2",
        team,
        member.as_ref()
    )
    .execute(&pool)
    .await?;
    assert!(
        repo.set_member_crm_access(team, &owner, &member, false)
            .await
            .is_err()
    );
    assert!(repo.get_team_by_id(&team).await?.crm_member_access[member.as_ref()]);
    Ok(())
}
