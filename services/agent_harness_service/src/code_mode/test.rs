use super::*;
use agent_session::domain::model::AgentSessionId;
use agent_session::testing::test_agent_session;
use std::{
    future::Future,
    pin::Pin,
    sync::atomic::{AtomicUsize, Ordering},
};
struct Gate {
    verdict: NativeToolVerdict,
    calls: AtomicUsize,
}
impl NativeToolGate for Gate {
    fn check<'a>(
        &'a self,
        _: AgentSessionId,
        name: &'a str,
        args: &'a serde_json::Value,
    ) -> Pin<Box<dyn Future<Output = NativeToolVerdict> + Send + 'a>> {
        assert_eq!(name, "ExecuteCode");
        assert_eq!(args["source"], "fixture");
        assert_eq!(args["turn_id"], macro_uuid::Uuid::from_u128(1).to_string());
        self.calls.fetch_add(1, Ordering::SeqCst);
        Box::pin(async { self.verdict.clone() })
    }

    fn refuse_remote_mcp<'a>(
        &'a self,
        _: AgentSessionId,
        _: &'a str,
    ) -> std::pin::Pin<Box<dyn Future<Output = Option<String>> + Send + 'a>> {
        Box::pin(async { None })
    }
}
#[tokio::test]
async fn owner_approval_is_required_before_credentials_and_cancel_skips_gate() {
    let session = test_agent_session(AgentSessionId::new());
    let identity = ExecutionIdentity {
        execution: agent_code_mode::domain::ExecutionId::mint(),
        acting_as: ai_toolset::actor::ToolActor::Owner,
        session: session.id,
        agent_id: session.bot_id,
        owner: session.owner_user().unwrap().clone(),
        turn: macro_uuid::Uuid::from_u128(1),
        lifetime: agent_code_mode::domain::RunLifetime::Foreground,
    };
    let gate = Gate {
        verdict: NativeToolVerdict::Refuse("Owner declined".into()),
        calls: AtomicUsize::new(0),
    };
    assert!(matches!(
        approve_run(&gate, &identity, "fixture", &CancellationToken::new()).await,
        Err(CodeModeError::Invalid(_))
    ));
    let cancel = CancellationToken::new();
    cancel.cancel();
    assert!(matches!(
        approve_run(&gate, &identity, "fixture", &cancel).await,
        Err(CodeModeError::Forbidden)
    ));
    assert_eq!(gate.calls.load(Ordering::SeqCst), 1);
    let gate = Gate {
        verdict: NativeToolVerdict::RunAs(session.owner_user().unwrap().clone()),
        calls: AtomicUsize::new(0),
    };
    assert!(
        approve_run(&gate, &identity, "fixture", &CancellationToken::new())
            .await
            .is_ok()
    );
}

#[tokio::test]
async fn execution_credentials_use_the_gate_resolved_requester() {
    let session = test_agent_session(AgentSessionId::new());
    let requester =
        macro_user_id::user_id::MacroUserIdStr::try_from_email("requester@example.com").unwrap();
    let identity = ExecutionIdentity {
        execution: agent_code_mode::domain::ExecutionId::mint(),
        acting_as: ai_toolset::actor::ToolActor::Requester,
        session: session.id,
        owner: session.owner_user().unwrap().clone(),
        agent_id: session.bot_id,
        turn: macro_uuid::Uuid::from_u128(1),
        lifetime: agent_code_mode::domain::RunLifetime::Foreground,
    };
    let gate = Gate {
        verdict: NativeToolVerdict::RunAs(requester.clone()),
        calls: AtomicUsize::new(0),
    };
    assert_eq!(
        approve_run(&gate, &identity, "fixture", &CancellationToken::new())
            .await
            .unwrap(),
        requester
    );
}

/// Every session is a generation session, or none is.
struct Scopes(Option<SessionScope>);

#[async_trait]
impl SessionScopes for Scopes {
    async fn scope(&self, _: uuid::Uuid) -> Result<Option<SessionScope>, rootcause::Report> {
        Ok(self.0)
    }
}

/// Lets everything run.
struct Open;

impl NativeToolGate for Open {
    fn check<'a>(
        &'a self,
        _: AgentSessionId,
        _: &'a str,
        _: &'a serde_json::Value,
    ) -> Pin<Box<dyn Future<Output = NativeToolVerdict> + Send + 'a>> {
        Box::pin(async { NativeToolVerdict::Run })
    }

    fn refuse_remote_mcp<'a>(
        &'a self,
        _: AgentSessionId,
        _: &'a str,
    ) -> std::pin::Pin<Box<dyn Future<Output = Option<String>> + Send + 'a>> {
        Box::pin(async { None })
    }
}

