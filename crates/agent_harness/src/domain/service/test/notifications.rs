use super::*;
use crate::domain::model::ReplyOutcome;
use agent_fold::domain::ports::FoldedMessageRepo as _;
use agent_runtime_protocol::domain::notification::{
    ImportPlan, NotificationEvent, input_from_runtime,
};
use agent_session::domain::notifications::*;
use macro_uuid::Uuid;
use std::sync::atomic::{AtomicBool, Ordering};

#[derive(Default)]
struct Outbox {
    pending: Mutex<Vec<PendingNotification>>,
    claimed: Mutex<Option<NotificationBatch>>,
    completed: Mutex<Vec<NotificationOutcome>>,
    fail_ack: AtomicBool,
    fail_renew: AtomicBool,
    renewals: Mutex<Vec<Uuid>>,
    expired: AtomicBool,
    session: Mutex<Option<AgentSessionId>>,
}
impl NotificationStore for Outbox {
    fn pending_sessions(
        &self,
        after: Option<AgentSessionId>,
    ) -> NotificationFuture<'_, Vec<AgentSessionId>> {
        Box::pin(async move {
            let mut sessions: Vec<_> = if self.expired.load(Ordering::SeqCst) {
                self.session.lock().unwrap().iter().copied().collect()
            } else {
                self.pending
                    .lock()
                    .unwrap()
                    .iter()
                    .filter(|row| row.wake)
                    .map(|row| row.session_id)
                    .collect()
            };
            sessions.sort_by_key(AgentSessionId::as_uuid);
            sessions.dedup();
            sessions.retain(|id| after.is_none_or(|cursor| id.as_uuid() > cursor.as_uuid()));
            sessions.truncate(100);
            Ok(sessions)
        })
    }
    fn claim(
        &self,
        session: AgentSessionId,
        real_prompt: bool,
    ) -> NotificationFuture<'_, Option<NotificationBatch>> {
        Box::pin(async move {
            let mut claimed = self.claimed.lock().unwrap();
            if self.expired.swap(false, Ordering::SeqCst)
                && let Some(batch) = claimed.as_mut()
            {
                batch.lease_id = macro_uuid::generate_uuid_v7();
                return Ok(Some(batch.clone()));
            }
            if claimed.is_some() {
                return Ok(None);
            }
            let mut pending = self.pending.lock().unwrap();
            if pending.is_empty() || (!real_prompt && !pending.iter().any(|row| row.wake)) {
                return Ok(None);
            }
            let (selected, waiting): (Vec<_>, Vec<_>) = pending
                .drain(..)
                .partition(|row| row.session_id == session && (real_prompt || row.wake));
            *pending = waiting;
            if selected.is_empty() {
                return Ok(None);
            }
            let batch = NotificationBatch {
                lease_id: macro_uuid::generate_uuid_v7(),
                action_id: AgentActionId::mint(),
                wake: selected.iter().any(|row| row.wake),
                notifications: selected.into_iter().map(|row| row.notification).collect(),
                producer_contexts: vec![],
            };
            *claimed = Some(batch.clone());
            Ok(Some(batch))
        })
    }
    fn bind_action(&self, _: Uuid, action: AgentActionId) -> NotificationFuture<'_, ()> {
        Box::pin(async move {
            if let Some(batch) = self.claimed.lock().unwrap().as_mut() {
                batch.action_id = action;
            }
            Ok(())
        })
    }
    fn defer_until_prompt(&self, _: Uuid) -> NotificationFuture<'_, ()> {
        Box::pin(async {
            if let Some(batch) = self.claimed.lock().unwrap().take() {
                let session_id = self.session.lock().unwrap().unwrap();
                self.pending
                    .lock()
                    .unwrap()
                    .extend(batch.notifications.into_iter().map(|notification| {
                        PendingNotification {
                            session_id,
                            notification,
                            dedupe_key: String::new(),
                            wake: false,
                            producer_context: Default::default(),
                        }
                    }));
            }
            Ok(())
        })
    }
    fn renew(&self, lease: Uuid) -> NotificationFuture<'_, ()> {
        Box::pin(async move {
            self.renewals.lock().unwrap().push(lease);
            if self.fail_renew.load(Ordering::SeqCst) {
                return Err(rootcause::report!("renew unavailable").into());
            }
            Ok(())
        })
    }
    fn complete(&self, lease: Uuid, outcome: NotificationOutcome) -> NotificationFuture<'_, ()> {
        Box::pin(async move {
            if self.fail_ack.load(Ordering::SeqCst) {
                return Err(rootcause::report!("ack unavailable").into());
            }
            let mut claimed = self.claimed.lock().unwrap();
            if claimed
                .as_ref()
                .is_some_and(|batch| batch.lease_id == lease)
            {
                claimed.take();
                self.completed.lock().unwrap().push(outcome);
            }
            Ok(())
        })
    }
    fn release(&self, _: Uuid) -> NotificationFuture<'_, ()> {
        Box::pin(async {
            self.expired.store(true, Ordering::SeqCst);
            Ok(())
        })
    }
    fn enqueue(&self, notification: PendingNotification) -> NotificationFuture<'_, ()> {
        Box::pin(async move {
            *self.session.lock().unwrap() = Some(notification.session_id);
            self.pending.lock().unwrap().push(notification);
            Ok(())
        })
    }
}

