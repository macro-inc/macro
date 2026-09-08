#[cfg(test)]
mod test;

use crossterm::event::{KeyCode, KeyEvent, KeyEventKind, KeyModifiers};
use rootcause::prelude::ResultExt as _;
use tui_input::Input;

use super::agent_catalog::{self, AgentKind, DetectedAgent, PathCommands};
use super::input::handle_text_input;
use super::platform::{BYO_AGENT_URL, browser_status, launch_browser_helper};
use crate::config::{Config, IdentityScope};

/// Editable state shown until `macrod.toml` has a working credential.
pub(crate) struct Quickstart {
    pub(crate) agents: Vec<DetectedAgent>,
    pub(crate) selected_agent: Option<DetectedAgent>,
    pub(crate) focus: QuickstartFocus,
    pub(crate) workspace: String,
    pub(crate) scope: IdentityScope,
    pub(crate) mode: QuickstartMode,
    pub(crate) status: Option<(String, bool)>,
}

/// Keyboard focus inside Quickstart.
pub(crate) enum QuickstartMode {
    Normal,
    CustomAgent { buffer: Input },
    EditWorkspace { buffer: Input },
}

/// Focused control in the flat Quickstart form.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum QuickstartFocus {
    Agent(usize),
    Workspace,
    Scope,
    Submit,
}

pub(crate) enum QuickstartAction {
    Continue,
    Create,
    Quit,
}

impl Quickstart {
    pub(crate) fn new() -> rootcause::Result<Self> {
        let workspace = std::env::current_dir()
            .context("failed to find the current directory for Quickstart")?
            .display()
            .to_string();
        Ok(Self {
            agents: agent_catalog::discover(&PathCommands::discover()),
            selected_agent: None,
            focus: QuickstartFocus::Agent(0),
            workspace,
            scope: IdentityScope::Private,
            mode: QuickstartMode::Normal,
            status: None,
        })
    }

    pub(crate) fn from_config(config: &Config) -> Self {
        Self::from_config_with_agents(config, agent_catalog::discover(&PathCommands::discover()))
    }

    fn from_config_with_agents(config: &Config, agents: Vec<DetectedAgent>) -> Self {
        let selected_agent = agents
            .iter()
            .find(|agent| {
                agent.launch.command == config.harness.command
                    && agent.launch.args == config.harness.args
            })
            .cloned()
            .or_else(|| {
                Some(DetectedAgent {
                    kind: AgentKind::Custom,
                    name: "Custom command",
                    launch: super::agent_catalog::LaunchSpec {
                        command: config.harness.command.clone(),
                        args: config.harness.args.clone(),
                    },
                    note: None,
                })
            });
        let focus = selected_agent
            .as_ref()
            .and_then(|selected| agents.iter().position(|agent| agent.kind == selected.kind))
            .map_or(QuickstartFocus::Agent(agents.len()), QuickstartFocus::Agent);
        Self {
            agents,
            selected_agent,
            focus,
            workspace: config.workspace.path.display().to_string(),
            scope: config.identity.scope,
            mode: QuickstartMode::Normal,
            status: None,
        }
    }

