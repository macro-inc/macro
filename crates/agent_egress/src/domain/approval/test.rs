use std::sync::Mutex;

use agent_runtime_protocol::domain::action::AgentActionId;
use http::header::CONTENT_TYPE;
use http_body_util::{BodyExt, Full};
use tokio::sync::oneshot;

use super::*;
use crate::outbound::tool_approvals::{InMemoryToolApprovalStore, InProcessToolApprovalSignals};

type MemoryStore = InMemoryToolApprovalStore;

trait OnlyApproval {
    fn only(&self) -> ToolApproval;
}

impl OnlyApproval for MemoryStore {
    fn only(&self) -> ToolApproval {
        let all = self.all();
        assert_eq!(all.len(), 1, "exactly one call was held");
        all.into_iter().next().unwrap()
    }
}

/// One announcement: the state, and the owner when it was a request.
type Heard = (ToolApprovalStatus, Option<String>);

/// What the announcer heard, in order.
#[derive(Clone, Default)]
struct RecordingAnnouncer {
    heard: Arc<Mutex<Vec<Heard>>>,
    /// Woken once per call that starts waiting.
    requested: Arc<tokio::sync::Notify>,
}

impl RecordingAnnouncer {
    fn heard(&self) -> Vec<Heard> {
        self.heard.lock().unwrap().clone()
    }
}

impl ToolApprovalAnnouncer for RecordingAnnouncer {
    async fn requested(&self, approval: &ToolApproval, owner: &MacroUserIdStr<'static>) {
        self.heard
            .lock()
            .unwrap()
            .push((approval.status, Some(owner.as_ref().to_owned())));
        self.requested.notify_one();
    }

    async fn resolved(&self, approval: &ToolApproval) {
        self.heard.lock().unwrap().push((approval.status, None));
    }
}

type Service = ToolApprovalService<MemoryStore, InProcessToolApprovalSignals, RecordingAnnouncer>;

fn service_with(timing: HoldTiming) -> (Service, MemoryStore, RecordingAnnouncer) {
    let store = MemoryStore::default();
    let announcer = RecordingAnnouncer::default();
    let service =
        ToolApprovalService::with_timing(store.clone(), store.signals(), announcer.clone(), timing);
    (service, store, announcer)
}

fn service() -> (Service, MemoryStore, RecordingAnnouncer) {
    service_with(HoldTiming::default())
}

fn owner() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("owner@macro.com").unwrap()
}

fn asker() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("asker@macro.com").unwrap()
}

fn tools_call(progress_token: Option<serde_json::Value>) -> ToolsCall {
    ToolsCall {
        id: serde_json::json!(7),
        name: "ListEmails".to_owned(),
        arguments: serde_json::json!({ "limit": 5 }),
        progress_token,
    }
}

/// A held call whose forward, once approved, answers with `answer` and
/// reports the request it was handed.
fn held(
    session: AgentSessionId,
    call: ToolsCall,
    answer: serde_json::Value,
) -> (HeldCall, oneshot::Receiver<ProxyRequest>) {
    let (forwarded, received) = oneshot::channel();
    let request = http::Request::builder()
        .method("POST")
        .uri("https://upstream.example/mcp")
        .body(
            Full::new(Bytes::from_static(b"{}"))
                .map_err(|never| match never {})
                .boxed_unsync(),
        )
        .unwrap();
    let held = HeldCall {
        session,
        owner: owner(),
        prompter: TurnPrompter {
            action_id: AgentActionId::mint(),
            user: Some(asker()),
        },
        server_slug: "macro".to_owned(),
        server_name: "Macro".to_owned(),
        call,
        request,
        forward: Box::new(move |request| {
            Box::pin(async move {
                let _ = forwarded.send(request);
                Ok(json_response(&answer))
            })
        }),
    };
    (held, received)
}