fn harness_with_outbox(outbox: Arc<Outbox>) -> (TestBench, TurnSignals) {
    harness_with_journal_and_policy(
        PromptContextMock::default(),
        PromptComposerMock::default(),
        KindDefaultPolicies,
        HarnessDefaultCodingAgents,
        PromptMentionsMock::new(),
        EgressProvisionerMock::new(),
        None,
        None,
        Some(outbox),
        None,
    )
}
async fn event(outbox: &Outbox, session: AgentSessionId, subject: &str, wake: bool) {
    outbox
        .enqueue(
            PendingNotification::new(ProduceNotification {
                session_id: session,
                subject_id: subject.into(),
                // Any event but `app.connected`, which may continue the
                // owner's own work (see `app_connected`).
                event: NotificationEvent::ImportPlanned(ImportPlan {
                    source: Default::default(),
                    copy: 1,
                    task_lists: 0,
                    skipped: 0,
                    by_hand: 0,
                }),
                dedupe_key: None,
                wake,
            })
            .unwrap(),
        )
        .await
        .unwrap();
}

#[tokio::test]
async fn discovery_moves_past_a_full_page_of_unreachable_sessions() {
    let outbox = Arc::new(Outbox::default());
    let ((service, _, containers, _, _), mut turns) = harness_with_outbox(outbox.clone());
    let id = AgentSessionId::new();
    let container = live_session(&service, &containers, id).await;
    turns.settled(id).await;
    for value in 1..=100 {
        event(
            &outbox,
            AgentSessionId::new_from_uuid(Uuid::from_u128(value)),
            "waiting",
            true,
        )
        .await;
    }
    event(&outbox, id, "reachable", true).await;
    service.recover_notifications().await.unwrap();
    assert_eq!(prompts(&container.agent()).len(), 1);
    assert_eq!(outbox.pending.lock().unwrap().len(), 101);
    service.recover_notifications().await.unwrap();
    container.agent().wait_for_requests(4).await;
    assert_eq!(prompts(&container.agent()).len(), 2);
    assert_eq!(outbox.pending.lock().unwrap().len(), 100);
    container.agent().completes_prompt().await;
    turns.settled(id).await;
    event(&outbox, id, "after wrap", true).await;
    service.recover_notifications().await.unwrap();
    assert_eq!(prompts(&container.agent()).len(), 2);
    service.recover_notifications().await.unwrap();
    container.agent().wait_for_requests(5).await;
    assert_eq!(prompts(&container.agent()).len(), 3);
}

#[tokio::test]
async fn events_behind_busy_turn_coalesce_with_system_authority_and_no_user_message() {
    let outbox = Arc::new(Outbox::default());
    let ((service, repo, containers, _, _), mut turns) = harness_with_outbox(outbox.clone());
    let id = AgentSessionId::new();
    let open = service.execute(id, HarnessCommand::Open(open_command()));
    let drive = async {
        containers.first_spawned().await;
        let container = containers.container(id).unwrap();
        complete_session_handshake(&container).await;
        container.agent().wait_for_requests(3).await;
        container
    };
    let (opened, container) = tokio::join!(open, drive);
    opened.unwrap();
    event(&outbox, id, "one", true).await;
    event(&outbox, id, "two", true).await;
    service.recover_notifications().await.unwrap();
    assert_eq!(
        prompts(&container.agent()).len(),
        1,
        "busy sessions do not accept overlapping invocations"
    );
    container.agent().completes_prompt().await;
    turns.settled(id).await;
    container.agent().wait_for_requests(4).await;
    assert_eq!(prompts(&container.agent()).len(), 2);
    let prompter = repo.turn_prompter(id).await.unwrap().unwrap();
    assert_eq!(
        prompter.kind,
        agent_session::domain::model::PrompterKind::System
    );
    assert!(prompter.acting_user().is_none());
    let requests = container.agent().received_frames();
    let input = requests
        .iter()
        .find_map(|frame| input_from_runtime(&ToRuntimeMessage::Acp(AcpMessage(frame.clone()))))
        .unwrap();
    assert_eq!(input.notifications.len(), 2);
    let messages = FoldedMessageService::new(repo.clone())
        .messages(id)
        .await
        .unwrap();
    assert_eq!(
        messages
            .iter()
            .filter(|message| matches!(
                message.author,
                agent_fold::domain::model::Author::User { .. }
            ))
            .count(),
        1
    );
}