    pub(crate) fn on_key(&mut self, key: KeyEvent) -> QuickstartAction {
        if key.kind != KeyEventKind::Press {
            return QuickstartAction::Continue;
        }
        if key.code == KeyCode::Char('c') && key.modifiers.contains(KeyModifiers::CONTROL) {
            return QuickstartAction::Quit;
        }
        match &mut self.mode {
            QuickstartMode::Normal => match key.code {
                KeyCode::Char('q') => QuickstartAction::Quit,
                KeyCode::Up | KeyCode::BackTab | KeyCode::Char('k') => {
                    self.focus = match self.focus {
                        QuickstartFocus::Agent(index) => {
                            QuickstartFocus::Agent(index.saturating_sub(1))
                        }
                        QuickstartFocus::Workspace => QuickstartFocus::Agent(self.agents.len()),
                        QuickstartFocus::Scope => QuickstartFocus::Workspace,
                        QuickstartFocus::Submit => QuickstartFocus::Scope,
                    };
                    QuickstartAction::Continue
                }
                KeyCode::Down | KeyCode::Tab | KeyCode::Char('j') => {
                    self.focus = match self.focus {
                        QuickstartFocus::Agent(index) if index < self.agents.len() => {
                            QuickstartFocus::Agent(index + 1)
                        }
                        QuickstartFocus::Agent(_) => QuickstartFocus::Workspace,
                        QuickstartFocus::Workspace => QuickstartFocus::Scope,
                        QuickstartFocus::Scope | QuickstartFocus::Submit => QuickstartFocus::Submit,
                    };
                    QuickstartAction::Continue
                }
                KeyCode::Char('?') if self.focus == QuickstartFocus::Agent(self.agents.len()) => {
                    self.status = Some(browser_status(launch_browser_helper(BYO_AGENT_URL)));
                    QuickstartAction::Continue
                }
                KeyCode::Enter => match self.focus {
                    QuickstartFocus::Agent(index) if index == self.agents.len() => {
                        let value = self
                            .selected_agent
                            .as_ref()
                            .filter(|agent| agent.kind == AgentKind::Custom)
                            .map(|agent| {
                                shell_words::join(
                                    std::iter::once(agent.launch.command.as_str())
                                        .chain(agent.launch.args.iter().map(String::as_str)),
                                )
                            })
                            .unwrap_or_default();
                        self.mode = QuickstartMode::CustomAgent {
                            buffer: value.into(),
                        };
                        QuickstartAction::Continue
                    }
                    QuickstartFocus::Agent(index) => {
                        self.selected_agent = self.agents.get(index).cloned();
                        self.status = None;
                        QuickstartAction::Continue
                    }
                    QuickstartFocus::Workspace => {
                        self.mode = QuickstartMode::EditWorkspace {
                            buffer: self.workspace.clone().into(),
                        };
                        QuickstartAction::Continue
                    }
                    QuickstartFocus::Scope => {
                        self.scope = match self.scope {
                            IdentityScope::Private => IdentityScope::Team,
                            IdentityScope::Team => IdentityScope::Private,
                        };
                        QuickstartAction::Continue
                    }
                    QuickstartFocus::Submit if self.selected_agent.is_none() => {
                        self.status =
                            Some(("Choose an agent harness before continuing".to_owned(), true));
                        QuickstartAction::Continue
                    }
                    QuickstartFocus::Submit => QuickstartAction::Create,
                },
                _ => QuickstartAction::Continue,
            },
            QuickstartMode::CustomAgent { buffer } => match key.code {
                KeyCode::Esc => {
                    self.mode = QuickstartMode::Normal;
                    self.focus = QuickstartFocus::Agent(self.agents.len());
                    QuickstartAction::Continue
                }
                KeyCode::Enter => match agent_catalog::custom(buffer.value()) {
                    Ok(agent) => {
                        self.selected_agent = Some(agent);
                        self.status = None;
                        self.mode = QuickstartMode::Normal;
                        QuickstartAction::Continue
                    }
                    Err(error) => {
                        self.status = Some((error, true));
                        QuickstartAction::Continue
                    }
                },
                _ => {
                    handle_text_input(buffer, key);
                    QuickstartAction::Continue
                }
            },
            QuickstartMode::EditWorkspace { buffer } => match key.code {
                KeyCode::Esc => {
                    self.mode = QuickstartMode::Normal;
                    QuickstartAction::Continue
                }
                KeyCode::Enter if buffer.value().trim().is_empty() => {
                    self.status = Some(("Workspace must not be empty".to_owned(), true));
                    QuickstartAction::Continue
                }
                KeyCode::Enter => {
                    self.workspace = buffer.value().trim().to_owned();
                    self.mode = QuickstartMode::Normal;
                    QuickstartAction::Continue
                }
                _ => {
                    handle_text_input(buffer, key);
                    QuickstartAction::Continue
                }
            },
        }
    }
}