/// A generation session's native tools are code mode's and finding tools
/// only; any other session's go to the owner's gate as before.
#[tokio::test]
async fn a_generation_session_uses_only_code_and_finding_tools() {
    let gate = |scope| ScopedToolGate {
        inner: Arc::new(Open),
        scopes: Arc::new(Scopes(scope)),
    };
    let session = AgentSessionId::new();
    let args = serde_json::json!({});
    let generation = gate(Some(SessionScope::Generation));
    for tool in [
        "ExecuteCode",
        "DescribeCodeTools",
        "ReadCodeDocs",
        "SearchTools",
        "LoadTools",
    ] {
        assert_eq!(
            generation.check(session, tool, &args).await,
            NativeToolVerdict::Run,
            "{tool}"
        );
    }
    for tool in [
        "SendConfirmedEmail",
        "SendChannelMessage",
        "CreateMemory",
        "WebFetch",
        "Subagent",
    ] {
        assert!(
            matches!(
                generation.check(session, tool, &args).await,
                NativeToolVerdict::Refuse(_)
            ),
            "{tool}"
        );
    }
    assert_eq!(
        gate(None).check(session, "SendConfirmedEmail", &args).await,
        NativeToolVerdict::Run
    );
}

/// The tools that use nobody's access (the web, Macro's help) are outside
/// every scope, `NoSend` included: a run that sends nothing could send data
/// out in a URL. The engine asks this gate about them (`GatedToolSet`).
#[tokio::test]
async fn a_scoped_session_uses_no_web_or_help_tool() {
    let gate = |scope| ScopedToolGate {
        inner: Arc::new(Open),
        scopes: Arc::new(Scopes(scope)),
    };
    let session = AgentSessionId::new();
    let args = serde_json::json!({});
    for scope in [SessionScope::NoSend, SessionScope::Generation] {
        for tool in ["WebSearch", "WebFetch", "SelfKnowledge"] {
            assert!(
                matches!(
                    gate(Some(scope)).check(session, tool, &args).await,
                    NativeToolVerdict::Refuse(_)
                ),
                "{scope:?} {tool}"
            );
        }
    }
    assert_eq!(
        gate(None).check(session, "WebFetch", &args).await,
        NativeToolVerdict::Run
    );
}

/// An SDK operation's path with every parameter filled in.
fn concrete(path: &str) -> String {
    path.split('/')
        .map(|segment| {
            if segment.starts_with('{') {
                "x"
            } else {
                segment
            }
        })
        .collect::<Vec<_>>()
        .join("/")
}

/// A routine's dry run reads anything the SDK reads, POST reads included,
/// and is refused every SDK write.
#[test]
fn the_dry_run_scope_is_every_sdk_read_and_no_write() {
    let scope = SessionScope::DryRun;
    for (key, operation) in code_execution::domain::operations() {
        // Unfurl fetches what its caller names from Macro's servers: no
        // scoped run reaches it (the run bootstrap refuses its host).
        if key.starts_with("unfurl.") {
            continue;
        }
        assert_eq!(
            scope.allows(&operation.method, &concrete(&operation.path)),
            !operation.write,
            "{key} ({} {})",
            operation.method,
            operation.path
        );
    }
}

/// The scope's list of POST reads covers every read the SDK sends as a POST,
/// and the only writes it lets a generation session make are its own tools
/// and creating an email draft.
#[test]
fn the_generation_scope_matches_the_sdk_catalog() {
    let intended = [
        "scheduled-action.addSuggestion",
        "scheduled-action.rewriteSuggestion",
        "scheduled-action.retireSuggestion",
        "scheduled-action.attachSuggestionDraft",
        "scheduled-action.suggestRoutine",
        "scheduled-action.retireRoutineSuggestion",
        "email.createDraft",
        "cognition.structuredCompletion",
    ];
    let scope = SessionScope::Generation;
    for (key, operation) in code_execution::domain::operations() {
        // Refused to scoped runs by the run bootstrap, whatever the scope.
        if key.starts_with("unfurl.") {
            continue;
        }
        let allowed = scope.allows(&operation.method, &concrete(&operation.path));
        if !operation.write {
            assert!(
                allowed,
                "the read {key} ({} {}) is refused",
                operation.method, operation.path
            );
        } else {
            assert_eq!(
                allowed,
                intended.contains(&key.as_str()),
                "{key} ({} {})",
                operation.method,
                operation.path
            );
        }
    }
}