/// The next event the held call's stream sends, as text.
async fn next_event(body: &mut crate::domain::model::ProxyBody) -> String {
    let frame = body
        .frame()
        .await
        .expect("the stream sends another event")
        .expect("the stream does not fail");
    String::from_utf8(frame.into_data().unwrap().to_vec()).unwrap()
}

/// The JSON-RPC message an event carries.
fn message(event: &str) -> serde_json::Value {
    let data = event
        .strip_prefix("event: message\ndata: ")
        .and_then(|rest| rest.strip_suffix("\n\n"))
        .unwrap_or_else(|| panic!("not a message event: {event:?}"));
    serde_json::from_str(data).unwrap()
}

fn result_text(message: &serde_json::Value) -> &str {
    message["result"]["content"][0]["text"].as_str().unwrap()
}

#[tokio::test]
async fn an_approved_call_goes_through_and_its_answer_comes_back_on_the_stream() {
    let (service, store, announcer) = service();
    let session = AgentSessionId::new();
    let upstream = serde_json::json!({ "jsonrpc": "2.0", "id": 7, "result": { "content": [] } });
    let (call, forwarded) = held(session, tools_call(None), upstream.clone());

    let response = service.hold(call).await.unwrap();
    assert_eq!(
        response.headers()[CONTENT_TYPE],
        "text/event-stream",
        "held calls answer as a stream"
    );
    let mut body = response.into_body();
    assert!(
        next_event(&mut body).await.starts_with(':'),
        "bytes go out at once"
    );

    let pending = store.only();
    assert_eq!(pending.status, ToolApprovalStatus::Pending);
    assert_eq!(pending.owner, owner());
    assert_eq!(pending.requested_by, Some(asker()));
    assert_eq!(pending.tool_name, "ListEmails");
    assert_eq!(pending.request_id, serde_json::json!(7));

    let approved = service
        .answer(session, pending.id, ApprovalAnswer::Approve, &owner())
        .await
        .unwrap();
    assert_eq!(approved.resolved_by, Some(owner()));

    assert_eq!(message(&next_event(&mut body).await), upstream);
    assert_eq!(
        forwarded.await.unwrap().uri(),
        "https://upstream.example/mcp"
    );
    assert_eq!(
        announcer.heard(),
        [
            (
                ToolApprovalStatus::Pending,
                Some(owner().as_ref().to_owned())
            ),
            (ToolApprovalStatus::Approved, None),
        ]
    );
}

#[tokio::test]
async fn a_declined_call_never_runs_and_says_who_declined() {
    let (service, store, _announcer) = service();
    let session = AgentSessionId::new();
    let (call, forwarded) = held(session, tools_call(None), serde_json::json!({}));
    let mut body = service.hold(call).await.unwrap().into_body();
    next_event(&mut body).await;

    service
        .answer(session, store.only().id, ApprovalAnswer::Deny, &owner())
        .await
        .unwrap();

    let answer = message(&next_event(&mut body).await);
    assert_eq!(answer["id"], 7);
    assert_eq!(answer["result"]["isError"], true);
    assert!(result_text(&answer).starts_with("owner@macro.com declined this call"));
    assert!(forwarded.await.is_err(), "nothing went upstream");
}

#[tokio::test]
async fn only_the_owner_approves_but_an_editor_may_cancel() {
    let (service, store, _announcer) = service();
    let session = AgentSessionId::new();
    let (call, _forwarded) = held(session, tools_call(None), serde_json::json!({}));
    let mut body = service.hold(call).await.unwrap().into_body();
    next_event(&mut body).await;
    let id = store.only().id;

    for answer in [ApprovalAnswer::Approve, ApprovalAnswer::Deny] {
        assert!(matches!(
            service.answer(session, id, answer, &asker()).await,
            Err(ToolApprovalError::NotOwner)
        ));
    }
    assert!(
        matches!(
            service
                .answer(AgentSessionId::new(), id, ApprovalAnswer::Cancel, &asker())
                .await,
            Err(ToolApprovalError::NotFound)
        ),
        "an approval is only answerable through its own session"
    );

    service
        .answer(session, id, ApprovalAnswer::Cancel, &asker())
        .await
        .unwrap();
    let answer = message(&next_event(&mut body).await);
    assert!(result_text(&answer).starts_with("This call was cancelled"));
    assert!(
        matches!(
            service
                .answer(session, id, ApprovalAnswer::Approve, &owner())
                .await,
            Err(ToolApprovalError::NotPending)
        ),
        "the first resolution is the only one"
    );
}

