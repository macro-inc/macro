//! Drives the throwaway Slack window: opens it, watches it, reads from it, and
//! wipes and closes it on every way out.

use std::future::Future;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tauri::webview::{Cookie, NewWindowResponse};
use tauri::{Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};
use tokio::sync::{Notify, oneshot};
use url::Url;

use super::validation::{
    self, CLIENT_ORIGIN, CaptchaStatus, DEFAULT_SIGN_IN_URL, READ_LOCAL_CONFIG, SESSION_COOKIE,
    SESSION_COOKIE_DS,
};
use super::{SlackDesktopError, SlackDesktopSession, SlackSecret, WINDOW_LABEL};
use crate::AppRuntime;

/// How long the person has to finish in the window.
const TOTAL_TIMEOUT: Duration = Duration::from_secs(15 * 60);
/// How long Slack's web client gets to write its workspace tokens.
const SESSION_WAIT: Duration = Duration::from_secs(15);
/// How often the window is checked. Slack's client routes with `pushState`,
/// which fires no load event, so its URL and storage are sampled instead.
const POLL_INTERVAL: Duration = Duration::from_millis(500);
/// A script evaluation that never answers (mid-navigation) counts as no result.
const EVAL_TIMEOUT: Duration = Duration::from_secs(5);
const WINDOW_WIDTH: f64 = 480.0;
const WINDOW_HEIGHT: f64 = 720.0;
const SIGN_IN_TITLE: &str = "Sign in to Slack";
const CAPTCHA_TITLE: &str = "Verify with Slack";

pub(super) async fn sign_in(
    caller: tauri::Webview<AppRuntime>,
    sign_in_url: Option<String>,
) -> Result<SlackDesktopSession, SlackDesktopError> {
    let url = validation::slack_page_url(sign_in_url.as_deref().unwrap_or(DEFAULT_SIGN_IN_URL))?;
    let window = SlackWindow::open(&caller, url, SIGN_IN_TITLE)?;
    window.run(wait_for_session(&window)).await
}

pub(super) async fn captcha(
    caller: tauri::Webview<AppRuntime>,
    site_key: String,
    page_url: String,
) -> Result<String, SlackDesktopError> {
    let url = validation::slack_page_url(&page_url)?;
    let script = validation::captcha_script(&site_key);
    let window = SlackWindow::open(&caller, url, CAPTCHA_TITLE)?;
    window.run(wait_for_captcha(&window, script)).await
}

/// Waits for the window to reach Slack's web client, then for the client to
/// hold the session cookie and at least one workspace token.
async fn wait_for_session(window: &SlackWindow) -> Result<SlackDesktopSession, SlackDesktopError> {
    let mut ticks = tokio::time::interval(POLL_INTERVAL);
    let mut reached_client: Option<Instant> = None;

    loop {
        ticks.tick().await;
        let Some(url) = window.current_url().await else {
            continue;
        };
        if !validation::is_client_url(&url) {
            continue;
        }

        let reached = *reached_client.get_or_insert_with(Instant::now);
        if let Some(session) = read_session(window).await? {
            return Ok(session);
        }
        if reached.elapsed() >= SESSION_WAIT {
            return Err(SlackDesktopError::NoSession);
        }
    }
}

/// The session once Slack has written all of it, or `None` to try again.
async fn read_session(
    window: &SlackWindow,
) -> Result<Option<SlackDesktopSession>, SlackDesktopError> {
    let cookies = window.client_cookies().await?;
    let cookie_value = |name: &str| {
        cookies
            .iter()
            .find(|cookie| cookie.name() == name)
            .map(|cookie| SlackSecret(cookie.value().to_string()))
    };
    let Some(cookie) = cookie_value(SESSION_COOKIE) else {
        return Ok(None);
    };
    let cookie_ds = cookie_value(SESSION_COOKIE_DS);

    let result = window.evaluate(READ_LOCAL_CONFIG.to_string()).await?;
    let Some(local_config) = validation::local_config_from_eval(&result) else {
        return Ok(None);
    };
    let tokens = validation::web_client_tokens(&local_config);
    if tokens.is_empty() {
        return Ok(None);
    }

    Ok(Some(SlackDesktopSession {
        cookie,
        cookie_ds,
        tokens,
    }))
}

/// Installs the reCAPTCHA overlay once a slack.com page has loaded (again
/// after any reload) and waits for its token.
async fn wait_for_captcha(
    window: &SlackWindow,
    script: String,
) -> Result<String, SlackDesktopError> {
    let mut ticks = tokio::time::interval(POLL_INTERVAL);

    loop {
        ticks.tick().await;
        let Some(url) = window.current_url().await else {
            continue;
        };
        if !validation::is_slack_host(&url) {
            continue;
        }

        let result = window.evaluate(script.clone()).await?;
        let Some(state) = validation::captcha_state_from_eval(&result) else {
            continue;
        };
        match (state.status, state.token) {
            (CaptchaStatus::Solved, Some(token)) => return Ok(token),
            (CaptchaStatus::Failed, _) => return Err(SlackDesktopError::CaptchaUnavailable),
            (CaptchaStatus::Solved | CaptchaStatus::Loading | CaptchaStatus::Pending, _) => {}
        }
    }
}

/// Set while a Slack window exists, so a second call is `busy` without racing
/// the first to create the window.
static WINDOW_OPEN: AtomicBool = AtomicBool::new(false);

struct WindowSlot;

