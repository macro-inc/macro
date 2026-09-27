//! The daemon-side half of the herdr integration: follows every ACP session
//! on the wire tap, opens a herdr window per session, keeps herdr's sidebar
//! in step with each turn, and serves the windows over a local socket.
//!
//! Nothing here speaks ACP to the agent. Windows steer a session through the
//! Macro control API, exactly as the web app does, so a prompt typed in herdr
//! is the same turn Macro records, folds, and shows.

use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};

use agent_client_protocol::LineDirection;
use agent_client_protocol::schema::v1::RequestId;
use agent_runtime_protocol::domain::action::{
    AgentAction, AgentPermissionAction, PermissionAnswer,
};
use agent_session::domain::model::AgentSessionId;
use macro_user_id::user_id::MacroUserIdStr;
use serde_json::Value;
use tokio::io::{AsyncBufReadExt as _, AsyncWriteExt as _, BufReader};
use tokio::net::{UnixListener, UnixStream};
use tokio::sync::mpsc;
use tokio_util::task::AbortOnDropHandle;

use super::HerdrSession;
use super::cli::{HerdrCli, Window};
use super::tap::{TapEvent, WireTap};
use super::wire::{AgentState, FromPane, ToPane};
use crate::outbound::agent_session::HarnessApi;

#[cfg(test)]
mod test;

/// How many wire events a window can replay on attach. Chunked agent output
/// is many small updates per message, so this is sized in updates, not turns.
const BACKLOG_LIMIT: usize = 20_000;
const TITLE_LIMIT: usize = 48;
const DISPLAY_AGENT: &str = "Macro agent";

type Owner = MacroUserIdStr<'static>;

/// A handle on the running integration. Cheap to clone; the socket and its
/// tasks stop when the last clone drops.
#[derive(Clone)]
pub(crate) struct Hub {
    inner: Arc<Inner>,
    _running: Arc<Running>,
}

struct Running {
    _serve: AbortOnDropHandle<()>,
    _windows: AbortOnDropHandle<()>,
    socket: PathBuf,
}

impl Drop for Running {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.socket);
    }
}

struct Inner {
    state: Mutex<HubState>,
    api: HarnessApi,
    web_url: String,
}

impl Hub {
    /// Bind the window socket and start opening windows in `herdr`.
    pub(crate) fn start(
        herdr: &HerdrSession,
        api: HarnessApi,
        workspace: &Path,
        web_url: &str,
    ) -> std::io::Result<Self> {
        let socket = socket_path();
        let _ = std::fs::remove_file(&socket);
        let listener = UnixListener::bind(&socket)?;
        restrict_to_owner(&socket)?;

        let (work_tx, work_rx) = mpsc::unbounded_channel();
        let inner = Arc::new(Inner {
            state: Mutex::new(HubState::new(work_tx)),
            api,
            web_url: web_url.trim_end_matches('/').to_owned(),
        });
        let launcher = Launcher {
            cli: HerdrCli::new(&herdr.bin, herdr.workspace_id.clone()),
            workspace: workspace.to_owned(),
            pane_command: pane_command(&socket),
            windows: HashMap::new(),
            seq: 0,
        };
        tracing::info!(
            socket = %socket.display(),
            workspace = %workspace.display(),
            "herdr detected; each agent session opens in its own herdr tab"
        );
        Ok(Self {
            _running: Arc::new(Running {
                _serve: AbortOnDropHandle::new(tokio::spawn(serve(inner.clone(), listener))),
                _windows: AbortOnDropHandle::new(tokio::spawn(launcher.run(work_rx))),
                socket,
            }),
            inner,
        })
    }

    /// The observer to hang on the harness's ACP wire.
    pub(crate) fn tap(&self) -> impl Fn(&str, LineDirection) + Send + Sync + 'static {
        let inner = self.inner.clone();
        move |line, direction| inner.lock().observe(line, direction)
    }

    /// The daemon opened a Macro session for `owner`; its ACP session is
    /// about to open (or just has).
    pub(crate) fn session_created(&self, session: AgentSessionId, owner: Owner) {
        self.inner.lock().session_created(session, owner);
    }

    /// `owner` prompted an existing session from Macro.
    pub(crate) fn owner_seen(&self, session: AgentSessionId, owner: Owner) {
        self.inner.lock().owners.insert(session, owner);
    }
}

