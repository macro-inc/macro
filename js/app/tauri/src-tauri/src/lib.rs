use logger::Logger;
use macro_bundle_updater_plugin::BundleRoot;
use navigation_plugin::MacroNavigationPlugin;
use navigation_plugin::scheme::MacroScheme;
use reqwest::cookie::CookieStore;
use reqwest::header::COOKIE;
use rootcause::{Report, report};
use serde::Serialize;
#[cfg(target_os = "ios")]
use std::sync::OnceLock;
use std::sync::RwLock;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use tauri::http::{HeaderMap, HeaderValue};
use tauri::{AppHandle, Emitter};
use tauri::{Manager, Runtime};

mod tauri_protocol;
use tauri_plugin_deep_link::{DeepLinkExt, OpenUrlEvent};
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;
use url::Url;

struct HeartbeatState {
    alive: AtomicBool,
    /// Incremented on each resume event so stale check threads are ignored
    generation: AtomicU64,
}

#[tauri::command]
fn heartbeat_response(state: tauri::State<'_, HeartbeatState>) {
    state.alive.store(true, Ordering::SeqCst);
}

/// This module provides debuging utilities and should not be compiled in prodiction builds
#[cfg(debug_assertions)] // do not remove this
mod debug;

#[cfg(target_os = "ios")]
static GLOBAL_APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();

/// Send a heartbeat ping to the JS layer and check for a response after 1 second.
/// If no response is received, reload the webview (the content process is likely dead).
#[cfg(target_os = "ios")]
fn send_heartbeat(handle: &AppHandle) {
    tracing::info!("app resumed, sending heartbeat ping");

    let state = handle.state::<HeartbeatState>();
    let current_gen = state.generation.fetch_add(1, Ordering::SeqCst) + 1;
    state.alive.store(false, Ordering::SeqCst);

    let _ = handle.emit("heartbeat_ping", ());

    let handle = handle.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
        let state = handle.state::<HeartbeatState>();

        if state.generation.load(Ordering::SeqCst) != current_gen {
            tracing::debug!("heartbeat: stale generation {current_gen}, skipping");
            return;
        }

        if !state.alive.load(Ordering::SeqCst) {
            tracing::warn!(
                "heartbeat: no response from JS — content process likely dead, reloading webview"
            );
            if let Some(webview) = handle.webview_windows().values().next() {
                let _ = webview.reload();
            }
        } else {
            tracing::info!("heartbeat: JS responded, content process alive");
        }
    });
}

/// Called from native Objective-C when the iOS app resumes from background.
/// See `main.mm` for the notification observer.
#[cfg(target_os = "ios")]
#[unsafe(no_mangle)]
extern "C" fn on_app_resumed() {
    let Some(handle) = GLOBAL_APP_HANDLE.get() else {
        tracing::warn!("on_app_resumed: app handle not yet initialized");
        return;
    };
    send_heartbeat(handle);
}

