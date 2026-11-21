use super::*;
use agent_code_mode::domain::ui_commands::*;
use agent_runtime_protocol::domain::action::AgentActionId;
use agent_session::domain::model::{PrompterKind, TurnPrompter, UiClientId};

struct Prompt;
#[async_trait]
impl UiTurns for Prompt {
    async fn turn(&self, _: AgentSessionId) -> Result<UiTurn, CodeModeError> {
        Ok(UiTurn {
            owner: MacroUserIdStr::try_from_email("owner@example.com").unwrap(),
            prompter: Some(TurnPrompter {
                kind: PrompterKind::User,
                action_id: AgentActionId::from_uuid(Uuid::from_u128(402)),
                user: Some(MacroUserIdStr::try_from_email("owner@example.com").unwrap()),
                client: Some(UiClientId::from_uuid(Uuid::from_u128(501))),
            }),
            agent_name: "Fixture".into(),
        })
    }
}
struct Budgets;
#[async_trait]
impl UiCommandBudgets for Budgets {
    async fn spend(&self, _: &[UiBudget]) -> Result<bool, CodeModeError> {
        Ok(true)
    }
}
#[derive(Default)]
struct Delivery(AtomicUsize);
#[async_trait]
impl UiCommandDelivery for Delivery {
    async fn send(
        &self,
        _: &MacroUserIdStr<'static>,
        _: &UiCommandFrame,
    ) -> Result<u64, CodeModeError> {
        self.0.fetch_add(1, Ordering::SeqCst);
        Ok(1)
    }
}
#[tokio::test]
async fn navigation_refuses_borrowed_executions_and_keeps_the_own_run_working() {
    let fixture = Fixture::new(true);
    let delivery = Arc::new(Delivery::default());
    let service = UiCommandService::new(
        UiCommandPorts {
            store: fixture.store.clone(),
            active: Arc::new(Turns),
            turns: Arc::new(Prompt),
            budgets: Arc::new(Budgets),
            delivery: delivery.clone(),
        },
        NavigableRoutes::generated().unwrap(),
    );
    let mut failures = Vec::new();
    for (label, attribution) in [
        ("uncorrelated", Attribution::default()),
        (
            "another session",
            Attribution {
                correlation_id: Some(Uuid::from_u128(301)),
                session_id: Some(Uuid::from_u128(201)),
                ..Default::default()
            },
        ),
        (
            "sibling execution",
            Attribution {
                correlation_id: Some(Uuid::from_u128(303)),
                session_id: Some(Uuid::from_u128(202)),
                ..Default::default()
            },
        ),
        (
            "scoped",
            Attribution {
                correlation_id: Some(Uuid::from_u128(302)),
                session_id: Some(Uuid::from_u128(202)),
                scope: Some(SessionScope::NoSend),
                ..Default::default()
            },
        ),
    ] {
        let result = scope_attribution(
            attribution,
            service.open(
                &fixture.access,
                &fixture.owner,
                OpenInApp {
                    execution_id: fixture.execution,
                    path: "/drive/md/0190f5a4-0000-7000-8000-000000000001".into(),
                    placement: UiPlacement::BesideAgent,
                },
            ),
        )
        .await;
        if !matches!(result, Err(CodeModeError::Forbidden)) {
            failures.push(format!("{label}: {result:?}"));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
    assert_eq!(delivery.0.load(Ordering::SeqCst), 0);
    let own = Attribution {
        correlation_id: Some(Uuid::from_u128(302)),
        session_id: Some(Uuid::from_u128(202)),
        ..Default::default()
    };
    let result = scope_attribution(
        own,
        service.open(
            &fixture.access,
            &fixture.owner,
            OpenInApp {
                execution_id: fixture.execution,
                path: "/drive/md/0190f5a4-0000-7000-8000-000000000001".into(),
                placement: UiPlacement::BesideAgent,
            },
        ),
    )
    .await
    .unwrap();
    assert!(matches!(result, UiCommandOutcome::Sent { .. }));
    assert_eq!(delivery.0.load(Ordering::SeqCst), 1);
}
