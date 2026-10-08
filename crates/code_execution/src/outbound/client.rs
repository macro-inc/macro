//! Backend bridge. Tool work and UI delivery continue while Deno awaits promises.

use crate::{domain::*, protocol::*};
use futures::{SinkExt, StreamExt};
use std::{sync::Arc, time::Duration};
use tokio::{
    sync::{Semaphore, mpsc},
    task::JoinSet,
    time::{Instant, sleep_until},
};
use tokio_tungstenite::{
    connect_async_with_config,
    tungstenite::{Message, client::IntoClientRequest, protocol::WebSocketConfig},
};
use tokio_util::sync::CancellationToken;

/// Reusable connection configuration and a process-wide host-dispatch limit.
#[derive(Clone)]
pub struct RunnerClient {
    endpoint: String,
    token: ServiceToken,
    per_execution: usize,
    global_calls: Arc<Semaphore>,
}

#[async_trait::async_trait]
impl ProgramExecutor for RunnerClient {
    async fn execute_program(
        &self,
        request: ExecuteRequest,
        dispatcher: Arc<dyn HostDispatcher>,
        cancellation: CancellationToken,
    ) -> Outcome {
        self.execute_inner(request, dispatcher, None, cancellation)
            .await
            .unwrap_or_else(Outcome::from)
    }
}

impl RunnerClient {
    /// Share one client across sessions to share the global host-call budget.
    pub fn new(
        endpoint: String,
        token: ServiceToken,
        per_execution: usize,
        global_calls: usize,
    ) -> Result<Self, rootcause::Report> {
        if !endpoint.starts_with("ws://") && !endpoint.starts_with("wss://") {
            return Err(rootcause::report!(
                "runner endpoint must use ws:// or wss://"
            ));
        }
        if per_execution == 0
            || per_execution > 16
            || global_calls < per_execution
            || global_calls > 1024
        {
            return Err(rootcause::report!("invalid host dispatch concurrency"));
        }
        endpoint.as_str().into_client_request()?;
        Ok(Self {
            endpoint,
            token,
            per_execution,
            global_calls: Arc::new(Semaphore::new(global_calls)),
        })
    }

    /// Execute and stream events to the session backend while the model waits.
    ///
    /// Supply a dispatcher already bound to the authorized actor/session. Drop
    /// this future, close the event receiver, or cancel the token to stop work.
    /// A transport failure means external side effects may have an unknown outcome.
    pub async fn execute(
        &self,
        request: ExecuteRequest,
        dispatcher: Arc<dyn HostDispatcher>,
        events: mpsc::Sender<BackendEvent>,
        cancellation: CancellationToken,
    ) -> Outcome {
        match self
            .execute_inner(request, dispatcher, Some(events), cancellation)
            .await
        {
            Ok(outcome) => outcome,
            Err(error) => error.into(),
        }
    }