#[tokio::test]
async fn a_call_nobody_answers_expires_and_says_so() {
    let (service, store, announcer) = service_with(HoldTiming {
        keepalive_every: Duration::from_millis(5),
        limit_with_progress: Duration::from_secs(60),
        limit: Duration::from_millis(30),
    });
    let session = AgentSessionId::new();
    let (call, _forwarded) = held(session, tools_call(None), serde_json::json!({}));
    let mut body = service.hold(call).await.unwrap().into_body();

    let answer = loop {
        let event = next_event(&mut body).await;
        if !event.starts_with(':') {
            break message(&event);
        }
    };
    assert!(result_text(&answer).starts_with("owner@macro.com did not approve this call in time"));
    assert_eq!(store.only().status, ToolApprovalStatus::Expired);
    assert_eq!(
        announcer.heard().last(),
        Some(&(ToolApprovalStatus::Expired, None))
    );
}

#[tokio::test]
async fn a_client_that_asked_for_progress_is_kept_alive_with_it() {
    let (service, store, _announcer) = service_with(HoldTiming {
        keepalive_every: Duration::from_millis(5),
        limit_with_progress: Duration::from_secs(60),
        limit: Duration::from_millis(1),
    });
    let session = AgentSessionId::new();
    let (call, _forwarded) = held(
        session,
        tools_call(Some(serde_json::json!("token-1"))),
        serde_json::json!({}),
    );
    let mut body = service.hold(call).await.unwrap().into_body();
    next_event(&mut body).await;

    let progress = message(&next_event(&mut body).await);
    assert_eq!(progress["method"], "notifications/progress");
    assert_eq!(progress["params"]["progressToken"], "token-1");
    assert_eq!(progress["params"]["progress"], 1);
    let progress = message(&next_event(&mut body).await);
    assert_eq!(
        progress["params"]["progress"], 2,
        "progress only ever grows"
    );
    assert_eq!(
        store.only().status,
        ToolApprovalStatus::Pending,
        "the shorter limit is for clients that asked for no progress"
    );
}

#[tokio::test]
async fn a_client_that_hangs_up_cancels_its_call() {
    let (service, store, announcer) = service();
    let session = AgentSessionId::new();
    let (call, _forwarded) = held(session, tools_call(None), serde_json::json!({}));
    drop(service.hold(call).await.unwrap());

    let id = store.only().id;
    let mut subscription = store.signals().subscribe(id);
    if store.only().status.is_pending() {
        subscription.changed().await;
    }
    assert_eq!(store.only().status, ToolApprovalStatus::Cancelled);
    assert_eq!(
        announcer.heard().last(),
        Some(&(ToolApprovalStatus::Cancelled, None))
    );
}

#[tokio::test]
async fn the_agent_withdrawing_its_request_cancels_the_hold() {
    let (service, store, _announcer) = service();
    let session = AgentSessionId::new();
    let (call, _forwarded) = held(session, tools_call(None), serde_json::json!({}));
    let mut body = service.hold(call).await.unwrap().into_body();
    next_event(&mut body).await;

    service
        .withdraw(AgentSessionId::new(), &serde_json::json!(7))
        .await
        .unwrap();
    assert!(
        store.only().status.is_pending(),
        "another session's id is not this one"
    );

    service
        .withdraw(session, &serde_json::json!(7))
        .await
        .unwrap();
    assert!(
        result_text(&message(&next_event(&mut body).await)).starts_with("This call was cancelled")
    );
}

