//! Session-side Codex effort commands. Codex has no native `/effort` command;
//! translate it through the same guarded native picker as model selection.
use super::models::{Stage, codex_footer, same_session};
use super::*;

const LEVELS: &[(&str, &str)] = &[
    ("none", "None"),
    ("minimal", "Minimal"),
    ("low", "Low"),
    ("medium", "Medium"),
    ("high", "High"),
    ("xhigh", "Extra high"),
    ("max", "Max"),
    ("ultra", "Ultra"),
];
const FOOTER: &str = "Press enter to confirm or esc to go back";
pub(super) const CONFIG_ID: &str = "reasoning_effort";

/// Never reinterpret multiline prompts or longer prose as a setting change.
pub(super) fn command(text: &str) -> Option<Result<Option<&str>, RpcError>> {
    let text = text.trim();
    if text.contains(['\n', '\r']) {
        return None;
    }
    let mut words = text.split_whitespace();
    if words.next()? != "/effort" {
        return None;
    }
    let argument = words.next();
    if words.next().is_some() {
        return None;
    }
    Some(match argument {
        None | Some("status") => Ok(None),
        Some("default" | "auto") => Ok(Some("default")),
        Some(value) if LEVELS.iter().any(|(id, _)| *id == value) => Ok(Some(value)),
        _ => Err(RpcError::invalid(
            "unknown effort; use /effort to see the session's choices",
        )),
    })
}

impl Adapter {
    /// Return the complete ACP snapshot consumed by Macro's model/effort menu.
    /// Until the native footer confirms an effort, don't guess from defaults.
    pub(super) fn session_options(&self, session: &Session) -> Value {
        let model = lock(&session.model).clone();
        let mut options = self.model_options(&model);
        if self.options.kind == TuiAgent::Codex
            && let Some(current) = lock(&session.effort).as_deref()
            && let Some(preset) = self.codex_preset(&model)
            && let Some(levels) = preset["supported_reasoning_levels"].as_array()
        {
            let mut choices: Vec<_> = levels
                .iter()
                .filter_map(|level| {
                    let value = level["effort"].as_str()?;
                    let name = LEVELS.iter().find(|(id, _)| *id == value)?.1;
                    Some(json!({"value":value,"name":name}))
                })
                .collect();
            if !choices.is_empty() {
                if !choices.iter().any(|choice| choice["value"] == current) {
                    choices.push(json!({"value":current,"name":current}));
                }
                options
                    .as_array_mut()
                    .expect("model options are an array")
                    .push(json!({
                        "id":CONFIG_ID,"name":"Reasoning effort","category":"thought_level",
                        "type":"select","currentValue":current,"options":choices,
                    }));
            }
        }
        options
    }

    fn codex_preset(&self, model: &str) -> Option<Value> {
        let bytes = std::fs::read(self.home.as_ref()?.join(".codex/models_cache.json")).ok()?;
        let cache: Value = serde_json::from_slice(&bytes).ok()?;
        cache["models"]
            .as_array()?
            .iter()
            .find(|entry| entry["slug"] == model)
            .cloned()
    }

    pub(super) async fn set_effort(
        &self,
        session: &Session,
        value: &str,
    ) -> Result<Value, RpcError> {
        tokio::time::timeout(Duration::from_secs(20), async {
            if session.prompt_pending.load(Ordering::SeqCst) {
                return Err(RpcError::invalid("cannot change effort during a turn"));
            }
            let guard = tokio::time::timeout(Duration::from_secs(3), session.live.lock())
                .await
                .map_err(|_| RpcError::invalid("native session is busy; retry the selection"))?;
            if session.prompt_pending.load(Ordering::SeqCst) {
                return Err(RpcError::invalid("cannot change effort during a turn"));
            }
            let live = guard.as_ref().ok_or_else(|| {
                RpcError::invalid("start the native session before selecting effort")
            })?;
            self.codex_effort(session, live, Some(value)).await?;
            Ok(json!({"configOptions":self.session_options(session)}))
        })
        .await
        .map_err(|_| {
            RpcError::internal("effort change was not confirmed; check the native session in Herdr")
        })?
    }

