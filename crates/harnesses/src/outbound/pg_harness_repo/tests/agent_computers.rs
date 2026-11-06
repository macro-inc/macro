use super::*;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn agent_computer_roles_stay_bounded_and_survive_rekey(pool: PgPool) {
    let repo = PgHarnessRepo::new(pool.clone());
    let admin = "macro|admin@example.com";
    let team_owner = "macro|team-owner@example.com";
    let resident = "macro|resident@example.com";
    let outsider = "macro|outsider@example.com";
    for id in [OWNER_ID, admin, team_owner, resident, TEAMMATE_ID, outsider] {
        insert_user(&pool, id).await;
    }
    let team_id = Uuid::new_v4();
    sqlx::query!(
        "INSERT INTO team (id, name, owner_id) VALUES ($1, 'Agent team', $2)",
        team_id,
        team_owner
    )
    .execute(&pool)
    .await
    .unwrap();
    for (id, role) in [
        (admin, "admin"),
        (resident, "admin"),
        (TEAMMATE_ID, "member"),
    ] {
        sqlx::query!("INSERT INTO team_user (user_id, team_id, team_role) VALUES ($1, $2, $3::text::team_role)", id, team_id, role)
            .execute(&pool).await.unwrap();
    }
    let computer_id = Uuid::new_v4();
    sqlx::query!(
        r#"INSERT INTO hosted_runtime (id, team_id, name, size, units, state, created_by, persona)
        VALUES ($1, $2, 'Agent computer', 'standard', 1, '{}', $3, '{}')"#,
        computer_id,
        team_id,
        OWNER_ID,
    )
    .execute(&pool)
    .await
    .unwrap();
    let mut registration = hosted_harness(team_id, computer_id);
    registration.team_grant.as_mut().unwrap().access = HarnessTeamAccess::Read;
    let harness_id = registration.id;
    let pairing_id = Uuid::new_v4();
    repo.upsert_hosted_pairing(hosted_pairing(pairing_id, "initial"), registration.clone())
        .await
        .unwrap();

    // Even a stale caller offering User cannot persist an elevated team grant.
    repo.set_team_access(harness_id, team_id, HarnessTeamAccess::User, true)
        .await
        .unwrap();
    let stored = sqlx::query_scalar!(
        r#"SELECT access_level AS "level!: AccessLevel" FROM entity_access
        WHERE entity_id = $1 AND entity_type = 'harness' AND source_type = 'team' AND source_id = $2"#,
        harness_id.as_uuid(), team_id.to_string(),
    ).fetch_one(&pool).await.unwrap();
    assert_eq!(stored, AccessLevel::View);

    // Persona alone classifies a computer before the resident enrollment exists.
    assert!(
        repo.get_harness(harness_id)
            .await
            .unwrap()
            .unwrap()
            .is_agent_computer
    );
    assert_eq!(
        repo.harness_access(harness_id, user(TEAMMATE_ID))
            .await
            .unwrap(),
        HarnessAccess::Read
    );
    sqlx::query!(
        "INSERT INTO team_agents (user_id, team_id, created_by, computer_id) VALUES ($1, $2, $3, $4)",
        resident, team_id, OWNER_ID, computer_id,
    ).execute(&pool).await.unwrap();
    for (id, expected) in [
        (OWNER_ID, HarnessAccess::Owner),
        (team_owner, HarnessAccess::Owner),
        (admin, HarnessAccess::Owner),
        (TEAMMATE_ID, HarnessAccess::Read),
        (resident, HarnessAccess::Resident),
        (outsider, HarnessAccess::None),
    ] {
        assert_eq!(
            repo.harness_access(harness_id, user(id)).await.unwrap(),
            expected,
            "{id}"
        );
    }
    assert!(
        repo.list_usable_harnesses(user(resident))
            .await
            .unwrap()
            .is_empty()
    );
    assert!(
        matches!(repo.list_residents(harness_id).await.unwrap().as_slice(),
        [HarnessResident::Account { user_id, team_id: resident_team, .. }] if user_id == resident && *resident_team == team_id)
    );

    // The bound account also classifies the computer if persona metadata is missing.
    sqlx::query!(
        "UPDATE hosted_runtime SET persona = NULL WHERE id = $1",
        computer_id
    )
    .execute(&pool)
    .await
    .unwrap();
    assert!(
        repo.get_harness(harness_id)
            .await
            .unwrap()
            .unwrap()
            .is_agent_computer
    );
    assert_eq!(
        repo.harness_access(harness_id, user(resident))
            .await
            .unwrap(),
        HarnessAccess::Resident
    );

    // A claimed computer is re-keyed without replacing its owner, grant or resident.
    repo.claim_pairing(
        pairing_id,
        Uuid::new_v4(),
        HashedHarnessToken::from_raw("initial-token"),
    )
    .await
    .unwrap()
    .unwrap();
    registration.owner = HarnessOwner::User {
        user_id: admin.to_owned(),
    };
    registration.created_by = user(admin);
    repo.upsert_hosted_pairing(hosted_pairing(Uuid::new_v4(), "replacement"), registration)
        .await
        .unwrap();
    let after = repo.get_harness(harness_id).await.unwrap().unwrap();
    assert_eq!(
        after.owner,
        HarnessOwner::User {
            user_id: OWNER_ID.to_owned()
        }
    );
    assert_eq!(after.shared_team_ids, [team_id]);
    assert_eq!(
        repo.harness_access(harness_id, user(resident))
            .await
            .unwrap(),
        HarnessAccess::Resident
    );
    assert_eq!(
        repo.harness_access(harness_id, user(TEAMMATE_ID))
            .await
            .unwrap(),
        HarnessAccess::Read
    );
}
