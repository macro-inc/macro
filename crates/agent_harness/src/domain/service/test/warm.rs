use super::*;
use agent_session::domain::warm::{WarmClaim, WarmMissReason};

struct WarmLifecycleStub {
    claim: WarmClaim,
}
impl agent_session::domain::warm::WarmSessionLifecycle for WarmLifecycleStub {
    fn claim<'a>(
        &'a self,
        _id: AgentSessionId,
        _owner: &'a model_owner::Owner,
        _bot: BotId,
        _model: &'a str,
        _instructions: Option<&'a str>,
    ) -> std::pin::Pin<
        Box<
            dyn std::future::Future<Output = agent_session::domain::error::Result<WarmClaim>>
                + Send
                + 'a,
        >,
    > {
        Box::pin(async { Ok(self.claim) })
    }
    fn expire(
        &self,
    ) -> std::pin::Pin<
        Box<
            dyn std::future::Future<
                    Output = agent_session::domain::error::Result<Vec<AgentSessionId>>,
                > + Send
                + '_,
        >,
    > {
        Box::pin(async { Ok(Vec::new()) })
    }
}

#[tokio::test]
async fn warming_rejects_bot_owners_and_bounds_speculation_per_user() {
    let (service, _, containers, _, _) = harness();
    let service = service.with_warm_sessions(
        Arc::new(WarmLifecycleStub {
            claim: WarmClaim::Missed(WarmMissReason::NotFound),
        }),
        Arc::new(agent_session::domain::ports::NoOpToolCatalog),
    );
    assert!(matches!(
        service
            .warm_session(
                model_owner::Owner::Bot(BotId::TEST_A),
                AgentSessionId::new()
            )
            .await,
        Err(AgentSessionError::OwnerNotUser(_))
    ));
    let owner = model_owner::Owner::User(sender());
    {
        let mut reservations = service.warm_reservations.lock().await;
        for _ in 0..2 {
            reservations.insert(
                AgentSessionId::new(),
                (owner.clone(), std::time::Instant::now()),
            );
        }
    }
    assert!(
        service
            .warm_session(owner, AgentSessionId::new())
            .await
            .unwrap()
            .is_none()
    );
    assert_eq!(containers.spawned(), 0);
}

struct GatedWarmTools(tokio::sync::Semaphore);

impl agent_session::domain::ports::SessionToolCatalog for GatedWarmTools {
    fn tool_definitions(
        &self,
        _servers: Vec<agent_client_protocol::schema::v1::McpServer>,
    ) -> std::pin::Pin<
        Box<
            dyn Future<Output = Vec<agent_session::domain::ports::SessionToolDefinition>>
                + Send
                + '_,
        >,
    > {
        Box::pin(async {
            self.0.acquire().await.expect("test gate is open").forget();
            Vec::new()
        })
    }
}

#[tokio::test]
async fn warming_initializes_without_a_prompt_or_visible_created_event() {
    let ((service, repo, containers, _, _), signals) =
        harness_with_signals(PromptContextMock::default(), PromptComposerMock::default());
    let tools = Arc::new(GatedWarmTools(tokio::sync::Semaphore::new(0)));
    let service = service.with_warm_sessions(
        Arc::new(WarmLifecycleStub {
            claim: WarmClaim::Claimed,
        }),
        tools.clone(),
    );
    let id = AgentSessionId::new();
    let mut warm = Box::pin(service.warm_session(model_owner::Owner::User(sender()), id));
    let drive = async {
        loop {
            if containers.spawned() == 1 {
                break;
            }
            tokio::task::yield_now().await;
        }
        let container = containers.container(id).expect("warm runtime");
        complete_session_handshake(&container).await;
        assert!(prompts(&container.agent()).is_empty());
    };
    tokio::select! {
        result = &mut warm => panic!("warm returned before MCP readiness: {result:?}"),
        () = drive => {},
    }
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(20), &mut warm)
            .await
            .is_err()
    );
    tools.0.add_permits(1);
    assert_eq!(warm.await.unwrap().unwrap().id, id);
    assert!(repo.get(id).await.is_ok());
    assert!(signals.lifecycle.published().is_empty());
    let claimed = service
        .open_managed_session(OpenManagedSession {
            id: Some(id),
            owner: model_owner::Owner::User(sender()),
            prompt: None,
            repo_url: None,
            repo_branch: None,
            instructions: None,
            model: None,
            profile: Some(agent_session::domain::ports::SelectedManagedPersona {
                bot_id: bot_id::MACRO_NEW_BOT_ID,
                profile: None,
            }),
        })
        .await
        .expect("claim prepared session");
    assert_eq!(claimed.id, id);
    assert!(service.warm_reservations.lock().await.is_empty());
    assert_eq!(
        containers.spawned(),
        1,
        "claim must reuse the prepared runtime"
    );
    assert_eq!(
        signals.lifecycle.published().len(),
        1,
        "claim reveals the conversation"
    );
}

fn span_exporter() -> (
    opentelemetry_sdk::trace::InMemorySpanExporter,
    opentelemetry_sdk::trace::SdkTracerProvider,
    tracing::subscriber::DefaultGuard,
) {
    use opentelemetry::trace::TracerProvider as _;
    use tracing_subscriber::layer::SubscriberExt as _;
    let exporter = opentelemetry_sdk::trace::InMemorySpanExporter::default();
    let provider = opentelemetry_sdk::trace::SdkTracerProvider::builder()
        .with_simple_exporter(exporter.clone())
        .build();
    let layer = tracing_opentelemetry::layer().with_tracer(provider.tracer("test"));
    let guard = tracing::subscriber::set_default(tracing_subscriber::registry().with(layer));
    tracing::callsite::rebuild_interest_cache();
    (exporter, provider, guard)
}

