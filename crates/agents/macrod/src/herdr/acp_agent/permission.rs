//! Native permission dialogs answered from Macro. "Always allow" presses the
//! dialog's own "don't ask again" answer when it shows one; otherwise this
//! session remembers the tool and answers its later dialogs itself.

use super::super::controls::{self, NativeAlways};
use super::*;

const ALLOW: &str = "allow";
const ALWAYS: &str = "always";
const REJECT: &str = "reject";

/// The tool call the agent's transcript shows running, which a permission
/// dialog is about.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct OpenTool {
    pub id: String,
    pub title: String,
    /// The agent's own tool name, such as `Bash`.
    pub name: Option<String>,
}

/// How "Always allow" is carried out for one dialog.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Always {
    /// Press the dialog's own answer; the agent remembers it.
    Native(NativeAlways),
    /// Approve, and auto-approve this tool's later dialogs in the session.
    Standing { tool: String, name: String },
}

impl Always {
    fn for_dialog(kind: TuiAgent, tool: Option<&OpenTool>, screen: &str) -> Option<Self> {
        if let Some(native) = controls::always_choice(kind, screen) {
            return Some(Self::Native(native));
        }
        standing_tool(kind, tool, screen).map(|(tool, shown)| Self::Standing {
            tool,
            name: format!("Always allow {shown} in this session"),
        })
    }

    fn name(&self) -> &str {
        match self {
            Self::Native(native) => &native.name,
            Self::Standing { name, .. } => name,
        }
    }
}

/// What a standing approval covers, and how to show it: Claude Code names
/// the tool in its transcript; Codex shows the command on screen.
fn standing_tool(
    kind: TuiAgent,
    tool: Option<&OpenTool>,
    screen: &str,
) -> Option<(String, String)> {
    match kind {
        TuiAgent::Claude => tool
            .and_then(|tool| tool.name.clone())
            .map(|name| (name.clone(), name)),
        TuiAgent::Codex => dialog_command(screen)
            .map(|command| (command.to_owned(), format!("`{}`", clip_title(command)))),
    }
}

/// The options Macro offers for one dialog.
fn permission_options(always: Option<&Always>) -> Value {
    let mut options = vec![json!({"optionId": ALLOW, "name": "Allow once", "kind": "allow_once"})];
    if let Some(always) = always {
        options.push(json!({"optionId": ALWAYS, "name": always.name(), "kind": "allow_always"}));
    }
    options.push(json!({"optionId": REJECT, "name": "Reject", "kind": "reject_once"}));
    Value::Array(options)
}

impl Adapter {
    /// Ask Macro about the TUI's permission dialog, then press the key for
    /// the answer - unless the dialog was already answered in the window.
    /// A tool the session always allows is approved without asking.
    pub(super) fn ask_permission(
        self: &Arc<Self>,
        session: &Arc<Session>,
        live: &Live,
        tool: Option<OpenTool>,
        generation: u64,
        blocked: &Arc<AtomicU64>,
    ) {
        let adapter = self.clone();
        let session = session.clone();
        let name = live.name.clone();
        let blocked = blocked.clone();
        tokio::spawn(async move {
            adapter
                .answer_permission(&session, &name, tool, generation, &blocked)
                .await;
        });
    }