#[tokio::test]
async fn quiet_event_waits_for_user_prompt_and_keeps_the_user_as_prompter() {
    let outbox = Arc::new(Outbox::default());
    let ((service, repo, containers, _, _), mut turns) = harness_with_outbox(outbox.clone());
    let id = AgentSessionId::new();
    let container = live_session(&service, &containers, id).await;
    turns.settled(id).await;
    event(&outbox, id, "quiet", false).await;
    service.recover_notifications().await.unwrap();
    assert_eq!(prompts(&container.agent()).len(), 1);
    let command = forward_message("continue my request");
    let actor = command.actor.clone();
    service
        .execute(id, HarnessCommand::Deliver(command))
        .await
        .unwrap();
    container.agent().wait_for_requests(4).await;
    let prompter = repo.turn_prompter(id).await.unwrap().unwrap();
    assert_eq!(
        prompter.kind,
        agent_session::domain::model::PrompterKind::User
    );
    assert_eq!(prompter.user, actor);
    let input = container
        .agent()
        .received_frames()
        .iter()
        .find_map(|frame| input_from_runtime(&ToRuntimeMessage::Acp(AcpMessage(frame.clone()))))
        .unwrap();
    assert!(!input.system_turn);
    assert_eq!(input.notifications.len(), 1);
}

#[tokio::test]
async fn failed_acknowledgment_retries_without_starting_another_turn() {
    let outbox = Arc::new(Outbox::default());
    let ((service, _, containers, _, _), mut turns) = harness_with_outbox(outbox.clone());
    let id = AgentSessionId::new();
    let container = live_session(&service, &containers, id).await;
    turns.settled(id).await;
    event(&outbox, id, "one", true).await;
    service.recover_notifications().await.unwrap();
    container.agent().wait_for_requests(4).await;
    outbox.fail_ack.store(true, Ordering::SeqCst);
    container.agent().completes_prompt().await;
    turns.settled(id).await;
    // This command is serialized after the end signal, so no polling is needed.
    service
        .execute(id, HarnessCommand::DrainNotifications)
        .await
        .unwrap_err();
    assert_eq!(prompts(&container.agent()).len(), 2);
    outbox.fail_ack.store(false, Ordering::SeqCst);
    service.recover_notifications().await.unwrap();
    assert_eq!(
        outbox.completed.lock().unwrap().as_slice(),
        &[NotificationOutcome::Delivered]
    );
    assert_eq!(prompts(&container.agent()).len(), 2);
}

#[tokio::test]
async fn recovery_waits_for_running_delivery_without_reprompting() {
    let outbox = Arc::new(Outbox::default());
    let ((service, repo, containers, _, _), mut turns) = harness_with_outbox(outbox.clone());
    let id = AgentSessionId::new();
    let container = live_session(&service, &containers, id).await;
    turns.settled(id).await;
    event(&outbox, id, "one", true).await;
    service.recover_notifications().await.unwrap();
    container.agent().wait_for_requests(4).await;
    service.inner.notification_batches.remove(&id);
    service.inner.busy.clear(id);
    outbox.expired.store(true, Ordering::SeqCst);
    service.recover_notifications().await.unwrap();
    assert_eq!(prompts(&container.agent()).len(), 2);
    assert_eq!(
        repo.turn_prompter(id).await.unwrap().unwrap().kind,
        agent_session::domain::model::PrompterKind::System
    );
    container.agent().completes_prompt().await;
    turns.settled(id).await;
    service
        .execute(id, HarnessCommand::DrainNotifications)
        .await
        .unwrap();
    assert_eq!(
        outbox.completed.lock().unwrap().as_slice(),
        &[NotificationOutcome::Delivered]
    );
}

#[tokio::test]
async fn recovered_system_identity_overrides_a_legacy_wire_owner() {
    let outbox = Arc::new(Outbox::default());
    let ((service, repo, containers, _, _), mut turns) = harness_with_outbox(outbox.clone());
    let id = AgentSessionId::new();
    let container = live_session(&service, &containers, id).await;
    turns.settled(id).await;
    let command = forward_message("legacy review outcome");
    let action = command.id;
    assert!(command.actor.is_some());
    service
        .execute(id, HarnessCommand::Deliver(command))
        .await
        .unwrap();
    container.agent().wait_for_requests(4).await;
    event(&outbox, id, "legacy review", true).await;
    let batch = outbox.claim(id, false).await.unwrap().unwrap();
    outbox.bind_action(batch.lease_id, action).await.unwrap();
    // PostgreSQL's legacy claim already conditionally demoted this action.
    repo.set_turn_prompter(
        id,
        &agent_session::domain::model::TurnPrompter {
            kind: agent_session::domain::model::PrompterKind::System,
            action_id: action,
            user: None,
            client: None,
        },
    )
    .await
    .unwrap();
    service.inner.busy.clear(id);
    outbox.expired.store(true, Ordering::SeqCst);
    service.recover_notifications().await.unwrap();
    let recovered = service.inner.busy.turn(id).unwrap();
    assert_eq!(recovered.action_id, action);
    assert!(recovered.actor.is_none());
    assert_eq!(prompts(&container.agent()).len(), 2);
}