impl Inner {
    fn lock(&self) -> MutexGuard<'_, HubState> {
        self.state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    fn web_url(&self, session: Option<AgentSessionId>) -> Option<String> {
        session.map(|session| format!("{}/agent/{session}", self.web_url))
    }
}

/// Work for herdr, done in order on one task so a report never races the
/// window it reports on.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum Work {
    Open {
        session: String,
    },
    Report {
        session: String,
        state: AgentState,
        message: Option<String>,
    },
    Title {
        session: String,
        title: String,
    },
}

#[derive(Default)]
struct SessionView {
    macro_session: Option<AgentSessionId>,
    backlog: VecDeque<ToPane>,
    subscribers: Vec<mpsc::UnboundedSender<ToPane>>,
    titled: bool,
    opened: bool,
}

impl SessionView {
    fn push(&mut self, message: ToPane) {
        self.subscribers
            .retain(|subscriber| subscriber.send(message.clone()).is_ok());
        if self.backlog.len() == BACKLOG_LIMIT {
            self.backlog.pop_front();
        }
        self.backlog.push_back(message);
    }
}

pub(crate) struct HubState {
    tap: WireTap,
    sessions: HashMap<String, SessionView>,
    owners: HashMap<AgentSessionId, Owner>,
    /// Macro sessions this daemon created that no ACP session has claimed,
    /// for services that do not name the Macro session in `_meta`.
    unclaimed_macro: VecDeque<AgentSessionId>,
    unclaimed_acp: VecDeque<String>,
    work: mpsc::UnboundedSender<Work>,
}

impl HubState {
    pub(crate) fn new(work: mpsc::UnboundedSender<Work>) -> Self {
        Self {
            tap: WireTap::default(),
            sessions: HashMap::new(),
            owners: HashMap::new(),
            unclaimed_macro: VecDeque::new(),
            unclaimed_acp: VecDeque::new(),
            work,
        }
    }

    fn observe(&mut self, line: &str, direction: LineDirection) {
        for event in self.tap.observe(line, direction) {
            self.apply(event);
        }
    }

    fn queue(&self, work: Work) {
        let _ = self.work.send(work);
    }

    fn session_created(&mut self, session: AgentSessionId, owner: Owner) {
        self.owners.insert(session, owner);
        if self
            .sessions
            .values()
            .any(|view| view.macro_session == Some(session))
        {
            return;
        }
        match self.unclaimed_acp.pop_front() {
            Some(acp) => self.bind(&acp, session),
            None => self.unclaimed_macro.push_back(session),
        }
    }

    fn bind(&mut self, acp: &str, session: AgentSessionId) {
        self.unclaimed_macro.retain(|unclaimed| *unclaimed != session);
        let view = self.sessions.entry(acp.to_owned()).or_default();
        view.macro_session = Some(session);
    }