#[tokio::test]
async fn ending_the_session_releases_every_held_call() {
    let (service, _store, _announcer) = service();
    let session = AgentSessionId::new();
    let (call, _forwarded) = held(session, tools_call(None), serde_json::json!({}));
    let mut body = service.hold(call).await.unwrap().into_body();
    next_event(&mut body).await;

    service.release_session(session).await.unwrap();
    assert!(
        result_text(&message(&next_event(&mut body).await)).starts_with("This call was cancelled")
    );
}

#[tokio::test]
async fn without_a_way_to_ask_every_held_call_is_refused() {
    let (call, forwarded) = held(
        AgentSessionId::new(),
        tools_call(None),
        serde_json::json!({}),
    );
    let response = RefuseHeldCalls.hold(call).await.unwrap();
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let answer: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(answer["id"], 7);
    assert_eq!(answer["result"]["isError"], true);
    assert!(result_text(&answer).starts_with("ListEmails did not run."));
    assert!(forwarded.await.is_err());
}

#[test]
fn a_tools_call_is_read_with_its_progress_token() {
    let call = ToolsCall::parse(
        br#"{"jsonrpc":"2.0","id":"a","method":"tools/call","params":{"name":"Search","arguments":{"q":"x"},"_meta":{"progressToken":3}}}"#,
    )
    .unwrap();
    assert_eq!(
        call,
        ToolsCall {
            id: serde_json::json!("a"),
            name: "Search".to_owned(),
            arguments: serde_json::json!({ "q": "x" }),
            progress_token: Some(serde_json::json!(3)),
        }
    );
    assert_eq!(
        ToolsCall::parse(br#"{"jsonrpc":"2.0","id":1,"method":"tools/list"}"#),
        None
    );
    assert_eq!(
        ToolsCall::parse(br#"{"jsonrpc":"2.0","method":"tools/call","params":{"name":"x"}}"#),
        None,
        "a notification has no answer to hold"
    );
}

fn in_process(session: AgentSessionId) -> InProcessCall {
    InProcessCall {
        session,
        owner: owner(),
        prompter: TurnPrompter {
            action_id: AgentActionId::mint(),
            user: Some(asker()),
        },
        server_slug: "macro".to_owned(),
        server_name: "Macro".to_owned(),
        tool_name: "ListEmails".to_owned(),
        arguments: serde_json::json!({}),
    }
}

#[tokio::test]
async fn an_in_process_call_waits_for_the_owner_and_says_how_it_ended() {
    let (service, store, announcer) = service();
    let session = AgentSessionId::new();
    let waiting = tokio::spawn({
        let service = service.clone();
        async move { service.hold_in_process(in_process(session)).await }
    });
    // Held once the owner has been told; answer then.
    announcer.requested.notified().await;
    let id = store.only().id;
    service
        .answer(session, id, ApprovalAnswer::Deny, &owner())
        .await
        .unwrap();
    assert_eq!(waiting.await.unwrap().unwrap(), ToolApprovalStatus::Denied);
    assert_eq!(announcer.heard()[0].0, ToolApprovalStatus::Pending);
}

#[tokio::test]
async fn abandoning_an_in_process_call_cancels_it() {
    let (service, store, _announcer) = service();
    let session = AgentSessionId::new();
    {
        let hold = service.hold_in_process(in_process(session));
        tokio::pin!(hold);
        // Poll once so the call is recorded, then drop it.
        let _ = futures::poll!(&mut hold);
    }
    let id = store.only().id;
    let mut subscription = store.signals().subscribe(id);
    if store.only().status.is_pending() {
        subscription.changed().await;
    }
    assert_eq!(store.only().status, ToolApprovalStatus::Cancelled);
}

#[test]
fn only_approval_lets_a_call_run() {
    assert_eq!(refusal(ToolApprovalStatus::Approved, "o@m.com", "T"), None);
    for status in [
        ToolApprovalStatus::Denied,
        ToolApprovalStatus::Cancelled,
        ToolApprovalStatus::Expired,
    ] {
        assert!(
            refusal(status, "o@m.com", "T")
                .unwrap()
                .contains("T did not run")
        );
    }
}

#[test]
fn only_public_lookups_on_macro_skip_the_owner() {
    assert!(!spends_owner_access(MACRO_SERVER_SLUG, "WebSearch"));
    assert!(!spends_owner_access(MACRO_SERVER_SLUG, "WebFetch"));
    assert!(spends_owner_access(MACRO_SERVER_SLUG, "ListEmails"));
    assert!(spends_owner_access(MACRO_SERVER_SLUG, "ReadContent"));
    assert!(
        spends_owner_access("linear", "WebSearch"),
        "a connected app is always the owner's own account"
    );
}

/// Hold `call` in-process on a task, and the approval it is waiting on once
/// the owner has been told.
async fn waiting_in_process(
    service: &Service,
    store: &MemoryStore,
    announcer: &RecordingAnnouncer,
    call: InProcessCall,
) -> (
    tokio::task::JoinHandle<Result<ToolApprovalStatus, EgressError>>,
    ToolApprovalId,
) {
    let before: Vec<ToolApprovalId> = store.all().iter().map(|approval| approval.id).collect();
    let waiting = tokio::spawn({
        let service = service.clone();
        async move { service.hold_in_process(call).await }
    });
    announcer.requested.notified().await;
    let id = store
        .all()
        .into_iter()
        .find(|approval| !before.contains(&approval.id))
        .expect("the call was held")
        .id;
    (waiting, id)
}

#[tokio::test]
async fn approving_for_good_lets_that_person_use_that_macro_tool_without_asking_again() {
    let (service, store, announcer) = service();
    let session = AgentSessionId::new();
    let (waiting, id) = waiting_in_process(&service, &store, &announcer, in_process(session)).await;

    let approved = service
        .answer(session, id, ApprovalAnswer::ApproveAndRemember, &owner())
        .await
        .unwrap();
    assert_eq!(approved.status, ToolApprovalStatus::Approved);
    assert!(approved.remembered, "the log says it was approved for good");
    assert_eq!(
        waiting.await.unwrap().unwrap(),
        ToolApprovalStatus::Approved
    );

    assert_eq!(
        service.hold_in_process(in_process(session)).await.unwrap(),
        ToolApprovalStatus::Approved,
        "the same person calling the same tool runs at once"
    );
    assert_eq!(store.all().len(), 1, "and nothing was held for it");
    assert_eq!(
        announcer.heard(),
        [
            (
                ToolApprovalStatus::Pending,
                Some(owner().as_ref().to_owned())
            ),
            (ToolApprovalStatus::Approved, None),
        ],
        "nobody was asked about the second call"
    );
}

#[tokio::test]
async fn approving_one_macro_tool_for_good_still_asks_about_anything_else() {
    let (service, store, announcer) = service();
    let session = AgentSessionId::new();
    let (waiting, id) = waiting_in_process(&service, &store, &announcer, in_process(session)).await;
    service
        .answer(session, id, ApprovalAnswer::ApproveAndRemember, &owner())
        .await
        .unwrap();
    waiting.await.unwrap().unwrap();

    let other_tool = InProcessCall {
        tool_name: "SendEmail".to_owned(),
        ..in_process(session)
    };
    let (other_tool, _) = waiting_in_process(&service, &store, &announcer, other_tool).await;
    other_tool.abort();

    let someone_else = InProcessCall {
        prompter: TurnPrompter {
            action_id: AgentActionId::mint(),
            user: Some(MacroUserIdStr::try_from_email("someone@macro.com").unwrap()),
        },
        ..in_process(session)
    };
    let (someone_else, _) = waiting_in_process(&service, &store, &announcer, someone_else).await;
    someone_else.abort();

    let (another_session, _) = waiting_in_process(
        &service,
        &store,
        &announcer,
        in_process(AgentSessionId::new()),
    )
    .await;
    another_session.abort();

    assert_eq!(store.all().len(), 4, "each of those was held");
}

#[tokio::test]
async fn approving_a_connected_app_for_good_covers_all_of_its_tools() {
    let (service, store, _announcer) = service();
    let session = AgentSessionId::new();
    let linear = |call: ToolsCall| {
        let (held, forwarded) = held(session, call, serde_json::json!({ "jsonrpc": "2.0" }));
        (
            HeldCall {
                server_slug: "linear".to_owned(),
                server_name: "Linear".to_owned(),
                ..held
            },
            forwarded,
        )
    };
    let (first, _) = linear(tools_call(None));
    let mut body = service.hold(first).await.unwrap().into_body();
    next_event(&mut body).await;
    service
        .answer(
            session,
            store.only().id,
            ApprovalAnswer::ApproveAndRemember,
            &owner(),
        )
        .await
        .unwrap();

    let (second, forwarded) = linear(ToolsCall {
        name: "create_issue".to_owned(),
        ..tools_call(None)
    });
    let response = service.hold(second).await.unwrap();
    assert_ne!(
        response
            .headers()
            .get(CONTENT_TYPE)
            .map(|value| value.as_bytes()),
        Some(b"text/event-stream".as_slice()),
        "the call is not held"
    );
    forwarded.await.expect("it went straight upstream");
    assert_eq!(store.all().len(), 1, "and nothing was recorded for it");
}

#[tokio::test]
async fn approving_for_good_also_approves_what_that_person_is_already_waiting_on() {
    let (service, store, announcer) = service();
    let session = AgentSessionId::new();
    let (first, first_id) =
        waiting_in_process(&service, &store, &announcer, in_process(session)).await;
    let (second, _) = waiting_in_process(&service, &store, &announcer, in_process(session)).await;
    let other_tool = InProcessCall {
        tool_name: "SendEmail".to_owned(),
        ..in_process(session)
    };
    let (other_tool, other_id) = waiting_in_process(&service, &store, &announcer, other_tool).await;

    service
        .answer(
            session,
            first_id,
            ApprovalAnswer::ApproveAndRemember,
            &owner(),
        )
        .await
        .unwrap();

    assert_eq!(first.await.unwrap().unwrap(), ToolApprovalStatus::Approved);
    assert_eq!(
        tokio::time::timeout(Duration::from_secs(5), second)
            .await
            .expect("the second call to the same tool did not need its own click")
            .unwrap()
            .unwrap(),
        ToolApprovalStatus::Approved
    );
    assert_eq!(
        store.get(other_id).await.unwrap().unwrap().status,
        ToolApprovalStatus::Pending,
        "a call it does not cover still waits"
    );
    other_tool.abort();
}

#[tokio::test]
async fn only_the_owner_approves_for_good_and_never_for_a_bot() {
    let (service, store, announcer) = service();
    let session = AgentSessionId::new();
    let (waiting, id) = waiting_in_process(&service, &store, &announcer, in_process(session)).await;
    assert!(matches!(
        service
            .answer(session, id, ApprovalAnswer::ApproveAndRemember, &asker())
            .await,
        Err(ToolApprovalError::NotOwner)
    ));
    waiting.abort();

    let from_a_bot = InProcessCall {
        prompter: TurnPrompter {
            action_id: AgentActionId::mint(),
            user: None,
        },
        ..in_process(session)
    };
    let (waiting, id) = waiting_in_process(&service, &store, &announcer, from_a_bot).await;
    assert!(
        matches!(
            service
                .answer(session, id, ApprovalAnswer::ApproveAndRemember, &owner())
                .await,
            Err(ToolApprovalError::NobodyToRemember)
        ),
        "there is no person to remember"
    );
    assert_eq!(
        store.get(id).await.unwrap().unwrap().status,
        ToolApprovalStatus::Pending,
        "and the call still waits for a plain answer"
    );
    waiting.abort();
}