/// A run that sends nothing is refused every SDK write that reaches someone
/// else. Any write whose name or path looks like one is either refused or
/// listed here as reviewed, so a new one is classified before it ships.
#[test]
fn a_run_that_sends_nothing_is_refused_every_send_in_the_sdk() {
    // Send-looking writes that reach nobody else.
    let reviewed = [
        "auth.generateEmailLink",
        "auth.rejectInvitation",
        "auth.postProfilePictures",
        // Its route refuses a scoped session tools.
        "cognition.sendChatMessage",
        // Stopping a chat's stream reaches nobody and starts nothing.
        "cognition.stopChatStream",
        "email.createDraft",
        "email.deleteDraft",
        "email.deleteScheduledDraft",
        "email.recoverDraftTransfer",
        "email.addDraftAttachment",
        "email.removeDraftAttachment",
        "email.completeDraftAttachment",
        "email.addForwardedAttachment",
        "email.removeForwardedAttachment",
        "email.resolveMessageOperation",
        "email.addRemoveLabel",
        "email.threadSeen",
        "notification.unsubscribeEmail",
        "notification.unsubscribeItem",
        "notification.unsubscribeItems",
        "notification.unsubscribeAll",
        // A user's own notification settings for one channel reach nobody.
        "notification.updateChannelNotificationSettings",
        "notification.resetChannelNotificationSettings",
        "scheduled-action.dismissRoutineSuggestion",
        "scheduled-action.retireRoutineSuggestion",
        "scheduled-action.suggestRoutine",
        "scheduled-action.draftRoutine",
        "scheduled-action.startRoutineDraftJob",
        "scheduled-action.discardRoutineDraftJob",
        "scheduled-action.deleteScheduledAction",
        // Detaching only moves the owner's own sub-routine to their list.
        "scheduled-action.detachScheduledAction",
        // A routine's icon and color show only in its owner's lists.
        "scheduled-action.setScheduledActionAppearance",
        "scheduled-action.unshareScheduledActionTemplate",
        "storage.deleteEntityMention",
        "storage.entityMessageDeleteMessage",
        "storage.entityMessageDeleteThread",
        "storage.deleteChannelLabel",
        "storage.createChannelLabel",
        "storage.renameChannelLabel",
        "storage.setChannelLabel",
        "storage.cancelChannelAccessRequest",
        "storage.deleteWebhook",
        "storage.deleteDatabaseWebhook",
        "storage.externalChatRead",
        "storage.externalChatUpload",
        "storage.externalChatRemove",
        "storage.removeBotFromChannelByBot",
        "storage.deleteCallRecord",
        "storage.editCallRecord",
        "storage.editCallTranscript",
        "storage.meetingCancelPreparation",
        "storage.meetingPrepare",
        "storage.setEmailFollowup",
        "calendar.getBookingInsights",
        "email.addRemoveThreadLabel",
        "email.archiveThread",
        "email.archiveThreads",
        "email.blockSender",
        "email.unblockSender",
        "email.cancelBackfillGmail",
        "email.copyThreadCalendarInvitation",
        "email.createLabel",
        "email.deleteLabel",
        "email.upsertEmailFilter",
        "email.deleteEmailFilter",
        "email.deleteLink",
        "email.disableLinkCalendar",
        "email.disableSync",
        "email.healthCheckLinks",
        "email.initUser",
        "email.patchSettings",
        "email.resyncLink",
        "email.updateThreadProject",
        "email.updateThreadState",
        "storage.setCrmContactEmail",
        "storage.addCrmContactEmail",
        "storage.removeCrmContactEmail",
        // Cancelling an owner-only count preview changes no contribution.
        "storage.cancelCrmEmailRulePreview",
        // Deleting a message in a call's guest chat, like a channel message.
        "storage.guestCallChatDeleteMessage",
        "storage.setEmailSync",
        // Channel sections only arrange the person's own sidebar.
        "storage.createChannelSection",
        "storage.deleteChannelSection",
        "storage.previewChannelSection",
        "storage.setChannelSection",
        "storage.updateChannelSection",
        "scheduled-action.attachSuggestionDraft",
        // Reads and inference sent as POST.
        "agent-harness.agentSessionsForPullRequest",
        "agent-harness.agentSessionsForPullRequests",
        "agent-harness.chooseAgentMode",
        "agent-harness.classify",
        "agent-harness.extract",
        "agent-harness.discoverAgentCapabilitiesHandler",
        "agent-harness.discoverConnectedApps",
        "agent-harness.loadAgentModelsHandler",
        // Changes to a session the run can edit, like edits to a shared
        // document: presenting a review or view, opening it in the person's
        // app, and its name, links and settings. None of them runs a
        // session, and deciding a review is refused.
        "agent-harness.createSessionReview",
        // Stopping a background job sends nothing, and the route refuses
        // programs anyway: the agent cancels through its CancelJob tool.
        "agent-harness.cancelCodeExecutionJob",
        "agent-harness.openInApp",
        "agent-harness.presentSessionView",
        "agent-harness.deleteAgentSession",
        "agent-harness.linkAgentSessionPullRequest",
        "agent-harness.linkAgentSessionTask",
        "agent-harness.putAgentSessionAutoArchive",
        "agent-harness.putAgentSessionSandboxSize",
        "agent-harness.refreshAgentSessionChanges",
        "agent-harness.registerAgentSessionWork",
        "agent-harness.removeQueuedAction",
        "agent-harness.renameAgentSession",
        "agent-harness.setAgentSessionArchived",
        "agent-harness.unlinkAgentSessionPullRequest",
        "agent-harness.unregisterAgentSessionWork",
        // The person's own preferences.
        "agent-harness.putAgentAutoArchivePreferences",
        "agent-harness.putAgentCodingPreferences",
        "agent-harness.putAgentSandboxSize",
        // Rejecting a pending tool call runs nothing; running or rewriting
        // one is refused.
        "cognition.rejectToolCall",
        // Withdrawing the person's own request, like a channel's.
        "storage.accessRequestsCancel",
        // Unauthenticated: a credential adds nothing.
        "storage.claimHarnessPairing",
        "storage.createHarnessPairing",
    ];
    let looks_like_a_send = |key: &str, path: &str| {
        let text = format!("{key} {path}").to_lowercase();
        [
            "send",
            "message",
            "share",
            "invite",
            "mention",
            "guest",
            "rsvp",
            "webhook",
            "forward",
            "post",
            "comment",
            "calls",
            "dm",
            "booking",
            "meeting",
            "/call",
            "scheduled-actions",
            "/events",
            "external-chats",
            "agent-conversations",
            "participants",
            "join",
            "leave",
            "channel",
            "notice",
            "referral",
            "welcome",
            "draft",
            "email",
            "permissions",
            "access",
            "/agents",
            "/bots",
            "agent-sessions",
            "harness",
            "/tool",
            "/web/",
        ]
        .iter()
        .any(|word| text.contains(word))
    };
    let scope = SessionScope::NoSend;
    let operations = code_execution::domain::operations();
    // A reviewed entry names an operation the scope still allows, so a
    // renamed or newly refused one doesn't linger.
    let stale: Vec<&str> = reviewed
        .iter()
        .copied()
        .filter(|key| {
            operations.get(*key).is_none_or(|operation| {
                !scope.allows(&operation.method, &concrete(&operation.path))
            })
        })
        .collect();
    assert!(stale.is_empty(), "stale reviewed entries: {stale:#?}");
    let mut unclassified = Vec::new();
    for (key, operation) in operations {
        if !operation.write || !looks_like_a_send(key, &operation.path) {
            continue;
        }
        let refused = !scope.allows(&operation.method, &concrete(&operation.path));
        if !refused && !reviewed.contains(&key.as_str()) {
            unclassified.push(format!("{key} {} {}", operation.method, operation.path));
        }
    }
    assert!(unclassified.is_empty(), "unclassified: {unclassified:#?}");
}

