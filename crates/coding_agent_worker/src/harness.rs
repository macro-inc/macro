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

use crate::computer::Computer;
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
    AcpMessage, ModelProbeResult, SystemEvent, TeammateHostReport, ToRuntimeMessage,
    ToServerMessage,
};
use tokio::sync::{Notify, oneshot};
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

/// The teammates this macrod hosts in containers; none outside Unix.
#[cfg(unix)]
pub type HostTeammates = crate::teammate::HostTeammates;
/// The teammates this macrod hosts in containers; none outside Unix.
#[cfg(not(unix))]
pub enum HostTeammates {}

/// The teammates this macrod hosts, once hosting is set up: at start, or
/// by a later retry when setting it up failed (`daemon.rs`). Each dial reads
/// it, and a connection made without it redials once it is set up.
#[derive(Clone)]
pub struct Hosting(Arc<tokio::sync::watch::Sender<Option<Arc<HostTeammates>>>>);

impl Default for Hosting {
    fn default() -> Self {
        Self(Arc::new(tokio::sync::watch::Sender::new(None)))
    }
}

impl Hosting {
    /// Hosting already set up.
    pub fn with(teammates: Arc<HostTeammates>) -> Self {
        let hosting = Self::default();
        hosting.set(teammates);
        hosting
    }

    /// Hosting is set up.
    pub fn set(&self, teammates: Arc<HostTeammates>) {
        self.0.send_replace(Some(teammates));
    }

    /// The teammates, if hosting is set up.
    pub fn current(&self) -> Option<Arc<HostTeammates>> {
        self.0.borrow().clone()
    }

    /// Resolves once hosting is set up.
    pub async fn ready(&self) {
        let mut hosting = self.0.subscribe();
        let _ = hosting.wait_for(Option::is_some).await;
    }
}

/// Why hosting teammates couldn't be set up.
#[derive(Debug, thiserror::Error)]
pub enum HostingSetupError {
    /// The teammate settings in the config are wrong: trying again won't
    /// help until they are fixed.
    #[error("the teammate settings are invalid: {0}")]
    Settings(rootcause::Report),
    /// Something that may pass by itself (a file another macrod writes).
    #[error("could not set up hosting teammates: {0}")]
    Failed(rootcause::Report),
}

/// Which call carried the harness credentials the service answered.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum CredentialPath {
    /// The runtime gateway's WebSocket dial.
    RuntimeDial,
    /// The trigger stream's calls (its bound-agent reads).
    Stream,
}

/// The service refused this machine's harness credentials on `path` (it
/// was unpaired or removed, or that path is failing): stop the teammates it
/// runs once the refusal persists.
pub fn credentials_refused(
    teammates: Option<&std::sync::Arc<HostTeammates>>,
    path: CredentialPath,
) {
    let Some(teammates) = teammates else {
        return;
    };
    #[cfg(unix)]
    teammates.credentials_refused(path);
    #[cfg(not(unix))]
    let _ = path;
    #[cfg(not(unix))]
    match **teammates {}
}

/// Nothing calls the service on `path` any more: its refusal no longer
/// holds the teammates stopped.
pub fn stopped_calling(teammates: Option<&std::sync::Arc<HostTeammates>>, path: CredentialPath) {
    let Some(teammates) = teammates else {
        return;
    };
    #[cfg(unix)]
    teammates.stopped_calling(path);
    #[cfg(not(unix))]
    let _ = path;
    #[cfg(not(unix))]
    match **teammates {}
}

/// The service accepted this machine's harness credentials on `path`: run
/// again the teammates a refusal stopped, once no path is refused.
pub fn credentials_accepted(
    teammates: Option<&std::sync::Arc<HostTeammates>>,
    path: CredentialPath,
) {
    let Some(teammates) = teammates else {
        return;
    };
    #[cfg(unix)]
    teammates.credentials_accepted(path);
    #[cfg(not(unix))]
    let _ = path;
    #[cfg(not(unix))]
    match **teammates {}
}

