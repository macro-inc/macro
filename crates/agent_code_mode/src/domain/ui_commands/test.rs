use super::*;
use crate::domain::ExecutionRecord;
use agent_session::domain::model::PrompterKind;
use entity_access::domain::models::EntityType;
use macro_user_id::cowlike::CowLike;
use std::collections::HashMap;
use std::sync::Mutex;

/// A route table in the generated format: a document and a channel are open
/// to agents; composing mail, a call and every other path are not.
const ROUTES: &str = r#"{"branches": [
    {"route": "mail-compose", "navigable": false, "segments": ["mail", "new"]},
    {"route": "drive-document", "navigable": true, "segments": ["drive", ":", ":"]},
    {"route": "mail-thread", "navigable": true, "segments": ["mail", ":"]},
    {"route": "channels-channel", "navigable": true, "segments": ["channels", ":"]},
    {"route": "legacy-content", "navigable": true, "segments": ["md", ":"]},
    {"route": "meet", "navigable": false, "segments": ["meet", "*"]},
    {"route": "legacy-content", "navigable": false, "segments": [":", ":"]},
    {"route": "not-found", "navigable": false, "segments": ["*"]}
]}"#;

const TURN: u128 = 1;
const DOC: &str = "/drive/md/0190f5a4-0000-7000-8000-000000000001";

fn owner() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|owner@example.com")
        .unwrap()
        .into_owned()
}

fn other_person() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|other@example.com")
        .unwrap()
        .into_owned()
}

fn tab() -> UiClientId {
    UiClientId::from_uuid(Uuid::from_u128(0xc1))
}

fn session() -> AgentSessionId {
    AgentSessionId::new_from_uuid(Uuid::from_u128(7))
}

struct Store(ExecutionRecord);

#[async_trait]
impl ExecutionStore for Store {
    async fn create(&self, _: AgentSessionId, _: &ExecutionRecord) -> Result<(), CodeModeError> {
        unreachable!("ui commands never create executions")
    }

    async fn save(&self, _: AgentSessionId, _: &ExecutionRecord) -> Result<(), CodeModeError> {
        unreachable!("ui commands never save executions")
    }

    async fn get(
        &self,
        _: AgentSessionId,
        execution: ExecutionId,
    ) -> Result<ExecutionRecord, CodeModeError> {
        Some(self.0.clone())
            .filter(|record| record.execution_id == execution)
            .ok_or(CodeModeError::NotFound)
    }
}

struct Active(Option<Uuid>);

#[async_trait]
impl ExecutionTurns for Active {
    async fn active(&self, _: AgentSessionId) -> Result<Option<Uuid>, CodeModeError> {
        Ok(self.0)
    }
}

struct Turn(Option<TurnPrompter>);

#[async_trait]
impl UiTurns for Turn {
    async fn turn(&self, _: AgentSessionId) -> Result<UiTurn, CodeModeError> {
        Ok(UiTurn {
            owner: owner(),
            prompter: self.0.clone(),
            agent_name: "Research agent".into(),
        })
    }
}

struct Flag(bool);

#[async_trait]
impl UiNavigationFlag for Flag {
    async fn enabled(&self, _: &MacroUserIdStr<'static>) -> bool {
        self.0
    }
}

/// Counts per scope, as the shared counter does, all-or-nothing.
#[derive(Default)]
struct Budgets(Mutex<HashMap<String, u32>>);

#[async_trait]
impl UiCommandBudgets for Budgets {
    async fn spend(&self, budgets: &[UiBudget]) -> Result<bool, CodeModeError> {
        let mut counts = self.0.lock().unwrap();
        let keys: Vec<String> = budgets.iter().map(|b| format!("{:?}", b.scope)).collect();
        let room = budgets
            .iter()
            .zip(&keys)
            .all(|(budget, key)| counts.get(key).copied().unwrap_or(0) < budget.max);
        if room {
            for key in keys {
                *counts.entry(key).or_default() += 1;
            }
        }
        Ok(room)
    }
}

/// Records every frame and answers with a fixed number of connections.
struct Gateway {
    connections: u64,
    sent: Mutex<Vec<(MacroUserIdStr<'static>, UiCommandFrame)>>,
}

impl Gateway {
    fn with(connections: u64) -> Arc<Self> {
        Arc::new(Self {
            connections,
            sent: Mutex::new(Vec::new()),
        })
    }

