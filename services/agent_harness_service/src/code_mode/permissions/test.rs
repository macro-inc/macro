//! The gate's decisions with fake analyzer, permissions and holds. The
//! fakes are shared with `code_mode/test.rs`, which runs the whole
//! credential issue against a database.

use std::collections::BTreeMap;
use std::sync::Mutex;

use agent_egress::domain::error::EgressError;
use agent_permission_registry::Action;
use agent_permissions::domain::model::{
    Caller, CatalogEntry, Change, Origin, PermissionError, PermissionState, PermissionsView,
    ResolvedCall, Tightened, ToolPermissionCatalog,
};
use agent_session::domain::model::{AgentSessionId, PrompterKind};
use agent_session::testing::test_agent_session;
use bot_id::BotId;
use code_execution::domain::{Diagnostic, SdkOperation};
use entity_access::domain::models::{EntityAccessReceipt, ViewAccessLevel};

use super::*;

/// Answers with a fixed analysis and counts how often it was asked.
pub(crate) struct FakeAnalyzer {
    pub analysis: Result<Analysis, ()>,
    pub calls: Mutex<usize>,
}

impl FakeAnalyzer {
    pub fn new(analysis: Analysis) -> Self {
        Self {
            analysis: Ok(analysis),
            calls: Mutex::new(0),
        }
    }
}

#[async_trait]
impl ProgramAnalyzer for FakeAnalyzer {
    fn sdk_fingerprint(&self) -> &str {
        "0.1.0+fixture"
    }
    async fn may_call(&self, _: &str) -> Result<Analysis, CheckError> {
        *self.calls.lock().unwrap() += 1;
        self.analysis.clone().map_err(|()| CheckError::Internal)
    }
}

pub(crate) fn call(service: &str, operation: &str) -> SdkCall {
    SdkCall {
        operation: SdkOperation {
            service: service.into(),
            operation_id: operation.into(),
        },
        method: "POST".into(),
        route: format!("/{operation}"),
        rivals: Vec::new(),
    }
}

/// Permissions that set each operation as `states` says, always otherwise;
/// an operation named `unknown_*` is missing from the registry.
pub(crate) struct FakePermissions(pub BTreeMap<String, PermissionState>);

