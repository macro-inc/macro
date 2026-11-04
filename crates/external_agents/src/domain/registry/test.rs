use super::*;
use crate::domain::fakes::{FakeEndpoints, FakePersonas, FakeRepo, OWNER, agent, user};

fn request(endpoint_url: Option<&str>) -> RegisterExternalAgent {
    RegisterExternalAgent {
        team_id: None,
        name: "Outside Assistant".to_owned(),
        handle: "outside".to_owned(),
        description: None,
        avatar_url: None,
        endpoint_url: endpoint_url.map(str::to_owned),
    }
}

fn registry(
    endpoints: FakeEndpoints,
) -> ExternalAgentRegistryService<FakePersonas, FakeEndpoints, FakeRepo> {
    ExternalAgentRegistryService::new(FakePersonas::default(), endpoints, FakeRepo::default())
}

#[tokio::test]
async fn registering_with_an_endpoint_creates_a_verified_persona_inbox_and_credentials() {
    let registry = registry(FakeEndpoints {
        verifies: true,
        ..FakeEndpoints::default()
    });

    let registered = registry
        .register(user(OWNER), request(Some("https://agent.example.com/macro")))
        .await
        .expect("registration succeeds");

    let bot_id = registered.agent.bot.id;
    let created = registry.personas.created.lock().unwrap();
    assert_eq!(created[0].harness, harness_id::EXTERNAL_HARNESS_SLUG);
    assert_eq!(created[0].default_model, EXTERNAL_AGENT_MODEL);
    drop(created);
    assert_eq!(registered.bot_token, format!("mbot_token_for_{bot_id}"));
    assert_eq!(registered.signing_secret.as_deref(), Some("whsec_test"));
    let endpoint = registered.agent.endpoint.expect("an endpoint");
    assert_eq!(endpoint.url, "https://agent.example.com/macro");
    assert!(endpoint.verified);
    assert_eq!(
        registry.repo.agents.lock().unwrap().get(&bot_id),
        Some(&Some(endpoint.webhook_id)),
    );
}

#[tokio::test]
async fn registering_without_an_endpoint_leaves_the_runtime_polling() {
    let registry = registry(FakeEndpoints::default());

    let registered = registry
        .register(user(OWNER), request(Some("   ")))
        .await
        .expect("registration succeeds");

    assert!(registered.agent.endpoint.is_none());
    assert!(registered.signing_secret.is_none());
    assert!(registry.endpoints.endpoints.lock().unwrap().is_empty());
    assert_eq!(
        registry
            .repo
            .agents
            .lock()
            .unwrap()
            .get(&registered.agent.bot.id),
        Some(&None),
    );
}

#[tokio::test]
async fn an_unreachable_endpoint_still_registers_the_agent_unverified() {
    let registry = registry(FakeEndpoints {
        verifies: false,
        ..FakeEndpoints::default()
    });

    let registered = registry
        .register(user(OWNER), request(Some("https://agent.example.com/macro")))
        .await
        .expect("registration succeeds");

    assert!(!registered.agent.endpoint.expect("an endpoint").verified);
}

#[tokio::test]
async fn a_rejected_endpoint_removes_the_agent_it_created() {
    let registry = registry(FakeEndpoints {
        reject_urls: true,
        ..FakeEndpoints::default()
    });

    let error = registry
        .register(user(OWNER), request(Some("http://agent.example.com/macro")))
        .await
        .expect_err("the endpoint is rejected");

    assert!(matches!(error, ExternalAgentError::BadRequest(_)));
    assert!(registry.personas.agents.lock().unwrap().is_empty());
    assert_eq!(registry.personas.deleted.lock().unwrap().len(), 1);
    assert!(registry.repo.agents.lock().unwrap().is_empty());
}