    fn frames(&self) -> Vec<(MacroUserIdStr<'static>, UiCommandFrame)> {
        self.sent.lock().unwrap().clone()
    }
}

#[async_trait]
impl UiCommandDelivery for Gateway {
    async fn send(
        &self,
        user: &MacroUserIdStr<'static>,
        frame: &UiCommandFrame,
    ) -> Result<u64, CodeModeError> {
        self.sent
            .lock()
            .unwrap()
            .push((user.clone(), frame.clone()));
        Ok(self.connections)
    }
}

fn record(execution: ExecutionId, turn: Uuid) -> ExecutionRecord {
    ExecutionRecord {
        execution_id: execution,
        // System turns' programs act as the owner, who also prompts here.
        acting_as: Some(ToolActor::Owner),
        turn_id: Some(turn),
        source: "export async function main() {}".into(),
        status: ExecutionStatus::Running,
        result: None,
        error: None,
        calls: Vec::new(),
        activity: Vec::new(),
        activity_truncated: false,
    }
}

/// The owner typed this turn's prompt in tab `tab()`.
fn typed_in_tab() -> TurnPrompter {
    TurnPrompter {
        kind: PrompterKind::User,
        action_id: AgentActionId::from_uuid(Uuid::from_u128(TURN)),
        user: Some(owner()),
        client: Some(tab()),
    }
}

struct Harness {
    service: UiCommandService,
    gateway: Arc<Gateway>,
    execution: ExecutionId,
}

fn harness(prompter: Option<TurnPrompter>, flag: bool, connections: u64) -> Harness {
    harness_sharing(
        Uuid::from_u128(TURN),
        prompter,
        flag,
        Gateway::with(connections),
        Arc::new(Budgets::default()),
    )
}

fn harness_sharing(
    turn: Uuid,
    prompter: Option<TurnPrompter>,
    flag: bool,
    gateway: Arc<Gateway>,
    budgets: Arc<Budgets>,
) -> Harness {
    let execution = ExecutionId::mint();
    let service = UiCommandService::new(
        UiCommandPorts {
            store: Arc::new(Store(record(execution, turn))),
            active: Arc::new(Active(Some(turn))),
            turns: Arc::new(Turn(prompter)),
            flag: Arc::new(Flag(flag)),
            budgets,
            delivery: gateway.clone(),
        },
        NavigableRoutes::from_json(ROUTES).unwrap(),
    );
    Harness {
        service,
        gateway,
        execution,
    }
}

impl Harness {
    async fn open_as(
        &self,
        caller: MacroUserIdStr<'static>,
        path: &str,
    ) -> Result<UiCommandOutcome, CodeModeError> {
        let access = EntityAccessReceipt::<EditAccessLevel>::dangerously_assert_authenticated_user(
            caller.clone(),
            &session().to_string(),
            EntityType::AgentSession,
        );
        self.service
            .open(
                &access,
                &caller,
                OpenInApp {
                    execution_id: self.execution,
                    path: path.to_owned(),
                    placement: UiPlacement::BesideAgent,
                },
            )
            .await
    }

