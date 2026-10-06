//! `macrod herdr-pane`: one ACP session's live window inside herdr.
//!
//! The window attaches to its macrod over the local socket, replays what the
//! session has done so far, then follows it live: prompts, streamed agent
//! output, thoughts, tool calls, plans. Typing prompts the session and Esc
//! interrupts it, both carried to the session through Macro by the daemon.
//! Permission requests are shown but answered in Macro: the service accepts
//! approvals only from a user, never from the runtime they would unblock.

use std::path::Path;
use std::time::Duration;

use crossterm::event::{Event as TermEvent, KeyCode, KeyEvent, KeyEventKind, KeyModifiers};
use rootcause::prelude::ResultExt as _;
use serde_json::Value;
use tokio::io::{AsyncBufReadExt as _, AsyncWriteExt as _, BufReader};
use tokio::net::UnixStream;
use tokio::net::unix::OwnedWriteHalf;
use tui_input::Input;

use super::input::handle_text_input;
use super::ui;
use crate::herdr::wire::{AgentState, FromPane, PermissionChoice, ToPane};

#[cfg(test)]
mod test;

const TICK: Duration = Duration::from_millis(120);
/// How many lines one PageUp/PageDown moves.
const PAGE: usize = 10;

/// One thing the transcript shows.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Entry {
    /// A prompt the agent received.
    User(String),
    /// Streamed agent output.
    Agent(String),
    /// Streamed agent reasoning.
    Thought(String),
    /// A tool call and its latest status.
    Tool {
        /// The agent's id for it.
        id: String,
        /// What it is doing.
        title: String,
        /// `pending`, `in_progress`, `completed`, or `failed`.
        status: String,
    },
    /// The agent's current plan: `(step, status)`.
    Plan(Vec<(String, String)>),
    /// A turn's end, when it ended for a reason worth saying.
    Stopped(String),
    /// A message from the window itself.
    Notice {
        /// The text.
        text: String,
        /// Whether it reports a failure.
        error: bool,
    },
}

/// The session's story, folded from wire events.
#[derive(Debug, Default)]
pub(crate) struct Transcript {
    pub(crate) entries: Vec<Entry>,
    prompted: bool,
}

impl Transcript {
    fn prompted(&mut self, text: String) {
        self.prompted = true;
        self.entries.push(Entry::User(text));
    }

    fn append_text(&mut self, text: &str, make: fn(String) -> Entry, is: fn(&Entry) -> bool) {
        if let Some(last) = self.entries.last_mut()
            && is(last)
            && let Entry::Agent(existing) | Entry::Thought(existing) | Entry::User(existing) = last
        {
            existing.push_str(text);
            return;
        }
        self.entries.push(make(text.to_owned()));
    }

    /// Fold one `session/update` payload in.
    pub(crate) fn apply_update(&mut self, update: &Value) {
        let text = || {
            update
                .pointer("/content/text")
                .and_then(Value::as_str)
                .unwrap_or_default()
        };
        match update.get("sessionUpdate").and_then(Value::as_str) {
            Some("agent_message_chunk") => {
                self.append_text(text(), Entry::Agent, |e| matches!(e, Entry::Agent(_)));
            }
            Some("agent_thought_chunk") => {
                self.append_text(text(), Entry::Thought, |e| matches!(e, Entry::Thought(_)));
            }
            // Replayed history on load; live prompts arrive as `Prompted`.
            Some("user_message_chunk") if !self.prompted => {
                self.append_text(text(), Entry::User, |e| matches!(e, Entry::User(_)));
            }
            Some("tool_call") => {
                let field = |name: &str| {
                    update
                        .get(name)
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_owned()
                };
                let status = update
                    .get("status")
                    .and_then(Value::as_str)
                    .unwrap_or("pending")
                    .to_owned();
                self.entries.push(Entry::Tool {
                    id: field("toolCallId"),
                    title: field("title"),
                    status,
                });
            }
            Some("tool_call_update") => {
                let Some(id) = update.get("toolCallId").and_then(Value::as_str) else {
                    return;
                };
                let found = self.entries.iter_mut().rev().find_map(|entry| match entry {
                    Entry::Tool {
                        id: tool,
                        title,
                        status,
                    } if tool == id => Some((title, status)),
                    _ => None,
                });
                if let Some((title, status)) = found {
                    if let Some(new) = update.get("title").and_then(Value::as_str) {
                        new.clone_into(title);
                    }
                    if let Some(new) = update.get("status").and_then(Value::as_str) {
                        new.clone_into(status);
                    }
                }
            }
            Some("plan") => {
                let steps = update
                    .get("entries")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .map(|step| {
                        let field = |name| {
                            step.get(name)
                                .and_then(Value::as_str)
                                .unwrap_or_default()
                                .to_owned()
                        };
                        (field("content"), field("status"))
                    })
                    .collect();
                match self.entries.last_mut() {
                    Some(Entry::Plan(existing)) => *existing = steps,
                    _ => self.entries.push(Entry::Plan(steps)),
                }
            }
            _ => {}
        }
    }
}

