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

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_purchase_for_an_agent_links_it_while_confirming_and_after(pool: PgPool) {
    insert_team(&pool).await;
    let agent = insert_agent(&pool).await;
    let repo = PgComputerRepo::new(pool.clone(), policy());
    host(&repo, "runtime-dev-1", 31, 7, 3).await;
    let id = ComputerId::new_from_uuid(Uuid::from_u128(1));

    // Bought first: a team buys one unpaid computer at a time.
    bought(&repo, 2).await;
    let mut for_agent = standard(1);
    for_agent.agent = Some(agent.clone());
    let reservation = reserve(&repo, for_agent).await;

    // Confirming: the reservation carries the link.
    assert_eq!(repo.agent_of(id).await.unwrap(), Some(agent.clone()));
    assert_eq!(
        repo.computer_for_agent(TEAM, &agent).await.unwrap(),
        Some(id)
    );
    // A purchase still confirming is not a computer yet.
    assert!(!repo.has_live_computer(TEAM, &agent).await.unwrap());

    repo.convert_reservation(reservation.id, now())
        .await
        .unwrap()
        .unwrap();

    // Bought: the computer carries it.
    assert_eq!(repo.agent_of(id).await.unwrap(), Some(agent.clone()));
    assert_eq!(
        repo.computer_for_agent(TEAM, &agent).await.unwrap(),
        Some(id)
    );
    assert_eq!(
        repo.agent_of(ComputerId::new_from_uuid(Uuid::from_u128(2)))
            .await
            .unwrap(),
        None
    );
    assert_eq!(
        repo.computer_for_agent(Uuid::from_u128(0xbad), &agent)
            .await
            .unwrap(),
        None
    );
    assert!(repo.has_live_computer(TEAM, &agent).await.unwrap());
    assert!(
        !repo
            .has_live_computer(Uuid::from_u128(0xbad), &agent)
            .await
            .unwrap()
    );

    // Released: still linked, no longer live.
    sqlx::query!(
        r#"UPDATE hosted_runtime SET state = jsonb_set(state, '{phase}', '{"phase": "destroying"}') WHERE id = $1"#,
        id.as_uuid(),
    )
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(
        repo.computer_for_agent(TEAM, &agent).await.unwrap(),
        Some(id)
    );
    assert!(!repo.has_live_computer(TEAM, &agent).await.unwrap());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_agent_gets_only_one_computer(pool: PgPool) {
    insert_team(&pool).await;
    let agent = insert_agent(&pool).await;
    let repo = PgComputerRepo::new(pool, policy());
    host(&repo, "runtime-dev-1", 31, 7, 3).await;

    let mut first = standard(1);
    first.agent = Some(agent.clone());
    reserve(&repo, first).await;
    let mut second = standard(2);
    second.agent = Some(agent);
    // Comped, so the team's unpaid first purchase does not refuse it first.
    second.funding = Funding::Comped {
        reason: "internal team".to_owned(),
    };

    assert!(matches!(
        repo.reserve(second, now(), now() + Duration::minutes(15))
            .await,
        Err(ReserveError::Storage(_))
    ));
}
