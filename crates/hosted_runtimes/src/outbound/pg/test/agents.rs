use super::*;
use crate::domain::agent::ComputerAgents;
use crate::outbound::pg::PgComputerAgents;
use harnesses::domain::ports::ComputerTeamAgents;

pub(super) async fn insert_agent(pool: &PgPool) -> MacroUserIdStr<'static> {
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

    let mut for_agent = standard(1);
    for_agent.agent = Some(agent.clone());
    let reservation = reserve(&repo, for_agent).await;
    bought(&repo, 2).await;

    // Confirming: the reservation carries the link.
    assert_eq!(repo.agent_of(id).await.unwrap(), Some(agent.clone()));
    assert_eq!(
        repo.computer_for_agent(TEAM, &agent).await.unwrap(),
        Some(id)
    );
    // A purchase still confirming is not a computer yet.
    assert!(!repo.has_live_computer(TEAM, &agent).await.unwrap());
    // The harness listings read the same link, many computers at once.
    let people_computer = ComputerId::new_from_uuid(Uuid::from_u128(2));
    assert_eq!(
        PgComputerAgents::new(pool.clone())
            .team_agents_of(&[id, people_computer])
            .await
            .unwrap(),
        std::collections::HashMap::from([(id, agent.clone())])
    );

    repo.convert_reservation(reservation.id, active(1), now())
        .await
        .unwrap()
        .unwrap();

    // Bought: the computer carries it.
    assert_eq!(repo.agent_of(id).await.unwrap(), Some(agent.clone()));
    assert_eq!(
        PgComputerAgents::new(pool.clone())
            .team_agents_of(&[id, people_computer])
            .await
            .unwrap(),
        std::collections::HashMap::from([(id, agent.clone())])
    );
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
async fn the_purchase_trace_records_only_the_agent_computer_insert_commit(pool: PgPool) {
    use opentelemetry::{KeyValue, trace::TracerProvider as _};
    use opentelemetry_sdk::trace::{InMemorySpanExporter, SdkTracerProvider};
    use tracing::instrument::WithSubscriber as _;
    use tracing_subscriber::prelude::*;

    insert_team(&pool).await;
    let repo = PgComputerRepo::new(pool.clone(), policy());
    host(&repo, "commit-test-host", 31, 7, 3).await;
    let mut for_agent = standard(1);
    for_agent.agent = Some(insert_agent(&pool).await);
    let reservation = reserve(&repo, for_agent).await;

    let exporter = InMemorySpanExporter::default();
    let provider = SdkTracerProvider::builder()
        .with_simple_exporter(exporter.clone())
        .build();
    let subscriber = tracing_subscriber::registry()
        .with(tracing_opentelemetry::layer().with_tracer(provider.tracer("test")));

    async {
        bought(&repo, 2).await;
        let inserted = repo
            .convert_reservation(reservation.id, active(1), now())
            .await
            .expect("agent computer transaction");
        assert!(inserted.is_some());
        let repeated = repo
            .convert_reservation(reservation.id, active(1), now())
            .await
            .expect("repeated conversion");
        assert!(repeated.is_none());
    }
    .with_subscriber(subscriber)
    .await;

    provider.force_flush().expect("flush spans");
    let spans = exporter.get_finished_spans().expect("purchase trace");
    let phases: Vec<_> = spans
        .iter()
        .filter(|span| span.name == "computer.purchase.invite_phase")
        .collect();
    assert_eq!(phases.len(), 1);
    assert!(
        phases[0]
            .attributes
            .contains(&KeyValue::new("phase", "commit"))
    );
    assert!(
        phases[0]
            .attributes
            .contains(&KeyValue::new("outcome", "ok"))
    );
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

    assert!(matches!(
        repo.reserve(second, now(), now() + Duration::minutes(15))
            .await,
        Err(ReserveError::Storage(_))
    ));
}

/// The agent's hand-off and start are timed in Postgres too: a finished
/// hand-off changes nothing but the setup timeline, and still counts.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_agent_hand_off_and_start_are_timed_in_postgres(pool: PgPool) {
    insert_team(&pool).await;
    let repo = PgComputerRepo::new(pool.clone(), policy());
    host(&repo, "agent-timing-host", 31, 7, 3).await;
    let id = bought(&repo, 1).await.id;
    changed(&repo, id, Event::InstanceStarted, now()).await;
    let connected = changed(
        &repo,
        id,
        Event::MacrodConnected,
        now() + Duration::seconds(10),
    )
    .await;
    assert!(
        connected
            .state
            .setup
            .as_ref()
            .is_some_and(|setup| setup.connected_at.is_some())
    );

    let delivered = changed(
        &repo,
        id,
        Event::AgentDelivered,
        now() + Duration::seconds(12),
    )
    .await;
    let online = changed(&repo, id, Event::AgentOnline, now() + Duration::seconds(20)).await;

    let setup = |computer: &Computer| computer.state.setup.clone().unwrap();
    assert_eq!(
        setup(&delivered).agent_delivered_at,
        Some(now() + Duration::seconds(12))
    );
    assert_eq!(
        setup(&online).agent_online_at,
        Some(now() + Duration::seconds(20))
    );
    let stored = repo.get(id).await.unwrap().unwrap().into_healthy().unwrap();
    assert_eq!(
        setup(&stored).agent_delivered_at,
        Some(now() + Duration::seconds(12))
    );
}
