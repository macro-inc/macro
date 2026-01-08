use logger::Logger;
use navigation_plugin::scheme::MacroScheme;
use navigation_plugin::{MacroNavigationPlugin, Platform};
use reqwest::cookie::CookieStore;
use reqwest::header::COOKIE;
use rootcause::{Report, report};
use serde::Serialize;
use tauri::http::{HeaderMap, HeaderValue};
use tauri::{AppHandle, Emitter};
use tauri::{Manager, Runtime};
use tauri_plugin_deep_link::{DeepLinkExt, OpenUrlEvent};
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;
use url::Url;

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
    "http://localhost:3000",
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

    let registry = tracing_subscriber::registry()
        .with(filter)
        .with(fmt_layer);

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
        builder = builder.plugin(tauri_plugin_haptics::init());
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
        .plugin(
            MacroNavigationPlugin::new(
                ALLOWED_DOMAINS,
                cfg!(mobile)
                    .then_some(Platform::Mobile)
                    .unwrap_or(Platform::Desktop),
            )
            .expect("Domains must be valid urls"),
        );

    #[cfg(mobile)]
    {
        // register mobile specific plugins
        builder = builder
            .plugin(tauri_plugin_safe_area_insets::init())
            .plugin(tauri_plugin_notifications::init());
    }

    builder
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

        let macro_scheme = MacroScheme::new(url)?;

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
