//! Defers mobile WKWebView termination reloads while the app is backgrounded.
//!
//! On iOS, `WKWebView` terminates its WebContent process after background runs
//! or under memory pressure. Calling `webview.reload()` unconditionally inside
//! `on_web_content_process_terminate` while the app is suspended causes a
//! background kill -> reload -> kill spiral. Instead, keep recording every
//! termination immediately, defer reloading backgrounded webviews, and reload
//! them once `WindowEvent::Resumed` returns the app to the foreground.

use std::collections::HashSet;
use std::sync::Mutex;

#[derive(Default)]
struct RecoveryState {
    backgrounded: bool,
    pending_reloads: HashSet<String>,
}

/// Tracks mobile foreground/background state and webviews awaiting a deferred
/// reload after a background WebContent termination.
#[derive(Default)]
pub(crate) struct WebContentRecovery {
    state: Mutex<RecoveryState>,
}

impl WebContentRecovery {
    /// Marks the mobile app as backgrounded (`WindowEvent::Suspended`).
    #[cfg_attr(not(mobile), allow(dead_code))]
    pub(crate) fn on_suspended(&self) {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        state.backgrounded = true;
    }

    /// Handles a WebContent process termination for `label`.
    ///
    /// Returns `true` if the caller should reload the webview immediately
    /// (foreground), or `false` if the reload was deferred until resume.
    #[cfg_attr(not(mobile), allow(dead_code))]
    pub(crate) fn on_terminated(&self, label: &str) -> bool {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        if state.backgrounded {
            state.pending_reloads.insert(label.to_owned());
            false
        } else {
            true
        }
    }

    /// Marks the mobile app as foregrounded (`WindowEvent::Resumed`) and
    /// returns `true` if `label` has a deferred termination reload to run now.
    #[cfg_attr(not(mobile), allow(dead_code))]
    pub(crate) fn on_resumed(&self, label: &str) -> bool {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        state.backgrounded = false;
        state.pending_reloads.remove(label)
    }
}

#[cfg(test)]
mod tests {
    use super::WebContentRecovery;

    #[test]
    fn foreground_termination_reloads_immediately() {
        let recovery = WebContentRecovery::default();
        assert!(recovery.on_terminated("main"));
        assert!(!recovery.on_resumed("main"));
    }

    #[test]
    fn background_termination_defers_reload_until_resume() {
        let recovery = WebContentRecovery::default();
        recovery.on_suspended();

        assert!(!recovery.on_terminated("main"));
        // Repeated background terminations stay deduplicated.
        assert!(!recovery.on_terminated("main"));

        assert!(recovery.on_resumed("main"));
        // Resuming again does not trigger a second reload.
        assert!(!recovery.on_resumed("main"));
        // Subsequent foreground terminations reload immediately again.
        assert!(recovery.on_terminated("main"));
    }

    #[test]
    fn resume_without_background_termination_does_not_reload() {
        let recovery = WebContentRecovery::default();
        recovery.on_suspended();
        assert!(!recovery.on_resumed("main"));
    }

    #[test]
    fn pending_reloads_are_scoped_by_webview_label() {
        let recovery = WebContentRecovery::default();
        recovery.on_suspended();
        assert!(!recovery.on_terminated("main"));

        assert!(!recovery.on_resumed("other"));
        assert!(recovery.on_resumed("main"));
    }
}