    async fn answer_permission(
        &self,
        session: &Session,
        name: &str,
        tool: Option<OpenTool>,
        generation: u64,
        blocked: &AtomicU64,
    ) {
        let Some(herdr) = &self.herdr else {
            return;
        };
        let kind = self.options.kind;
        let Ok(before) = herdr.agent_info(name).await else {
            return;
        };
        let Ok(screen) = herdr.read_agent(name).await else {
            return;
        };
        let Some(approve_key) = controls::approve_key(kind, &screen) else {
            self.notify_update(&session.id, json!({"sessionUpdate":"agent_message_chunk", "content":{"type":"text", "text":"The native agent needs input in Herdr."}}));
            return;
        };
        if before.status != "blocked" {
            return;
        }
        let always = Always::for_dialog(kind, tool.as_ref(), &screen);
        let standing = match &always {
            Some(Always::Standing { tool, .. }) => lock(&session.always_allowed).contains(tool),
            _ => false,
        };
        let choice = if standing {
            tracing::info!(session_id = %session.id, "native permission dialog approved by a standing approval");
            Some(ALLOW.to_owned())
        } else {
            let (tool_id, title) = match &tool {
                Some(tool) => (tool.id.clone(), tool.title.clone()),
                None => (
                    format!("herdr-permission-{generation}"),
                    permission_title(kind, &screen),
                ),
            };
            self.call(
                "session/request_permission",
                json!({
                    "sessionId": session.id,
                    "toolCall": {"toolCallId": tool_id, "title": title, "status": "pending"},
                    "options": permission_options(always.as_ref()),
                }),
            )
            .await
            .as_ref()
            .and_then(|answer| answer.pointer("/result/outcome/optionId"))
            .and_then(Value::as_str)
            .map(str::to_owned)
        };
        if blocked.load(Ordering::SeqCst) != generation {
            return;
        }
        let Ok(after) = herdr.agent_info(name).await else {
            return;
        };
        let Ok(current_screen) = herdr.read_agent(name).await else {
            return;
        };
        if !controls::same_dialog(
            &screen,
            &current_screen,
            before.state_change_seq,
            after.state_change_seq,
            &after.status,
        ) {
            return;
        }
        let (key, remember) = match (choice.as_deref(), always) {
            (Some(ALLOW), _) => (approve_key.to_owned(), None),
            (Some(ALWAYS), Some(Always::Native(native))) => (native.key, None),
            (Some(ALWAYS), Some(Always::Standing { tool, .. })) => {
                (approve_key.to_owned(), Some(tool))
            }
            (Some(REJECT), _) => ("esc".to_owned(), None),
            _ => return,
        };
        if blocked.load(Ordering::SeqCst) != generation {
            return;
        }
        if let Err(error) = herdr.send_keys(name, &[&key]).await {
            tracing::warn!(error = %error, "could not answer the agent's permission dialog");
            return;
        }
        if let Some(tool) = remember {
            lock(&session.always_allowed).insert(tool);
        }
    }
}

/// The command a Codex dialog asks to run.
fn dialog_command(screen: &str) -> Option<&str> {
    let lines: Vec<&str> = screen.lines().map(str::trim).collect();
    let question = lines
        .iter()
        .rposition(|line| line.starts_with("Would you like to"))?;
    lines[question + 1..]
        .iter()
        .find_map(|line| line.strip_prefix("$ "))
}

/// What a permission dialog on the agent's screen is asking about.
pub(super) fn permission_title(kind: TuiAgent, screen: &str) -> String {
    let lines: Vec<&str> = screen.lines().map(str::trim).collect();
    let asked = lines
        .iter()
        .rposition(|line| line.starts_with("Would you like to"))
        .map(|index| (lines[index], &lines[index + 1..]));
    if let Some((question, rest)) = asked {
        if let Some(command) = dialog_command(screen) {
            return format!("Run {}", clip_title(command));
        }
        if question.contains("edit") {
            return "Edit files".to_owned();
        }
        if let Some(reason) = rest.iter().find_map(|line| line.strip_prefix("Reason: ")) {
            return clip_title(reason);
        }
    }
    match kind {
        TuiAgent::Claude => "Claude Code is asking for permission".to_owned(),
        TuiAgent::Codex => "Codex is asking for permission".to_owned(),
    }
}

fn clip_title(text: &str) -> String {
    const LIMIT: usize = 80;
    let mut clipped: String = text.chars().take(LIMIT).collect();
    if text.chars().count() > LIMIT {
        clipped.push('…');
    }
    clipped
}

pub(super) fn track_open_tool(open_tool: &mut Option<OpenTool>, update: &Value) {
    let id = update.get("toolCallId").and_then(Value::as_str);
    match update.get("sessionUpdate").and_then(Value::as_str) {
        Some("tool_call") => {
            *open_tool = id.map(|id| OpenTool {
                id: id.to_owned(),
                title: update
                    .get("title")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_owned(),
                name: update
                    .pointer("/_meta/claudeCode/toolName")
                    .and_then(Value::as_str)
                    .map(str::to_owned),
            });
        }
        Some("tool_call_update") if open_tool.as_ref().map(|open| open.id.as_str()) == id => {
            *open_tool = None;
        }
        _ => {}
    }
}

#[cfg(test)]
mod test;
