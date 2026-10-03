use std::path::Path;
use std::time::Duration;

use crossterm::event::Event as TermEvent;
use rootcause::prelude::ResultExt as _;

use super::app::{App, Mode};
use super::config_form::ConfigForm;
use super::input::read_event;
use super::logging::LogBuffer;
use super::platform::open_pending_browser;
use super::quickstart::{Quickstart, QuickstartAction};
use super::ui;
use crate::config::Config;

#[cfg(test)]
mod test;

/// Spinner cadence and input latency budget.
const TICK: Duration = Duration::from_millis(120);

/// Run the control panel - and the daemon inside it - until the user quits.
pub async fn run(config_path: &Path, logs: LogBuffer) -> rootcause::Result<()> {
    let mut terminal = ratatui::init();
    let existing_config = match Config::load(config_path) {
        Ok(config) => Some(config),
        Err(crate::config::ConfigError::Io { source, .. })
            if source.kind() == std::io::ErrorKind::NotFound =>
        {
            None
        }
        Err(error) => {
            ratatui::restore();
            return Err(error.into());
        }
    };
    let needs_quickstart = existing_config
        .as_ref()
        .is_none_or(|config| !config_is_working(config));
    let quickstarted = if !needs_quickstart {
        false
    } else {
        match run_quickstart(&mut terminal, config_path, existing_config.as_ref()).await {
            Ok(created) => created,
            Err(error) => {
                ratatui::restore();
                return Err(error);
            }
        }
    };
    if needs_quickstart && !quickstarted {
        ratatui::restore();
        return Ok(());
    }
    if !config_path.exists() {
        ratatui::restore();
        return Ok(());
    }
    let mut app = match App::load(config_path, logs) {
        Ok(app) => app,
        Err(error) => {
            ratatui::restore();
            return Err(error);
        }
    };
    let outcome = run_loop(&mut terminal, &mut app, quickstarted).await;
    ratatui::restore();
    outcome
}

async fn run_quickstart(
    terminal: &mut ratatui::DefaultTerminal,
    config_path: &Path,
    existing_config: Option<&Config>,
) -> rootcause::Result<bool> {
    let mut quickstart = match existing_config {
        Some(config) => Quickstart::from_config(config),
        None => Quickstart::new()?,
    };
    loop {
        terminal
            .draw(|frame| ui::render_quickstart(frame, &quickstart, config_path))
            .context("failed to draw Quickstart")?;
        let event = read_event()
            .await
            .context("failed to read terminal input")?;
        let TermEvent::Key(key) = event else {
            continue;
        };
        match quickstart.on_key(key) {
            QuickstartAction::Continue => {}
            QuickstartAction::Quit => return Ok(false),
            QuickstartAction::Create => {
                let Some(agent) = quickstart.selected_agent.clone() else {
                    quickstart.status =
                        Some(("Press Enter on Agent to choose one".to_owned(), true));
                    continue;
                };
                let workspace = match std::path::absolute(&quickstart.workspace) {
                    Ok(workspace) => workspace,
                    Err(error) => {
                        quickstart.status =
                            Some((format!("Could not resolve the workspace: {error}"), true));
                        continue;
                    }
                };
                if !workspace.is_dir() {
                    quickstart.status = Some((
                        format!("Workspace does not exist: {}", workspace.display()),
                        true,
                    ));
                    continue;
                }
                if let Some(install) = agent.pending_install() {
                    // Drawn before the wait: nothing else repaints until npm
                    // returns.
                    quickstart.status = Some((format!("Installing {}...", install.package), false));
                    terminal
                        .draw(|frame| ui::render_quickstart(frame, &quickstart, config_path))
                        .context("failed to draw Quickstart")?;
                    if let Err(error) = install.run().await {
                        quickstart.status = Some((error, true));
                        continue;
                    }
                }
                let saved = if existing_config.is_some() {
                    ConfigForm::load(config_path).and_then(|mut form| {
                        form.apply_quickstart(&agent, &workspace, quickstart.scope);
                        form.set_permission_bypass(quickstart.allow_permission_bypass);
                        form.save()
                    })
                } else {
                    ConfigForm::create(config_path, &agent, &workspace).and_then(|()| {
                        let mut form = ConfigForm::load(config_path)?;
                        form.set_scope(quickstart.scope);
                        form.set_permission_bypass(quickstart.allow_permission_bypass);
                        form.save()
                    })
                };
                match saved {
                    Ok(()) => {
                        let config = Config::load(config_path)?;
                        match setup_mcp(terminal, &agent, &config).await {
                            Ok(()) => return Ok(true),
                            Err(error) => quickstart.status = Some((format!("{error}"), true)),
                        }
                    }
                    Err(error) => quickstart.status = Some((format!("{error}"), true)),
                }
            }
        }
    }
}

