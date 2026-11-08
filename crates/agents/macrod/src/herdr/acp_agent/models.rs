//! Model configuration translated to the running native TUI. The picker is
//! driven only while its expected screen and session identity still match.

use super::*;

impl Adapter {
    pub(super) fn model_options(&self, current: &str) -> Value {
        let mut config = config_options(self.options.kind, current);
        if self.options.kind == TuiAgent::Codex
            && let Some(home) = &self.home
            && let Ok(bytes) = std::fs::read(home.join(".codex/models_cache.json"))
            && let Ok(cache) = serde_json::from_slice::<Value>(&bytes)
            && let Some(models) = cache.get("models").and_then(Value::as_array)
        {
            let mut choices: Vec<_> = models
                .iter()
                .filter_map(|model| {
                    let id = model.get("slug")?.as_str()?;
                    if !valid_model(id)
                        || model.get("visibility").and_then(Value::as_str) == Some("hide")
                    {
                        return None;
                    }
                    let name = model
                        .get("display_name")
                        .and_then(Value::as_str)
                        .unwrap_or(id);
                    Some(json!({"value":id,"name":name}))
                })
                .collect();
            if !choices.is_empty() {
                if !choices.iter().any(|option| option["value"] == current) {
                    choices.insert(0, json!({"value":current,"name":if current == DEFAULT_MODEL {"Native default (resolved when the agent starts)"} else {current}}));
                }
                config[0]["options"] = json!(choices);
            }
        }
        if current != DEFAULT_MODEL {
            // "default" is a launch policy, not a model the live native picker can select.
            if let Some(options) = config[0]["options"].as_array_mut() {
                options.retain(|option| option["value"] != DEFAULT_MODEL);
            }
        }
        config
    }

    pub(super) fn report_model(
        &self,
        session: &Session,
        live: &Live,
        model: &str,
    ) -> Result<(), RpcError> {
        if *lock(&session.model) == model {
            return Ok(());
        }
        self.report_settings(session, live, model, None)
    }

    pub(super) fn report_settings(
        &self,
        session: &Session,
        live: &Live,
        model: &str,
        effort: Option<&str>,
    ) -> Result<(), RpcError> {
        if *lock(&session.model) == model && lock(&session.effort).as_deref() == effort {
            return Ok(());
        }
        model.clone_into(&mut lock(&session.model));
        *lock(&session.effort) = effort.map(str::to_owned);
        self.save(session, Some(live))?;
        self.notify_update(
            &session.id,
            json!({
                "sessionUpdate":"config_option_update", "configOptions":self.session_options(session),
            }),
        );
        Ok(())
    }

    pub(super) async fn sync_model(&self, session: &Session, live: &Live) {
        // Codex displays the effective model in its live footer even before the
        // first turn_context record. Claude's assistant records carry its ID.
        if self.options.kind != TuiAgent::Codex {
            return;
        }
        let Some(herdr) = &self.herdr else { return };
        let snapshot = tokio::time::timeout(Duration::from_secs(2), async {
            let info = herdr.agent_info(&live.name).await.ok()?;
            if !same_session(session, &info) {
                return None;
            }
            herdr.read_agent(&live.name).await.ok()
        })
        .await;
        let Ok(Some(screen)) = snapshot else { return };
        if let Some((model, effort)) = codex_footer(&screen)
            && let Err(error) = self.report_settings(session, live, model, Some(effort))
        {
            tracing::warn!(error = %error.message, "could not save native model");
        }
    }

    pub(super) async fn set_model(
        &self,
        session: &Arc<Session>,
        model: &str,
    ) -> Result<Value, RpcError> {
        tokio::time::timeout(Duration::from_secs(20), self.apply_model(session, model))
            .await
            .map_err(|_| {
                RpcError::internal(
                    "model change was not confirmed; check the native session in Herdr",
                )
            })?
    }