#[async_trait]
impl AgentPermissions for FakePermissions {
    async fn catalog(&self, _: &Caller) -> Result<ToolPermissionCatalog, PermissionError> {
        Err(PermissionError::NotFound)
    }
    async fn view_agent(&self, _: &Caller, _: BotId) -> Result<PermissionsView, PermissionError> {
        Err(PermissionError::NotFound)
    }
    async fn view_session(
        &self,
        _: &Caller,
        _: &EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<PermissionsView, PermissionError> {
        Err(PermissionError::NotFound)
    }
    async fn set(
        &self,
        _: &Caller,
        _: BotId,
        _: Vec<Change>,
    ) -> Result<PermissionsView, PermissionError> {
        Err(PermissionError::NotFound)
    }
    async fn tighten(
        &self,
        _: &Caller,
        _: BotId,
        _: Vec<Change>,
    ) -> Result<Tightened, PermissionError> {
        Err(PermissionError::NotFound)
    }
    async fn reset(&self, _: &Caller, _: BotId) -> Result<PermissionsView, PermissionError> {
        Err(PermissionError::NotFound)
    }
    async fn set_source(
        &self,
        _: &agent_permissions::domain::model::Caller,
        _: bot_id::BotId,
        _: agent_permissions::domain::model::PolicyId,
    ) -> Result<
        agent_permissions::domain::model::PermissionsView,
        agent_permissions::domain::model::PermissionError,
    > {
        Err(agent_permissions::domain::model::PermissionError::NotFound)
    }
    async fn detach(
        &self,
        _: &agent_permissions::domain::model::Caller,
        _: bot_id::BotId,
        _: Option<Vec<agent_permissions::domain::model::Change>>,
    ) -> Result<
        agent_permissions::domain::model::PermissionsView,
        agent_permissions::domain::model::PermissionError,
    > {
        Err(agent_permissions::domain::model::PermissionError::NotFound)
    }
    async fn source_candidates(
        &self,
        _: &agent_permissions::domain::model::Caller,
        _: agent_permissions::domain::model::CandidatesFor,
    ) -> Result<
        agent_permissions::domain::model::SourceCandidates,
        agent_permissions::domain::model::PermissionError,
    > {
        Err(agent_permissions::domain::model::PermissionError::NotFound)
    }
    async fn view_policy(
        &self,
        _: &agent_permissions::domain::model::Caller,
        _: agent_permissions::domain::model::PolicyId,
    ) -> Result<
        agent_permissions::domain::model::PermissionsView,
        agent_permissions::domain::model::PermissionError,
    > {
        Err(agent_permissions::domain::model::PermissionError::NotFound)
    }
    async fn resolve_calls(
        &self,
        _: &SessionPolicy,
        calls: &[OperationKey],
    ) -> Result<Vec<ResolvedCall>, PermissionError> {
        Ok(calls
            .iter()
            .map(|key| {
                let name = format!("{}.{}", key.service, key.operation);
                let known = !key.operation.starts_with("unknown_");
                ResolvedCall {
                    key: key.clone(),
                    entry: known.then(|| CatalogEntry {
                        service: key.service.clone(),
                        operation: key.operation.clone(),
                        group: "email".into(),
                        action: Action::Send,
                        label: format!("Do {}", key.operation),
                    }),
                    state: if known {
                        self.0
                            .get(&name)
                            .copied()
                            .unwrap_or(PermissionState::Always)
                    } else {
                        PermissionState::Never
                    },
                    origin: if known { Origin::Tool } else { Origin::Default },
                }
            })
            .collect())
    }
}

/// Answers every hold with `status` and records it.
pub(crate) struct FakeHolds {
    pub status: ToolApprovalStatus,
    pub held: Mutex<Vec<PermissionHold>>,
}

impl FakeHolds {
    pub fn new(status: ToolApprovalStatus) -> Self {
        Self {
            status,
            held: Mutex::new(Vec::new()),
        }
    }
}

#[async_trait]
impl PermissionApprovals for FakeHolds {
    async fn hold_permissions(
        &self,
        hold: PermissionHold,
    ) -> Result<ToolApprovalStatus, EgressError> {
        self.held.lock().unwrap().push(hold);
        Ok(self.status)
    }
}

/// On or off for every language.
pub(crate) struct Rollout(pub bool);

#[async_trait]
impl LanguageRollout for Rollout {
    async fn enabled(&self, _: &MacroUserIdStr<'static>, _: ProgramLanguage) -> bool {
        self.0
    }
}

/// The turn's prompter, read in order: the last one repeats.
pub(crate) struct Prompters(pub Mutex<Vec<TurnPrompter>>);

#[async_trait]
impl TurnPrompters for Prompters {
    async fn current(&self, _: AgentSessionId) -> Result<Option<TurnPrompter>, rootcause::Report> {
        let mut turns = self.0.lock().unwrap();
        Ok(if turns.len() > 1 {
            Some(turns.remove(0))
        } else {
            turns.first().cloned()
        })
    }
}

pub(crate) fn prompter() -> TurnPrompter {
    TurnPrompter {
        kind: PrompterKind::User,
        action_id: agent_runtime_protocol::domain::action::AgentActionId::mint(),
        user: Some(MacroUserIdStr::try_from_email("asker@macro.com").unwrap()),
        client: None,
    }
}

pub(crate) struct Parts {
    pub analyzer: Arc<FakeAnalyzer>,
    pub holds: Arc<FakeHolds>,
    pub gate: PermissionGate,
}

pub(crate) fn gate(
    analysis: Analysis,
    states: &[(&str, PermissionState)],
    hold: ToolApprovalStatus,
    rollout: bool,
) -> Parts {
    let analyzer = Arc::new(FakeAnalyzer::new(analysis));
    let holds = Arc::new(FakeHolds::new(hold));
    let gate = PermissionGate {
        analyzers: Analyzers {
            js_tools: Some(analyzer.clone()),
        },
        permissions: Arc::new(FakePermissions(
            states
                .iter()
                .map(|(name, state)| ((*name).to_owned(), *state))
                .collect(),
        )),
        holds: holds.clone(),
        rollout: Arc::new(Rollout(rollout)),
        prompters: Arc::new(Prompters(Mutex::new(vec![prompter()]))),
    };
    Parts {
        analyzer,
        holds,
        gate,
    }
}

pub(crate) fn identity() -> ExecutionIdentity {
    let session = test_agent_session(AgentSessionId::new());
    ExecutionIdentity {
        execution: agent_code_mode::domain::ExecutionId::mint(),
        acting_as: ai_toolset::actor::ToolActor::Owner,
        session: session.id,
        agent_id: session.bot_id,
        owner: session.owner_user().unwrap().clone(),
        turn: macro_uuid::Uuid::from_u128(1),
    }
}

fn not_run(result: Result<impl std::fmt::Debug, CodeModeError>) -> NotRun {
    match result {
        Err(CodeModeError::NotRun(not_run)) => not_run,
        other => panic!("expected NotRun, got {other:?}"),
    }
}

fn two_calls() -> Analysis {
    Analysis::Calls(
        [
            call("email", "send_message"),
            call("storage", "get_document"),
        ]
        .into(),
    )
}

#[tokio::test]
async fn javascript_and_owners_without_the_rollout_are_not_checked() {
    let parts = gate(two_calls(), &[], ToolApprovalStatus::Approved, false);
    let identity = identity();
    for language in [ProgramLanguage::JsTools, ProgramLanguage::Javascript] {
        assert!(
            parts
                .gate
                .check(&identity, "src", language)
                .await
                .unwrap()
                .is_none()
        );
    }
    let on = gate(two_calls(), &[], ToolApprovalStatus::Approved, true);
    assert!(
        on.gate
            .check(&identity, "src", ProgramLanguage::Javascript)
            .await
            .unwrap()
            .is_none()
    );
    assert_eq!(*parts.analyzer.calls.lock().unwrap(), 0);
    assert_eq!(*on.analyzer.calls.lock().unwrap(), 0);
}

#[tokio::test]
async fn a_never_operation_refuses_the_program_naming_it() {
    let parts = gate(
        two_calls(),
        &[("email.send_message", PermissionState::Never)],
        ToolApprovalStatus::Approved,
        true,
    );
    let refused = not_run(
        parts
            .gate
            .check(&identity(), "src", ProgramLanguage::JsTools)
            .await,
    );
    assert!(
        refused
            .message
            .starts_with("This program did not run: this agent is not allowed to Do send_message (Email, send, email.send_message)"),
        "{}",
        refused.message
    );
    assert!(refused.message.contains("ShowPermissions"));
    match refused.permission {
        Some(ExecutionPermission::Blocked { operations }) => {
            assert_eq!(operations.len(), 1);
            assert_eq!(operations[0].operation, "send_message");
            assert_eq!(operations[0].state, PermissionState::Never);
        }
        other => panic!("{other:?}"),
    }
    assert!(parts.holds.held.lock().unwrap().is_empty());
}

#[tokio::test]
async fn an_unclassified_operation_is_blocked() {
    let parts = gate(
        Analysis::Calls([call("storage", "unknown_thing")].into()),
        &[],
        ToolApprovalStatus::Approved,
        true,
    );
    let refused = not_run(
        parts
            .gate
            .check(&identity(), "src", ProgramLanguage::JsTools)
            .await,
    );
    assert!(matches!(
        refused.permission,
        Some(ExecutionPermission::Blocked { .. })
    ));
}

#[tokio::test]
async fn a_program_that_cannot_be_analyzed_or_compiled_is_returned_to_rewrite() {
    let parts = gate(
        Analysis::CannotAnalyze(vec![AnalysisReason {
            message: "belongs to Obj".into(),
            line: 3,
            column: 5,
        }]),
        &[],
        ToolApprovalStatus::Approved,
        true,
    );
    let refused = not_run(
        parts
            .gate
            .check(&identity(), "src", ProgramLanguage::JsTools)
            .await,
    );
    assert_eq!(refused.permission, None);
    assert!(refused.message.contains("main.js:3:5: belongs to Obj"));
    assert!(refused.message.contains("Rewrite it"));

    let parts = gate(
        Analysis::Diagnostics(vec![Diagnostic {
            file: Some("main.js".into()),
            message: "Error: Unbound value x\n    at main.js:1:9".into(),
        }]),
        &[],
        ToolApprovalStatus::Approved,
        true,
    );
    let refused = not_run(
        parts
            .gate
            .check(&identity(), "src", ProgramLanguage::JsTools)
            .await,
    );
    assert_eq!(refused.permission, None);
    assert_eq!(
        refused.message,
        "Error: Unbound value x\n    at main.js:1:9"
    );

    // The analyzer failing is the service's: nothing runs.
    let mut parts = gate(two_calls(), &[], ToolApprovalStatus::Approved, true);
    parts.gate.analyzers.js_tools = Some(Arc::new(FakeAnalyzer {
        analysis: Err(()),
        calls: Mutex::new(0),
    }));
    assert!(matches!(
        parts
            .gate
            .check(&identity(), "src", ProgramLanguage::JsTools)
            .await,
        Err(CodeModeError::Unavailable)
    ));
}

#[tokio::test]
async fn an_ask_operation_holds_for_the_runs_account_and_runs_on_approval() {
    let parts = gate(
        two_calls(),
        &[("email.send_message", PermissionState::Ask)],
        ToolApprovalStatus::Approved,
        true,
    );
    let identity = identity();
    let checked = parts
        .gate
        .check(&identity, "the source", ProgramLanguage::JsTools)
        .await
        .unwrap()
        .unwrap();
    // Everything the program may call, not only what was asked about.
    assert_eq!(checked.calls.len(), 2);
    let actor = MacroUserIdStr::try_from_email("actor@macro.com").unwrap();
    parts
        .gate
        .hold(
            &checked,
            &identity,
            &actor,
            "the source",
            Some("export const x = 1;"),
            &CancellationToken::new(),
        )
        .await
        .unwrap();
    let held = parts.holds.held.lock().unwrap();
    assert_eq!(held.len(), 1);
    assert_eq!(held[0].approver, actor);
    assert_eq!(held[0].operations, ["email.send_message"]);
    assert_eq!(held[0].arguments["source"], "the source");
    // The card shows the module beside the program.
    assert_eq!(held[0].arguments["module"], "export const x = 1;");
    assert_eq!(held[0].arguments["permission"]["language"], "js_tools");
    assert_eq!(
        held[0].arguments["permission"]["executionId"],
        identity.execution.to_string()
    );
    assert_eq!(
        held[0].arguments["permission"]["operations"][0]["operation"],
        "send_message"
    );
    assert_eq!(
        held[0].arguments["permission"]["operations"][0]["groupName"],
        agent_permission_registry::group("email").unwrap().name
    );
}

#[tokio::test]
async fn nothing_to_ask_holds_nothing() {
    let parts = gate(two_calls(), &[], ToolApprovalStatus::Denied, true);
    let identity = identity();
    let checked = parts
        .gate
        .check(&identity, "src", ProgramLanguage::JsTools)
        .await
        .unwrap()
        .unwrap();
    parts
        .gate
        .hold(
            &checked,
            &identity,
            &identity.owner,
            "src",
            None,
            &CancellationToken::new(),
        )
        .await
        .unwrap();
    assert!(parts.holds.held.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_declined_or_expired_hold_does_not_run() {
    for (answer, status, words) in [
        (
            ToolApprovalStatus::Denied,
            DeclinedStatus::Denied,
            "declined",
        ),
        (
            ToolApprovalStatus::Expired,
            DeclinedStatus::Expired,
            "in time",
        ),
        (
            ToolApprovalStatus::Cancelled,
            DeclinedStatus::Cancelled,
            "cancelled",
        ),
    ] {
        let parts = gate(
            two_calls(),
            &[("email.send_message", PermissionState::Ask)],
            answer,
            true,
        );
        let identity = identity();
        let checked = parts
            .gate
            .check(&identity, "src", ProgramLanguage::JsTools)
            .await
            .unwrap()
            .unwrap();
        let refused = not_run(
            parts
                .gate
                .hold(
                    &checked,
                    &identity,
                    &identity.owner,
                    "src",
                    None,
                    &CancellationToken::new(),
                )
                .await,
        );
        assert!(refused.message.contains(words), "{}", refused.message);
        assert!(
            refused
                .message
                .ends_with("It needed approval for: Do send_message.")
        );
        assert!(matches!(
            refused.permission,
            Some(ExecutionPermission::Declined { status: got, ref operations }) if got == status && operations.len() == 1
        ));
    }
}

#[tokio::test]
async fn a_turn_that_ended_during_the_hold_does_not_run() {
    let mut parts = gate(
        two_calls(),
        &[("email.send_message", PermissionState::Ask)],
        ToolApprovalStatus::Approved,
        true,
    );
    parts.gate.prompters = Arc::new(Prompters(Mutex::new(vec![prompter(), prompter()])));
    let identity = identity();
    let checked = parts
        .gate
        .check(&identity, "src", ProgramLanguage::JsTools)
        .await
        .unwrap()
        .unwrap();
    let refused = not_run(
        parts
            .gate
            .hold(
                &checked,
                &identity,
                &identity.owner,
                "src",
                None,
                &CancellationToken::new(),
            )
            .await,
    );
    assert_eq!(
        refused.message,
        "The original turn ended; the program did not run."
    );
}

#[tokio::test]
async fn a_stopped_turn_or_no_turn_records_the_program_as_not_approved() {
    let parts = gate(
        two_calls(),
        &[("email.send_message", PermissionState::Ask)],
        ToolApprovalStatus::Approved,
        true,
    );
    let identity = identity();
    let checked = parts
        .gate
        .check(&identity, "src", ProgramLanguage::JsTools)
        .await
        .unwrap()
        .unwrap();
    let cancel = CancellationToken::new();
    cancel.cancel();
    let refused = not_run(
        parts
            .gate
            .hold(&checked, &identity, &identity.owner, "src", None, &cancel)
            .await,
    );
    assert!(matches!(
        refused.permission,
        Some(ExecutionPermission::Declined {
            status: DeclinedStatus::Cancelled,
            ..
        })
    ));

    let mut parts = gate(
        two_calls(),
        &[("email.send_message", PermissionState::Ask)],
        ToolApprovalStatus::Approved,
        true,
    );
    parts.gate.prompters = Arc::new(Prompters(Mutex::new(Vec::new())));
    let refused = not_run(
        parts
            .gate
            .hold(
                &checked,
                &identity,
                &identity.owner,
                "src",
                None,
                &CancellationToken::new(),
            )
            .await,
    );
    assert!(matches!(
        refused.permission,
        Some(ExecutionPermission::Declined {
            status: DeclinedStatus::Expired,
            ..
        })
    ));
    assert!(parts.holds.held.lock().unwrap().is_empty());
}

/// On only for the languages listed.
struct Languages(Vec<ProgramLanguage>);

#[async_trait]
impl LanguageRollout for Languages {
    async fn enabled(&self, _: &MacroUserIdStr<'static>, language: ProgramLanguage) -> bool {
        self.0.contains(&language)
    }
}

#[tokio::test]
async fn each_language_is_checked_only_with_its_own_rollout_and_analyzer() {
    let mut parts = gate(two_calls(), &[], ToolApprovalStatus::Approved, true);
    parts.gate.rollout = Arc::new(Languages(vec![]));
    let identity = identity();
    assert!(
        parts
            .gate
            .check(&identity, "src", ProgramLanguage::JsTools)
            .await
            .unwrap()
            .is_none()
    );
    assert_eq!(*parts.analyzer.calls.lock().unwrap(), 0);
    parts.gate.rollout = Arc::new(Languages(vec![ProgramLanguage::JsTools]));
    assert!(
        parts
            .gate
            .check(&identity, "src", ProgramLanguage::JsTools)
            .await
            .unwrap()
            .is_some()
    );

    // A build that can't analyze JavaScript tools programs doesn't gate them.
    let mut parts = gate(two_calls(), &[], ToolApprovalStatus::Approved, true);
    parts.gate.analyzers.js_tools = None;
    assert!(
        parts
            .gate
            .check(&identity, "src", ProgramLanguage::JsTools)
            .await
            .unwrap()
            .is_none()
    );
    assert_eq!(*parts.analyzer.calls.lock().unwrap(), 0);
}

#[tokio::test]
async fn a_js_tools_program_with_a_never_operation_is_refused_naming_it() {
    let parts = gate(
        two_calls(),
        &[("email.send_message", PermissionState::Never)],
        ToolApprovalStatus::Approved,
        true,
    );
    let refused = not_run(
        parts
            .gate
            .check(&identity(), "src", ProgramLanguage::JsTools)
            .await,
    );
    assert!(
        refused.message.starts_with(
            "This program did not run: this agent is not allowed to Do send_message (Email, send, email.send_message)"
        ),
        "{}",
        refused.message
    );
    assert!(matches!(
        refused.permission,
        Some(ExecutionPermission::Blocked { ref operations }) if operations.len() == 1
    ));
    assert!(parts.holds.held.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_js_tools_program_that_cannot_be_analyzed_points_at_main_js() {
    let parts = gate(
        Analysis::CannotAnalyze(vec![AnalysisReason {
            message: "`require` can't be used in a checked program.".into(),
            line: 1,
            column: 11,
        }]),
        &[],
        ToolApprovalStatus::Approved,
        true,
    );
    let refused = not_run(
        parts
            .gate
            .check(&identity(), "src", ProgramLanguage::JsTools)
            .await,
    );
    assert_eq!(refused.permission, None);
    assert!(refused.message.starts_with("This program did not run."));
    assert!(
        refused
            .message
            .contains("main.js:1:11: `require` can't be used in a checked program.")
    );
    assert!(
        refused
            .message
            .contains("tools.<service>.<operation>(input)")
    );
}

#[tokio::test]
async fn a_js_tools_ask_operation_holds_naming_the_language_and_runs_on_approval() {
    let parts = gate(
        two_calls(),
        &[("email.send_message", PermissionState::Ask)],
        ToolApprovalStatus::Approved,
        true,
    );
    let identity = identity();
    let checked = parts
        .gate
        .check(&identity, "the source", ProgramLanguage::JsTools)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(checked.language, ProgramLanguage::JsTools);
    assert_eq!(
        checked.calls,
        [
            call("email", "send_message"),
            call("storage", "get_document")
        ]
        .into()
    );
    parts
        .gate
        .hold(
            &checked,
            &identity,
            &identity.owner,
            "the source",
            None,
            &CancellationToken::new(),
        )
        .await
        .unwrap();
    {
        let held = parts.holds.held.lock().unwrap();
        assert_eq!(held[0].operations, ["email.send_message"]);
        assert_eq!(held[0].arguments["permission"]["language"], "js_tools");
    }

    // Declined: the program does not run.
    let parts = gate(
        two_calls(),
        &[("email.send_message", PermissionState::Ask)],
        ToolApprovalStatus::Denied,
        true,
    );
    let checked = parts
        .gate
        .check(&identity, "src", ProgramLanguage::JsTools)
        .await
        .unwrap()
        .unwrap();
    let refused = not_run(
        parts
            .gate
            .hold(
                &checked,
                &identity,
                &identity.owner,
                "src",
                None,
                &CancellationToken::new(),
            )
            .await,
    );
    assert!(matches!(
        refused.permission,
        Some(ExecutionPermission::Declined {
            status: DeclinedStatus::Denied,
            ..
        })
    ));

    // No turn to ask in.
    let mut parts = gate(
        two_calls(),
        &[("email.send_message", PermissionState::Ask)],
        ToolApprovalStatus::Approved,
        true,
    );
    parts.gate.prompters = Arc::new(Prompters(Mutex::new(Vec::new())));
    let refused = not_run(
        parts
            .gate
            .hold(
                &checked,
                &identity,
                &identity.owner,
                "src",
                None,
                &CancellationToken::new(),
            )
            .await,
    );
    assert!(
        refused.message.starts_with(
            "This program did not run: it needs a person's approval for: Do send_message"
        ),
        "{}",
        refused.message
    );
}

/// Agents and sessions the real permissions service never asks about in a
/// gate's resolution.
struct NoDirectory;

impl agent_permissions::domain::ports::AgentDirectory for NoDirectory {
    type Err = std::convert::Infallible;
    async fn access(
        &self,
        _: &MacroUserIdStr<'static>,
        _: BotId,
    ) -> Result<agent_permissions::domain::model::AgentAccess, Self::Err> {
        Ok(agent_permissions::domain::model::AgentAccess::NotFound)
    }
    async fn facts(
        &self,
        _: BotId,
    ) -> Result<Option<agent_permissions::domain::model::AgentFacts>, Self::Err> {
        Ok(None)
    }
    async fn source_candidates(
        &self,
        _: &MacroUserIdStr<'static>,
        _: &agent_permissions::domain::model::AgentScope,
    ) -> Result<Vec<agent_permissions::domain::model::AgentFacts>, Self::Err> {
        Ok(Vec::new())
    }
}

impl agent_permissions::domain::ports::SessionDirectory for NoDirectory {
    type Err = std::convert::Infallible;
    async fn facts(
        &self,
        _: AgentSessionId,
    ) -> Result<Option<agent_permissions::domain::model::SessionFacts>, Self::Err> {
        Ok(None)
    }
}

impl agent_permissions::domain::ports::PermissionsRollout for NoDirectory {
    async fn enabled(&self, _: &MacroUserIdStr<'static>) -> bool {
        true
    }
}

/// A follower's program is gated by its source's rules, live: a person's
/// Never on the source refuses the follower's next program, and lifting it
/// lets the next one run.
#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn a_followers_program_is_gated_by_its_sources_rules(pool: sqlx::PgPool) {
    use agent_permissions::domain::model::{PolicyOwner, SetBy, Target};
    use agent_permissions::domain::ports::{PermissionStore, SourceWrite, Write, WriteTo};
    use agent_permissions::outbound::pg::PgPermissionStore;

    let follower = BotId::new_from_uuid(macro_uuid::Uuid::from_u128(0xf011));
    let source = BotId::new_from_uuid(macro_uuid::Uuid::from_u128(0x5005));
    sqlx::raw_sql(
        r#"
        INSERT INTO macro_user (id, username, email, stripe_customer_id)
        VALUES ('00000000-0000-4000-8000-0000000000f1', 'follower-owner@example.com', 'follower-owner@example.com', 'stripe_follower_owner');
        INSERT INTO "User" (id, email, macro_user_id)
        VALUES ('macro|follower-owner@example.com', 'follower-owner@example.com', '00000000-0000-4000-8000-0000000000f1');
        INSERT INTO bots (id, kind, owner_user_id, name, handle, created_by) VALUES
        ('00000000-0000-0000-0000-00000000f011', 'owned', 'macro|follower-owner@example.com', 'Analyst', 'analyst', 'macro|follower-owner@example.com'),
        ('00000000-0000-0000-0000-000000005005', 'owned', 'macro|follower-owner@example.com', 'Scout', 'scout', 'macro|follower-owner@example.com');
        "#,
    )
    .execute(&pool)
    .await
    .unwrap();
    let owner = MacroUserIdStr::try_from("macro|follower-owner@example.com".to_owned()).unwrap();
    let store = PgPermissionStore::new(pool.clone());
    let follower_policy = store
        .ensure_policy(&PolicyOwner::Agent(follower))
        .await
        .unwrap();
    let source_policy = store
        .ensure_policy(&PolicyOwner::Agent(source))
        .await
        .unwrap();
    store
        .set_source(
            SourceWrite {
                policy: follower_policy,
                by: &owner,
            },
            source_policy,
        )
        .await
        .unwrap()
        .unwrap();
    let set_source_send = |state: Option<PermissionState>| {
        let (store, owner) = (store.clone(), owner.clone());
        async move {
            let write = Write {
                policy: source_policy,
                session: None,
                to: WriteTo::Saved,
                by: &owner,
                set_by: SetBy::Person,
            };
            let change = Change {
                target: Target::GroupAction {
                    group: "email".to_owned(),
                    action: Action::Send,
                },
                state,
            };
            store
                .write(write, |_, _| Ok(vec![change]))
                .await
                .unwrap()
                .unwrap();
        }
    };

    let permissions = Arc::new(
        agent_permissions::domain::service::AgentPermissionsService::new(
            store.clone(),
            NoDirectory,
            NoDirectory,
            NoDirectory,
            Arc::new(agent_permissions::outbound::registry::registry_catalog()),
        ),
    );
    let gate = |analysis: Analysis| PermissionGate {
        analyzers: Analyzers {
            js_tools: Some(Arc::new(FakeAnalyzer::new(analysis))),
        },
        permissions: permissions.clone(),
        holds: Arc::new(FakeHolds::new(ToolApprovalStatus::Approved)),
        rollout: Arc::new(Rollout(true)),
        prompters: Arc::new(Prompters(Mutex::new(vec![prompter()]))),
    };
    let identity = ExecutionIdentity {
        agent_id: follower,
        owner: owner.clone(),
        ..identity()
    };

    set_source_send(Some(PermissionState::Never)).await;
    let refused = not_run(
        gate(two_calls())
            .check(&identity, "src", ProgramLanguage::JsTools)
            .await,
    );
    match refused.permission {
        Some(ExecutionPermission::Blocked { operations }) => {
            assert_eq!(operations.len(), 1);
            assert_eq!(operations[0].operation, "send_message");
            assert_eq!(operations[0].origin, Origin::Source);
        }
        other => panic!("{other:?}"),
    }

    set_source_send(None).await;
    let checked = gate(two_calls())
        .check(&identity, "src", ProgramLanguage::JsTools)
        .await
        .unwrap();
    assert!(checked.is_some());
}
