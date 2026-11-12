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

/// The scope's list of POST reads covers every read the SDK sends as a POST,
/// and the only writes it lets a generation session make are its own tools
/// and creating an email draft.
#[test]
fn the_generation_scope_matches_the_sdk_catalog() {
    let concrete = |path: &str| {
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
    };
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
    let concrete = |path: &str| {
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
    };
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