    async fn apply_model(&self, session: &Arc<Session>, model: &str) -> Result<Value, RpcError> {
        let current = lock(&session.model).clone();
        if !valid_model(model)
            || !self.model_options(&current)[0]["options"]
                .as_array()
                .is_some_and(|options| options.iter().any(|option| option["value"] == model))
        {
            return Err(RpcError::invalid("unsupported model"));
        }
        if session.prompt_pending.load(Ordering::SeqCst) {
            return Err(RpcError::invalid("cannot change model during a turn"));
        }
        // A short observer poll must not cause an otherwise idle model change
        // to fail. Active Macro prompts are rejected before and after waiting.
        let mut guard = tokio::time::timeout(Duration::from_secs(3), session.live.lock())
            .await
            .map_err(|_| RpcError::invalid("native session is busy; retry the selection"))?;
        if session.prompt_pending.load(Ordering::SeqCst) {
            return Err(RpcError::invalid("cannot change model during a turn"));
        }
        let Some(live) = guard.as_mut() else {
            model.clone_into(&mut lock(&session.model));
            *lock(&session.effort) = None;
            self.save(session, None)?;
            return Ok(json!({"configOptions":self.session_options(session)}));
        };
        if model == DEFAULT_MODEL {
            return Err(RpcError::invalid(
                "choose a specific model for a running native session",
            ));
        }
        let herdr = self
            .herdr
            .as_ref()
            .ok_or_else(|| RpcError::internal("Herdr is unavailable"))?;
        let info = herdr.agent_info(&live.name).await?;
        if !same_session(session, &info) || !matches!(info.status.as_str(), "idle" | "done") {
            return Err(RpcError::invalid(
                "finish the current native turn or dialog before changing model",
            ));
        }
        // Synchronize earlier model facts before applying the new setting.
        loop {
            let offset = live.cursor.offset;
            self.forward(session, live, &mut None)?;
            if live.cursor.offset == offset && live.pending.is_empty() {
                break;
            }
        }
        self.sync_model(session, live).await;
        if *lock(&session.model) == model {
            return Ok(json!({"configOptions":self.session_options(session)}));
        }
        let effort = self.native_selection(session, live, model, None).await?;
        self.report_settings(session, live, model, effort.as_deref())?;
        Ok(json!({"configOptions":self.session_options(session)}))
    }
    /// Drive only the recognized native picker, verifying the resulting setting.
    pub(super) async fn native_selection(
        &self,
        session: &Session,
        live: &Live,
        model: &str,
        effort: Option<&str>,
    ) -> Result<Option<String>, RpcError> {
        let herdr = self
            .herdr
            .as_ref()
            .ok_or_else(|| RpcError::internal("Herdr is unavailable"))?;
        let info = herdr.agent_info(&live.name).await?;
        if !same_session(session, &info) || !matches!(info.status.as_str(), "idle" | "done") {
            return Err(RpcError::invalid(
                "finish the current native turn or dialog before changing settings",
            ));
        }
        let before = herdr.read_agent(&live.name).await?;
        let check = herdr.agent_info(&live.name).await?;
        if !same_session(session, &check)
            || info.state_change_seq != check.state_change_seq
            || !matches!(check.status.as_str(), "idle" | "done")
        {
            return Err(RpcError::invalid(
                "native session changed; retry the selection",
            ));
        }
        tokio::time::timeout(Duration::from_secs(15), async {
            herdr
                .prompt_agent(
                    &live.name,
                    &match self.options.kind {
                        TuiAgent::Claude => format!("/model {model}"),
                        TuiAgent::Codex => "/model".to_owned(),
                    },
                )
                .await?;
            let mut stage = Stage::Model;
            loop {
                tokio::time::sleep(POLL).await;
                let info = herdr.agent_info(&live.name).await?;
                if !same_session(session, &info)
                    || !matches!(info.status.as_str(), "idle" | "done" | "blocked")
                {
                    return Err(RpcError::invalid(
                        "native session changed while selecting a model",
                    ));
                }
                let screen = herdr.read_agent(&live.name).await?;
                if (self.options.kind == TuiAgent::Claude || matches!(stage, Stage::Confirmation))
                    && confirmed(self.options.kind, model, &before, &screen)
                    && effort.is_none_or(|wanted| {
                        codex_footer(&screen).is_some_and(|(_, actual)| wanted == actual)
                    })
                {
                    return Ok(codex_footer(&screen).map(|(_, effort)| effort.to_owned()));
                }
                if self.options.kind == TuiAgent::Codex
                    && let Some((key, next)) = effort.map_or_else(
                        || picker_key(stage, model, &screen),
                        |effort| super::effort::picker_key(stage, model, effort, &screen),
                    )
                {
                    let check = herdr.agent_info(&live.name).await?;
                    if !same_session(session, &check)
                        || info.state_change_seq != check.state_change_seq
                        || herdr.read_agent(&live.name).await? != screen
                    {
                        return Err(RpcError::invalid(
                            "native model picker changed; retry the selection",
                        ));
                    }
                    herdr.send_keys(&live.name, &[&key]).await?;
                    stage = next;
                }
            }
        })
        .await
        .map_err(|_| {
            RpcError::internal(
                "model or effort change was not confirmed; check the native picker in Herdr",
            )
        })?
    }
}