/// A run that sends nothing starts no work that runs with the person's full
/// access: no agent session, session control or queued prompt, tool
/// approval, review decision, session share, chat tool call, or agent or
/// bot, which acts later.
#[test]
fn a_run_that_sends_nothing_starts_no_work_with_the_persons_access() {
    let operations = code_execution::domain::operations();
    for key in [
        "agent-harness.createAgentSession",
        "agent-harness.controlAgentSession",
        "agent-harness.editQueuedAction",
        "agent-harness.steerQueuedAction",
        "agent-harness.answerAgentSessionToolApproval",
        "agent-harness.decideSessionReview",
        "agent-harness.updateAgentSessionPermissions",
        "agent-harness.startFreshAgentConversation",
        "agent-harness.retryAgentConversationTurn",
        "agent-harness.warmAgentSessionHandler",
        "agent-harness.reportAgentSessionAppConnected",
        "cognition.callTool",
        "storage.createAgent",
        "storage.updateAgent",
        "storage.patchAgent",
        "storage.createBot",
        "storage.patchBot",
    ] {
        let operation = operations
            .get(key)
            .unwrap_or_else(|| panic!("{key} is not in the SDK"));
        assert!(
            !SessionScope::NoSend.allows(&operation.method, &concrete(&operation.path)),
            "{key} ({} {})",
            operation.method,
            operation.path
        );
    }
}

/// How a host's service holds a scoped session's credential to its scope.
enum ScopeEnforcement {
    /// `agent_correlation::inbound::propagate`: the scope stored with the
    /// correlation and the one the credential signs.
    Propagate,
    /// `agent_correlation::inbound::enforce_signed_scope`: the signed scope
    /// alone, for a service with no database.
    SignedScope,
    /// The service accepts no Macro API token, so the credential grants
    /// nothing there.
    NoMacroCredential,
    /// The service takes no credential and fetches what its caller names
    /// from Macro's servers, so the run bootstrap refuses its host to every
    /// scoped run.
    RefusedToScopedRuns,
}

