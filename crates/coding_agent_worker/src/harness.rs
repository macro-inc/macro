//! The harness child process and the bridge between its stdio and the
//! gateway channel.
//!
//! The bridge is a line relay: every line the agent writes becomes one ACP
//! message to the service, and every ACP message from the service becomes
//! one line on the agent's stdin. Owning the relay (rather than running the
//! agent through the SDK's client) is what lets a self-update stop it at a
//! line boundary and hand the still-running agent to the next process image.

use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use crate::config::Harness;
use crate::outbound::acp_probe::{ProbeError, ProbeSubprocess, probe_subprocess};
use crate::outbound::acp_process::{AcpProcess, AgentEvent, AttachedAgent, RunningAgent};
use crate::self_knowledge::SelfKnowledge;
use crate::turns::ActiveTurns;
use agent_client_protocol::{LineDirection, RawJsonRpcMessage};
use agent_runtime_protocol::domain::connection::{
    ConnectionError, ModelProbeHandler, RuntimeChannel,
};
use agent_runtime_protocol::domain::schema::v0::{
    AcpMessage, ModelProbeResult, SystemEvent, ToRuntimeMessage, ToServerMessage,
};
use tokio::sync::oneshot;
use tokio::task::JoinSet;

#[cfg(test)]
mod test;

const MODEL_PROBE_TIMEOUT: Duration = Duration::from_secs(10);

/// How long the relay may take to settle the agent's pipes and flush the
/// socket when handing the agent off.
#[cfg(unix)]
const HANDOFF_TIMEOUT: Duration = Duration::from_secs(10);

/// Why the bridge ended.
#[derive(Debug, thiserror::Error)]
pub enum BridgeError {
    /// The service connection closed before the harness could be announced.
    #[error("the service connection closed before the harness was announced")]
    Announce(#[source] ConnectionError),
    /// The harness could not be spawned, or its ACP session ended in failure.
    #[error("the harness process ended in failure: {0}")]
    Harness(String),
}

/// Observes every line crossing the harness's stdio.
pub type LineTap = Arc<dyn Fn(&str, LineDirection) + Send + Sync>;

/// A request to stop relaying and hand the running agent back, answered
/// once the agent is detached (or with `None` when there is none).
#[cfg(unix)]
pub type HandoffRequest = oneshot::Sender<Option<crate::handoff::HandedOffAgent>>;

/// How the bridge ended without failing.
#[derive(Debug)]
pub enum BridgeEnd {
    /// The service or the agent went away; the agent is stopped.
    Closed,
    /// The agent was handed off as asked and keeps running.
    #[cfg(unix)]
    HandedOff,
}

/// Relay between the harness (spawned in ACP mode, or `adopted` from the
/// previous process image) and the service until either side ends, tracking
/// its turns in `turns` and handing every ACP line to `tap` when there is
/// one. `handoff` asks the bridge to stop at a line boundary and hand the
/// agent over instead.
pub async fn bridge(
    harness: &Harness,
    cwd: &Path,
    channel: RuntimeChannel,
    tap: Option<LineTap>,
    turns: &ActiveTurns,
    adopted: Option<RunningAgent>,
    handoff: &mut Handoffs,
) -> Result<BridgeEnd, BridgeError> {
    let probes = HarnessModelProbes {
        process: probe_process(harness, cwd),
    };
    let agent_process =
        AcpProcess::new(&harness.command, harness.args.clone(), cwd).envs(harness.env.clone());

    let RuntimeChannel {
        tx: to_service,
        rx: mut from_service,
    } = channel;
    // Taken by a handoff, which closes the socket by dropping it.
    let mut to_service = Some(to_service);
    to_service
        .as_ref()
        .expect("just set")
        .send(ToServerMessage::Event {
            event: SystemEvent::AcpReady,
        })
        .map_err(|_| BridgeError::Announce(ConnectionError::Closed))?;

    let line_turns = turns.clone();
    // The wire tap: every ndjson line crossing the child's stdio, plus its
    // stderr. Enable with RUST_LOG=coding_agent_worker=trace.
    let debug = Arc::new(move |line: &str, direction: LineDirection| {
        tracing::trace!(?direction, line, "acp line");
        line_turns.observe(line, direction);
        if let Some(tap) = &tap {
            tap(line, direction);
        }
    });

    let started = match adopted {
        Some(agent) => Ok(agent),
        None => agent_process.start(),
    };
    let outcome = match started {
        Ok(agent) => {
            relay(
                agent.attach(debug),
                &mut to_service,
                &mut from_service,
                &probes,
                turns,
                handoff,
            )
            .await
        }
        Err(error) => Err(BridgeError::Harness(error.to_string())),
    };
    turns.clear();

    // A handoff already told the service and closed the socket; anything
    // else announces the end. Best effort: a transport that has already
    // failed cannot carry news of its own failure.
    if let Some(to_service) = to_service
        && to_service
            .send(ToServerMessage::Event {
                event: SystemEvent::Disconnected,
            })
            .is_err()
    {
        tracing::debug!("could not announce disconnect");
    }
    match outcome {
        Ok(Relayed::Closed) => Ok(BridgeEnd::Closed),
        #[cfg(unix)]
        Ok(Relayed::HandedOff(())) => Ok(BridgeEnd::HandedOff),
        Err(error) => Err(error),
    }
}

/// Where handoff requests reach the bridge.
pub struct Handoffs {
    #[cfg(unix)]
    pub(crate) requests: tokio::sync::mpsc::Receiver<HandoffRequest>,
}

impl Handoffs {
    pub fn channel() -> (Self, HandoffSender) {
        #[cfg(unix)]
        {
            let (sender, requests) = tokio::sync::mpsc::channel(1);
            (Self { requests }, HandoffSender { sender })
        }
        #[cfg(not(unix))]
        {
            (Self {}, HandoffSender {})
        }
    }

