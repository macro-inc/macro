//! Native command discovery and completion at the ACP boundary. Herdr does
//! not expose a command catalog, so advertise the built-ins we can dispatch.

use super::{Adapter, Arc, TuiAgent, Value, json};

impl Adapter {
    /// Advertise after the successful response: the shared runtime router needs
    /// that response to bind a new ACP session before it can route notifications.
    pub(super) async fn respond_to_request(
        self: &Arc<Self>,
        id: Value,
        method: &str,
        params: Value,
    ) {
        let loading = (method == "session/load")
            .then(|| {
                params
                    .get("sessionId")
                    .and_then(Value::as_str)
                    .map(str::to_owned)
            })
            .flatten();
        let result = self.request(method, params).await;
        let session = result.as_ref().ok().and_then(|response| {
            if method == "session/new" {
                response
                    .get("sessionId")
                    .and_then(Value::as_str)
                    .map(str::to_owned)
            } else {
                loading
            }
        });
        self.respond(id, result);
        if let Some(session) = session {
            self.notify_update(&session, available(self.options.kind));
        }
    }
}

fn available(kind: TuiAgent) -> Value {
    let mut commands = vec![
        json!({"name": "compact", "description": "Compact the native session's context"}),
        json!({"name": "init", "description": "Create repository instructions with the native agent"}),
    ];
    match kind {
        TuiAgent::Claude => commands.push(json!({
            "name": "fast",
            "description": "Set Claude fast mode; without an argument, opens its controls in Herdr",
            "input": {"hint": "on|off (optional)"},
        })),
        TuiAgent::Codex => {
            commands.extend([
                json!({"name": "fast", "description": "Toggle Codex's fast service tier when available for the current model"}),
                json!({"name": "ultrafast", "description": "Toggle Codex's ultrafast service tier when available for the current model"}),
            ]);
        }
    }
    // In particular, do not advertise /resume, /new or /fork: changing the
    // native session identity would detach it from Macro's saved session.
    json!({"sessionUpdate": "available_commands_update", "availableCommands": commands})
}

/// Only standalone native controls may finish on delivery. Ordinary prompts,
/// skills and commands that run the model still require a confirmed turn.
pub(super) fn native_control(kind: TuiAgent, text: &str) -> Option<&str> {
    let text = text.trim();
    if text.contains(['\n', '\r']) {
        return None;
    }
    let mut words = text.split_whitespace();
    let command = words.next()?;
    let argument = words.next();
    let recognized = match kind {
        TuiAgent::Claude => command == "/fast" && matches!(argument, None | Some("on" | "off")),
        TuiAgent::Codex => matches!(command, "/fast" | "/ultrafast") && argument.is_none(),
    };
    (recognized && words.next().is_none()).then_some(text)
}

#[cfg(test)]
mod test;
