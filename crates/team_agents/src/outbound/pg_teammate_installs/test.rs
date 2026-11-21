use agent_runtime_protocol::domain::schema::v0::{
    ContainerEngine, ContainerEngineKind, HostArch, HostOs, TeammateHostReport,
};
use macro_db_migrator::MACRO_DB_MIGRATIONS;

use super::*;

const TEAM: Uuid = Uuid::from_u128(0x0193_a1b2_0000_7000_8000_0000_0000_00aa);
const ADMIN: &str = "macro|admin@example.com";
const AGENT: &str = "macro|sam-rivera-abc123@agents.macro.invalid";
const LAPTOP: Uuid = Uuid::from_u128(0x0193_a1b2_0000_7000_8000_0000_0000_0d01);
const DESKTOP: Uuid = Uuid::from_u128(0x0193_a1b2_0000_7000_8000_0000_0000_0d02);
const IMAGE: &str = "sha256:1111111111111111111111111111111111111111111111111111111111111111";
const INSTALL: Uuid = Uuid::from_u128(0x0193_a1b2_0000_7000_8000_0000_0000_01a1);

/// Count a delivery and release it at once, as an issuer that minted.
async fn deliver(
    installs: &PgTeammateInstalls,
    install_id: Uuid,
    harness: HarnessId,
    reported: (u64, u64),
) -> Option<(u64, u64)> {
    let counted = installs
        .next_delivery(install_id, harness, reported, IMAGE)
        .await
        .unwrap()?;
    let pair = counted.pair();
    counted.release().await.unwrap();
    Some(pair)
}

fn user(id: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(id).unwrap().into_owned()
}

async fn insert_user(pool: &PgPool, id: &str, email: &str, macro_user_id: Uuid) {
    sqlx::query!(
        r#"
        INSERT INTO macro_user (id, username, email, stripe_customer_id)
        VALUES ($1, $2, $2, $3)
        "#,
        macro_user_id,
        email,
        format!("cus_{macro_user_id}"),
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, $2, $3)"#,
        id,
        email,
        macro_user_id,
    )
    .execute(pool)
    .await
    .unwrap();
}

async fn insert_harness(pool: &PgPool, id: Uuid, name: &str, owner: &str) {
    sqlx::query!(
        r#"
        INSERT INTO harnesses (id, name, owner_user_id, created_by)
        VALUES ($1, $2, $3, $3)
        "#,
        id,
        name,
        owner,
    )
    .execute(pool)
    .await
    .unwrap();
}

/// A team with its admin, an agent on it, and the admin's two machines.
async fn fixture(pool: &PgPool) {
    insert_user(
        pool,
        ADMIN,
        "admin@example.com",
        Uuid::from_u128(0x0193_a1b2_0000_7000_8000_0000_0000_0011),
    )
    .await;
    insert_user(
        pool,
        AGENT,
        "sam-rivera-abc123@agents.macro.invalid",
        Uuid::from_u128(0x0193_a1b2_0000_7000_8000_0000_0000_0012),
    )
    .await;
    sqlx::query!(
        "INSERT INTO team (id, name, owner_id) VALUES ($1, 'Agents', $2)",
        TEAM,
        ADMIN,
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"
        INSERT INTO team_agents (user_id, team_id, created_by, persona_seed, purchase_key)
        VALUES ($1, $2, $3, '{"name": "Sam Rivera", "job_description": "", "personality": "", "creator_id": null}', 'invite-1')
        "#,
        AGENT,
        TEAM,
        ADMIN,
    )
    .execute(pool)
    .await
    .unwrap();
    insert_harness(pool, LAPTOP, "Laptop", ADMIN).await;
    insert_harness(pool, DESKTOP, "Desktop", ADMIN).await;
}