#[tokio::test]
async fn quiet_batch_recovery_keeps_its_real_prompt_identity() {
    for opaque in [false, true] {
        let outbox = Arc::new(Outbox::default());
        let ((service, repo, containers, _, _), mut turns) = harness_with_outbox(outbox.clone());
        let id = AgentSessionId::new();
        let container = live_session(&service, &containers, id).await;
        turns.settled(id).await;
        event(&outbox, id, "quiet", false).await;
        let command = forward_message("owner request");
        let original_id = command.id;
        let original_actor = command.actor.clone();
        service
            .execute(id, HarnessCommand::Deliver(command))
            .await
            .unwrap();
        container.agent().wait_for_requests(4).await;
        assert_eq!(
            outbox.claimed.lock().unwrap().as_ref().unwrap().action_id,
            original_id
        );
        service.inner.notification_batches.remove(&id);
        if opaque {
            outbox
                .claimed
                .lock()
                .unwrap()
                .as_mut()
                .unwrap()
                .notifications
                .clear();
        }
        service.inner.busy.clear(id);
        outbox.expired.store(true, Ordering::SeqCst);
        service
            .execute(id, HarnessCommand::Deliver(forward_message("next request")))
            .await
            .unwrap();
        assert_eq!(prompts(&container.agent()).len(), 2);
        let prompter = repo.turn_prompter(id).await.unwrap().unwrap();
        assert_eq!(prompter.action_id, original_id);
        assert_eq!(prompter.user, original_actor);
        assert_eq!(service.inner.busy.turn(id).unwrap().actor, original_actor);
        assert_eq!(
            prompter.kind,
            agent_session::domain::model::PrompterKind::User
        );
        container.agent().completes_prompt().await;
        turns.settled(id).await;
        container.agent().wait_for_requests(5).await;
        assert_eq!(prompts(&container.agent()).len(), 3);
    }
}

#[tokio::test]
async fn silent_delivery_acknowledges_without_assistant_message_or_settled_notifications() {
    let outbox = Arc::new(Outbox::default());
    let ((service, repo, containers, _, _), mut turns) = harness_with_outbox(outbox.clone());
    let id = AgentSessionId::new();
    let container = live_session(&service, &containers, id).await;
    turns.settled(id).await;
    event(&outbox, id, "one", true).await;
    service.recover_notifications().await.unwrap();
    container.agent().wait_for_requests(4).await;
    let message_count = FoldedMessageService::new(repo.clone())
        .messages(id)
        .await
        .unwrap()
        .len();
    let lifecycle_count = turns.lifecycle().len();
    let push_count = turns.notifier.notified().len();
    container.agent().sends_raw(agent_client_protocol::RawJsonRpcMessage::notification("session/update".into(), serde_json::json!({
        "sessionId":"acp-test", "update":{"sessionUpdate":"agent_message_chunk", "content":{"type":"text","text":"<noop/>"}}
    })).unwrap());
    container.agent().completes_prompt().await;
    turns.settled(id).await;
    service
        .execute(id, HarnessCommand::DrainNotifications)
        .await
        .unwrap();
    assert_eq!(
        outbox.completed.lock().unwrap().as_slice(),
        &[NotificationOutcome::Noop]
    );
    assert_eq!(
        FoldedMessageService::new(repo)
            .messages(id)
            .await
            .unwrap()
            .len(),
        message_count
    );
    assert_eq!(turns.lifecycle().len(), lifecycle_count);
    assert_eq!(turns.notifier.notified().len(), push_count);
}

#[tokio::test]
async fn background_recovery_reconciles_a_quiet_user_turn_before_new_waking_events() {
    let outbox = Arc::new(Outbox::default());
    let ((service, repo, containers, _, _), mut turns) = harness_with_outbox(outbox.clone());
    let id = AgentSessionId::new();
    let container = live_session(&service, &containers, id).await;
    turns.settled(id).await;
    event(&outbox, id, "quiet", false).await;
    let command = forward_message("owner request");
    let original = command.id;
    service
        .execute(id, HarnessCommand::Deliver(command))
        .await
        .unwrap();
    container.agent().wait_for_requests(4).await;
    service.inner.notification_batches.remove(&id);
    service.inner.busy.clear(id);
    outbox.expired.store(true, Ordering::SeqCst);
    event(&outbox, id, "new wake", true).await;
    service.recover_notifications().await.unwrap();
    assert_eq!(prompts(&container.agent()).len(), 2);
    assert_eq!(
        repo.turn_prompter(id).await.unwrap().unwrap().action_id,
        original
    );
    assert!(service.inner.busy.turn(id).is_some());
    container.agent().completes_prompt().await;
    turns.settled(id).await;
    container.agent().wait_for_requests(5).await;
    assert_eq!(prompts(&container.agent()).len(), 3);
    assert_eq!(
        repo.turn_prompter(id).await.unwrap().unwrap().kind,
        agent_session::domain::model::PrompterKind::System
    );
}