fn attributes(
    exporter: &opentelemetry_sdk::trace::InMemorySpanExporter,
    provider: &opentelemetry_sdk::trace::SdkTracerProvider,
    name: &str,
) -> std::collections::HashMap<String, opentelemetry::Value> {
    provider.force_flush().expect("flush");
    let spans = exporter.get_finished_spans().expect("finished spans");
    let span = spans
        .iter()
        .find(|span| span.name == name)
        .unwrap_or_else(|| {
            panic!(
                "no {name} span in {:?}",
                spans.iter().map(|span| &span.name).collect::<Vec<_>>()
            )
        });
    span.attributes
        .iter()
        .map(|kv| (kv.key.to_string(), kv.value.clone()))
        .collect()
}

#[tokio::test]
async fn a_missed_warm_claim_records_why_on_the_open_span() {
    let (exporter, provider, _guard) = span_exporter();
    let (service, _, _, _, _) = harness();
    let service = service.with_warm_sessions(
        Arc::new(WarmLifecycleStub {
            claim: WarmClaim::Missed(WarmMissReason::ModelMismatch),
        }),
        Arc::new(agent_session::domain::ports::NoOpToolCatalog),
    );
    let session = service
        .open_managed_session(OpenManagedSession {
            id: Some(AgentSessionId::new()),
            owner: model_owner::Owner::User(sender()),
            prompt: None,
            repo_url: None,
            repo_branch: None,
            instructions: None,
            model: Some("composer-model".to_owned()),
            profile: Some(agent_session::domain::ports::SelectedManagedPersona {
                bot_id: bot_id::MACRO_NEW_BOT_ID,
                profile: None,
            }),
        })
        .await
        .expect("cold open after a missed claim");
    // The session's actor holds the open span until the session ends.
    service
        .execute(session.id, HarnessCommand::Delete)
        .await
        .expect("delete");

    let attributes = attributes(&exporter, &provider, "open_managed_session_inner");
    assert_eq!(
        attributes.get("agent.session.warm_miss_reason"),
        Some(&opentelemetry::Value::from("model_mismatch"))
    );
    assert_eq!(
        attributes.get("agent.session.warm_id_sent"),
        Some(&opentelemetry::Value::Bool(true))
    );
    assert_eq!(
        attributes.get("agent.session.warm_hit"),
        Some(&opentelemetry::Value::Bool(false))
    );
    assert_eq!(
        attributes.get("agent.session.model"),
        Some(&opentelemetry::Value::from("composer-model"))
    );
}

#[tokio::test]
async fn an_open_without_a_client_id_records_that_no_warm_id_was_sent() {
    let (exporter, provider, _guard) = span_exporter();
    let (service, _, _, _, _) = harness();
    let service = service.with_warm_sessions(
        Arc::new(WarmLifecycleStub {
            claim: WarmClaim::Missed(WarmMissReason::NotFound),
        }),
        Arc::new(agent_session::domain::ports::NoOpToolCatalog),
    );
    let session = service
        .open_managed_session(OpenManagedSession {
            id: None,
            owner: model_owner::Owner::User(sender()),
            prompt: None,
            repo_url: None,
            repo_branch: None,
            instructions: None,
            model: None,
            profile: Some(agent_session::domain::ports::SelectedManagedPersona {
                bot_id: bot_id::MACRO_NEW_BOT_ID,
                profile: None,
            }),
        })
        .await
        .expect("cold open");
    // The session's actor holds the open span until the session ends.
    service
        .execute(session.id, HarnessCommand::Delete)
        .await
        .expect("delete");

    let attributes = attributes(&exporter, &provider, "open_managed_session_inner");
    assert_eq!(
        attributes.get("agent.session.warm_miss_reason"),
        Some(&opentelemetry::Value::from("no_warm_id"))
    );
    assert_eq!(
        attributes.get("agent.session.warm_id_sent"),
        Some(&opentelemetry::Value::Bool(false))
    );
}

#[tokio::test]
async fn warming_past_the_owner_cap_records_the_refusal() {
    let (exporter, provider, _guard) = span_exporter();
    let (service, _, _, _, _) = harness();
    let service = service.with_warm_sessions(
        Arc::new(WarmLifecycleStub {
            claim: WarmClaim::Claimed,
        }),
        Arc::new(agent_session::domain::ports::NoOpToolCatalog),
    );
    let owner = model_owner::Owner::User(sender());
    {
        let mut reservations = service.warm_reservations.lock().await;
        for _ in 0..2 {
            reservations.insert(
                AgentSessionId::new(),
                (owner.clone(), std::time::Instant::now()),
            );
        }
    }
    assert!(
        service
            .warm_session(owner, AgentSessionId::new())
            .await
            .unwrap()
            .is_none()
    );

    let attributes = attributes(&exporter, &provider, "agent.session.prepare_warm");
    assert_eq!(
        attributes.get("agent.warm.outcome"),
        Some(&opentelemetry::Value::from("refused_owner_cap"))
    );
    assert!(attributes.contains_key("agent.session.model"));
}
