//! Actionable freedesktop notifications. Keep the D-Bus connection alive until
//! activation/dismissal and forward the compositor's token to GTK on Wayland.

use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

use gtk::prelude::*;
use serde::Serialize;
use tauri::{Manager, Runtime, State, WebviewWindow, ipc::Channel};
use tokio::sync::{OnceCell, oneshot};
use uuid::Uuid;

mod transport;
use transport::{Notification, Outcome};

#[derive(Clone, Default)]
pub struct LinuxNotifications {
    pending: Arc<Mutex<HashMap<Uuid, Pending>>>,
    connection: Arc<OnceCell<zbus::Connection>>,
}

struct Pending {
    window: String,
    close: oneshot::Sender<()>,
}

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum NotificationEvent {
    Click,
    Dismissed,
}

impl LinuxNotifications {
    pub fn close_window(&self, label: &str) {
        // Dropping the senders also wakes the notification tasks for cleanup.
        self.pending
            .lock()
            .unwrap()
            .retain(|_, pending| pending.window != label);
    }
}

#[tauri::command]
pub async fn send_linux_notification<R: Runtime>(
    window: WebviewWindow<R>,
    state: State<'_, LinuxNotifications>,
    title: String,
    body: Option<String>,
    icon: Option<String>,
    on_event: Channel<NotificationEvent>,
) -> Result<String, String> {
    // Share one bus connection across sends, including concurrent first sends.
    // Failed initialization leaves the cell empty so the next send can retry.
    let connection = state
        .connection
        .get_or_try_init(zbus::Connection::session)
        .await
        .map_err(|e| e.to_string())?
        .clone();
    let notification = Notification::show(
        connection,
        &window.app_handle().config().identifier,
        &title,
        body.as_deref(),
        icon.as_deref(),
    )
    .await
    .map_err(|e| e.to_string())?;
    // This key identifies our handle, not a server ID that could be reused after
    // a daemon restart. A different webview cannot close this window's handles.
    let key = Uuid::new_v4();
    let (close, closed) = oneshot::channel();
    let state = state.inner().clone();
    state.pending.lock().unwrap().insert(
        key,
        Pending {
            window: window.label().to_owned(),
            close,
        },
    );
    tauri::async_runtime::spawn(async move {
        let outcome = notification.wait(closed).await;
        state.pending.lock().unwrap().remove(&key);
        match outcome {
            Ok(Outcome::Activated(token)) => {
                // GTK calls must run on the UI thread. window.focus() in JS has
                // neither a native window handle nor the Wayland activation token.
                let target = window.clone();
                if let Err(error) = window.run_on_main_thread(move || {
                    match target.gtk_window() {
                        Ok(gtk_window) => {
                            if let Some(token) = token {
                                gtk_window.set_startup_id(&token);
                            }
                            gtk_window.deiconify();
                            gtk_window.present();
                        }
                        Err(error) => {
                            tracing::warn!(?error, "Unable to activate notification window")
                        }
                    }
                    let _ = on_event.send(NotificationEvent::Click);
                }) {
                    tracing::warn!(?error, "Unable to dispatch notification click");
                }
            }
            result => {
                if let Err(error) = result {
                    tracing::warn!(?error, "Linux notification listener failed");
                }
                let _ = on_event.send(NotificationEvent::Dismissed);
            }
        }
    });
    Ok(key.to_string())
}

#[tauri::command]
pub fn close_linux_notification<R: Runtime>(
    window: WebviewWindow<R>,
    state: State<'_, LinuxNotifications>,
    id: String,
) -> Result<(), String> {
    let key = Uuid::parse_str(&id).map_err(|e| e.to_string())?;
    let mut pending = state.pending.lock().unwrap();
    if let Some(notification) = pending.get(&key) {
        if notification.window != window.label() {
            return Err("Notification belongs to a different window".into());
        }
        if let Some(notification) = pending.remove(&key) {
            let _ = notification.close.send(());
        }
    }
    Ok(())
}
