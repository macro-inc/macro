use super::*;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn corrupt_persona_does_not_abort_fleet_scans(pool: PgPool) {
    insert_team(&pool).await;
    let repo = PgComputerRepo::new(pool.clone());
    let host = repo
        .register_host(HostRegistration {
            name: "quarantine-test".to_owned(),
            memory_gb: 64,
            reserve_gb: 8,
            oversell_factor: 3,
        })
        .await
        .unwrap();
    for id in [101, 102] {
        let computer = repo.reserve(standard(id), now()).await.unwrap();
        let mut state = computer.state;
        state.phase = Phase::Running { host: host.id };
        sqlx::query!(
            "UPDATE hosted_runtime SET state = $2, awake = true WHERE id = $1",
            computer.id.as_uuid(),
            serde_json::to_value(state).unwrap()
        )
        .execute(&pool)
        .await
        .unwrap();
    }
    let bad_id = Uuid::from_u128(102);
    let persona = serde_json::json!({
        "name": "Agent", "os_user": "agent-worker", "extra_service": {
            "unit_name": "agent-worker", "exec": "/bin/true", "env": {}
        }, "config": {"REPO_TOKEN": "never-log-this-value"}
    });
    sqlx::query!(
        "UPDATE hosted_runtime SET persona = $2 WHERE id = $1",
        bad_id,
        persona
    )
    .execute(&pool)
    .await
    .unwrap();

    assert_eq!(repo.list_for_team(TEAM).await.unwrap().len(), 2);
    assert_eq!(repo.instances_expected(host.id).await.unwrap().len(), 2);
    assert_eq!(repo.running().await.unwrap().len(), 2);
    assert!(
        repo.get(ComputerId::new_from_uuid(bad_id))
            .await
            .unwrap()
            .is_some()
    );
}