    pub(super) async fn codex_effort(
        &self,
        session: &Session,
        live: &Live,
        requested: Option<&str>,
    ) -> Result<String, RpcError> {
        let herdr = self
            .herdr
            .as_ref()
            .ok_or_else(|| RpcError::internal("Herdr is unavailable"))?;
        let info = herdr.agent_info(&live.name).await?;
        if !same_session(session, &info) || !matches!(info.status.as_str(), "idle" | "done") {
            return Err(RpcError::invalid(
                "finish the current native turn or dialog before changing effort",
            ));
        }
        let screen = herdr.read_agent(&live.name).await?;
        let (model, current) = codex_footer(&screen).ok_or_else(|| {
            RpcError::invalid(
                "cannot read Codex's active model and effort; return to its composer in Herdr",
            )
        })?;
        let preset = self.codex_preset(model);
        let preset = preset.as_ref();
        let choices: Vec<_> = preset
            .and_then(|preset| preset["supported_reasoning_levels"].as_array())
            .into_iter()
            .flatten()
            .filter_map(|level| level["effort"].as_str())
            .collect();
        let Some(requested) = requested else {
            self.report_settings(session, live, model, Some(current))?;
            let options = if choices.is_empty() {
                "Use /effort <level>, e.g. /effort high. The native picker validates availability."
                    .to_owned()
            } else {
                format!(
                    "Available: {}. Use /effort <level> or /effort default.",
                    choices.join(", ")
                )
            };
            return Ok(format!(
                "Codex is using **{model}** with **{current}** effort. {options}"
            ));
        };
        let wanted = if requested == "default" {
            preset
                .and_then(|preset| preset["default_reasoning_level"].as_str())
                .ok_or_else(|| {
                    RpcError::invalid(
                        "Codex's default effort is unavailable; choose an explicit level",
                    )
                })?
        } else {
            requested
        };
        if !LEVELS.iter().any(|(id, _)| *id == wanted)
            || (!choices.is_empty() && !choices.contains(&wanted) && current != wanted)
        {
            return Err(RpcError::invalid(format!(
                "{model} supports: {}",
                choices.join(", ")
            )));
        }
        if current != wanted {
            self.native_selection(session, live, model, Some(wanted))
                .await?;
        }
        self.report_settings(session, live, model, Some(wanted))?;
        Ok(format!(
            "Codex is now using **{wanted}** effort with **{model}**."
        ))
    }
}

pub(super) fn picker_key(
    stage: Stage,
    model: &str,
    effort: &str,
    screen: &str,
) -> Option<(String, Stage)> {
    if matches!(stage, Stage::Model) {
        return super::models::picker_key(stage, model, screen);
    }
    if !screen.trim_end().ends_with(FOOTER) {
        return None;
    }
    let standard = screen
        .lines()
        .any(|line| line.trim() == format!("Select Reasoning Level for {model}"));
    let advanced = screen
        .lines()
        .any(|line| line.trim() == "Advanced Reasoning");
    if !(matches!(stage, Stage::Effort) && standard || matches!(stage, Stage::Advanced) && advanced)
    {
        return None;
    }
    let label = LEVELS.iter().find(|(id, _)| *id == effort)?.1;
    if let Some(key) = row(screen, label) {
        return Some((key, Stage::Confirmation));
    }
    if matches!(stage, Stage::Effort) && matches!(effort, "max" | "ultra") {
        return row(screen, "More reasoning…").map(|key| (key, Stage::Advanced));
    }
    None
}

fn row(screen: &str, label: &str) -> Option<String> {
    screen.lines().find_map(|line| {
        let (number, text) = line
            .trim()
            .trim_start_matches('›')
            .trim()
            .split_once(". ")?;
        if number.len() != 1 || !matches!(number.parse::<u8>(), Ok(1..=9)) {
            return None;
        }
        (text == label
            || text
                .strip_prefix(label)
                .is_some_and(|rest| rest.starts_with(' ')))
        .then(|| number.to_owned())
    })
}

#[cfg(test)]
mod test;
