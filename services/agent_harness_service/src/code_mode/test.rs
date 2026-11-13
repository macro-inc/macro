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
        "agent-harness.addConnectedMcpServer",
        "auth.generateEmailLink",
        "auth.deleteTeamInviteLink",
        "auth.deleteTeamInviteHandler",
        "auth.rejectInvitation",
        "auth.revokeGtmInviteLink",
        "auth.redeemGtmInviteLink",
        "auth.joinTeamByInviteLink",
        "auth.toggleTeamNonAdminInvites",
        "auth.postProfilePictures",
        "cognition.sendChatMessage",
        "cognition.stopChatStream",
        "cognition.callTool",
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
        "scheduled-action.dismissRoutineSuggestion",
        "scheduled-action.retireRoutineSuggestion",
        "scheduled-action.suggestRoutine",
        "scheduled-action.draftRoutine",
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
        "storage.patchWebhook",
        "storage.externalChatRead",
        "storage.externalChatUpload",
        "storage.externalChatRemove",
        "storage.externalChatUpdatePermissions",
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
        "storage.setEmailSync",
        // Channel sections only arrange the person's own sidebar.
        "storage.createChannelSection",
        "storage.deleteChannelSection",
        "storage.previewChannelSection",
        "storage.setChannelSection",
        "storage.updateChannelSection",
        "scheduled-action.attachSuggestionDraft",
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
        ]
        .iter()
        .any(|word| text.contains(word))
    };
    let scope = SessionScope::NoSend;
    let mut unclassified = Vec::new();
    for (key, operation) in code_execution::domain::operations() {
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
        // service mints, behind its scope check; unfurl previews public links
        // for any caller.
        SdkHost::DocumentContent | SdkHost::EditingWorker | SdkHost::Unfurl => {
            ScopeEnforcement::NoMacroCredential
        }
    }
}

/// Every host the SDK can reach, including the ones it falls back to when
/// code mode passes none, is one code mode knows, and its service holds a
/// scoped session's credential to its scope: it checks the scope on a path
/// the scope understands, or accepts no Macro credential and serves nothing
/// outside either scope.
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
                ScopeEnforcement::NoMacroCredential => {}
            }
        }
    }
    for (key, operation) in code_execution::domain::operations() {
        let (service, _) = key.split_once('.').unwrap();
        if let ScopeEnforcement::NoMacroCredential = enforcement(host(service)) {
            for scope in [SessionScope::Generation, SessionScope::NoSend] {
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
    for (scope, name) in [
        (Some(SessionScope::Generation), Some("generation")),
        (Some(SessionScope::NoSend), Some("no_send")),
        (None, None),
    ] {
        let run = RunCredentials {
            signer: MacroApiTokenSigner::new(pool.clone(), "fixture", PRIVATE),
            correlations: agent_correlation::outbound::PgCorrelationRepository(pool.clone()),
            gate: Arc::new(Gate {
                verdict: NativeToolVerdict::RunAs(owner.clone()),
                calls: AtomicUsize::new(0),
            }),
            endpoints: SdkEndpoints::default(),
            scopes: Arc::new(Scopes(scope)),
        }
        .issue(&identity, "fixture", CancellationToken::new())
        .await
        .unwrap();
        assert_eq!(signed(&run.token).as_deref(), name, "session run {scope:?}");
        let run = UserRunCredentials {
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