fn new_install(install_id: Uuid, harness: Uuid) -> NewTeammateInstall {
    NewTeammateInstall {
        install_id,
        agent: user(AGENT),
        team_id: TEAM,
        harness_id: HarnessId::new_from_uuid(harness),
        created_by: user(ADMIN),
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn two_installs_for_one_agent_racing_leave_one(pool: PgPool) {
    fixture(&pool).await;
    let installs = PgTeammateInstalls::new(pool.clone());
    let on_laptop = new_install(INSTALL, LAPTOP);
    let on_desktop = new_install(Uuid::from_u128(0x02), DESKTOP);

    let (first, second) = tokio::join!(installs.create(&on_laptop), installs.create(&on_desktop));

    let outcomes = [first.unwrap(), second.unwrap()];
    let created: Vec<_> = outcomes
        .iter()
        .filter_map(|outcome| match outcome {
            CreatedInstall::Created(install) => Some(install.clone()),
            CreatedInstall::AlreadyInstalled(_) => None,
        })
        .collect();
    assert_eq!(created.len(), 1);
    let stored = installs.for_agent(&user(AGENT)).await.unwrap().unwrap();
    assert_eq!(stored, created[0]);
    assert_eq!(stored.generation, 1);
    assert_eq!(stored.delivery, 0);
    assert_eq!(stored.run_state, InstallRunState::Pending);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn racing_deliveries_each_count_their_own_and_a_caught_up_machine_gets_none(pool: PgPool) {
    fixture(&pool).await;
    let installs = PgTeammateInstalls::new(pool.clone());
    installs
        .create(&new_install(INSTALL, LAPTOP))
        .await
        .unwrap();
    let laptop = HarnessId::new_from_uuid(LAPTOP);

    // Two replicas both think the machine runs nothing.
    let (first, second) = tokio::join!(
        deliver(&installs, INSTALL, laptop, (0, 0)),
        deliver(&installs, INSTALL, laptop, (0, 0)),
    );
    let mut counted = vec![first.unwrap(), second.unwrap()];
    counted.sort();

    // Serialized by the row: two distinct deliveries, minted in order, so
    // the higher the machine keeps is the last one minted.
    assert_eq!(counted, vec![(1, 1), (1, 2)]);
    // Once the machine says it runs the latest, nothing more is delivered.
    assert_eq!(deliver(&installs, INSTALL, laptop, (1, 2)).await, None);
    // Not on another machine.
    assert_eq!(
        deliver(
            &installs,
            INSTALL,
            HarnessId::new_from_uuid(DESKTOP),
            (0, 0)
        )
        .await,
        None
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_racing_issuer_waits_until_the_first_has_minted(pool: PgPool) {
    fixture(&pool).await;
    let installs = PgTeammateInstalls::new(pool.clone());
    installs
        .create(&new_install(INSTALL, LAPTOP))
        .await
        .unwrap();
    let laptop = HarnessId::new_from_uuid(LAPTOP);

    let first = installs
        .next_delivery(INSTALL, laptop, (0, 0), IMAGE)
        .await
        .unwrap()
        .unwrap();
    let racing = installs.clone();
    let second = tokio::spawn(async move { deliver(&racing, INSTALL, laptop, (0, 0)).await });
    tokio::time::sleep(std::time::Duration::from_millis(300)).await;

    // Still minting the first: the second can't count past it yet.
    assert!(!second.is_finished());
    assert_eq!(first.pair(), (1, 1));
    first.release().await.unwrap();
    assert_eq!(second.await.unwrap(), Some((1, 2)));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_dropped_delivery_is_not_counted(pool: PgPool) {
    fixture(&pool).await;
    let installs = PgTeammateInstalls::new(pool.clone());
    installs
        .create(&new_install(INSTALL, LAPTOP))
        .await
        .unwrap();
    let laptop = HarnessId::new_from_uuid(LAPTOP);

    drop(
        installs
            .next_delivery(INSTALL, laptop, (0, 0), IMAGE)
            .await
            .unwrap(),
    );

    assert_eq!(installs.by_id(INSTALL).await.unwrap().unwrap().delivery, 0);
    assert_eq!(
        deliver(&installs, INSTALL, laptop, (0, 0)).await,
        Some((1, 1))
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_move_waits_on_its_checkpoint_then_makes_a_new_install_on_the_target(pool: PgPool) {
    fixture(&pool).await;
    let installs = PgTeammateInstalls::new(pool.clone());
    installs
        .create(&new_install(INSTALL, LAPTOP))
        .await
        .unwrap();
    let laptop = HarnessId::new_from_uuid(LAPTOP);
    let desktop = HarnessId::new_from_uuid(DESKTOP);
    deliver(&installs, INSTALL, laptop, (0, 0)).await;

    let moving = installs
        .begin_checkpoint(&user(AGENT), Checkpoint::Moving { to: desktop })
        .await
        .unwrap()
        .unwrap();

    assert!(matches!(
        moving.checkpoint,
        Some((Checkpoint::Moving { to }, _)) if to == desktop
    ));
    // Nothing is delivered while the old machine checkpoints.
    assert_eq!(deliver(&installs, INSTALL, laptop, (0, 0)).await, None);

    let new_id = Uuid::from_u128(0x03);
    let moved = installs
        .finish_move(INSTALL, new_id)
        .await
        .unwrap()
        .unwrap();

    assert_eq!(moved.install_id, new_id);
    assert_eq!(moved.harness_id, desktop);
    assert_eq!(moved.generation, 2);
    assert_eq!(moved.delivery, 0);
    assert_eq!(moved.checkpoint, None);
    // Finishing again changes nothing.
    assert_eq!(
        installs
            .finish_move(INSTALL, Uuid::from_u128(0x04))
            .await
            .unwrap(),
        None
    );
    assert_eq!(
        deliver(&installs, new_id, desktop, (0, 0)).await,
        Some((2, 1))
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_new_image_gives_a_delivered_install_its_next_generation_once(pool: PgPool) {
    fixture(&pool).await;
    let installs = PgTeammateInstalls::new(pool.clone());
    installs
        .create(&new_install(INSTALL, LAPTOP))
        .await
        .unwrap();
    let laptop = HarnessId::new_from_uuid(LAPTOP);
    let newer = "sha256:2222222222222222222222222222222222222222222222222222222222222222";

    // Never delivered: nothing to replace.
    assert_eq!(
        installs
            .new_image_generation(INSTALL, 1, newer)
            .await
            .unwrap(),
        None
    );
    deliver(&installs, INSTALL, laptop, (0, 0)).await;
    assert_eq!(
        installs
            .by_id(INSTALL)
            .await
            .unwrap()
            .unwrap()
            .image_id
            .as_deref(),
        Some(IMAGE)
    );
    // The same image: nothing.
    assert_eq!(
        installs
            .new_image_generation(INSTALL, 1, IMAGE)
            .await
            .unwrap(),
        None
    );

    let bumped = installs
        .new_image_generation(INSTALL, 1, newer)
        .await
        .unwrap()
        .unwrap();

    assert_eq!((bumped.generation, bumped.delivery), (2, 0));
    // A racing replica asking from generation 1 again changes nothing.
    assert_eq!(
        installs
            .new_image_generation(INSTALL, 1, newer)
            .await
            .unwrap(),
        None
    );
    assert_eq!(
        deliver(&installs, INSTALL, laptop, (1, 1)).await,
        Some((2, 1))
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_rolled_back_image_is_stored_with_its_reason(pool: PgPool) {
    fixture(&pool).await;
    let installs = PgTeammateInstalls::new(pool.clone());
    installs
        .create(&new_install(INSTALL, LAPTOP))
        .await
        .unwrap();
    deliver(&installs, INSTALL, HarnessId::new_from_uuid(LAPTOP), (0, 0)).await;

    assert!(
        installs
            .record_status(
                HarnessId::new_from_uuid(LAPTOP),
                INSTALL,
                (1, 1),
                InstallRunState::RolledBack,
                Some(InstallFailure::IncompatibleRuntime),
            )
            .await
            .unwrap()
    );

    let stored = installs.by_id(INSTALL).await.unwrap().unwrap();
    assert_eq!(stored.run_state, InstallRunState::RolledBack);
    assert_eq!(stored.failure, Some(InstallFailure::IncompatibleRuntime));
    assert_eq!(stored.applied, None);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_removal_is_never_turned_back_into_a_move(pool: PgPool) {
    fixture(&pool).await;
    let installs = PgTeammateInstalls::new(pool.clone());
    installs
        .create(&new_install(INSTALL, LAPTOP))
        .await
        .unwrap();

    installs
        .begin_checkpoint(&user(AGENT), Checkpoint::Removing)
        .await
        .unwrap()
        .unwrap();
    let moved = installs
        .begin_checkpoint(
            &user(AGENT),
            Checkpoint::Moving {
                to: HarnessId::new_from_uuid(DESKTOP),
            },
        )
        .await
        .unwrap();

    assert_eq!(moved, None);
    let stored = installs.for_agent(&user(AGENT)).await.unwrap().unwrap();
    assert!(matches!(stored.checkpoint, Some((Checkpoint::Removing, _))));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn only_a_running_report_of_the_current_delivery_confirms_it(pool: PgPool) {
    fixture(&pool).await;
    let installs = PgTeammateInstalls::new(pool.clone());
    installs
        .create(&new_install(INSTALL, LAPTOP))
        .await
        .unwrap();
    let laptop = HarnessId::new_from_uuid(LAPTOP);
    deliver(&installs, INSTALL, laptop, (0, 0)).await;

    assert!(
        installs
            .record_status(
                HarnessId::new_from_uuid(LAPTOP),
                INSTALL,
                (1, 1),
                InstallRunState::Downloading,
                None
            )
            .await
            .unwrap()
    );
    assert_eq!(
        installs.by_id(INSTALL).await.unwrap().unwrap().applied,
        None
    );
    assert!(
        installs
            .record_status(
                HarnessId::new_from_uuid(LAPTOP),
                INSTALL,
                (1, 1),
                InstallRunState::Running,
                None
            )
            .await
            .unwrap()
    );
    // A late report about an older generation changes nothing.
    assert!(
        !installs
            .record_status(
                HarnessId::new_from_uuid(LAPTOP),
                INSTALL,
                (0, 3),
                InstallRunState::Failed,
                Some(InstallFailure::CrashLoop)
            )
            .await
            .unwrap()
    );

    let stored = installs.by_id(INSTALL).await.unwrap().unwrap();
    assert_eq!(stored.applied, Some((1, 1)));
    assert_eq!(stored.run_state, InstallRunState::Running);
    assert_eq!(stored.failure, None);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn removing_the_agents_seat_removes_its_install(pool: PgPool) {
    fixture(&pool).await;
    let installs = PgTeammateInstalls::new(pool.clone());
    installs
        .create(&new_install(INSTALL, LAPTOP))
        .await
        .unwrap();

    sqlx::query!("DELETE FROM team_agents WHERE user_id = $1", AGENT)
        .execute(&pool)
        .await
        .unwrap();

    assert_eq!(installs.by_id(INSTALL).await.unwrap(), None);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_inviters_hosts_are_their_own_paired_machines_with_their_reports(pool: PgPool) {
    fixture(&pool).await;
    insert_user(
        &pool,
        "macro|someone@example.com",
        "someone@example.com",
        Uuid::from_u128(0x0193_a1b2_0000_7000_8000_0000_0000_0013),
    )
    .await;
    insert_harness(
        &pool,
        Uuid::from_u128(0x0d03),
        "Theirs",
        "macro|someone@example.com",
    )
    .await;
    let installs = PgTeammateInstalls::new(pool.clone());
    let report = TeammateHostReport {
        engine: Some(ContainerEngine {
            kind: ContainerEngineKind::Podman,
            version: "5.2.0".to_owned(),
            rootless: true,
        }),
        engines: Vec::new(),
        os: HostOs::Linux,
        arch: HostArch::Amd64,
        cpus: 8,
        memory_mib: 16384,
        disk_free_mib: Some(100_000),
        problem: None,
        installs: vec![],
    };
    installs
        .save_host_report(HarnessId::new_from_uuid(LAPTOP), &report)
        .await
        .unwrap();
    sqlx::query!(
        "INSERT INTO harness_runtime_connection (harness_id, id, replica_id, lease_expires_at) VALUES ($1, $2, $3, now() + interval '1 minute')",
        LAPTOP,
        Uuid::from_u128(0x0c01),
        Uuid::from_u128(0x0e01),
    )
    .execute(&pool)
    .await
    .unwrap();

    let hosts = installs.hosts_of(&user(ADMIN)).await.unwrap();

    assert_eq!(
        hosts,
        vec![
            HostFacts {
                harness_id: HarnessId::new_from_uuid(DESKTOP),
                name: "Desktop".to_owned(),
                connected: false,
                report: None,
            },
            HostFacts {
                harness_id: HarnessId::new_from_uuid(LAPTOP),
                name: "Laptop".to_owned(),
                connected: true,
                report: Some(report),
            },
        ]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_start_refused_for_network_isolation_is_stored_with_its_reason(pool: PgPool) {
    fixture(&pool).await;
    let installs = PgTeammateInstalls::new(pool.clone());
    installs
        .create(&new_install(INSTALL, LAPTOP))
        .await
        .unwrap();
    deliver(&installs, INSTALL, HarnessId::new_from_uuid(LAPTOP), (0, 0)).await;

    assert!(
        installs
            .record_status(
                HarnessId::new_from_uuid(LAPTOP),
                INSTALL,
                (1, 1),
                InstallRunState::Failed,
                Some(InstallFailure::NetworkIsolationUnavailable),
            )
            .await
            .unwrap()
    );

    let stored = installs.by_id(INSTALL).await.unwrap().unwrap();
    assert_eq!(stored.run_state, InstallRunState::Failed);
    assert_eq!(
        stored.failure,
        Some(InstallFailure::NetworkIsolationUnavailable)
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_teams_installs_are_read_in_one_query_by_agent(pool: PgPool) {
    fixture(&pool).await;
    let installs = PgTeammateInstalls::new(pool.clone());
    installs
        .create(&new_install(INSTALL, LAPTOP))
        .await
        .unwrap();
    let agent = MacroUserIdStr::parse_from_str(AGENT).unwrap().into_owned();
    let without_install = MacroUserIdStr::parse_from_str("macro|nobody@example.com")
        .unwrap()
        .into_owned();

    let found = installs
        .for_agents(&[agent, without_install])
        .await
        .unwrap();

    assert_eq!(
        found
            .iter()
            .map(|install| install.install_id)
            .collect::<Vec<_>>(),
        [INSTALL]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn another_machine_cant_set_an_installs_state(pool: PgPool) {
    fixture(&pool).await;
    let installs = PgTeammateInstalls::new(pool.clone());
    installs
        .create(&new_install(INSTALL, LAPTOP))
        .await
        .unwrap();
    deliver(&installs, INSTALL, HarnessId::new_from_uuid(LAPTOP), (0, 0)).await;

    let applied = installs
        .record_status(
            HarnessId::new_from_uuid(DESKTOP),
            INSTALL,
            (1, 1),
            InstallRunState::Failed,
            Some(InstallFailure::CrashLoop),
        )
        .await
        .unwrap();

    assert!(!applied);
    let stored = installs.by_id(INSTALL).await.unwrap().unwrap();
    assert_eq!(stored.run_state, InstallRunState::Pending);
    assert_eq!(stored.failure, None);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_late_report_about_an_older_delivery_doesnt_overwrite_a_newer_one(pool: PgPool) {
    fixture(&pool).await;
    let installs = PgTeammateInstalls::new(pool.clone());
    let laptop = HarnessId::new_from_uuid(LAPTOP);
    installs
        .create(&new_install(INSTALL, LAPTOP))
        .await
        .unwrap();
    deliver(&installs, INSTALL, laptop, (0, 0)).await;
    // The machine still runs nothing: a second delivery is counted.
    assert_eq!(
        deliver(&installs, INSTALL, laptop, (0, 0)).await,
        Some((1, 2))
    );
    assert!(
        installs
            .record_status(laptop, INSTALL, (1, 2), InstallRunState::Running, None)
            .await
            .unwrap()
    );

    let applied = installs
        .record_status(
            laptop,
            INSTALL,
            (1, 1),
            InstallRunState::Failed,
            Some(InstallFailure::BadConfiguration),
        )
        .await
        .unwrap();

    assert!(!applied);
    let stored = installs.by_id(INSTALL).await.unwrap().unwrap();
    assert_eq!(stored.run_state, InstallRunState::Running);
    assert_eq!(stored.applied, Some((1, 2)));
}

async fn make_admin(pool: &PgPool, user: &str, role: &str) {
    sqlx::query!(
        "INSERT INTO team_user (user_id, team_id, team_role) VALUES ($1, $2, $3::TEXT::team_role)
         ON CONFLICT (user_id, team_id) DO UPDATE SET team_role = EXCLUDED.team_role",
        user,
        TEAM,
        role,
    )
    .execute(pool)
    .await
    .unwrap();
}

const OTHER_ADMIN: &str = "macro|other-admin@example.com";

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_machine_may_host_while_its_owner_is_an_admin_and_it_is_paired(pool: PgPool) {
    fixture(&pool).await;
    insert_user(
        &pool,
        OTHER_ADMIN,
        "other-admin@example.com",
        Uuid::from_u128(0x0193_a1b2_0000_7000_8000_0000_0000_0013),
    )
    .await;
    let theirs = Uuid::from_u128(0x0193_a1b2_0000_7000_8000_0000_0000_0d03);
    insert_harness(&pool, theirs, "Theirs", OTHER_ADMIN).await;
    let installs = PgTeammateInstalls::new(pool.clone());
    installs
        .create(&new_install(INSTALL, theirs))
        .await
        .unwrap();
    let host = HarnessId::new_from_uuid(theirs);

    // Not on the team at all.
    assert!(!installs.host_entitled(host, TEAM).await.unwrap());
    assert_eq!(installs.unentitled_installs(10).await.unwrap().len(), 1);

    make_admin(&pool, OTHER_ADMIN, "admin").await;
    assert!(installs.host_entitled(host, TEAM).await.unwrap());
    assert!(installs.unentitled_installs(10).await.unwrap().is_empty());

    // Demoted.
    make_admin(&pool, OTHER_ADMIN, "member").await;
    assert!(!installs.host_entitled(host, TEAM).await.unwrap());

    // An admin again, then unpairs the machine.
    make_admin(&pool, OTHER_ADMIN, "admin").await;
    sqlx::query!(
        "UPDATE harnesses SET deleted_at = now() WHERE id = $1",
        theirs
    )
    .execute(&pool)
    .await
    .unwrap();
    assert!(!installs.host_entitled(host, TEAM).await.unwrap());
    assert_eq!(installs.unentitled_installs(10).await.unwrap().len(), 1);

    // Already being removed: no longer listed.
    installs
        .begin_checkpoint(&user(AGENT), Checkpoint::Removing)
        .await
        .unwrap();
    assert!(installs.unentitled_installs(10).await.unwrap().is_empty());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_teams_owner_may_host_without_a_member_row(pool: PgPool) {
    fixture(&pool).await;
    let installs = PgTeammateInstalls::new(pool.clone());
    installs
        .create(&new_install(INSTALL, LAPTOP))
        .await
        .unwrap();

    assert!(
        installs
            .host_entitled(HarnessId::new_from_uuid(LAPTOP), TEAM)
            .await
            .unwrap()
    );
    assert!(installs.unentitled_installs(10).await.unwrap().is_empty());
}
