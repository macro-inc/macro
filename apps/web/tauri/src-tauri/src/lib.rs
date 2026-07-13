use logger::Logger;
use macro_bundle_updater_plugin::inbound::plugin::retry_waiting_for_wifi;
#[cfg(feature = "auto_apply_update")]
use macro_bundle_updater_plugin::inbound::plugin::{
    allow_update_reload_retry, apply_completed_update_from, start_update_check,
};
use navigation_plugin::MacroNavigationPlugin;
use navigation_plugin::scheme::MacroScheme;
use reqwest::cookie::CookieStore;
use reqwest::header::{COOKIE, ORIGIN};
use rootcause::{Report, report};
use serde::Serialize;
use share_target::{
    PendingShareFilesState, clear_shared_files, get_pending_share_filenames,
    maybe_handle_share_deep_link, pop_shared_files, read_shared_file_text,
};
use staged_upload::cleanup_stale_staged_files;
use tauri::http::{HeaderMap, HeaderValue};
use tauri::{AppHandle, Emitter, Manager, RunEvent, Runtime};

mod tauri_protocol;

pub(crate) const APP_SCHEME: &str = "macro";
use tauri_plugin_deep_link::{DeepLinkExt, OpenUrlEvent};
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;
use url::Url;

mod share_target;
mod staged_upload;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AppEnvironment {
    Development,
    Production,
}

impl AppEnvironment {
    fn current() -> Self {
        match env!("MACRO_TAURI_APP_ENV") {
            "development" => Self::Development,
            "production" => Self::Production,
            other => unreachable!("invalid MACRO_TAURI_APP_ENV: {other}"),
        }
    }

    fn auth_service_url(self) -> &'static str {
        match self {
            Self::Development => "https://auth-service-dev.macro.com/",
            Self::Production => "https://auth-service.macro.com/",
        }
    }

    fn bundle_update_base_url(self) -> &'static str {
        option_env!("MACRO_BUNDLE_UPDATE_BASE_URL")
            .filter(|url| !url.trim().is_empty())
            .unwrap_or_else(|| self.auth_service_url())
    }

    fn web_origin(self) -> &'static str {
        match self {
            Self::Development => "https://dev.macro.com",
            Self::Production => "https://macro.com",
        }
    }
}

fn embedded_bundle_build() -> u64 {
    env!("MACRO_EMBEDDED_BUNDLE_BUILD")
        .parse()
        .expect("MACRO_EMBEDDED_BUNDLE_BUILD must be an unsigned integer")
}

/// This module provides debuging utilities and should not be compiled in prodiction builds
#[cfg(debug_assertions)] // do not remove this
mod debug;

