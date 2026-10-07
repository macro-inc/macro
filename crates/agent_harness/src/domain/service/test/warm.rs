use super::*;

struct WarmLifecycleStub {
    claim: bool,
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
            dyn std::future::Future<Output = agent_session::domain::error::Result<bool>>
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
        Arc::new(WarmLifecycleStub { claim: false }),
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
    let service =
        service.with_warm_sessions(Arc::new(WarmLifecycleStub { claim: true }), tools.clone());
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