#[tokio::test]
async fn an_unaccepted_quiet_attempt_defers_without_waking_until_a_real_prompt() {
    let outbox = Arc::new(Outbox::default());
    let ((service, repo, containers, _, _), mut turns) = harness_with_outbox(outbox.clone());
    let id = AgentSessionId::new();
    let container = live_session(&service, &containers, id).await;
    turns.settled(id).await;
    event(&outbox, id, "quiet", false).await;
    let original = outbox.claim(id, true).await.unwrap().unwrap();
    outbox.expired.store(true, Ordering::SeqCst);
    service.recover_notifications().await.unwrap();
    assert_eq!(prompts(&container.agent()).len(), 1);
    assert!(outbox.claimed.lock().unwrap().is_none());
    service
        .execute(
            id,
            HarnessCommand::Deliver(forward_message("owner request")),
        )
        .await
        .unwrap();
    container.agent().wait_for_requests(4).await;
    let input = container
        .agent()
        .received_frames()
        .iter()
        .find_map(|frame| input_from_runtime(&ToRuntimeMessage::Acp(AcpMessage(frame.clone()))))
        .unwrap();
    assert_eq!(input.notifications[0].id, original.notifications[0].id);
    assert!(!input.system_turn);
    assert_eq!(
        repo.turn_prompter(id).await.unwrap().unwrap().kind,
        agent_session::domain::model::PrompterKind::User
    );
}