/// The teammates to serve on one connection, with the engine check made
/// before its dial.
pub type TeammateHosting = (Arc<HostTeammates>, TeammateHostReport);

/// What one connection's teammate traffic asks of the relay.
#[derive(Debug)]
pub enum TeammateEvent {
    /// Send this to the service.
    Send(ToServerMessage),
    /// The engine answers again, but this connection's dial didn't list
    /// the teammate capability: redial (once no turn is running) so the
    /// service can send teammates here.
    Redial,
}

#[cfg(unix)]
type TeammateLink = crate::teammate::Link;
#[cfg(not(unix))]
type TeammateLink = std::convert::Infallible;

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
/// `agents_changed` is raised when the service says the agents bound to this
/// harness may have changed. `teammates`, when this macrod hosts any, gets
/// the connection's teammate messages and sends their reports.
#[expect(clippy::too_many_arguments, reason = "the bridge's whole input")]
pub async fn bridge(
    harness: &Harness,
    cwd: &Path,
    channel: RuntimeChannel,
    tap: Option<LineTap>,
    turns: &ActiveTurns,
    adopted: Option<RunningAgent>,
    handoff: &mut Handoffs,
    computer: Option<Arc<Computer>>,
    agents_changed: &Notify,
    teammates: Option<TeammateHosting>,
    hosting: &Hosting,
) -> Result<BridgeEnd, BridgeError> {
    let probes = HarnessModelProbes {
        process: probe_process(harness, cwd),
    };
    let agent_process = agent_process(harness, cwd);

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
    let mut teammates = teammates
        .map(|hosting| open_teammate_link(hosting, to_service.as_ref().expect("just set")));
    // Teammates are hosted on Unix only; elsewhere the service is told so,
    // and the Invite form shows the machine with that reason.
    #[cfg(not(unix))]
    let _ = to_service
        .as_ref()
        .expect("just set")
        .send(ToServerMessage::TeammateHost {
            report: unsupported_host_report(),
        });

    let line_turns = turns.clone();
    // Observe protocol traffic without logging credentials in session-start env.
    let debug = Arc::new(move |line: &str, direction: LineDirection| {
        tracing::trace!(?direction, bytes = line.len() as i64, "acp line");
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
                computer.as_ref(),
                agents_changed,
                &mut teammates,
                hosting,
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

#[expect(clippy::too_many_arguments, reason = "the relay's whole input")]
async fn relay(
    mut agent: AttachedAgent,
    to_service_slot: &mut Option<tokio::sync::mpsc::UnboundedSender<ToServerMessage>>,
    from_service: &mut tokio::sync::mpsc::UnboundedReceiver<ToRuntimeMessage>,
    probes: &HarnessModelProbes,
    turns: &ActiveTurns,
    handoff: &mut Handoffs,
    computer: Option<&Arc<Computer>>,
    agents_changed: &Notify,
    teammates: &mut Option<TeammateLink>,
    hosting: &Hosting,
) -> Result<Relayed, BridgeError> {
    let to_service = to_service_slot
        .clone()
        .expect("the bridge holds the sender");
    // Owned by the relay: ending it aborts every probe subprocess.
    let mut probe_tasks = JoinSet::new();
    let mut self_knowledge = SelfKnowledge::default();
    // A redial is due (to list what this dial didn't), once no turn runs:
    // ending the connection would end a running turn in Macro.
    let mut redial_pending = false;
    loop {
        if redial_pending && turns.is_idle() {
            tracing::info!("redialing so the dial lists teammate hosting");
            return Ok(Relayed::Closed);
        }
        tokio::select! {
            () = hosting.ready(), if teammates.is_none() && !redial_pending => {
                tracing::info!("hosting teammates was set up after this dial; redialing once no turn runs");
                redial_pending = true;
            }
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
                        if let Some(line) = encode(&teach(&mut self_knowledge, frame, computer)?)
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
                    Some(ToRuntimeMessage::AgentsChanged) => agents_changed.notify_one(),
                    Some(ToRuntimeMessage::ApplyAgent { environment, traceparent }) => {
                        // Read by the guest's agent units; outside a Macro
                        // computer nothing installs it, so it does nothing.
                        let span = tracing::info_span!("macrod.agent.apply", otel.status_code = tracing::field::Empty);
                        hosted_runtimes::domain::telemetry::attach(&span, traceparent.as_deref());
                        let _entered = span.enter();
                        match apply_agent(&environment.0, traceparent.as_deref()) {
                            Ok(staged) => {
                                tracing::info!(?staged, "handled the agent teammate's environment");
                                // macrod starts the agent on it, when it controls the unit.
                                #[cfg(unix)]
                                if staged == crate::agent_env::Staged::Written && let Some(computer) = computer {
                                    computer.agent_delivered();
                                }
                            }
                            Err(error) => {
                                span.record("otel.status_code", "ERROR");
                                tracing::error!(error = ?error, "could not stage the agent teammate's environment");
                            }
                        }
                    }
                    Some(message @ (ToRuntimeMessage::RunTeammate { .. } | ToRuntimeMessage::StopTeammate { .. })) => {
                        handle_teammate_message(teammates.as_ref(), message);
                    }
                    Some(ToRuntimeMessage::RecheckTeammateHost { traceparent, .. }) => recheck_teammate_host(teammates.as_ref(), traceparent),
                    Some(other) => tracing::debug!(message = ?other, "ignoring an unknown runtime message"),
                    None => return Ok(Relayed::Closed),
                }
            }
            Some(_) = probe_tasks.join_next(), if !probe_tasks.is_empty() => {}
            event = next_teammate_event(teammates) => match event {
                TeammateEvent::Send(message) => {
                    if to_service.send(message).is_err() {
                        return Ok(Relayed::Closed);
                    }
                }
                TeammateEvent::Redial => {
                    tracing::info!("the container engine answers again; redialing once no turn runs");
                    redial_pending = true;
                }
            },
            request = handoff.next() => {
                #[cfg(unix)]
                {
                    probe_tasks.shutdown().await;
                    // Every sender must go for the socket to close.
                    to_service_slot.take();
                    let handed = hand_off(agent, to_service, from_service, turns, &mut self_knowledge, computer).await;
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
    computer: Option<&Arc<Computer>>,
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
                && let Ok(frame) = teach(self_knowledge, frame, computer)
                && let Some(line) = encode(&frame)
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
                tracing::warn!(error = ?error, "could not hand the agent off");
                None
            }
        },
        Err(error) => {
            tracing::warn!(error = ?error, "could not detach the agent");
            None
        }
    }
}

#[cfg(unix)]
fn open_teammate_link(
    (teammates, report): TeammateHosting,
    to_service: &tokio::sync::mpsc::UnboundedSender<ToServerMessage>,
) -> TeammateLink {
    crate::teammate::Link::open(teammates, report, to_service)
}

#[cfg(not(unix))]
fn open_teammate_link(
    (teammates, _report): TeammateHosting,
    _to_service: &tokio::sync::mpsc::UnboundedSender<ToServerMessage>,
) -> TeammateLink {
    match *teammates {}
}

/// What a machine that can't host teammates reports.
#[cfg(not(unix))]
fn unsupported_host_report() -> agent_runtime_protocol::domain::schema::v0::TeammateHostReport {
    use agent_runtime_protocol::domain::schema::v0::{
        HostArch, HostOs, TeammateHostProblem, TeammateHostReport,
    };
    TeammateHostReport {
        engine: None,
        engines: Vec::new(),
        os: HostOs::Windows,
        arch: match std::env::consts::ARCH {
            "x86_64" => HostArch::Amd64,
            "aarch64" => HostArch::Arm64,
            _ => HostArch::Other,
        },
        cpus: 0,
        memory_mib: 0,
        disk_free_mib: None,
        problem: Some(TeammateHostProblem::UnsupportedPlatform),
        installs: Vec::new(),
    }
}

/// The next teammate report to send, or a redial; never resolves without
/// teammates.
async fn next_teammate_event(teammates: &mut Option<TeammateLink>) -> TeammateEvent {
    #[cfg(unix)]
    if let Some(link) = teammates {
        return link.next().await;
    }
    #[cfg(not(unix))]
    let _ = teammates;
    std::future::pending().await
}

/// Check hosting again now, as the service asked; without teammates there
/// is nothing to check.
fn recheck_teammate_host(teammates: Option<&TeammateLink>, traceparent: Option<String>) {
    #[cfg(unix)]
    if let Some(link) = teammates {
        link.recheck(traceparent);
    }
    #[cfg(not(unix))]
    let _ = (teammates, traceparent);
}

/// Hand a `RunTeammate` or `StopTeammate` to the teammates. The service
/// sends them only to a macrod that listed the capability, so without
/// teammates there is nothing to do but say so.
fn handle_teammate_message(teammates: Option<&TeammateLink>, message: ToRuntimeMessage) {
    #[cfg(unix)]
    if let Some(link) = teammates {
        match crate::teammate::TeammateRequest::from_message(message) {
            Ok(request) => link.handle(request),
            Err(other) => tracing::debug!(message = ?other, "not a teammate message"),
        }
        return;
    }
    let _ = (teammates, message);
    tracing::warn!("ignoring a teammate message: this macrod hosts no teammates");
}

/// Relay one agent line, letting `self_knowledge` learn which session a
/// `session/new` answer created.
#[cfg(unix)]
fn apply_agent(
    environment: &std::collections::BTreeMap<String, String>,
    traceparent: Option<&str>,
) -> rootcause::Result<crate::agent_env::Staged> {
    // The trace first, since the environment is what starts the agent. A trace
    // that can't be staged only costs the start's spans, never the hand-off.
    if let Err(error) = crate::agent_env::stage_setup_traceparent(
        Path::new(crate::agent_env::SETUP_TRACEPARENT_INBOX),
        traceparent,
    ) {
        tracing::warn!(error = ?error, "could not stage the setup trace for the agent's start");
    }
    crate::agent_env::stage_agent_env(
        Path::new(crate::agent_env::AGENT_ENV_INBOX),
        Path::new(crate::agent_env::AGENT_ENV_INSTALLED),
        environment,
    )
}

#[cfg(not(unix))]
fn apply_agent(
    _environment: &std::collections::BTreeMap<String, String>,
    _traceparent: Option<&str>,
) -> rootcause::Result<std::convert::Infallible> {
    Err(rootcause::report!(
        "agent teammates run only on Macro computers"
    ))
}

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

/// Teach a new session's agent about this runtime on its first prompt, and
/// on a Macro computer give each Claude Code session its account or gateway.
fn teach(
    self_knowledge: &mut SelfKnowledge,
    message: RawJsonRpcMessage,
    computer: Option<&Arc<Computer>>,
) -> Result<RawJsonRpcMessage, BridgeError> {
    let Ok(mut value) = serde_json::to_value(&message) else {
        return Ok(message);
    };
    self_knowledge.outbound(&mut value);
    if let Some(computer) = computer {
        computer
            .prepare_session(&mut value)
            .map_err(|error| BridgeError::Harness(format!("{error}")))?;
    }
    serde_json::from_value(value).map_err(|error| BridgeError::Harness(error.to_string()))
}

/// The harness's ACP agent, launched in `cwd`.
pub(crate) fn agent_process(harness: &Harness, cwd: &Path) -> AcpProcess {
    AcpProcess::new(&harness.command, harness.args.clone(), cwd).envs(harness.env.clone())
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