/// Decided per host when it is added.
fn enforcement(host: SdkHost) -> ScopeEnforcement {
    match host {
        SdkHost::Storage
        | SdkHost::Search
        | SdkHost::Properties
        | SdkHost::Auth
        | SdkHost::AgentHarness
        | SdkHost::Email
        | SdkHost::Calendar
        | SdkHost::Cognition
        | SdkHost::Notification
        | SdkHost::ScheduledAction
        | SdkHost::Connection
        | SdkHost::Contacts => ScopeEnforcement::Propagate,
        // The static file service and the CDN in front of it.
        SdkHost::StaticFiles | SdkHost::StaticContent => ScopeEnforcement::SignedScope,
        // CloudFront serves document content only to URLs the storage service
        // signs; the editing worker accepts only document tokens the storage
        // service mints with a POST no scoped session can make.
        SdkHost::DocumentContent | SdkHost::EditingWorker => ScopeEnforcement::NoMacroCredential,
        // Unfurl previews any link for any caller.
        SdkHost::Unfurl => ScopeEnforcement::RefusedToScopedRuns,
    }
}

/// Every host the SDK can reach, including the ones it falls back to when
/// code mode passes none, is one code mode knows, and its service holds a
/// scoped session's credential to its scope: it checks the scope on a path
/// the scope understands, or accepts no Macro credential and the SDK calls
/// nothing there outside either scope.
#[test]
fn every_sdk_host_holds_a_scoped_credential_to_its_scope() {
    use std::str::FromStr;
    let host = |name: &str| {
        SdkHost::from_str(name).unwrap_or_else(|_| {
            panic!("the SDK reaches {name}, which code mode doesn't know: add it to SdkHost")
        })
    };
    type Hosts = std::collections::BTreeMap<String, String>;
    let environments: std::collections::BTreeMap<String, Hosts> =
        serde_json::from_str(code_mode_assets::HOSTS).unwrap();
    assert_eq!(
        environments.keys().collect::<Vec<_>>(),
        ["dev", "local", "prod"]
    );
    for (environment, sdk) in &environments {
        assert!(sdk.contains_key("static-files"), "{environment}: {sdk:?}");
        for (name, url) in sdk {
            let path = url::Url::parse(url)
                .unwrap()
                .path()
                .trim_end_matches('/')
                .to_owned();
            match enforcement(host(name)) {
                ScopeEnforcement::Propagate | ScopeEnforcement::SignedScope => assert!(
                    agent_correlation::scope::matches(
                        &format!("{path}/suggestions"),
                        "/suggestions"
                    ),
                    "{environment} {name} ({url}) serves under a prefix the scope doesn't strip"
                ),
                ScopeEnforcement::NoMacroCredential | ScopeEnforcement::RefusedToScopedRuns => {}
            }
        }
    }
    for (key, operation) in code_execution::domain::operations() {
        let (service, _) = key.split_once('.').unwrap();
        if let ScopeEnforcement::NoMacroCredential = enforcement(host(service)) {
            for scope in [
                SessionScope::Generation,
                SessionScope::NoSend,
                SessionScope::DryRun,
            ] {
                assert!(
                    scope.allows(&operation.method, &concrete(&operation.path)),
                    "{key} ({} {}) is outside {scope:?} on a host that can't refuse it",
                    operation.method,
                    operation.path
                );
            }
        }
    }
}

const PRIVATE: &str = include_str!(
    "../../../../tooling/xtask/crates/xtask_local/src/local/identity/macro-api-token.local.private.pem"
);
const PUBLIC: &str = include_str!(
    "../../../../tooling/xtask/crates/xtask_local/src/local/identity/macro-api-token.local.public.pem"
);