#[tokio::test]
async fn active_leases_reconcile_lost_completion_callbacks_and_late_noop_stays_silent() {
    let outbox = Arc::new(Outbox::default());
    let ((service, repo, containers, _, _), mut turns) = harness_with_outbox(outbox.clone());
    let id = AgentSessionId::new();
    let container = live_session(&service, &containers, id).await;
    turns.settled(id).await;
    event(&outbox, id, "one", true).await;
    service.recover_notifications().await.unwrap();
    container.agent().wait_for_requests(4).await;
    let action = service
        .inner
        .notification_batches
        .get(&id)
        .unwrap()
        .action_id;
    let turn = service.inner.busy.turn(id).unwrap().turn;
    let lifecycle_count = turns.lifecycle().len();
    let push_count = turns.notifier.notified().len();
    // Persist the terminal evidence without calling the observer, as when a
    // replica commits the response just before another replica takes over.
    repo.extend_log(agent_fold::testing::parse_log_as(id, &format!(r#"
{{"direction":"to_server","content":{{"type":"acp","jsonrpc":"2.0","method":"session/update","params":{{"sessionId":"acp-test","update":{{"sessionUpdate":"agent_message_chunk","content":{{"type":"text","text":"<noop/>"}}}}}}}}}}
{{"direction":"to_server","content":{{"type":"acp","jsonrpc":"2.0","id":"{action}","result":{{"stopReason":"end_turn"}}}}}}
"#)));
    service.recover_notifications().await.unwrap();
    assert_eq!(
        outbox.completed.lock().unwrap().as_slice(),
        &[NotificationOutcome::Noop]
    );
    assert!(service.inner.busy.turn(id).is_none());
    assert_eq!(prompts(&container.agent()).len(), 2);
    service
        .execute(
            id,
            HarnessCommand::Turn(TurnSignal::TurnEnded {
                turn,
                action_id: Some(action),
                stop: agent_fold::domain::model::StopReason::EndTurn,
                last_text: None,
                notification_noop: true,
            }),
        )
        .await
        .unwrap();
    assert_eq!(turns.lifecycle().len(), lifecycle_count);
    assert_eq!(turns.notifier.notified().len(), push_count);
}

#[tokio::test]
async fn recovering_a_real_prompt_completion_resolves_its_reply_and_deduplicates_the_observer() {
    let outbox = Arc::new(Outbox::default());
    let ((service, repo, containers, announcer, _), mut turns) =
        harness_with_outbox(outbox.clone());
    let id = AgentSessionId::new();
    let container = live_session(&service, &containers, id).await;
    turns.settled(id).await;
    event(&outbox, id, "quiet", false).await;
    service
        .execute(
            id,
            HarnessCommand::Deliver(forward_message("owner request")),
        )
        .await
        .unwrap();
    container.agent().wait_for_requests(4).await;
    let action = service
        .inner
        .notification_batches
        .get(&id)
        .unwrap()
        .action_id;
    let turn = service.inner.busy.turn(id).unwrap().turn;
    let lifecycle_count = turns.lifecycle().len();
    let reply_count = announcer.resolved().len();
    repo.extend_log(agent_fold::testing::parse_log_as(id, &format!(r#"
{{"direction":"to_server","content":{{"type":"acp","jsonrpc":"2.0","method":"session/update","params":{{"sessionId":"acp-test","update":{{"sessionUpdate":"agent_message_chunk","content":{{"type":"text","text":"All done."}}}}}}}}}}
{{"direction":"to_server","content":{{"type":"acp","jsonrpc":"2.0","id":"{action}","result":{{"stopReason":"end_turn"}}}}}}
"#)));
    service.recover_notifications().await.unwrap();
    assert_eq!(announcer.resolved().len(), reply_count + 1);
    assert_eq!(turns.lifecycle().len(), lifecycle_count + 2);
    let lifecycle_count = turns.lifecycle().len();
    service
        .execute(
            id,
            HarnessCommand::Turn(TurnSignal::TurnEnded {
                turn,
                action_id: Some(action),
                stop: agent_fold::domain::model::StopReason::EndTurn,
                last_text: Some("All done.".into()),
                notification_noop: false,
            }),
        )
        .await
        .unwrap();
    assert_eq!(announcer.resolved().len(), reply_count + 1);
    assert_eq!(turns.lifecycle().len(), lifecycle_count);
    assert_eq!(
        outbox.completed.lock().unwrap().as_slice(),
        &[NotificationOutcome::Delivered]
    );
}

#[tokio::test]
async fn recovering_an_interrupted_real_prompt_cleans_up_its_pending_reply() {
    let outbox = Arc::new(Outbox::default());
    let ((service, repo, containers, announcer, _), mut turns) =
        harness_with_outbox(outbox.clone());
    let id = AgentSessionId::new();
    let container = live_session(&service, &containers, id).await;
    turns.settled(id).await;
    event(&outbox, id, "quiet", false).await;
    service
        .execute(
            id,
            HarnessCommand::Deliver(forward_message("owner request")),
        )
        .await
        .unwrap();
    container.agent().wait_for_requests(4).await;
    let reply_count = announcer.resolved().len();
    repo.extend_log(agent_fold::testing::parse_log_as(
        id,
        r#"{"direction":"to_server","content":{"type":"event","event":"disconnected"}}"#,
    ));
    service.recover_notifications().await.unwrap();
    assert_eq!(announcer.resolved().len(), reply_count + 1);
    assert!(matches!(
        announcer.resolved().last().unwrap().outcome,
        ReplyOutcome::Failed
    ));
    assert!(service.inner.busy.turn(id).is_none());
    assert!(outbox.claimed.lock().unwrap().is_none());
    assert_eq!(prompts(&container.agent()).len(), 2);
}

#[tokio::test(start_paused = true)]
async fn a_blocked_worker_does_not_block_discovery_or_renewal_or_queue_duplicate_drains() {
    let outbox = Arc::new(Outbox::default());
    let ((service, _, containers, _, _), mut turns) = harness_with_outbox(outbox.clone());
    let blocked = AgentSessionId::new_from_uuid(Uuid::from_u128(1));
    let blocked_open = service.enqueue(blocked, HarnessCommand::Open(open_command()), true);
    containers.first_spawned().await;
    let id = AgentSessionId::new();
    let opened = service.enqueue(id, HarnessCommand::Open(open_command()), true);
    let container = containers.wait_for_spawn(id).await;
    complete_handshake(&container).await;
    opened.await.unwrap();
    turns.settled(id).await;
    event(&outbox, blocked, "blocked", true).await;
    event(&outbox, id, "available", true).await;
    service.recover_notifications().await.unwrap();
    assert_eq!(prompts(&container.agent()).len(), 2);
    let pending = service.inner.notification_drains.lock().await[&blocked].clone();
    outbox.fail_renew.store(true, Ordering::SeqCst);
    service.recover_notifications().await.unwrap();
    assert_eq!(outbox.renewals.lock().unwrap().len(), 1);
    assert!(pending.ptr_eq(&service.inner.notification_drains.lock().await[&blocked]));
    // Finish the blocked command using its real transport handshake.
    complete_handshake(&containers.container(blocked).unwrap()).await;
    blocked_open.await.unwrap();
}

#[tokio::test]
async fn a_settled_import_wakes_an_idle_session_with_its_final_report() {
    use agent_runtime_protocol::domain::notification::{
        ImportOutcome, ImportSettlement, ImportWorkspace, ReviewSettlement,
    };
    let outbox = Arc::new(Outbox::default());
    let ((service, repo, containers, _, _), mut turns) = harness_with_outbox(outbox.clone());
    let id = AgentSessionId::new();
    let container = live_session(&service, &containers, id).await;
    turns.settled(id).await;
    let review = Uuid::now_v7();
    outbox
        .enqueue(
            PendingNotification::new(ProduceNotification {
                session_id: id,
                subject_id: review.to_string(),
                event: NotificationEvent::ReviewSettled(ReviewSettlement::Import {
                    import: ImportSettlement {
                        source: ImportWorkspace::Notion,
                        outcome: ImportOutcome::Completed,
                        error: None,
                        imported: 3,
                        planned: 3,
                        documents: 3,
                        databases: 0,
                        database_rows: 0,
                        task_lists: 0,
                        task_rows: 0,
                        skipped: 1,
                        not_written: 0,
                        shared_with_team: 0,
                        already_in_macro: 0,
                        waiting_on_teammates: 0,
                        root_folder_id: None,
                        failures: Vec::new(),
                        hand_items: Vec::new(),
                    },
                }),
                dedupe_key: None,
                wake: true,
            })
            .unwrap(),
        )
        .await
        .unwrap();

    service.recover_notifications().await.unwrap();
    container.agent().wait_for_requests(4).await;

    let prompt = prompts(&container.agent());
    let ContentBlock::Text(context) = &prompt.last().unwrap()[0] else {
        panic!("the events lead the prompt");
    };
    assert!(
        context.text.contains(&format!(
            "<m-notification kind=\"review.settled\" subject=\"{review}\""
        )),
        "{}",
        context.text
    );
    assert!(
        context
            .text
            .contains("&quot;outcome&quot;:&quot;completed&quot;"),
        "{}",
        context.text
    );
    let prompter = repo.turn_prompter(id).await.unwrap().unwrap();
    assert_eq!(
        prompter.kind,
        agent_session::domain::model::PrompterKind::System
    );
}

/// A live session whose owner's first turn ends with the agent's `reply`.
async fn owner_session_answered(
    service: &TestHarness,
    containers: &MockContainerManager,
    id: AgentSessionId,
    reply: &str,
) -> ContainerMock {
    let open = service.execute(id, HarnessCommand::Open(open_command()));
    let drive = async {
        containers.first_spawned().await;
        let container = containers.container(id).unwrap();
        complete_session_handshake(&container).await;
        container.agent().wait_for_requests(3).await;
        container.agent().sends_raw(
            agent_client_protocol::RawJsonRpcMessage::notification(
                "session/update".to_owned(),
                serde_json::json!({
                    "sessionId": "acp-test",
                    "update": {
                        "sessionUpdate": "agent_message_chunk",
                        "content": {"type": "text", "text": reply}
                    }
                }),
            )
            .unwrap(),
        );
        container.agent().completes_prompt().await;
        container
    };
    let (opened, container) = tokio::join!(open, drive);
    opened.unwrap();
    container
}

const ASKS_FOR_CONFLUENCE: &str = "Confluence isn't connected yet. Connect it below.\n\n<m-connect-app>{\"appSlug\":\"confluence\",\"name\":\"Confluence\"}</m-connect-app>";

/// The owner connecting an app wakes the session with an `app.connected`.
async fn app_connected(outbox: &Outbox, session: AgentSessionId) {
    outbox
        .enqueue(
            PendingNotification::new(ProduceNotification {
                session_id: session,
                subject_id: "confluence".into(),
                event: NotificationEvent::AppConnected {
                    app: "Confluence".into(),
                },
                dedupe_key: None,
                wake: true,
            })
            .unwrap(),
        )
        .await
        .unwrap();
}

/// The prompter of the turn a woken session runs once it has been prompted
/// `requests` times in all.
async fn woken_prompter(
    service: &TestHarness,
    repo: &InMemoryAgentSessionRepo,
    container: &ContainerMock,
    id: AgentSessionId,
    requests: usize,
) -> agent_session::domain::model::TurnPrompter {
    service.recover_notifications().await.unwrap();
    container.agent().wait_for_requests(requests).await;
    let input = container
        .agent()
        .received_frames()
        .iter()
        .filter_map(|frame| input_from_runtime(&ToRuntimeMessage::Acp(AcpMessage(frame.clone()))))
        .next_back()
        .unwrap();
    assert!(input.system_turn, "the wake has no human prompt");
    repo.turn_prompter(id).await.unwrap().unwrap()
}

/// Continuing after connecting from the agent's connect card: the turn that
/// asked was the owner's, so the continuation spends the owner's access as
/// a program would, and the owner's own calls are not held as a bot's.
#[tokio::test]
async fn an_app_connected_after_the_owners_turn_acts_for_the_owner() {
    let outbox = Arc::new(Outbox::default());
    let ((service, repo, containers, _, _), mut turns) = harness_with_outbox(outbox.clone());
    let id = AgentSessionId::new();
    let container = owner_session_answered(&service, &containers, id, ASKS_FOR_CONFLUENCE).await;
    turns.settled(id).await;
    let owner = sender();
    assert_eq!(
        repo.turn_prompter(id).await.unwrap().unwrap().acting_user(),
        Some(&owner),
        "the owner prompted the turn that asked for the app"
    );
    app_connected(&outbox, id).await;
    let prompter = woken_prompter(&service, &repo, &container, id, 4).await;
    assert_eq!(
        prompter.kind,
        agent_session::domain::model::PrompterKind::Program,
        "the owner's access, never the owner's word"
    );
    assert_eq!(prompter.acting_user(), Some(&owner));
    assert_eq!(service.inner.busy.turn(id).unwrap().actor, Some(owner));
}

/// The continuation interrupted mid-turn (the runtime disconnected while
/// one of its calls waited) is sent again as the same turn, and keeps the
/// owner's access instead of falling back to acting for nobody.
#[tokio::test]
async fn an_interrupted_continuation_resent_still_acts_for_the_owner() {
    let outbox = Arc::new(Outbox::default());
    let ((service, repo, containers, _, _), mut turns) = harness_with_outbox(outbox.clone());
    let id = AgentSessionId::new();
    let container = owner_session_answered(&service, &containers, id, ASKS_FOR_CONFLUENCE).await;
    turns.settled(id).await;
    app_connected(&outbox, id).await;
    let first = woken_prompter(&service, &repo, &container, id, 4).await;
    assert_eq!(
        first.kind,
        agent_session::domain::model::PrompterKind::Program
    );
    repo.extend_log(agent_fold::testing::parse_log_as(
        id,
        r#"{"direction":"to_server","content":{"type":"event","event":"disconnected"}}"#,
    ));
    service.inner.notification_batches.remove(&id);
    service.inner.busy.clear(id);
    outbox.expired.store(true, Ordering::SeqCst);
    let resent = woken_prompter(&service, &repo, &container, id, 5).await;
    assert_eq!(
        resent.action_id, first.action_id,
        "the same turn, sent again"
    );
    assert_eq!(
        resent.kind,
        agent_session::domain::model::PrompterKind::Program
    );
    assert_eq!(resent.acting_user(), Some(&sender()));
    assert_eq!(service.inner.busy.turn(id).unwrap().actor, Some(sender()));
}

/// Connecting an app is not the owner's word on what somebody else asked
/// for: continuing another person's turn acts for nobody, so its calls on
/// the owner's access still wait for the owner.
#[tokio::test]
async fn an_app_connected_after_someone_elses_turn_acts_for_nobody() {
    let outbox = Arc::new(Outbox::default());
    let ((service, repo, containers, _, _), mut turns) = harness_with_outbox(outbox.clone());
    let id = AgentSessionId::new();
    let container = owner_session_answered(&service, &containers, id, ASKS_FOR_CONFLUENCE).await;
    turns.settled(id).await;
    service
        .execute(
            id,
            HarnessCommand::Deliver(forward_message("list my spaces")),
        )
        .await
        .unwrap();
    container.agent().wait_for_requests(4).await;
    container.agent().completes_prompt().await;
    turns.settled(id).await;
    assert_ne!(
        repo.turn_prompter(id).await.unwrap().unwrap().acting_user(),
        Some(&sender())
    );
    app_connected(&outbox, id).await;
    let prompter = woken_prompter(&service, &repo, &container, id, 5).await;
    assert_eq!(
        prompter.kind,
        agent_session::domain::model::PrompterKind::System
    );
    assert!(prompter.acting_user().is_none());
}

/// A wake that carries any other event beside the connection acts for
/// nobody: only the connection is the owner's own report.
#[tokio::test]
async fn an_app_connected_batched_with_another_event_acts_for_nobody() {
    let outbox = Arc::new(Outbox::default());
    let ((service, repo, containers, _, _), mut turns) = harness_with_outbox(outbox.clone());
    let id = AgentSessionId::new();
    let container = owner_session_answered(&service, &containers, id, ASKS_FOR_CONFLUENCE).await;
    turns.settled(id).await;
    app_connected(&outbox, id).await;
    event(&outbox, id, "import", true).await;
    let prompter = woken_prompter(&service, &repo, &container, id, 4).await;
    assert_eq!(
        prompter.kind,
        agent_session::domain::model::PrompterKind::System
    );
    assert!(prompter.acting_user().is_none());
}

/// A connect button the owner's latest turn did not offer: the turn that
/// asked for the app is an older one, maybe somebody else's, so the
/// continuation acts for nobody.
#[tokio::test]
async fn an_app_connected_the_owners_latest_turn_did_not_ask_for_acts_for_nobody() {
    let outbox = Arc::new(Outbox::default());
    let ((service, repo, containers, _, _), mut turns) = harness_with_outbox(outbox.clone());
    let id = AgentSessionId::new();
    let container = owner_session_answered(&service, &containers, id, "Here are your tasks.").await;
    turns.settled(id).await;
    assert_eq!(
        repo.turn_prompter(id).await.unwrap().unwrap().acting_user(),
        Some(&sender())
    );
    app_connected(&outbox, id).await;
    let prompter = woken_prompter(&service, &repo, &container, id, 4).await;
    assert_eq!(
        prompter.kind,
        agent_session::domain::model::PrompterKind::System
    );
    assert!(prompter.acting_user().is_none());
}

#[test]
fn connect_buttons_reads_each_buttons_app() {
    assert_eq!(
        crate::domain::app_connections::connect_buttons(&format!(
            "{ASKS_FOR_CONFLUENCE} or <m-connect-app>{{\"appSlug\":\"confluence_data_center\"}}</m-connect-app> <m-connect-app>not json</m-connect-app>"
        )),
        vec!["confluence".to_owned(), "confluence_data_center".to_owned()]
    );
}