fn config_is_working(config: &Config) -> bool {
    config
        .credentials
        .as_ref()
        .is_some_and(crate::config::HarnessCredentials::is_valid)
}

async fn run_loop(
    terminal: &mut ratatui::DefaultTerminal,
    app: &mut App,
    pair_on_start: bool,
) -> rootcause::Result<()> {
    let mut tick = tokio::time::interval(TICK);
    // Paired already? Start serving before the first frame.
    if app.paired() {
        app.restart_daemon().await;
    }
    app.refresh().await;
    if pair_on_start {
        app.start_pairing().await;
        apply_pending_browser(app);
    }

    loop {
        terminal
            .draw(|frame| ui::render(frame, app))
            .context("failed to draw the terminal UI")?;

        tokio::select! {
            event = read_event() => {
                if let TermEvent::Key(key) = event.context("failed to read terminal input")? {
                    app.on_key(key).await;
                }
                apply_pending_browser(app);
            }
            _ = tick.tick() => {
                app.spinner = app.spinner.wrapping_add(1);
                app.poll_pairing().await;
                app.poll_install().await;
                if matches!(app.mode, Mode::Normal) {
                    app.maybe_refresh().await;
                }
            }
        }

        if app.quit {
            app.stop_daemon().await;
            return Ok(());
        }
        if let Some(agent) = app.pending_agent_setup.take() {
            match setup_mcp(terminal, &agent, &app.config).await {
                Ok(()) => app.apply_agent(&agent).await,
                Err(error) => app.fail(format!("{error}")),
            }
        }
    }
}

async fn setup_mcp(
    terminal: &mut ratatui::DefaultTerminal,
    agent: &super::agent_catalog::DetectedAgent,
    config: &Config,
) -> rootcause::Result<()> {
    let url = config.macro_api.mcp_url()?;
    let plan = agent.mcp_setup(&url);
    ratatui::restore();
    eprintln!(
        "\nSet up Macro MCP for {}. Complete the browser sign-in when prompted.",
        agent.name
    );
    let result = match plan {
        Some(plan) => {
            plan.run(&crate::outbound::harness_setup::NativeSetup {
                cwd: &config.workspace.path,
            })
            .await
        }
        None => {
            eprintln!(
                "Custom ACP commands have no standard MCP installer. Configure a remote HTTP server named macro at {url} in your harness and authenticate it."
            );
            eprintln!("Type ready once that is complete, or press Enter to return to setup:");
            let mut answer = String::new();
            match std::io::stdin().read_line(&mut answer) {
                Ok(_) if answer.trim() == "ready" => Ok(()),
                Ok(_) => Err(rootcause::report!("Custom harness MCP setup is incomplete")),
                Err(error) => Err(error.into()),
            }
        }
    };
    if let Err(error) = &result {
        eprintln!("\n{error}\nPress Enter to return to setup.");
        let mut answer = String::new();
        let _ = std::io::stdin().read_line(&mut answer);
    }
    *terminal = ratatui::init();
    result
}

fn apply_pending_browser(app: &mut App) {
    if let Some((message, is_error)) = open_pending_browser(&mut app.pending_browser) {
        if is_error {
            app.fail(message);
        } else {
            app.ok(message);
        }
    }
}