    async fn open(&self, path: &str) -> UiCommandOutcome {
        self.open_as(owner(), path).await.unwrap()
    }
}

#[tokio::test]
async fn a_prompt_typed_in_a_tab_opens_in_that_tab_only() {
    let harness = harness(Some(typed_in_tab()), true, 2);

    let outcome = harness.open(DOC).await;

    let frames = harness.gateway.frames();
    assert_eq!(frames.len(), 1);
    let (user, frame) = &frames[0];
    assert_eq!(
        outcome,
        UiCommandOutcome::Sent {
            command_id: frame.command_id
        }
    );
    assert_eq!(user, &owner());
    assert_eq!(frame.user_id, owner());
    assert_eq!(frame.client_id, tab());
    assert_eq!(frame.session_id, session());
    assert_eq!(frame.agent_name, "Research agent");
    assert_eq!(frame.path, DOC);
    assert_eq!(frame.kind, UiCommandKind::Open);
}

#[tokio::test]
async fn a_system_turn_never_sends_a_command() {
    // Routines' notification batches, triggers and email-triggered turns are
    // System turns. Even with a person and a tab on the row, nothing is sent.
    let prompter = TurnPrompter {
        kind: PrompterKind::System,
        ..typed_in_tab()
    };
    let harness = harness(Some(prompter), true, 1);

    assert_eq!(harness.open(DOC).await, UiCommandOutcome::NoClient);
    assert!(harness.gateway.frames().is_empty());
}

#[tokio::test]
async fn a_turn_nobody_typed_in_a_tab_never_sends_a_command() {
    // A routine prompt, a channel mention or an API prompt names a person
    // but no tab.
    let prompter = TurnPrompter {
        client: None,
        ..typed_in_tab()
    };
    let harness = harness(Some(prompter), true, 1);

    assert_eq!(harness.open(DOC).await, UiCommandOutcome::NoClient);
    assert!(harness.gateway.frames().is_empty());
}

#[tokio::test]
async fn a_tab_from_an_earlier_turn_is_not_reused() {
    let prompter = TurnPrompter {
        action_id: AgentActionId::from_uuid(Uuid::from_u128(TURN + 1)),
        ..typed_in_tab()
    };
    let harness = harness(Some(prompter), true, 1);

    assert_eq!(harness.open(DOC).await, UiCommandOutcome::NoClient);
    assert!(harness.gateway.frames().is_empty());
}

#[tokio::test]
async fn a_closed_or_foreign_route_is_refused_before_sending() {
    let harness = harness(Some(typed_in_tab()), true, 1);
    let refused = [
        "https://evil.example.com/app/md/x",
        "//evil.example.com/drive/md/x",
        "javascript:alert(1)",
        "/mail/new?to=someone%40example.com",
        "/meet/join/abc",
        "/settings/api-keys",
        "/drive/md/x#fragment",
        "/drive/md/x/~/channels/y",
        "/drive/md/x\\..\\y",
        "drive/md/x",
        "",
    ];

    for path in refused {
        assert_eq!(
            harness.open(path).await,
            UiCommandOutcome::Declined {
                reason: UiDeclineReason::NotAllowedRoute
            },
            "{path}"
        );
    }
    assert!(harness.gateway.frames().is_empty());
}

#[tokio::test]
async fn open_routes_pass_with_their_query() {
    let harness = harness(Some(typed_in_tab()), true, 1);

    for path in [
        "/md/0190f5a4-0000-7000-8000-000000000001",
        "/mail/0190f5a4-0000-7000-8000-000000000002",
        "/channels/c1?s0.channels.messageId=m1",
    ] {
        assert!(
            matches!(harness.open(path).await, UiCommandOutcome::Sent { .. }),
            "{path}"
        );
    }
}

#[tokio::test]
async fn a_turn_sends_at_most_three_panes() {
    let harness = harness(Some(typed_in_tab()), true, 1);

    for _ in 0..MAX_NEW_PANES_PER_TURN {
        assert!(matches!(
            harness.open(DOC).await,
            UiCommandOutcome::Sent { .. }
        ));
    }

    assert_eq!(
        harness.open(DOC).await,
        UiCommandOutcome::Declined {
            reason: UiDeclineReason::RateLimited
        }
    );
    assert_eq!(harness.gateway.frames().len(), 3);
}

#[tokio::test]
async fn a_person_gets_at_most_thirty_commands_a_minute_across_sessions() {
    let gateway = Gateway::with(1);
    let budgets = Arc::new(Budgets::default());
    let mut sent = 0;

    // Eleven sessions' turns, three panes each: 33 tries.
    for _ in 0..11 {
        let turn = AgentActionId::mint();
        let harness = harness_sharing(
            turn.as_uuid(),
            Some(TurnPrompter {
                action_id: turn,
                ..typed_in_tab()
            }),
            true,
            gateway.clone(),
            budgets.clone(),
        );
        for _ in 0..MAX_NEW_PANES_PER_TURN {
            if matches!(harness.open(DOC).await, UiCommandOutcome::Sent { .. }) {
                sent += 1;
            }
        }
    }

    assert_eq!(sent, MAX_COMMANDS_PER_USER_MINUTE);
    assert_eq!(gateway.frames().len(), 30);
}

#[tokio::test]
async fn navigation_turned_off_sends_nothing() {
    let harness = harness(Some(typed_in_tab()), false, 1);

    assert_eq!(
        harness.open(DOC).await,
        UiCommandOutcome::Declined {
            reason: UiDeclineReason::TurnedOff
        }
    );
    assert!(harness.gateway.frames().is_empty());
}

#[tokio::test]
async fn a_tab_that_is_not_connected_is_no_client() {
    let harness = harness(Some(typed_in_tab()), true, 0);

    assert_eq!(harness.open(DOC).await, UiCommandOutcome::NoClient);
}

#[tokio::test]
async fn only_the_account_the_execution_acts_as_may_send() {
    let harness = harness(Some(typed_in_tab()), true, 1);

    let result = harness.open_as(other_person(), DOC).await;

    assert!(matches!(result, Err(CodeModeError::Forbidden)));
    assert!(harness.gateway.frames().is_empty());
}

#[test]
fn the_web_apps_table_opens_items_and_keeps_side_effects_closed() {
    let routes = NavigableRoutes::generated().unwrap();
    let route_of = |path: &str| {
        routes
            .check(path)
            .map(|path| path.route_ids()[0].to_owned())
    };

    assert_eq!(
        route_of("/md/0190f5a4-0000-7000-8000-000000000001").as_deref(),
        Some("legacy-content")
    );
    assert_eq!(
        route_of("/drive/md/0190f5a4-0000-7000-8000-000000000001").as_deref(),
        Some("drive-document")
    );
    assert_eq!(
        route_of("/channels/0190f5a4-0000-7000-8000-000000000002?s0.channels.messageId=m")
            .as_deref(),
        Some("channels-channel")
    );
    assert_eq!(
        route_of("/mail/0190f5a4-0000-7000-8000-000000000003").as_deref(),
        Some("mail-thread")
    );

    for closed in [
        "/mail/new",
        "/MAIL/New",
        "/meet/join/token",
        "/settings/api-keys",
        "/settings",
        "/component/settings",
        "/debug/ui",
        "/routines/new",
        "/signup",
        "/inbox-link-callback",
        "/pipedream-connect.html",
    ] {
        assert_eq!(route_of(closed), None, "{closed}");
    }
}