    async fn execute_inner(
        &self,
        request: ExecuteRequest,
        dispatcher: Arc<dyn HostDispatcher>,
        events: Option<mpsc::Sender<BackendEvent>>,
        cancellation: CancellationToken,
    ) -> Result<Outcome, ExecutionFailure> {
        let deadline = Instant::now()
            + Duration::from_millis(request.timeout_ms.min(300_000))
            + Duration::from_secs(5);
        let dispatch_cancel = cancellation.child_token();
        let _cancel_on_drop = dispatch_cancel.clone().drop_guard();
        let mut handshake = self
            .endpoint
            .as_str()
            .into_client_request()
            .map_err(transport)?;
        let mut authorization: tokio_tungstenite::tungstenite::http::HeaderValue =
            self.token.authorization().parse().map_err(transport)?;
        authorization.set_sensitive(true);
        handshake
            .headers_mut()
            .insert("authorization", authorization);
        let configuration = WebSocketConfig::default()
            .max_message_size(Some(MAX_WIRE_BYTES))
            .max_frame_size(Some(MAX_WIRE_BYTES));
        let (mut socket, _) = tokio::select! {
            _ = cancellation.cancelled() => return Ok(Outcome::Cancelled),
            _ = observer_closed(&events) => return Ok(Outcome::Cancelled),
            result = tokio::time::timeout(Duration::from_secs(5), connect_async_with_config(handshake, Some(configuration), false)) => result.map_err(transport)?.map_err(transport)?,
        };
        let initial =
            serde_json::to_string(&ClientMessage::Execute { request }).map_err(transport)?;
        if initial.len() > MAX_WIRE_BYTES {
            return Err(ExecutionFailure::new(
                FailureCode::Limit,
                "request exceeded transport limit",
            ));
        }
        tokio::time::timeout(
            Duration::from_secs(2),
            socket.send(Message::Text(initial.into())),
        )
        .await
        .map_err(transport)?
        .map_err(transport)?;
        let local_calls = Arc::new(Semaphore::new(self.per_execution));
        let mut calls = JoinSet::new();
        let (activity, mut activity_rx) = if events.is_some() {
            let (sender, receiver) = mpsc::channel(32);
            (Some(sender), Some(receiver))
        } else {
            (None, None)
        };
        let mut cancel_sent = false;
        let mut cancellation_deadline = deadline;
        let mut run_id = None;
        let mut expected_sequence = 0;
        let mut event_budget = 2048_usize;
        loop {
            tokio::select! {
                biased;
                _ = observer_closed(&events) => return Ok(Outcome::Cancelled),
                _ = cancellation.cancelled(), if !cancel_sent => {
                    cancel_sent = true;
                    cancellation_deadline = Instant::now() + Duration::from_secs(3);
                    calls.abort_all();
                    let cancel = serde_json::to_string(&ClientMessage::Cancel).map_err(transport)?;
                    tokio::time::timeout(Duration::from_secs(2), socket.send(Message::Text(cancel.into()))).await.map_err(transport)?.map_err(transport)?;
                }
                _ = sleep_until(cancellation_deadline) => return Err(ExecutionFailure::new(FailureCode::Transport, "runner did not confirm completion before connection deadline")),
                event = next_activity(&mut activity_rx) => {
                    if let Some(event) = event { publish(&events, event, &mut event_budget)?; }
                }
                reply = calls.join_next(), if !calls.is_empty() => {
                    match reply {
                        Some(Ok(reply)) if !cancel_sent => {
                            let json = serde_json::to_string(&ClientMessage::Reply { reply }).map_err(transport)?;
                            if json.len() > MAX_WIRE_BYTES { return Err(ExecutionFailure::new(FailureCode::Limit, "host reply exceeded transport limit")) }
                            tokio::time::timeout(Duration::from_secs(2), socket.send(Message::Text(json.into()))).await.map_err(transport)?.map_err(transport)?;
                        }
                        Some(Ok(_)) => {},
                        Some(Err(error)) if error.is_cancelled() && cancel_sent => {},
                        Some(Err(_)) => return Err(ExecutionFailure::new(FailureCode::Internal, "host dispatcher task failed")),
                        None => {},
                    }
                }
                message = socket.next() => {
                    let message = message.ok_or_else(|| transport("connection closed"))?.map_err(transport)?;
                    let Message::Text(text) = message else {
                        if matches!(message, Message::Ping(_) | Message::Pong(_)) { continue }
                        return Err(transport("unexpected connection frame"));
                    };
                    match serde_json::from_str::<ServerMessage>(&text).map_err(transport)? {
                        ServerMessage::Rejected { message } => return Err(ExecutionFailure::new(FailureCode::Protocol, message)),
                        ServerMessage::Event { event } => {
                            if event.sequence != expected_sequence || run_id.is_some_and(|id| id != event.run_id) {
                                return Err(ExecutionFailure::new(FailureCode::Protocol, "invalid execution event sequence"));
                            }
                            run_id = Some(event.run_id);
                            expected_sequence += 1;
                            match &event.kind {
                                EventKind::HostCall { call } => {
                                    if cancel_sent { continue }
                                    if calls.len() >= 16 { return Err(ExecutionFailure::new(FailureCode::Limit, "too many pending host calls")) }
                                    calls.spawn(dispatch(
                                        event.run_id, call.clone(), dispatcher.clone(), activity.clone(),
                                        local_calls.clone(), self.global_calls.clone(), dispatch_cancel.clone(),
                                    ));
                                }
                                EventKind::Finished { outcome } => {
                                    let outcome = outcome.clone();
                                    // Flush already-issued call activity before the terminal event.
                                    if let Some(receiver) = &mut activity_rx {
                                        while let Ok(event) = receiver.try_recv() { publish(&events, event, &mut event_budget)?; }
                                    }
                                    publish(&events, BackendEvent::Execution(event), &mut event_budget)?;
                                    return Ok(outcome);
                                }
                                _ => publish(&events, BackendEvent::Execution(event), &mut event_budget)?,
                            }
                        }
                    }
                }
            }
        }
    }
}