#[tokio::test]
async fn listing_returns_only_registered_external_agents_with_their_endpoints() {
    let registry = registry(FakeEndpoints::default());
    let pushed = registry
        .register(user(OWNER), request(Some("https://agent.example.com/macro")))
        .await
        .unwrap();
    let polling = registry
        .register(user(OWNER), request(None))
        .await
        .unwrap();
    let in_macro = agent(BotId::new_from_uuid(uuid::Uuid::from_u128(0xC0DE)), "in-memory");
    registry.personas.agents.lock().unwrap().push(in_macro);

    let mut listed = registry.list(user(OWNER)).await.unwrap();
    listed.sort_by_key(|agent| agent.bot.id.as_uuid());

    assert_eq!(
        listed
            .iter()
            .map(|agent| (agent.bot.id, agent.endpoint.as_ref().map(|e| e.url.clone())))
            .collect::<Vec<_>>(),
        vec![
            (
                pushed.agent.bot.id,
                Some("https://agent.example.com/macro".to_owned())
            ),
            (polling.agent.bot.id, None),
        ],
    );
}

#[tokio::test]
async fn adding_an_endpoint_to_a_polling_agent_hands_over_its_new_secret() {
    let registry = registry(FakeEndpoints {
        verifies: true,
        ..FakeEndpoints::default()
    });
    let polling = registry
        .register(user(OWNER), request(None))
        .await
        .unwrap();
    let bot_id = polling.agent.bot.id;

    let added = registry
        .set_endpoint(
            user(OWNER),
            bot_id,
            Some("https://agent.example.com/macro".to_owned()),
        )
        .await
        .unwrap();
    assert_eq!(added.signing_secret.as_deref(), Some("whsec_test"));
    assert!(added.agent.endpoint.as_ref().unwrap().verified);

    let moved = registry
        .set_endpoint(
            user(OWNER),
            bot_id,
            Some("https://agent.example.com/v2".to_owned()),
        )
        .await
        .unwrap();
    assert!(moved.signing_secret.is_none(), "a moved endpoint keeps its secret");
    assert_eq!(moved.agent.endpoint.unwrap().url, "https://agent.example.com/v2");

    let removed = registry
        .set_endpoint(user(OWNER), bot_id, None)
        .await
        .unwrap();
    assert!(removed.agent.endpoint.is_none());
    assert!(registry.endpoints.endpoints.lock().unwrap().is_empty());
    assert_eq!(registry.repo.agents.lock().unwrap().get(&bot_id), Some(&None));
}

#[tokio::test]
async fn an_agent_that_runs_in_macro_is_not_an_external_agent() {
    let registry = registry(FakeEndpoints::default());
    let bot_id = BotId::new_from_uuid(uuid::Uuid::from_u128(0xC0DE));
    registry
        .personas
        .agents
        .lock()
        .unwrap()
        .push(agent(bot_id, "in-memory"));

    for error in [
        registry.issue_token(user(OWNER), bot_id).await.unwrap_err(),
        registry.delete(user(OWNER), bot_id).await.unwrap_err(),
        registry
            .set_endpoint(user(OWNER), bot_id, None)
            .await
            .map(drop)
            .unwrap_err(),
    ] {
        assert!(matches!(error, ExternalAgentError::NotFound));
    }
    assert!(registry.personas.tokens.lock().unwrap().is_empty());
    assert!(registry.personas.deleted.lock().unwrap().is_empty());
}

#[tokio::test]
async fn deleting_removes_the_agent_its_endpoint_and_its_inbox() {
    let registry = registry(FakeEndpoints::default());
    let registered = registry
        .register(user(OWNER), request(Some("https://agent.example.com/macro")))
        .await
        .unwrap();
    let bot_id = registered.agent.bot.id;

    registry.delete(user(OWNER), bot_id).await.unwrap();

    assert_eq!(*registry.personas.deleted.lock().unwrap(), vec![bot_id]);
    assert!(registry.endpoints.endpoints.lock().unwrap().is_empty());
    assert!(registry.repo.agents.lock().unwrap().is_empty());
}
