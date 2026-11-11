use super::*;
use crate::domain::agent::ComputerAgents;

async fn insert_agent(pool: &PgPool) -> MacroUserIdStr<'static> {
    let macro_user_id = Uuid::from_u128(0x0000_0000_0000_7000_8000_0000_0000_0022);
    sqlx::query!(
        r#"
        INSERT INTO macro_user (id, username, email, stripe_customer_id)
        VALUES ($1, 'ada-1@agents.macro.invalid', 'ada-1@agents.macro.invalid', 'cus_agent_ada')
        "#,
        macro_user_id,
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id, "isAgent") VALUES ('macro|ada-1@agents.macro.invalid', 'ada-1@agents.macro.invalid', $1, TRUE)"#,
        macro_user_id,
    )
    .execute(pool)
    .await
    .unwrap();
    MacroUserIdStr::try_from("macro|ada-1@agents.macro.invalid".to_owned()).unwrap()
}

async fn register_host(repo: &PgComputerRepo) {
    repo.register_host(HostRegistration {
        name: "runtime-dev-1".to_owned(),
        memory_gb: 31,
        reserve_gb: 7,
        oversell_factor: 3,
    })
    .await
    .unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_computer_bought_for_an_agent_is_linked_to_it(pool: PgPool) {
    insert_team(&pool).await;
    let agent = insert_agent(&pool).await;
    let repo = PgComputerRepo::new(pool);
    register_host(&repo).await;

    let mut agent_computer = standard(1);
    agent_computer.agent = Some(agent.clone());
    repo.reserve(agent_computer, now()).await.unwrap();
    repo.reserve(standard(2), now()).await.unwrap();

    assert_eq!(
        repo.agent_of(ComputerId::new_from_uuid(Uuid::from_u128(1)))
            .await
            .unwrap(),
        Some(agent.clone())
    );
    assert_eq!(
        repo.agent_of(ComputerId::new_from_uuid(Uuid::from_u128(2)))
            .await
            .unwrap(),
        None
    );
    assert_eq!(
        repo.computer_for_agent(TEAM, &agent).await.unwrap(),
        Some(ComputerId::new_from_uuid(Uuid::from_u128(1)))
    );
    assert_eq!(
        repo.computer_for_agent(Uuid::from_u128(0xbad), &agent)
            .await
            .unwrap(),
        None
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_agent_gets_only_one_computer(pool: PgPool) {
    insert_team(&pool).await;
    let agent = insert_agent(&pool).await;
    let repo = PgComputerRepo::new(pool);
    register_host(&repo).await;

    let mut first = standard(1);
    first.agent = Some(agent.clone());
    repo.reserve(first, now()).await.unwrap();
    let mut second = standard(2);
    second.agent = Some(agent);

    assert!(matches!(
        repo.reserve(second, now()).await,
        Err(ReserveError::Storage(_))
    ));
}