/// Session and public MCP runs sign the scope they store with the
/// correlation, so services with no database hold the run to it too.
#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn a_run_signs_its_sessions_scope_into_its_credential(pool: sqlx::PgPool) {
    use macro_auth::middleware::decode_jwt::{JwtToken, JwtValidationArgs, handler};
    sqlx::raw_sql(
        r#"
        INSERT INTO macro_user (id, username, email, stripe_customer_id)
        VALUES ('00000000-0000-4000-8000-000000000001', 'owner@example.com', 'owner@example.com', 'stripe_owner');
        INSERT INTO "User" (id, email, macro_user_id)
        VALUES ('macro|owner@example.com', 'owner@example.com', '00000000-0000-4000-8000-000000000001');
        "#,
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::raw_sql(include_str!(
        "../../../../crates/agent_code_mode/src/outbound/postgres/test/sessions.sql"
    ))
    .execute(&pool)
    .await
    .unwrap();
    let session = test_agent_session(AgentSessionId::new_from_uuid(macro_uuid::Uuid::from_u128(
        1,
    )));
    let owner = session.owner_user().unwrap().clone();
    // The agent the fixture's session runs, which a correlation must name.
    let agent = bot_id::BotId::new_from_uuid(macro_uuid::Uuid::from_u128(0xa9e7));
    let identity = ExecutionIdentity {
        execution: agent_code_mode::domain::ExecutionId::mint(),
        acting_as: ai_toolset::actor::ToolActor::Owner,
        session: session.id,
        agent_id: agent,
        owner: owner.clone(),
        turn: macro_uuid::Uuid::from_u128(1),
        lifetime: agent_code_mode::domain::RunLifetime::Foreground,
    };
    let signed = |token: &str| match handler(
        &JwtValidationArgs::testing_macro_token("fixture", PUBLIC),
        token,
    )
    .unwrap()
    {
        JwtToken::MacroApiToken(token) => {
            assert!(token.agent_correlation_id.is_some());
            token.agent_scope
        }
        JwtToken::MacroAccessToken(_) => panic!("a code-mode credential is a Macro API token"),
    };
    // A background job always gets the job scope, approved at launch and
    // minted when it starts, whatever its session's scope.
    let deadline = chrono::Utc::now() + chrono::TimeDelta::minutes(10);
    for (scope, name) in [
        (None, Some("job")),
        (Some(SessionScope::NoSend), Some("job")),
        (Some(SessionScope::Generation), Some("job")),
    ] {
        let job = ExecutionIdentity {
            execution: agent_code_mode::domain::ExecutionId::mint(),
            lifetime: agent_code_mode::domain::RunLifetime::Job { deadline },
            ..identity.clone()
        };
        let credentials = RunCredentials {
            egress: EgressRollout::new(None),
            signer: MacroApiTokenSigner::new(pool.clone(), "fixture", PRIVATE),
            correlations: agent_correlation::outbound::PgCorrelationRepository(pool.clone()),
            gate: Arc::new(Gate {
                verdict: NativeToolVerdict::RunAs(owner.clone()),
                calls: AtomicUsize::new(0),
            }),
            endpoints: SdkEndpoints::default(),
            scopes: Arc::new(Scopes(scope)),
            detach: Arc::new(NeverDetach),
        };
        let actor = credentials
            .approve_job(&job, "fixture", CancellationToken::new())
            .await
            .unwrap();
        let run = credentials.mint_job(&job, &actor).await.unwrap();
        assert_eq!(
            signed(&run.environment.token).as_deref(),
            name,
            "job run {scope:?}"
        );
        let correlation = run.correlation_id;
        // Once the job stops, its credential's correlation is revoked, so
        // every service that validates attribution refuses a copy of it.
        credentials.revoke_job(correlation).await.unwrap();
        assert!(
            agent_correlation::outbound::PgCorrelationRepository(pool.clone())
                .find(correlation)
                .await
                .unwrap()
                .unwrap()
                .revoked
        );
    }
    for (scope, name) in [
        (Some(SessionScope::Generation), Some("generation")),
        (Some(SessionScope::NoSend), Some("no_send")),
        (None, None),
    ] {
        let run = RunCredentials {
            egress: EgressRollout::new(None),
            signer: MacroApiTokenSigner::new(pool.clone(), "fixture", PRIVATE),
            correlations: agent_correlation::outbound::PgCorrelationRepository(pool.clone()),
            gate: Arc::new(Gate {
                verdict: NativeToolVerdict::RunAs(owner.clone()),
                calls: AtomicUsize::new(0),
            }),
            endpoints: SdkEndpoints::default(),
            scopes: Arc::new(Scopes(scope)),
            detach: Arc::new(NeverDetach),
        }
        .issue(&identity, "fixture", CancellationToken::new())
        .await
        .unwrap();
        assert_eq!(
            signed(&run.environment.token).as_deref(),
            name,
            "session run {scope:?}"
        );
        let run = UserRunCredentials {
            egress: EgressRollout::new(None),
            signer: MacroApiTokenSigner::new(pool.clone(), "fixture", PRIVATE),
            correlations: agent_correlation::outbound::PgCorrelationRepository(pool.clone()),
            endpoints: SdkEndpoints::default(),
            scopes: Arc::new(Scopes(scope)),
        }
        .issue(
            &owner,
            &ai_toolset::ToolCaller::Agent(agent),
            Some(session.id.as_uuid()),
        )
        .await
        .unwrap();
        assert_eq!(signed(&run.token).as_deref(), name, "MCP run {scope:?}");
    }
}

/// Runs go through the forwarder only where the egress flag is on for the
/// user they act as; with no flag client, the flag off, or the flags
/// unreadable, they go directly.
#[tokio::test]
async fn the_egress_flag_fails_closed_to_direct() {
    use code_execution::domain::Egress;
    use feature_flags::{FlagSnapshot, FlagValue, outbound::fake::FakeFeatureFlags};
    let user = MacroUserIdStr::parse_from_str("macro|owner@example.com").unwrap();
    let flags = |result: Result<FlagSnapshot, String>| {
        let mut flags = FakeFeatureFlags::default();
        flags.set(user.clone(), result);
        EgressRollout::new(Some(flags))
    };
    let flag =
        |on: bool| FlagSnapshot::new([(EGRESS_PROXY_FLAG.to_owned(), FlagValue::Boolean(on))]);
    assert_eq!(flags(Ok(flag(true))).egress(&user).await, Egress::Proxied);
    assert_eq!(flags(Ok(flag(false))).egress(&user).await, Egress::Direct);
    assert_eq!(
        flags(Err("PostHog is down".into())).egress(&user).await,
        Egress::Direct
    );
    assert_eq!(
        EgressRollout::<FakeFeatureFlags>::new(None)
            .egress(&user)
            .await,
        Egress::Direct
    );
}