async fn dispatch(
    run_id: RunId,
    call: HostCall,
    dispatcher: Arc<dyn HostDispatcher>,
    activity: Option<mpsc::Sender<BackendEvent>>,
    local: Arc<Semaphore>,
    global: Arc<Semaphore>,
    cancellation: CancellationToken,
) -> HostReply {
    let id = call.id;
    let work = async {
        let _local = local.acquire().await.map_err(|_| ())?;
        let _global = global.acquire().await.map_err(|_| ())?;
        let Some(activity) = activity else {
            return Ok(dispatcher
                .dispatch(
                    call,
                    DispatchContext {
                        run_id,
                        cancellation: cancellation.clone(),
                        progress: None,
                    },
                )
                .await);
        };
        activity
            .try_send(BackendEvent::CallStarted {
                run_id,
                call_id: id,
                method: call.method.clone(),
            })
            .map_err(|_| ())?;
        let (progress, mut progress_rx) = mpsc::channel(8);
        let context = DispatchContext {
            run_id,
            cancellation: cancellation.clone(),
            progress: Some(progress),
        };
        let future = dispatcher.dispatch(call, context);
        tokio::pin!(future);
        let result = loop {
            tokio::select! {
                result = &mut future => break result,
                Some(value) = progress_rx.recv() => emit_progress(&activity, run_id, id, value)?,
            }
        };
        while let Ok(value) = progress_rx.try_recv() {
            emit_progress(&activity, run_id, id, value)?;
        }
        activity
            .try_send(BackendEvent::CallFinished {
                run_id,
                call_id: id,
                failed: matches!(result, HostResult::Error { .. }),
            })
            .map_err(|_| ())?;
        Ok::<_, ()>(result)
    };
    let result = tokio::select! {
        biased;
        _ = cancellation.cancelled() => HostResult::Error { message: "execution cancelled".into() },
        result = work => result.unwrap_or_else(|_| HostResult::Error { message: "host activity limit exceeded".into() }),
    };
    HostReply { id, result }
}

fn emit_progress(
    activity: &mpsc::Sender<BackendEvent>,
    run_id: RunId,
    call_id: CallId,
    value: serde_json::Value,
) -> Result<(), ()> {
    if serde_json::to_vec(&value).map_err(|_| ())?.len() > 16 * 1024 {
        return Err(());
    }
    activity
        .try_send(BackendEvent::CallProgress {
            run_id,
            call_id,
            value,
        })
        .map_err(|_| ())
}

fn publish(
    events: &Option<mpsc::Sender<BackendEvent>>,
    event: BackendEvent,
    budget: &mut usize,
) -> Result<(), ExecutionFailure> {
    let Some(events) = events else { return Ok(()) };
    *budget = budget
        .checked_sub(1)
        .ok_or_else(|| ExecutionFailure::new(FailureCode::Limit, "backend event limit exceeded"))?;
    events.try_send(event).map_err(|_| {
        ExecutionFailure::new(FailureCode::Limit, "session event consumer is too slow")
    })
}

async fn observer_closed(events: &Option<mpsc::Sender<BackendEvent>>) {
    match events {
        Some(events) => events.closed().await,
        None => std::future::pending().await,
    }
}

async fn next_activity(
    receiver: &mut Option<mpsc::Receiver<BackendEvent>>,
) -> Option<BackendEvent> {
    match receiver {
        Some(receiver) => receiver.recv().await,
        None => std::future::pending().await,
    }
}

fn transport(_error: impl std::fmt::Display) -> ExecutionFailure {
    ExecutionFailure::new(
        FailureCode::Transport,
        "runner connection failed; in-flight action outcomes may be unknown",
    )
}

#[cfg(test)]
mod test;