fn valid_model(model: &str) -> bool {
    !model.is_empty()
        && !model.starts_with('/')
        && !model.chars().any(char::is_whitespace)
        && !model.chars().any(char::is_control)
}

pub(super) fn same_session(session: &Session, info: &super::super::cli::AgentInfo) -> bool {
    info.cwd.as_ref().is_none_or(|cwd| cwd == &session.cwd)
        && info
            .session_id
            .as_ref()
            .zip(lock(&session.native_id).as_ref())
            .is_none_or(|(actual, expected)| actual == expected)
}

#[derive(Clone, Copy)]
pub(super) enum Stage {
    Model,
    Effort,
    Confirmation,
    Advanced,
}

pub(super) fn picker_key(stage: Stage, model: &str, screen: &str) -> Option<(String, Stage)> {
    match stage {
        Stage::Model
            if screen
                .lines()
                .any(|line| line.trim() == "Select Model and Effort")
                && screen
                    .trim_end()
                    .ends_with("Press enter to confirm or esc to go back") =>
        {
            let section = screen.split_once("Select Model and Effort")?.1;
            for line in section.lines() {
                let line = line.trim().trim_start_matches('›').trim();
                let Some((number, rest)) = line.split_once(". ") else {
                    continue;
                };
                if number.len() == 1
                    && matches!(number.parse::<u8>(), Ok(1..=9))
                    && rest.split_whitespace().next() == Some(model)
                {
                    return Some((number.to_owned(), Stage::Effort));
                }
            }
            None
        }
        Stage::Effort
            if screen
                .lines()
                .any(|line| line.trim() == format!("Select Reasoning Level for {model}"))
                && screen
                    .trim_end()
                    .ends_with("Press enter to confirm or esc to go back") =>
        {
            // Do not accept a warning or the nested "More reasoning" menu.
            let selected = screen
                .lines()
                .find_map(|line| line.trim().strip_prefix('›'))?;
            let (_, level) = selected.trim().split_once(". ")?;
            if !["Low", "Medium", "High", "Extra high", "Max", "Ultra"]
                .iter()
                .any(|level_name| {
                    level == *level_name
                        || level
                            .strip_prefix(level_name)
                            .is_some_and(|rest| rest.starts_with(' '))
                })
            {
                return None;
            }
            Some(("enter".to_owned(), Stage::Confirmation))
        }
        _ => None,
    }
}

fn codex_footer_model(screen: &str) -> Option<&str> {
    codex_footer(screen).map(|(model, _)| model)
}

pub(super) fn codex_footer(screen: &str) -> Option<(&str, &str)> {
    let (_, footer) = screen.rsplit_once(['›', '»'])?;
    footer.lines().skip(1).find_map(|line| {
        let (left, _) = line.trim().split_once('·')?;
        let mut words = left.split_whitespace();
        let model = words.next()?;
        let effort = words.next()?;
        (valid_model(model)
            && matches!(
                effort,
                "default"
                    | "none"
                    | "minimal"
                    | "low"
                    | "medium"
                    | "high"
                    | "xhigh"
                    | "max"
                    | "ultra"
            ))
        .then_some((model, effort))
    })
}

fn confirmed(kind: TuiAgent, model: &str, before: &str, screen: &str) -> bool {
    match kind {
        TuiAgent::Codex => codex_footer_model(screen) == Some(model),
        TuiAgent::Claude => {
            // Old scrollback is not confirmation. Require a new native result
            // line; ambiguous/repeated screens stay unconfirmed.
            let result = |text: &str| {
                text.lines().rev().find_map(|line| {
                    let line = line.trim().trim_start_matches('⎿').trim();
                    line.strip_prefix("Set model to ").map(str::to_owned)
                })
            };
            let Some(selected) = result(screen) else {
                return false;
            };
            if result(before).as_deref() == Some(&selected) {
                return false;
            }
            let selected = selected.split(['(', ' ']).next().unwrap_or("");
            selected.eq_ignore_ascii_case(model)
                || selected.eq_ignore_ascii_case(model.strip_prefix("claude-").unwrap_or(model))
        }
    }
}

#[cfg(test)]
mod test;