    pub(crate) fn apply(&mut self, event: TapEvent) {
        match event {
            TapEvent::Opened {
                session,
                macro_session,
            } => {
                let known = self
                    .sessions
                    .get(&session)
                    .and_then(|view| view.macro_session);
                match (macro_session, known) {
                    (Some(named), _) => self.bind(&session, named),
                    (None, Some(_)) => {}
                    (None, None) => match self.unclaimed_macro.pop_front() {
                        Some(claimed) => self.bind(&session, claimed),
                        None => {
                            self.sessions.entry(session.clone()).or_default();
                            self.unclaimed_acp.push_back(session.clone());
                        }
                    },
                }
                let view = self.sessions.entry(session.clone()).or_default();
                if !view.opened {
                    view.opened = true;
                    self.queue(Work::Open {
                        session: session.clone(),
                    });
                    self.queue(Work::Report {
                        session,
                        state: AgentState::Idle,
                        message: None,
                    });
                }
            }
            TapEvent::Prompted { session, text } => {
                let view = self.sessions.entry(session.clone()).or_default();
                view.push(ToPane::Prompted { text: text.clone() });
                view.push(ToPane::State {
                    state: AgentState::Working,
                    detail: None,
                });
                let first = !std::mem::replace(&mut view.titled, true);
                if first && let Some(title) = title_from(&text) {
                    self.queue(Work::Title {
                        session: session.clone(),
                        title,
                    });
                }
                self.queue(Work::Report {
                    session,
                    state: AgentState::Working,
                    message: None,
                });
            }
            TapEvent::Update { session, update } => {
                let title = (update.get("sessionUpdate").and_then(Value::as_str)
                    == Some("session_info_update"))
                .then(|| update.get("title").and_then(Value::as_str).and_then(title_from))
                .flatten();
                let view = self.sessions.entry(session.clone()).or_default();
                view.push(ToPane::Update { update });
                if let Some(title) = title {
                    view.titled = true;
                    self.queue(Work::Title { session, title });
                }
            }
            TapEvent::TurnEnded {
                session,
                stop_reason,
            } => {
                let view = self.sessions.entry(session.clone()).or_default();
                view.push(ToPane::State {
                    state: AgentState::Idle,
                    detail: Some(stop_reason.clone()),
                });
                self.queue(Work::Report {
                    session,
                    state: AgentState::Idle,
                    message: Some(stop_reason),
                });
            }
            TapEvent::PermissionAsked {
                session,
                request_id,
                title,
                options,
            } => {
                let view = self.sessions.entry(session.clone()).or_default();
                view.push(ToPane::Permission {
                    request_id,
                    title: title.clone(),
                    options,
                });
                view.push(ToPane::State {
                    state: AgentState::Blocked,
                    detail: title.clone(),
                });
                self.queue(Work::Report {
                    session,
                    state: AgentState::Blocked,
                    message: title.map(|title| format!("permission: {title}")),
                });
            }
            TapEvent::PermissionAnswered { session } => {
                let view = self.sessions.entry(session.clone()).or_default();
                view.push(ToPane::PermissionSettled);
                view.push(ToPane::State {
                    state: AgentState::Working,
                    detail: None,
                });
                self.queue(Work::Report {
                    session,
                    state: AgentState::Working,
                    message: None,
                });
            }
        }
    }

    /// Who may steer `session` from a window, and as whom.
    fn control_target(&self, session: &str) -> Option<(AgentSessionId, Owner)> {
        let macro_session = self.sessions.get(session)?.macro_session?;
        let owner = self.owners.get(&macro_session)?.clone();
        Some((macro_session, owner))
    }
}

/// The first line of a prompt, short enough for a tab label.
fn title_from(text: &str) -> Option<String> {
    let line = text.lines().map(str::trim).find(|line| !line.is_empty())?;
    let mut title: String = line.chars().take(TITLE_LIMIT).collect();
    if line.chars().count() > TITLE_LIMIT {
        title.push('…');
    }
    Some(title)
}

struct Launcher {
    cli: HerdrCli,
    workspace: PathBuf,
    pane_command: Vec<String>,
    windows: HashMap<String, Window>,
    seq: u64,
}

impl Launcher {
    async fn run(mut self, mut work: mpsc::UnboundedReceiver<Work>) {
        while let Some(item) = work.recv().await {
            if let Err(error) = self.handle(item).await {
                tracing::warn!(error = %error, "herdr command failed");
            }
        }
    }

    async fn handle(&mut self, work: Work) -> Result<(), super::cli::HerdrError> {
        match work {
            Work::Open { session } => {
                let window = self.cli.open_window(&self.workspace, "macro").await?;
                let mut command = self.pane_command.clone();
                command.extend(["--session".to_owned(), session.clone()]);
                self.cli
                    .run_in_pane(&window.pane_id, &shell_words::join(&command))
                    .await?;
                self.cli
                    .report_title(&window.pane_id, DISPLAY_AGENT, None)
                    .await?;
                tracing::info!(
                    %session,
                    tab = %window.tab_id,
                    pane = %window.pane_id,
                    "opened a herdr window for the session"
                );
                self.windows.insert(session, window);
            }
            Work::Report {
                session,
                state,
                message,
            } => {
                let Some(window) = self.windows.get(&session) else {
                    return Ok(());
                };
                self.seq += 1;
                self.cli
                    .report_state(&window.pane_id, state, message.as_deref(), self.seq)
                    .await?;
            }
            Work::Title { session, title } => {
                let Some(window) = self.windows.get(&session) else {
                    return Ok(());
                };
                self.cli.rename_tab(&window.tab_id, &title).await?;
                self.cli
                    .report_title(&window.pane_id, DISPLAY_AGENT, Some(&title))
                    .await?;
            }
        }
        Ok(())
    }
}