    /// The next request. Never resolves once every sender is gone.
    #[cfg(unix)]
    pub(crate) async fn next(&mut self) -> HandoffRequest {
        match self.requests.recv().await {
            Some(request) => request,
            None => std::future::pending().await,
        }
    }

    #[cfg(not(unix))]
    pub(crate) async fn next(&mut self) -> std::convert::Infallible {
        std::future::pending().await
    }
}

/// Asks the bridge (through the runtime) for its agent.
#[derive(Clone)]
pub struct HandoffSender {
    #[cfg(unix)]
    pub(crate) sender: tokio::sync::mpsc::Sender<HandoffRequest>,
}

enum Relayed {
    Closed,
    #[cfg(unix)]
    HandedOff(()),
}

async fn relay(
    mut agent: AttachedAgent,
    to_service_slot: &mut Option<tokio::sync::mpsc::UnboundedSender<ToServerMessage>>,
    from_service: &mut tokio::sync::mpsc::UnboundedReceiver<ToRuntimeMessage>,
    probes: &HarnessModelProbes,
    turns: &ActiveTurns,
    handoff: &mut Handoffs,
) -> Result<Relayed, BridgeError> {
    let to_service = to_service_slot
        .clone()
        .expect("the bridge holds the sender");
    // Owned by the relay: ending it aborts every probe subprocess.
    let mut probe_tasks = JoinSet::new();
    let mut self_knowledge = SelfKnowledge::default();
    loop {
        tokio::select! {
            event = agent.next_event() => match event {
              AgentEvent::Line(line) => {
                let Some(line) = line else {
                    // The agent closed its output; report how it ended.
                    let status = tokio::time::timeout(
                        crate::outbound::acp_process::SHUTDOWN_GRACE_PERIOD,
                        agent.exited(),
                    )
                    .await;
                    return match status {
                        Ok(Ok(status)) => agent.finish(status).await.map(|()| Relayed::Closed),
                        _ => Ok(Relayed::Closed),
                    }
                    .map_err(|error| BridgeError::Harness(error.to_string()));
                };
                if forward_to_service(&line, &to_service, &mut self_knowledge).is_err() {
                    return Ok(Relayed::Closed);
                }
              }
              AgentEvent::Exited(status) => {
                // Lines the agent wrote before exiting are still relayed.
                let flushed = tokio::time::timeout(
                    crate::outbound::acp_process::SHUTDOWN_GRACE_PERIOD,
                    async {
                        while let Some(line) = agent.next_line().await {
                            let _ = forward_to_service(&line, &to_service, &mut self_knowledge);
                        }
                    },
                )
                .await;
                if flushed.is_err() {
                    tracing::debug!("agent output stayed open after it exited");
                }
                let status = status.map_err(|error| BridgeError::Harness(error.to_string()))?;
                return agent
                    .finish(status)
                    .await
                    .map(|()| Relayed::Closed)
                    .map_err(|error| BridgeError::Harness(error.to_string()));
              }
            },
            message = from_service.recv() => {
                match message {
                    Some(ToRuntimeMessage::Acp(AcpMessage(frame))) => {
                        if let Some(line) = encode(&teach(&mut self_knowledge, frame))
                            && agent.send_line(line).is_err()
                        {
                            return Ok(Relayed::Closed);
                        }
                    }
                    Some(ToRuntimeMessage::ModelProbeRequest) => {
                        let probes = probes.clone();
                        let to_service = to_service.clone();
                        probe_tasks.spawn(async move {
                            let result = match probes.probe().await {
                                Ok(config_options) => ModelProbeResult::Available { config_options },
                                Err(message) => ModelProbeResult::Error { message },
                            };
                            let _ = to_service.send(ToServerMessage::ModelProbeResponse { result });
                        });
                    }
                    Some(other) => tracing::debug!(message = ?other, "ignoring an unknown runtime message"),
                    None => return Ok(Relayed::Closed),
                }
            }
            Some(_) = probe_tasks.join_next(), if !probe_tasks.is_empty() => {}
            request = handoff.next() => {
                #[cfg(unix)]
                {
                    probe_tasks.shutdown().await;
                    // Every sender must go for the socket to close.
                    to_service_slot.take();
                    let handed = hand_off(agent, to_service, from_service, turns, &mut self_knowledge).await;
                    let _ = request.send(handed);
                    return Ok(Relayed::HandedOff(()));
                }
                #[cfg(not(unix))]
                match request {}
            }
        }
    }
}

/// Stop at a line boundary and give the agent up, losing nothing on the way:
/// lines already read go to the service, messages already sent by the
/// service go to the agent, and the socket is flushed and closed before the
/// agent's pipes are returned.
#[cfg(unix)]
async fn hand_off(
    mut agent: AttachedAgent,
    to_service: tokio::sync::mpsc::UnboundedSender<ToServerMessage>,
    from_service: &mut tokio::sync::mpsc::UnboundedReceiver<ToRuntimeMessage>,
    turns: &ActiveTurns,
    self_knowledge: &mut SelfKnowledge,
) -> Option<crate::handoff::HandedOffAgent> {
    let span = tracing::info_span!("macrod.update.handoff");
    let _entered = span.enter();
    agent.stop_reading();
    while let Some(line) = agent.next_line().await {
        let _ = forward_to_service(&line, &to_service, self_knowledge);
    }
    // Closing the sending side lets the socket drain what is queued and shut;
    // the receiving side ends once it has.
    let _ = to_service.send(ToServerMessage::Event {
        event: SystemEvent::Disconnected,
    });
    drop(to_service);
    let drained = tokio::time::timeout(HANDOFF_TIMEOUT, async {
        while let Some(message) = from_service.recv().await {
            if let ToRuntimeMessage::Acp(AcpMessage(frame)) = message
                && let Some(line) = encode(&teach(self_knowledge, frame))
            {
                let _ = agent.send_line(line);
            }
        }
    })
    .await;
    if drained.is_err() {
        tracing::warn!("the service socket did not close in time; handing off anyway");
    }
    let active_prompts = turns.snapshot();
    match agent.detach(HANDOFF_TIMEOUT).await {
        Ok(running) => match running.hand_off(active_prompts) {
            Ok(handed) => Some(handed),
            Err(error) => {
                tracing::warn!(error = %error, "could not hand the agent off");
                None
            }
        },
        Err(error) => {
            tracing::warn!(error = %error, "could not detach the agent");
            None
        }
    }
}

/// Relay one agent line, letting `self_knowledge` learn which session a
/// `session/new` answer created.
fn forward_to_service(
    line: &str,
    to_service: &tokio::sync::mpsc::UnboundedSender<ToServerMessage>,
    self_knowledge: &mut SelfKnowledge,
) -> Result<(), ()> {
    match serde_json::from_str::<RawJsonRpcMessage>(line) {
        Ok(frame) => {
            if let Ok(message) = serde_json::to_value(&frame) {
                self_knowledge.inbound(&message);
            }
            to_service
                .send(ToServerMessage::Acp(AcpMessage(frame)))
                .map_err(|_| ())
        }
        Err(error) => {
            tracing::warn!(error = %error, "dropping an agent line that is not a JSON-RPC message");
            Ok(())
        }
    }
}

fn encode(frame: &RawJsonRpcMessage) -> Option<String> {
    serde_json::to_string(frame)
        .inspect_err(|error| tracing::warn!(error = %error, "could not encode an ACP message"))
        .ok()
}

/// Teach a new session's agent about this runtime on its first prompt.
fn teach(self_knowledge: &mut SelfKnowledge, message: RawJsonRpcMessage) -> RawJsonRpcMessage {
    let Ok(mut value) = serde_json::to_value(&message) else {
        return message;
    };
    self_knowledge.outbound(&mut value);
    serde_json::from_value(value).unwrap_or(message)
}

fn probe_process(harness: &Harness, cwd: &Path) -> ProbeSubprocess {
    ProbeSubprocess {
        command: harness.command.clone().into(),
        args: harness.args.clone(),
        cwd: cwd.to_owned(),
        env: harness.env.clone(),
    }
}

#[derive(Clone)]
struct HarnessModelProbes {
    process: ProbeSubprocess,
}

impl ModelProbeHandler for HarnessModelProbes {
    async fn probe(
        &self,
    ) -> Result<Vec<agent_client_protocol::schema::v1::SessionConfigOption>, String> {
        probe_subprocess(&self.process, MODEL_PROBE_TIMEOUT)
            .await
            .map_err(safe_probe_error)
    }
}

fn safe_probe_error(error: ProbeError) -> String {
    match error {
        ProbeError::Timeout(_) => "the ACP model probe timed out".to_owned(),
        ProbeError::Protocol(_) => "the ACP model probe protocol failed".to_owned(),
        ProbeError::Process(_) => "the ACP model probe process failed".to_owned(),
    }
}
