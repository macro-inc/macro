//! Launch-scoped desktop diagnostics. Sampling lives outside the webview so a
//! backgrounded or reloaded frontend cannot stop the memory timeline.

use std::collections::VecDeque;
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::Manager;
use uuid::Uuid;

pub mod events;
#[cfg(target_os = "ios")]
mod ios;
#[cfg(desktop)]
mod launch;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(test)]
mod test;

const SAMPLE_INTERVAL: Duration = Duration::from_secs(1);
// One hour of samples, bounded even if the webview stops consuming them.
const MAX_SAMPLES: usize = 3600;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Identity {
    instance_id: String,
    recording_id: Option<String>,
    traces_url: Option<String>,
    native_version: String,
    os: &'static str,
    host_pid: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ProcessRole {
    Native,
    WebContent,
    Gpu,
    Network,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessMemory {
    pid: u32,
    role: ProcessRole,
    resident_bytes: u64,
    footprint_bytes: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FrontendStatus {
    Available,
    Partial,
    Unavailable,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemorySample {
    sequence: u64,
    timestamp_ms: u64,
    processes: Vec<ProcessMemory>,
    frontend_status: FrontendStatus,
    error: Option<String>,
}

#[derive(Default)]
struct SampleBuffer {
    sequence: u64,
    samples: VecDeque<MemorySample>,
}

impl SampleBuffer {
    fn push(&mut self, mut sample: MemorySample) {
        self.sequence += 1;
        sample.sequence = self.sequence;
        self.samples.push_back(sample);
        if self.samples.len() > MAX_SAMPLES {
            self.samples.pop_front();
        }
    }

    fn read(&self, after_sequence: u64) -> (Vec<MemorySample>, u64) {
        let dropped = self.samples.front().map_or(0, |sample| {
            sample
                .sequence
                .saturating_sub(after_sequence.saturating_add(1))
        });
        let samples = self
            .samples
            .iter()
            .filter(|sample| sample.sequence > after_sequence)
            .cloned()
            .collect();
        (samples, dropped)
    }
}

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebContentDiagnostics {
    terminations: u64,
    last_termination_ms: Option<u64>,
}

impl WebContentDiagnostics {
    fn record_termination(&mut self, timestamp_ms: u64) {
        self.terminations += 1;
        self.last_termination_ms = Some(timestamp_ms);
    }
}

pub struct Diagnostics {
    identity: Identity,
    buffer: Mutex<SampleBuffer>,
    web_content: Mutex<WebContentDiagnostics>,
    events: Mutex<events::EventBuffer>,
}

impl Diagnostics {
    pub fn from_launch() -> Self {
        #[cfg(desktop)]
        let (recording_id, traces_url) = launch::configuration();
        #[cfg(mobile)]
        let (recording_id, traces_url) = (None, None);
        Self {
            identity: Identity {
                instance_id: Uuid::new_v4().to_string(),
                recording_id,
                traces_url,
                native_version: String::new(),
                os: std::env::consts::OS,
                host_pid: std::process::id(),
            },
            buffer: Mutex::new(SampleBuffer::default()),
            web_content: Mutex::new(WebContentDiagnostics::default()),
            events: Mutex::new(events::EventBuffer::default()),
        }
    }

    pub fn is_recording(&self) -> bool {
        self.identity.recording_id.is_some()
    }

    /// Retain process termination evidence outside the WebView being reloaded.
    pub fn record_web_content_termination(&self) -> Result<(), String> {
        self.record_native_event(events::NativeEvent::WebContentTerminated);
        let mut web_content = self.web_content.lock().map_err(|e| e.to_string())?;
        web_content.record_termination(
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64,
        );
        Ok(())
    }

    pub fn record_native_event(&self, event: events::NativeEvent) {
        if let Ok(mut buffer) = self.events.lock() {
            buffer.native(event, timestamp_ms());
        }
    }
}

fn timestamp_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[tauri::command]
pub fn record_frontend_diagnostic(
    state: tauri::State<'_, Diagnostics>,
    frontend_instance_id: Uuid,
    event: events::FrontendEvent,
) -> Result<(), String> {
    state.events.lock().map_err(|e| e.to_string())?.frontend(
        frontend_instance_id,
        event,
        timestamp_ms(),
    );
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    identity: Identity,
    samples: Vec<MemorySample>,
    dropped_samples: u64,
    web_content: WebContentDiagnostics,
    bundle_reloads: Option<macro_bundle_updater_plugin::inbound::plugin::BundleReloadDiagnostics>,
    recent_events: events::EventSnapshot,
}

#[tauri::command]
pub fn read_desktop_diagnostics<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    state: tauri::State<'_, Diagnostics>,
    after_sequence: Option<u64>,
) -> Result<Snapshot, String> {
    let buffer = state.buffer.lock().map_err(|e| e.to_string())?;
    let (samples, dropped_samples) = buffer.read(after_sequence.unwrap_or(0));
    Ok(Snapshot {
        identity: state.identity.clone(),
        samples,
        dropped_samples,
        web_content: state.web_content.lock().map_err(|e| e.to_string())?.clone(),
        bundle_reloads: macro_bundle_updater_plugin::inbound::plugin::bundle_reload_diagnostics(
            &app_handle,
        ),
        recent_events: state.events.lock().map_err(|e| e.to_string())?.snapshot(),
    })
}

pub fn setup<R: tauri::Runtime>(app: &tauri::App<R>, mut diagnostics: Diagnostics) {
    diagnostics.identity.native_version = app.package_info().version.to_string();
    let recording = diagnostics.is_recording();
    if let Some(id) = &diagnostics.identity.recording_id {
        tracing::info!(recording_id = %id, instance_id = %diagnostics.identity.instance_id,
            "Desktop memory recording started");
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.set_title(&format!("Macro — Recording {}", &id[..8]));
        }
    }
    app.manage(diagnostics);
    #[cfg(target_os = "ios")]
    ios::observe_memory_warnings(app.handle().clone());
    if !recording {
        return;
    }

    #[cfg(target_os = "macos")]
    {
        let handle = app.handle().clone();
        // Sampling uses blocking OS calls; keep it off both the UI and async threads.
        std::thread::spawn(move || {
            loop {
                let mut sample = macos::sample(std::process::id());
                sample.timestamp_ms = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis() as u64;
                let state = handle.state::<Diagnostics>();
                match state.buffer.lock() {
                    Ok(mut buffer) => buffer.push(sample),
                    Err(error) => {
                        tracing::error!(?error, "Memory recording buffer unavailable");
                        return;
                    }
                }
                std::thread::sleep(SAMPLE_INTERVAL);
            }
        });
    }
}