/// A permission request waiting on an answer in Macro.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct PendingPermission {
    pub(crate) title: Option<String>,
    pub(crate) options: Vec<PermissionChoice>,
}

/// Everything the window renders.
#[derive(Debug)]
pub(crate) struct PaneView {
    pub(crate) session: String,
    pub(crate) web_url: Option<String>,
    pub(crate) state: AgentState,
    pub(crate) transcript: Transcript,
    pub(crate) input: Input,
    pub(crate) permission: Option<PendingPermission>,
    /// Lines scrolled up from the bottom; zero follows live output.
    pub(crate) scroll: usize,
    pub(crate) connected: bool,
    pub(crate) tick: usize,
}

/// What a key asks the window to do.
#[derive(Debug, PartialEq)]
pub(crate) enum PaneAction {
    Nothing,
    Send(FromPane),
    Quit,
}

impl PaneView {
    pub(crate) fn new(session: &str) -> Self {
        Self {
            session: session.to_owned(),
            web_url: None,
            state: AgentState::Idle,
            transcript: Transcript::default(),
            input: Input::default(),
            permission: None,
            scroll: 0,
            connected: true,
            tick: 0,
        }
    }

    /// Fold one message from macrod in.
    pub(crate) fn apply(&mut self, message: ToPane) {
        match message {
            ToPane::Hello { session, web_url } => {
                self.session = session;
                self.web_url = web_url;
            }
            ToPane::Prompted { text } => self.transcript.prompted(text),
            ToPane::Update { update } => self.transcript.apply_update(&update),
            ToPane::State { state, detail } => {
                if state == AgentState::Idle
                    && let Some(reason) = detail.filter(|reason| reason != "end_turn")
                {
                    self.transcript.entries.push(Entry::Stopped(reason));
                }
                self.state = state;
            }
            ToPane::Permission { title, options, .. } => {
                self.permission = Some(PendingPermission { title, options });
            }
            ToPane::PermissionSettled => self.permission = None,
            ToPane::Notice { text, error } => {
                self.transcript.entries.push(Entry::Notice { text, error });
            }
        }
    }

    fn disconnected(&mut self) {
        self.connected = false;
        self.permission = None;
        self.transcript.entries.push(Entry::Notice {
            text: "macrod stopped; this window no longer follows the session. ctrl+c closes it."
                .to_owned(),
            error: true,
        });
    }

    fn stop(&self) -> PaneAction {
        if matches!(self.state, AgentState::Working | AgentState::Blocked) {
            PaneAction::Send(FromPane::Stop)
        } else {
            PaneAction::Nothing
        }
    }

    /// React to a terminal event.
    pub(crate) fn on_event(&mut self, event: TermEvent) -> PaneAction {
        match event {
            TermEvent::Key(key) if key.kind != KeyEventKind::Release => self.on_key(key),
            TermEvent::Paste(text) => {
                for ch in text.chars().map(|ch| if ch == '\n' { ' ' } else { ch }) {
                    self.input.handle(tui_input::InputRequest::InsertChar(ch));
                }
                PaneAction::Nothing
            }
            _ => PaneAction::Nothing,
        }
    }