impl WindowSlot {
    fn claim() -> Option<Self> {
        WINDOW_OPEN
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_ok()
            .then_some(Self)
    }
}

impl Drop for WindowSlot {
    fn drop(&mut self) {
        WINDOW_OPEN.store(false, Ordering::Release);
    }
}

/// The open Slack window. Dropping it, on success, failure, timeout or a
/// cancelled command, wipes its profile and destroys it.
struct SlackWindow {
    window: WebviewWindow<AppRuntime>,
    closed: Arc<Notify>,
    _slot: WindowSlot,
}

impl SlackWindow {
    fn open(
        caller: &tauri::Webview<AppRuntime>,
        url: Url,
        title: &str,
    ) -> Result<Self, SlackDesktopError> {
        let app = caller.app_handle();
        let focus_existing = || {
            if let Some(existing) = app.get_webview_window(WINDOW_LABEL) {
                let _ = existing.set_focus();
            }
            SlackDesktopError::Busy
        };

        // The Slack window has no IPC capability, but refuse it here as well.
        if caller.label() == WINDOW_LABEL {
            return Err(SlackDesktopError::Busy);
        }
        let slot = WindowSlot::claim().ok_or_else(&focus_existing)?;
        // A previous window may still be tearing down.
        if app.get_webview_window(WINDOW_LABEL).is_some() {
            return Err(focus_existing());
        }

        let builder = WebviewWindowBuilder::new(app, WINDOW_LABEL, WebviewUrl::External(url))
            .title(title)
            .inner_size(WINDOW_WIDTH, WINDOW_HEIGHT)
            .center()
            .focused(true)
            .incognito(true)
            .on_navigation(validation::allows_navigation)
            .on_new_window(|url, _features| {
                if validation::allows_popup(&url) {
                    NewWindowResponse::Allow
                } else {
                    NewWindowResponse::Deny
                }
            });
        let builder = match app.get_webview_window(caller.label()) {
            Some(parent) => builder.parent(&parent).map_err(|error| {
                tracing::warn!(?error, "unable to parent the Slack window");
                SlackDesktopError::WindowFailed
            })?,
            None => builder,
        };
        let window = builder.build().map_err(|error| {
            tracing::warn!(?error, "unable to open the Slack window");
            SlackDesktopError::WindowFailed
        })?;

        let closed = Arc::new(Notify::new());
        window.on_window_event({
            let closed = closed.clone();
            move |event| {
                if matches!(event, WindowEvent::Destroyed) {
                    closed.notify_one();
                }
            }
        });

        Ok(Self {
            window,
            closed,
            _slot: slot,
        })
    }

    /// Runs `work` until it finishes, the person closes the window, or the
    /// total timeout passes.
    async fn run<T>(
        &self,
        work: impl Future<Output = Result<T, SlackDesktopError>>,
    ) -> Result<T, SlackDesktopError> {
        let watched = async {
            tokio::select! {
                () = self.closed.notified() => Err(SlackDesktopError::Cancelled),
                result = work => result,
            }
        };
        tokio::time::timeout(TOTAL_TIMEOUT, watched)
            .await
            .unwrap_or(Err(SlackDesktopError::TimedOut))
    }

    /// The page's URL, or `None` while it can't be read.
    async fn current_url(&self) -> Option<Url> {
        let window = self.window.clone();
        tokio::task::spawn_blocking(move || window.url())
            .await
            .ok()?
            .ok()
    }

    /// Cookies Slack's web client sends, HttpOnly included. Read off the
    /// async runtime: the runtime blocks until its event loop answers, and
    /// WebView2 deadlocks when asked from a command thread.
    async fn client_cookies(&self) -> Result<Vec<Cookie<'static>>, SlackDesktopError> {
        let window = self.window.clone();
        let origin = Url::parse(CLIENT_ORIGIN).map_err(|_| SlackDesktopError::WindowFailed)?;
        tokio::task::spawn_blocking(move || window.cookies_for_url(origin))
            .await
            .map_err(|_| SlackDesktopError::WindowFailed)?
            .map_err(|error| {
                tracing::warn!(?error, "unable to read the Slack window's cookies");
                SlackDesktopError::WindowFailed
            })
    }

    /// Evaluates `script` in the page and returns the JSON of its value; empty
    /// when the evaluation failed or did not answer.
    async fn evaluate(&self, script: String) -> Result<String, SlackDesktopError> {
        let (send, receive) = oneshot::channel();
        let send = Mutex::new(Some(send));
        self.window
            .eval_with_callback(script, move |result| {
                if let Ok(mut slot) = send.lock()
                    && let Some(send) = slot.take()
                {
                    let _ = send.send(result);
                }
            })
            .map_err(|error| {
                tracing::warn!(?error, "unable to evaluate in the Slack window");
                SlackDesktopError::WindowFailed
            })?;

        match tokio::time::timeout(EVAL_TIMEOUT, receive).await {
            Ok(Ok(result)) => Ok(result),
            Ok(Err(_)) | Err(_) => Ok(String::new()),
        }
    }
}

impl Drop for SlackWindow {
    fn drop(&mut self) {
        let _ = self
            .window
            .clear_all_browsing_data()
            .inspect_err(|error| tracing::warn!(?error, "unable to clear the Slack window"));
        let _ = self
            .window
            .destroy()
            .inspect_err(|error| tracing::warn!(?error, "unable to close the Slack window"));
    }
}