/// domains which the tauri webview can render.
/// This should be as restrictive as possible.
/// If the webview attempts to naviate to other domains,
/// they will be opened in the systems default browser
static ALLOWED_DOMAINS: &[&str] = &[
    "http://tauri.localhost",
    "tauri://localhost",
    "https://macro.com",
    "https://dev.macro.com",
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

type Type = std::sync::OnceLock<
    Box<dyn Fn(&str, http::Request<Vec<u8>>, tauri::UriSchemeResponder) + Send + Sync + 'static>,
>;

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
            .plugin(tauri_plugin_input_accessory::init())
            .plugin(tauri_plugin_pasteboard::init())
            .plugin(tauri_plugin_photo_library::init())
            .plugin(tauri_plugin_call_kit::init());
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
        .plugin(tauri_plugin_device_info::init())
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
                AppEnvironment::current()
                    .bundle_update_base_url()
                    .parse()
                    .expect("valid url"),
                embedded_bundle_build(),
            )
            // Builds without this feature (just ios-dev, ios-build-no-update)
            // must never check for or apply OTA bundles on their own; manual
            // checks from settings still work.
            .with_auto_update(cfg!(feature = "auto_apply_update")),
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
            let handler: Type = std::sync::OnceLock::new();

            move |ctx, request, responder| {
                let h = handler.get_or_init(|| {
                    let app = ctx.app_handle();
                    tauri_protocol::get(app.clone(), &window_origin)
                });
                h(ctx.webview_label(), request, responder);
            }
        })
        .manage(PendingShareFilesState::default())
        .invoke_handler(tauri::generate_handler![
            macro_bundle_updater_plugin::inbound::plugin::grant_bundle_update,
            macro_bundle_updater_plugin::inbound::plugin::perform_update,
            macro_bundle_updater_plugin::inbound::plugin::ack_bundle_update_reload,
            macro_bundle_updater_plugin::inbound::plugin::check_for_update,
            macro_bundle_updater_plugin::inbound::plugin::get_bundle_debug_info,
            macro_bundle_updater_plugin::inbound::plugin::get_bundle_update_status,
            macro_bundle_updater_plugin::inbound::plugin::clear_bundle,
            get_pending_share_filenames,
            pop_shared_files,
            clear_shared_files,
            read_shared_file_text,
            staged_upload::upload_staged_file_to_presigned_url,
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
            cleanup_stale_staged_files(&app.handle());

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(move |app_handle, event| match &event {
            RunEvent::Ready => {
                #[cfg(feature = "auto_apply_update")]
                {
                    let app = app_handle.clone();
                    tauri::async_runtime::spawn(async move {
                        match apply_completed_update_from(&app, "run_event_ready").await {
                            Ok(_) => {}
                            Err(e) => {
                                tracing::error!("Failed to auto-apply bundle update on ready: {e}");
                            }
                        }
                    });
                }
            }
            RunEvent::Resumed => {
                let app = app_handle.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(e) = retry_waiting_for_wifi(&app).await {
                        tracing::warn!("Failed to retry bundle update Wi-Fi wait on resume: {e}");
                    }
                });
                #[cfg(feature = "auto_apply_update")]
                {
                    let app = app_handle.clone();
                    tauri::async_runtime::spawn(async move {
                        if let Err(e) = allow_update_reload_retry(&app).await {
                            tracing::warn!(
                                "Failed to allow bundle update reload retry on resume: {e}"
                            );
                        }
                        match apply_completed_update_from(&app, "run_event_resumed").await {
                            Ok(true) => {}
                            Ok(false) => {
                                if let Err(e) = start_update_check(&app).await {
                                    tracing::error!(
                                        "Failed to start bundle update check on resume: {e}"
                                    );
                                }
                            }
                            Err(e) => {
                                tracing::error!("Failed to auto-apply bundle update: {e}");
                            }
                        }
                    });
                }
            }
            _ => {}
        });
}

/// fn to merge the headers from the http cookie store into the initial
/// GET request to open a websocket
fn merge_header_callback<R: Runtime>(url: String, headers: &mut HeaderMap, handle: &AppHandle<R>) {
    let Ok(mut parsed_url) = Url::parse(&url) else {
        return;
    };

    // These services (including the macroverse.workers.dev sync service) validate
    // Origin for auth, so set it to our web origin unconditionally — independent of
    // whether cookie state is available.
    match parsed_url.host_str() {
        Some("services.macro.com")
        | Some("services-dev.macro.com")
        | Some("macroverse.workers.dev") => {
            headers.insert(
                ORIGIN,
                HeaderValue::from_static(AppEnvironment::current().web_origin()),
            );
        }
        _ => {}
    }

    // Cookie forwarding requires the HTTP plugin's cookie jar.
    let Some(s) = handle.try_state::<tauri_plugin_http::Http>() else {
        return;
    };
    parsed_url
        .set_scheme(match parsed_url.scheme() {
            "ws" => "http",
            _ => "https",
        })
        .ok();
    tracing::trace!("checking cookies for {parsed_url}");

    if let Some(cookie) = s.inner().cookies_jar.as_ref().cookies(&parsed_url) {
        tracing::trace!("inserting cookie value for {parsed_url}");
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
        tracing::trace!("received open url event {urls:?}");
        let url = urls
            .into_iter()
            .next()
            .ok_or_else(|| report!("expected at least 1 url"))?;

        if maybe_handle_share_deep_link(handle, &url) {
            return Ok(());
        }

        // Universal/App links come in as https:// URLs, custom scheme links come in as macro://
        let macro_scheme = match url.scheme() {
            s if s == APP_SCHEME => MacroScheme::new(url)?,
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

        tracing::trace!("{payload:?}");
        Ok(handle.emit("navigate", payload)?)
    }

    app.deep_link().on_open_url({
        let handle = app.handle().clone();
        move |ev| {
            inner_handler(ev, &handle).log_and_consume();
        }
    });
}