/// domains which the tauri webview can render.
/// This should be as restrictive as possible.
/// If the webview attempts to naviate to other domains,
/// they will be opened in the systems default browser
static ALLOWED_DOMAINS: &[&str] = &[
    "http://tauri.localhost",
    "tauri://localhost",
    "https://macro.com",
    "http://localhost:3000",
    "http://localhost:3001",
    "http://localhost:3002",
    "http://localhost:3003",
    "http://localhost:3004",
    "http://localhost:3005",
    "http://localhost:3006",
    "http://localhost:3007",
    "http://localhost:3008",
    "http://localhost:3009",
];

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    use tracing_subscriber::EnvFilter;

    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| {
        if cfg!(debug_assertions) {
            "debug,tungstenite=info,tokio_tungstenite=info,reqwest=info,hyper=info,h2=info".into()
        } else {
            "info,tungstenite=info,tokio_tungstenite=info,reqwest=info".into()
        }
    });

    let fmt_layer = tracing_subscriber::fmt::layer()
        .with_file(true)
        .with_target(false)
        .with_writer(std::io::stderr)
        .with_line_number(true)
        .pretty();

    let registry = tracing_subscriber::registry().with(filter).with(fmt_layer);

    #[cfg(target_os = "ios")]
    let registry = registry.with(tracing_oslog::OsLogger::new(
        "com.macro.app.prod",
        "default",
    ));

    registry.init();

    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        // single instance plugin should always be the first registered
        tracing::debug!("register single instance plugin");
        builder = builder.plugin(tauri_plugin_single_instance::init(|_app, argv, _cwd| {
            tracing::debug!("single instance callback with argv: {argv:?}");
        }))
    }

    #[cfg(target_os = "ios")]
    {
        builder = builder
            .plugin(tauri_plugin_haptics::init())
            .plugin(tauri_plugin_input_accessory::init());
    }

    // register the rest of the common plugins
    // The log plugin with "tracing" feature emits tracing::event! directly,
    // so logs from the webview will go through our tracing subscriber
    builder = builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(log::LevelFilter::Debug)
                .skip_logger() // Don't set up log crate logger, we only want the tracing events
                .build(),
        )
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_http::init())
        .plugin(
            tauri_plugin_websocket::Builder::new()
                .merge_header_callback(Box::new(merge_header_callback))
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(MacroNavigationPlugin::new(ALLOWED_DOMAINS).expect("Domains must be valid urls"))
        .plugin(
            macro_bundle_updater_plugin::inbound::plugin::MacroBundleUpdaterPlugin::new(
                "http://localhost:3001/".parse().expect("valid url"),
            ),
        );

    #[cfg(mobile)]
    {
        // register mobile specific plugins
        builder = builder
            .plugin(tauri_plugin_safe_area_insets::init())
            .plugin(tauri_plugin_notifications::init())
            .plugin(tauri_plugin_virtual_keyboard::init())
            .plugin(tauri_plugin_auth::init());
    }

    // Window origin differs by platform:
    // macOS/iOS/Linux: tauri://localhost
    // Windows/Android: https://tauri.localhost (or http://)
    let window_origin = if cfg!(any(target_os = "windows", target_os = "android")) {
        "https://tauri.localhost"
    } else {
        "tauri://localhost"
    };

    builder
        .register_asynchronous_uri_scheme_protocol("tauri", {
            // Build this outside the closure so we only create it once.
            // We need the AppHandle which isn't available until setup, but
            // register_asynchronous_uri_scheme_protocol gives us UriSchemeContext.
            // However, tauri_protocol::get needs AppHandle upfront.
            // Use a lazy init pattern via the context.
            let window_origin = window_origin.to_string();
            let handler: std::sync::OnceLock<
                Box<dyn Fn(&str, http::Request<Vec<u8>>, tauri::UriSchemeResponder) + Send + Sync>,
            > = std::sync::OnceLock::new();

            move |ctx, request, responder| {
                let h = handler.get_or_init(|| {
                    tauri_protocol::get(ctx.app_handle().clone(), &window_origin)
                });
                h(ctx.webview_label(), request, responder);
            }
        })
        .manage(BundleRoot(RwLock::new(None)))
        .manage(HeartbeatState {
            alive: AtomicBool::new(true),
            generation: AtomicU64::new(0),
        })
        .invoke_handler(tauri::generate_handler![
            heartbeat_response,
            macro_bundle_updater_plugin::inbound::plugin::grant_bundle_update,
            macro_bundle_updater_plugin::inbound::plugin::perform_update
        ])
        .setup(|app| {
            #[cfg(any(target_os = "linux", all(windows, debug_assertions)))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                app.deep_link()
                    .register_all()
                    .inspect(|_| tracing::debug!("attached scheme handler"))
                    .log_and_consume();
            }

            app.chain(attach_deep_link_handler);

            #[cfg(target_os = "ios")]
            {
                let _ = GLOBAL_APP_HANDLE.set(app.handle().clone());
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// fn to merge the headers from the http cookie store into the initial
/// GET request to open a websocket
fn merge_header_callback<R: Runtime>(url: String, headers: &mut HeaderMap, handle: &AppHandle<R>) {
    tracing::debug!("got url {url}");
    let Some(s) = handle.try_state::<tauri_plugin_http::Http>() else {
        return;
    };
    let Ok(mut url) = url.parse::<Url>() else {
        return;
    };
    url.set_scheme(match url.scheme() {
        "ws" => "http",
        _ => "https",
    })
    .ok();
    tracing::debug!("checking cookies for {url}");

    if let Some(cookie) = s.inner().cookies_jar.as_ref().cookies(&url) {
        tracing::info!("inserting cookie value for {url}");
        tracing::debug!("{cookie:?}");
        headers.insert(COOKIE, cookie);
    }
}

trait AppChain {
    fn chain(&mut self, f: impl FnOnce(&mut Self)) -> &mut Self;
}

impl AppChain for tauri::App {
    fn chain(&mut self, f: impl FnOnce(&mut Self)) -> &mut Self {
        f(self);
        self
    }
}

fn attach_deep_link_handler(app: &mut tauri::App) {
    fn inner_handler(ev: OpenUrlEvent, handle: &AppHandle) -> Result<(), Report> {
        let urls = ev.urls();
        tracing::info!("received open url event {urls:?}");
        let url = urls
            .into_iter()
            .next()
            .ok_or_else(|| report!("expected at least 1 url"))?;

        // Universal/App links come in as https:// URLs, custom scheme links come in as macro://
        let macro_scheme = match url.scheme() {
            "macro" => MacroScheme::new(url)?,
            "http" | "https" => MacroScheme::from_url(&url)?,
            scheme => {
                return Err(report!("unexpected deep link scheme: {}", scheme));
            }
        };

        #[derive(Clone, Serialize, Debug)]
        struct NavigatePayload<'a> {
            path: &'a str,
            query: &'a str,
        }

        let payload = NavigatePayload {
            path: macro_scheme.0.path(),
            query: macro_scheme.0.query().unwrap_or_default(),
        };
        // we send a navigate event instead of calling navigate directly
        // because navigate performs a full browser navigation

        tracing::info!("{payload:?}");
        Ok(handle.emit("navigate", payload)?)
    }

    app.deep_link().on_open_url({
        let handle = app.handle().clone();
        move |ev| {
            inner_handler(ev, &handle).log_and_consume();
        }
    });
}