/// The scope can't be read.
struct UnreadableScopes;

#[async_trait]
impl SessionScopes for UnreadableScopes {
    async fn scope(&self, _: uuid::Uuid) -> Result<Option<SessionScope>, rootcause::Report> {
        Err(rootcause::report!("database unavailable"))
    }
}

/// A scoped session calls no connected app's tool directly, read or write:
/// the egress proxy that carries the call doesn't know the scope. A session
/// with no scope is left to the proxy, and one whose scope can't be read
/// calls nothing.
#[tokio::test]
async fn a_scoped_session_calls_no_connected_apps_tool_directly() {
    let session = AgentSessionId::new();
    for scope in [SessionScope::NoSend, SessionScope::Generation] {
        let gate = ScopedToolGate {
            inner: Arc::new(Open),
            scopes: Arc::new(Scopes(Some(scope))),
        };
        for tool in ["mcp__slack__send_message", "mcp__linear__list_issues"] {
            assert!(
                gate.refuse_remote_mcp(session, tool).await.is_some(),
                "{scope:?} {tool}"
            );
        }
    }
    let unscoped = ScopedToolGate {
        inner: Arc::new(Open),
        scopes: Arc::new(Scopes(None)),
    };
    assert_eq!(
        unscoped
            .refuse_remote_mcp(session, "mcp__slack__send_message")
            .await,
        None
    );
    let unreadable = ScopedToolGate {
        inner: Arc::new(Open),
        scopes: Arc::new(UnreadableScopes),
    };
    assert!(
        unreadable
            .refuse_remote_mcp(session, "mcp__slack__send_message")
            .await
            .is_some()
    );
}

/// A user's egress is read once and reused: runs inside the cache's life
/// don't ask PostHog again, and a failed read sends runs direct for a
/// shorter while before asking again.
#[tokio::test(start_paused = true)]
async fn the_egress_flag_is_read_once_per_user_for_a_while() {
    use code_execution::domain::Egress;
    use feature_flags::{FlagSnapshot, FlagValue};
    use std::sync::atomic::{AtomicUsize, Ordering};

    /// Counts its loads; fails while `failing`.
    struct Counted {
        loads: Arc<AtomicUsize>,
        failing: Arc<std::sync::atomic::AtomicBool>,
    }

    impl feature_flags::FeatureFlags for Counted {
        async fn load(&self, _: &MacroUserIdStr<'_>) -> Result<FlagSnapshot, rootcause::Report> {
            self.loads.fetch_add(1, Ordering::SeqCst);
            if self.failing.load(Ordering::SeqCst) {
                return Err(rootcause::report!("PostHog is down"));
            }
            Ok(FlagSnapshot::new([(
                EGRESS_PROXY_FLAG.to_owned(),
                FlagValue::Boolean(true),
            )]))
        }
    }

    let loads = Arc::new(AtomicUsize::new(0));
    let failing = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let rollout = EgressRollout::new(Some(Counted {
        loads: Arc::clone(&loads),
        failing: Arc::clone(&failing),
    }));
    let user = MacroUserIdStr::parse_from_str("macro|owner@example.com").unwrap();
    let other = MacroUserIdStr::parse_from_str("macro|other@example.com").unwrap();

    assert_eq!(rollout.egress(&user).await, Egress::Proxied);
    assert_eq!(rollout.egress(&user).await, Egress::Proxied);
    assert_eq!(loads.load(Ordering::SeqCst), 1);
    // Another user is read on their own.
    assert_eq!(rollout.egress(&other).await, Egress::Proxied);
    assert_eq!(loads.load(Ordering::SeqCst), 2);
    // Past the cache's life, the flags are read again.
    tokio::time::advance(std::time::Duration::from_secs(61)).await;
    failing.store(true, Ordering::SeqCst);
    assert_eq!(rollout.egress(&user).await, Egress::Direct);
    assert_eq!(loads.load(Ordering::SeqCst), 3);
    // A failed read holds for a shorter while.
    assert_eq!(rollout.egress(&user).await, Egress::Direct);
    assert_eq!(loads.load(Ordering::SeqCst), 3);
    tokio::time::advance(std::time::Duration::from_secs(11)).await;
    failing.store(false, Ordering::SeqCst);
    assert_eq!(rollout.egress(&user).await, Egress::Proxied);
    assert_eq!(loads.load(Ordering::SeqCst), 4);
}