fn socket_path() -> PathBuf {
    std::env::temp_dir().join(format!("macrod-herdr-{}.sock", std::process::id()))
}

fn restrict_to_owner(socket: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt as _;
    std::fs::set_permissions(socket, std::fs::Permissions::from_mode(0o600))
}

/// `macrod herdr-pane --socket …`, before the session argument.
fn pane_command(socket: &Path) -> Vec<String> {
    let exe = std::env::current_exe()
        .map(|exe| exe.to_string_lossy().into_owned())
        .unwrap_or_else(|_| "macrod".to_owned());
    vec![
        exe,
        "herdr-pane".to_owned(),
        "--socket".to_owned(),
        socket.to_string_lossy().into_owned(),
    ]
}

async fn serve(inner: Arc<Inner>, listener: UnixListener) {
    loop {
        match listener.accept().await {
            Ok((stream, _)) => {
                tokio::spawn(serve_window(inner.clone(), stream));
            }
            Err(error) => {
                tracing::warn!(error = %error, "herdr window socket failed");
                return;
            }
        }
    }
}

async fn serve_window(inner: Arc<Inner>, stream: UnixStream) {
    let (read, mut write) = stream.into_split();
    let mut lines = BufReader::new(read).lines();
    let Ok(Some(first)) = lines.next_line().await else {
        return;
    };
    let Ok(FromPane::Attach { session }) = serde_json::from_str(&first) else {
        return;
    };

    let (tx, mut rx) = mpsc::unbounded_channel();
    {
        let mut state = inner.lock();
        let view = state.sessions.entry(session.clone()).or_default();
        let _ = tx.send(ToPane::Hello {
            session: session.clone(),
            web_url: inner.web_url(view.macro_session),
        });
        for message in &view.backlog {
            let _ = tx.send(message.clone());
        }
        view.subscribers.push(tx.clone());
    }

    loop {
        tokio::select! {
            message = rx.recv() => {
                let Some(message) = message else { return };
                let Ok(mut line) = serde_json::to_string(&message) else { continue };
                line.push('\n');
                if write.write_all(line.as_bytes()).await.is_err() {
                    return;
                }
            }
            line = lines.next_line() => {
                let Ok(Some(line)) = line else { return };
                let Ok(request) = serde_json::from_str::<FromPane>(&line) else { continue };
                let inner = inner.clone();
                let session = session.clone();
                let tx = tx.clone();
                tokio::spawn(async move {
                    if let Err(text) = steer(&inner, &session, request).await {
                        let _ = tx.send(ToPane::Notice { text, error: true });
                    }
                });
            }
        }
    }
}

/// Carry a window's request to the session through Macro.
async fn steer(inner: &Inner, session: &str, request: FromPane) -> Result<(), String> {
    let action = match request {
        FromPane::Attach { .. } => return Ok(()),
        FromPane::Prompt { text } => AgentAction::prompt(text),
        FromPane::Stop => AgentAction::Stop,
        FromPane::Answer {
            request_id,
            option_id,
        } => AgentAction::RespondToPermission(AgentPermissionAction {
            request_id: serde_json::from_value::<RequestId>(request_id)
                .map_err(|_| "the permission request id is malformed".to_owned())?,
            answer: match option_id {
                Some(option_id) => PermissionAnswer::Selected { option_id },
                None => PermissionAnswer::Cancelled,
            },
        }),
    };
    let target = inner.lock().control_target(session);
    let Some((macro_session, owner)) = target else {
        return Err(
            "this session was not opened by this macrod run; steer it from Macro".to_owned(),
        );
    };
    inner
        .api
        .control(macro_session, &owner, action)
        .await
        .map_err(|error| format!("Macro refused: {error}"))
}
