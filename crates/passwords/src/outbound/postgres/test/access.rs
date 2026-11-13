use super::*;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn human_membership_admin_visibility_and_literal_search_are_authoritative(pool: PgPool) {
    let (repository, actor, record) = folder_fixture(pool).await;
    let team = record.metadata.team_id;
    assert!(repository.is_human(&actor.user_id).await.expect("human"));
    assert!(
        repository
            .is_team_admin(&actor.user_id, team)
            .await
            .expect("owner role")
    );
    assert!(repository.has_team_data(team).await.expect("team data"));
    for search in ["%_", "\\", "LOGIN", ""] {
        assert_eq!(
            repository
                .list(&actor, team, search)
                .await
                .expect("literal search")
                .len(),
            1
        );
    }
    assert!(
        repository
            .list(&actor, team, "not present")
            .await
            .expect("absent")
            .is_empty()
    );
    // The immutable creator can leave; current human admins retain team-owned data.
    sqlx::query!("UPDATE password_item_entities SET user_id='macro|departed@example.test' WHERE team_id=$1 AND id=$2",team.0,record.metadata.id.0)
        .execute(&repository.pool).await.expect("departed creator fixture");
    assert_eq!(
        repository
            .list(&actor, team, "")
            .await
            .expect("admin private visibility")
            .len(),
        1
    );
    sqlx::query!(
        r#"UPDATE "User" SET "isAgent"=true WHERE id=$1"#,
        actor.user_id.as_ref()
    )
    .execute(&repository.pool)
    .await
    .expect("authoritative agent classification");
    assert!(!repository.is_human(&actor.user_id).await.expect("agent"));
    assert!(
        repository
            .list(&actor, team, "")
            .await
            .expect("agent excluded")
            .is_empty()
    );
    assert!(matches!(
        repository
            .stage(Uuid::now_v7(), &record, &actor.user_id)
            .await,
        Err(Error::NotFound)
    ));
    sqlx::query!(
        r#"UPDATE "User" SET "isAgent"=false WHERE id=$1"#,
        actor.user_id.as_ref()
    )
    .execute(&repository.pool)
    .await
    .expect("restore human");
    sqlx::query!(
        "DELETE FROM team_user WHERE team_id=$1 AND user_id=$2",
        team.0,
        actor.user_id.as_ref()
    )
    .execute(&repository.pool)
    .await
    .expect("membership ends");
    assert!(
        repository
            .list(&actor, team, "")
            .await
            .expect("former member excluded")
            .is_empty()
    );
    assert!(
        !repository
            .get(team, record.metadata.id)
            .await
            .expect("item retained")
            .deleting
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn account_classification_and_current_role_facts_come_from_postgres(pool: PgPool) {
    let (repository, actor, record) = folder_fixture(pool).await;
    let team = record.metadata.team_id;
    let missing =
        MacroUserIdStr::parse_from_str("macro|missing@example.test").expect("missing fixture");
    assert!(
        repository
            .is_human(&actor.user_id)
            .await
            .expect("present human")
    );
    assert!(
        !repository
            .is_human(&missing)
            .await
            .expect("missing is not human")
    );
    assert!(
        repository
            .is_team_admin(&actor.user_id, team)
            .await
            .expect("current owner")
    );
    assert!(
        !repository
            .is_team_admin(&missing, team)
            .await
            .expect("missing role")
    );
    sqlx::query!(
        "UPDATE team_user SET team_role='admin' WHERE team_id=$1 AND user_id=$2",
        team.0,
        actor.user_id.as_ref()
    )
    .execute(&repository.pool)
    .await
    .expect("admin role");
    assert!(
        repository
            .is_team_admin(&actor.user_id, team)
            .await
            .expect("current admin")
    );
    sqlx::query!(
        "UPDATE team_user SET team_role='member' WHERE team_id=$1 AND user_id=$2",
        team.0,
        actor.user_id.as_ref()
    )
    .execute(&repository.pool)
    .await
    .expect("member role");
    assert!(
        !repository
            .is_team_admin(&actor.user_id, team)
            .await
            .expect("ordinary member")
    );
    assert!(
        !repository
            .is_team_admin(&actor.user_id, TeamId(Uuid::now_v7()))
            .await
            .expect("other team")
    );
    sqlx::query!(
        r#"UPDATE "User" SET "isAgent"=true WHERE id=$1"#,
        actor.user_id.as_ref()
    )
    .execute(&repository.pool)
    .await
    .expect("agent account");
    assert!(
        !repository
            .is_human(&actor.user_id)
            .await
            .expect("agent is not human")
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn matching_compares_whole_names_ignoring_case_and_spaces_for_members_only(pool: PgPool) {
    let other_pool = pool.clone();
    let (repository, actor, record) = folder_fixture(pool).await;
    let team = record.metadata.team_id;
    let found = repository
        .matching(&actor, team, &["  LITERAL %_\\ login ".to_owned()])
        .await
        .expect("match");
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].metadata.id, record.metadata.id);
    // Whole names only: no pattern or prefix matching.
    for names in [vec!["literal".to_owned()], vec!["%".to_owned()], vec![]] {
        assert!(
            repository
                .matching(&actor, team, &names)
                .await
                .expect("match")
                .is_empty()
        );
    }
    let (_, outsider) = another_team(&other_pool).await;
    assert!(
        repository
            .matching(&outsider, team, &["literal %_\\ login".to_owned()])
            .await
            .expect("match")
            .is_empty()
    );
}