/// Answers every run with success, so a check is all that stands between a
/// program and success.
struct Accepts;

#[async_trait::async_trait]
impl code_execution::domain::CodeRunner for Accepts {
    async fn run(
        &self,
        _job: code_execution::domain::ExecutionJob,
        _events: &mut code_execution::domain::EventSink,
        _cancellation: tokio_util::sync::CancellationToken,
    ) -> code_execution::domain::Outcome {
        code_execution::domain::Outcome::Succeeded {
            value: serde_json::Value::Null,
        }
    }
}

/// The suggestions session runs the brief's programs as written: each one,
/// put in the brief's program shape, type-checks against the current SDK.
#[tokio::test]
#[ignore = "requires pinned Deno runtime"]
async fn suggestions_brief_programs_type_check() {
    use code_execution::domain::{
        EventKind, ExecuteRequest, ExecutionService, Limits, Outcome, RunEnvironment,
    };
    use suggestions::domain::{model::GenerationTrigger, prompt::brief};

    let root = tempfile::tempdir().unwrap();
    let binary = tokio::process::Command::new("which")
        .arg("deno")
        .output()
        .await
        .unwrap();
    assert!(binary.status.success(), "Deno 2.9.6 must be on PATH");
    let checker = code_execution::outbound::deno::check::DenoChecker::new(
        String::from_utf8(binary.stdout).unwrap().trim().into(),
        root.path().to_owned(),
        2,
        8,
        64 * 1024,
    )
    .await
    .unwrap();
    let service = ExecutionService::new(
        std::sync::Arc::new(Accepts),
        std::sync::Arc::new(checker),
        Limits::default(),
    )
    .unwrap();

    let text = brief(
        GenerationTrigger::Nightly,
        "UTC",
        chrono::Utc::now(),
        "",
        "a-model",
    );
    let blocks: Vec<&str> = text
        .split("```typescript\n")
        .skip(1)
        .map(|block| block.split("```").next().unwrap())
        .collect();
    let [shape, map, documents, suggest, draft, check] = blocks[..] else {
        panic!("expected the shape and five programs, got {}", blocks.len());
    };
    let marker =
        "  // the program's own lines go here and end with: return { data, reviews: [] };\n";
    assert!(shape.contains(marker));
    // What the brief leaves the session to fill in.
    let session_values = "const docId = '', threadId = '', channelId = '', callId = '', messageId = '', dedupKey = '', title = '', summary = '', prompt = '', subject = '', bodyText = '', reason = '', now = '';\nconst importance = 50;\nconst keys: string[] = [];\n";
    let programs = [
        map.to_owned(),
        documents.to_owned(),
        format!("{suggest}{draft}return {{ data: results, reviews: [] }};\n"),
        check.to_owned(),
    ];
    for program in programs {
        let source = shape.replace(marker, &format!("{session_values}{program}"));
        let mut handle = service
            .execute(
                ExecuteRequest {
                    source: source.clone(),
                    timeout_ms: 30_000,
                },
                RunEnvironment {
                    session_id: Some(uuid::Uuid::now_v7()),
                    execution_id: Some(uuid::Uuid::now_v7()),
                    ..RunEnvironment::default()
                },
            )
            .unwrap();
        let outcome = loop {
            match handle.events.recv().await.unwrap().kind {
                EventKind::Finished { outcome } => break outcome,
                _ => continue,
            }
        };
        assert!(
            matches!(outcome, Outcome::Succeeded { .. }),
            "{source}\n{outcome:?}"
        );
    }
    service.shutdown().await;
}

/// Refuses every detach; these credentials are for foreground runs.
struct NeverDetach;

impl super::jobs::MayDetach for NeverDetach {
    fn decide<'a>(
        &'a self,
        _: &'a ExecutionIdentity,
    ) -> futures::future::BoxFuture<'a, Result<agent_code_mode::domain::Detach, CodeModeError>>
    {
        Box::pin(async {
            Ok(agent_code_mode::domain::Detach::Refused(
                "not in this test".into(),
            ))
        })
    }
}

/// A scoped run gets no unfurl host, so neither `--allow-net` nor an egress
/// forwarder has an address for it; an unscoped run keeps it.
#[test]
fn a_scoped_run_gets_no_unfurl_host() {
    let endpoints = SdkEndpoints {
        hosts: BTreeMap::from([
            (
                "unfurl".to_owned(),
                "https://gateway.example/unfurl".to_owned(),
            ),
            (
                "storage".to_owned(),
                "https://gateway.example/dss".to_owned(),
            ),
        ]),
        web_app_url: "https://app.example".to_owned(),
    };
    let scoped = run_endpoints(&endpoints, true);
    assert_eq!(scoped.hosts.keys().collect::<Vec<_>>(), ["storage"]);
    let unscoped = run_endpoints(&endpoints, false);
    assert_eq!(unscoped.hosts.len(), 2);
}