    fn on_key(&mut self, key: KeyEvent) -> PaneAction {
        if key.code == KeyCode::Char('c') && key.modifiers == KeyModifiers::CONTROL {
            if !self.connected {
                return PaneAction::Quit;
            }
            return match self.stop() {
                PaneAction::Nothing => PaneAction::Quit,
                stop => stop,
            };
        }
        match key.code {
            KeyCode::Enter => {
                let text = self.input.value().trim().to_owned();
                if text.is_empty() {
                    return PaneAction::Nothing;
                }
                self.input.reset();
                self.scroll = 0;
                PaneAction::Send(FromPane::Prompt { text })
            }
            KeyCode::Esc => self.stop(),
            KeyCode::PageUp => {
                self.scroll = self.scroll.saturating_add(PAGE);
                PaneAction::Nothing
            }
            KeyCode::PageDown => {
                self.scroll = self.scroll.saturating_sub(PAGE);
                PaneAction::Nothing
            }
            _ => {
                handle_text_input(&mut self.input, key);
                PaneAction::Nothing
            }
        }
    }
}

async fn send(write: &mut OwnedWriteHalf, message: &FromPane) -> std::io::Result<()> {
    let mut line = serde_json::to_string(message).map_err(std::io::Error::other)?;
    line.push('\n');
    write.write_all(line.as_bytes()).await
}

/// Attach to `session` on the macrod listening at `socket` and show it
/// until the user quits.
pub async fn run_herdr_pane(socket: &Path, session: &str) -> rootcause::Result<()> {
    let stream = UnixStream::connect(socket)
        .await
        .context("could not reach macrod; is it still running?")?;
    let (read, mut write) = stream.into_split();
    send(
        &mut write,
        &FromPane::Attach {
            session: session.to_owned(),
        },
    )
    .await
    .context("could not attach to the session")?;

    let (message_tx, mut message_rx) = tokio::sync::mpsc::unbounded_channel();
    tokio::spawn(async move {
        let mut lines = BufReader::new(read).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if let Ok(message) = serde_json::from_str::<ToPane>(&line)
                && message_tx.send(Some(message)).is_err()
            {
                return;
            }
        }
        let _ = message_tx.send(None);
    });

    let (input_tx, mut input_rx) = tokio::sync::mpsc::unbounded_channel();
    std::thread::spawn(move || {
        while let Ok(event) = crossterm::event::read() {
            if input_tx.send(event).is_err() {
                return;
            }
        }
    });

    let mut terminal = ratatui::init();
    let _ = crossterm::execute!(std::io::stdout(), crossterm::event::EnableBracketedPaste);
    let mut view = PaneView::new(session);
    let mut ticker = tokio::time::interval(TICK);
    let outcome = loop {
        if let Err(error) = terminal.draw(|frame| ui::render_herdr_pane(frame, &view)) {
            break Err(error);
        }
        tokio::select! {
            _ = ticker.tick() => view.tick = view.tick.wrapping_add(1),
            Some(event) = input_rx.recv() => match view.on_event(event) {
                PaneAction::Nothing => {}
                PaneAction::Quit => break Ok(()),
                PaneAction::Send(message) => {
                    if send(&mut write, &message).await.is_err() {
                        view.connected = false;
                    }
                }
            },
            message = message_rx.recv(), if view.connected => {
                // A replayed backlog arrives all at once: fold it before
                // drawing again.
                let mut next = message;
                loop {
                    let Some(Some(message)) = next else {
                        view.disconnected();
                        break;
                    };
                    view.apply(message);
                    match message_rx.try_recv() {
                        Ok(message) => next = Some(message),
                        Err(_) => break,
                    }
                }
            }
        }
    };
    let _ = crossterm::execute!(std::io::stdout(), crossterm::event::DisableBracketedPaste);
    ratatui::restore();
    outcome.context("the window's terminal failed")?;
    Ok(())
}
