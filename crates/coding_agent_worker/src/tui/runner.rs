use std::path::Path;
use std::time::Duration;

use crossterm::event::Event as TermEvent;
use rootcause::prelude::ResultExt as _;

use super::app::{App, Mode};
use super::config_form::ConfigForm;
use super::logging::LogBuffer;
use super::platform::open_pending_browser;
use super::quickstart::{Quickstart, QuickstartAction};
use super::ui;
use crate::config::Config;
use crate::daemon::InheritedAgent;
use crate::update::{self, StagedUpdate};

/// What the caller does once the panel hands over to an updated macrod.
#[cfg(unix)]
pub struct Restart {
    /// The new binary, in place.
    pub installed: update::Installed,
    /// The running agent, for the new binary to keep relaying.
    pub agent: Option<InheritedAgent>,
}

/// Windows never restarts into an update; the launcher starts it next time.
#[cfg(not(unix))]
pub type Restart = std::convert::Infallible;

#[cfg(test)]
mod test;

/// Spinner cadence and input latency budget.
const TICK: Duration = Duration::from_millis(120);

/// Run the control panel - and the daemon inside it - until the user quits,
/// or until a self-update is installed and the caller should relaunch.
/// `inherited` is the agent a previous macrod handed over.
pub async fn run(
    config_path: &Path,
    logs: LogBuffer,
    inherited: Option<InheritedAgent>,
) -> rootcause::Result<Option<Restart>> {
    let (input_tx, mut input_rx) = tokio::sync::mpsc::unbounded_channel();
    // A dedicated thread owns the blocking crossterm read; the loop below
    // stays async and free to poll the network.
    std::thread::spawn(move || {
        while let Ok(event) = crossterm::event::read() {
            if input_tx.send(event).is_err() {
                return;
            }
        }
    });

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
        match run_quickstart(
            &mut terminal,
            config_path,
            existing_config.as_ref(),
            &mut input_rx,
        )
        .await
        {
            Ok(created) => created,
            Err(error) => {
                ratatui::restore();
                return Err(error);
            }
        }
    };
    if needs_quickstart && !quickstarted {
        ratatui::restore();
        return Ok(None);
    }
    if !config_path.exists() {
        ratatui::restore();
        return Ok(None);
    }
    let mut app = match App::load(config_path, logs, inherited) {
        Ok(app) => app,
        Err(error) => {
            ratatui::restore();
            return Err(error);
        }
    };
    let outcome = run_loop(&mut terminal, &mut app, &mut input_rx, quickstarted).await;
    ratatui::restore();
    outcome
}

async fn run_quickstart(
    terminal: &mut ratatui::DefaultTerminal,
    config_path: &Path,
    existing_config: Option<&Config>,
    input: &mut tokio::sync::mpsc::UnboundedReceiver<TermEvent>,
) -> rootcause::Result<bool> {
    let mut quickstart = match existing_config {
        Some(config) => Quickstart::from_config(config),
        None => Quickstart::new()?,
    };
    loop {
        terminal
            .draw(|frame| ui::render_quickstart(frame, &quickstart, config_path))
            .context("failed to draw Quickstart")?;
        let Some(event) = input.recv().await else {
            return Ok(false);
        };
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
                        return Ok(true);
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
    input: &mut tokio::sync::mpsc::UnboundedReceiver<TermEvent>,
    pair_on_start: bool,
) -> rootcause::Result<Option<Restart>> {
    let mut tick = tokio::time::interval(TICK);
    let mut poller = update::start_poller(app.config.update.auto);
    let mut staged: Option<StagedUpdate> = None;
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
            event = input.recv() => {
                match event {
                    Some(TermEvent::Key(key)) => app.on_key(key).await,
                    Some(_) => {}
                    None => return Ok(None),
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
                if let Some(update) = poller.as_mut().and_then(|poller| poller.staged.try_recv().ok()) {
                    poller = None;
                    if cfg!(windows) {
                        // Installed beside this one; the launcher starts it next time.
                        app.update_ready = Some(update.tag().to_owned());
                    } else {
                        app.ok(format!("macrod {} is ready; restarting once no turn is running", update.tag()));
                        staged = Some(update);
                    }
                }
                #[cfg(unix)]
                if let Some(installed) = install_when_idle(app, &mut staged) {
                    let agent = match app.daemon.take() {
                        Some(daemon) => daemon.hand_off().await,
                        None => None,
                    };
                    return Ok(Some(Restart { installed, agent }));
                }
            }
        }

        if app.quit {
            app.stop_daemon().await;
            return Ok(None);
        }
    }
}

/// Swap in a staged update once nothing would be cut short: no agent turn
/// running and no edit, pairing, or install open in the panel.
///
/// The agent process survives the restart, but the service ends a turn
/// when its runtime connection closes, so a turn in flight would still be
/// cut off in Macro: the swap waits for one to finish.
#[cfg(unix)]
fn install_when_idle(
    app: &mut App,
    staged: &mut Option<StagedUpdate>,
) -> Option<update::Installed> {
    let idle = matches!(app.mode, Mode::Normal)
        && app.daemon.as_ref().is_none_or(|daemon| daemon.is_idle());
    if !idle {
        return None;
    }
    let update = staged.take()?;
    let tag = update.tag().to_owned();
    match update.swap() {
        Ok(installed) => Some(installed),
        Err(error) => {
            app.fail(format!("Could not install macrod {tag}: {error}"));
            None
        }
    }
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
