use crate::logger::{Context, ContextErr, Logger};
use reqwest::cookie::CookieStore;
use reqwest::header::COOKIE;
use serde::{Deserialize, Serialize};
use std::str::FromStr;
use std::{borrow::Cow, collections::HashMap};
use tauri::http::{HeaderMap, HeaderValue};
use tauri::{AppHandle, Emitter};
use tauri::{Manager, Runtime, plugin::Plugin};
use tauri_plugin_deep_link::{DeepLinkExt, OpenUrlEvent};
use tauri_plugin_opener::OpenerExt;
use thiserror::Error;
use url::Url;

/// This module provides debuging utilities and should not be compiled in prodiction builds
#[cfg(debug_assertions)] // do not remove this
mod debug;
mod logger;

/// domains which the tauri webview can render.
/// This should be as restrictive as possible.
/// If the webview attempts to naviate to other domains,
/// they will be opened in the systems default browser
static ALLOWED_DOMAINS: &'static [&'static str] = &[
    // local urls
    "http://tauri.localhost",
    "https://macro.com",
    "http://localhost:3000",
];

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    use tracing_subscriber::EnvFilter;

    tracing_subscriber::fmt()
        .with_file(true)
        .with_target(false)
        .with_writer(std::io::stderr)
        .with_line_number(true)
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| {
            // Set default log levels
            if cfg!(debug_assertions) {
                // Enable debug logs for websocket and HTTP crates in debug mode
                "debug,tungstenite=info,tokio_tungstenite=info,reqwest=info,hyper=info,h2=info"
                    .into()
            } else {
                "info,tungstenite=info,tokio_tungstenite=info,reqwest=info".into()
            }
        }))
        .init();
    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        // single instance plugin should always be the first registered
        tracing::debug!("register single instance plugin");
        builder = builder.plugin(tauri_plugin_single_instance::init(|_app, argv, _cwd| {
            tracing::debug!("single instance callback with argv: {argv:?}");
        }))
    }

    // register the rest of the common plugins
    builder = builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_log::Builder::default().skip_logger().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_http::init())
        .plugin(
            tauri_plugin_websocket::Builder::new()
                .merge_header_callback(Box::new(merge_header_callback))
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(MacroNavigationPlugin::new(ALLOWED_DOMAINS).expect("Domains must be valid urls"));

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

            if cfg!(debug_assertions) {
                let window = app
                    .get_webview_window("main")
                    .expect("Main window not found");
                window.open_devtools();
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
        "wss" | _ => "https",
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

#[derive(Debug, Error)]
enum AppError {
    #[error("{0}")]
    SchemeErr(#[from] SchemeError),
    #[error("{0}")]
    ContextErr(#[from] ContextErr),
    #[error("{0}")]
    Tauri(#[from] tauri::Error),
}

fn attach_deep_link_handler(app: &mut tauri::App) {
    fn inner_handler(ev: OpenUrlEvent, handle: &AppHandle) -> Result<(), AppError> {
        let urls = ev.urls();
        tracing::info!("received open url event {urls:?}");
        let url = urls.into_iter().next().context("expected at least 1 url")?;

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

struct MacroNavigationPlugin {
    internal_domains: Vec<Url>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(transparent)]
struct MacroScheme(Url);

impl MacroScheme {
    fn new(url: Url) -> Result<Self, SchemeError> {
        let "macro" = url.scheme() else {
            return Err(SchemeError::InvalidScheme {
                expected: "macro".to_string(),
                found: url.scheme().to_string(),
            });
        };
        Ok(Self(url))
    }
    /// turn a http(s) url into a macro scheme url
    fn from_url(url: &Url) -> Result<Self, SchemeError> {
        let ("http" | "https") = url.scheme() else {
            return Err(SchemeError::InvalidScheme {
                expected: "http(s)".to_string(),
                found: url.scheme().to_string(),
            });
        };

        let Some(rest) = url.fragment().map(|s| s.trim_start_matches('/')) else {
            return Err(SchemeError::MissingFragment);
        };
        let query = url.query();
        let inner = match query {
            Some(q) => format!("macro://{rest}?{q}"),
            None => format!("macro://{rest}"),
        }
        .parse::<Url>()?;
        Ok(MacroScheme(inner))
    }
}

impl AsRef<str> for MacroScheme {
    fn as_ref(&self) -> &str {
        self.0.as_str()
    }
}

#[derive(Debug, Error)]
enum SchemeError {
    #[error("The input url did not have a fragment")]
    MissingFragment,
    #[error("{0}")]
    Parse(#[from] url::ParseError),
    #[error("Invalid scheme received. Expected {expected}, found {found}")]
    InvalidScheme { expected: String, found: String },
}

impl MacroNavigationPlugin {
    pub fn new(allow_list: &'static [&'static str]) -> Result<Self, url::ParseError> {
        Ok(MacroNavigationPlugin {
            internal_domains: allow_list
                .into_iter()
                .map(|s| s.parse())
                .collect::<Result<Vec<_>, _>>()?,
        })
    }

    #[tracing::instrument(ret, level = tracing::Level::DEBUG, skip(self))]
    fn is_internal_domain(&self, url: &Url) -> bool {
        self.internal_domains
            .iter()
            .find(|cur| {
                cur.scheme().eq(url.scheme())
                    && cur.domain().eq(&url.domain())
                    && cur.port().eq(&url.port())
            })
            .is_some()
    }

    #[tracing::instrument(ret, level = tracing::Level::DEBUG)]
    fn transform_external(mut url: Url) -> Url {
        let Some(query) = url.query() else {
            return url;
        };

        #[derive(Debug, Deserialize)]
        struct AuthCallbackQuery<'a> {
            original_url: Option<Url>,
            #[serde(flatten, borrow)]
            remaining: HashMap<Cow<'a, str>, Cow<'a, str>>,
        }

        #[derive(Debug, Serialize)]
        struct MacroCallbackQuery<'a> {
            original_url: MacroScheme,
            #[serde(flatten, borrow)]
            remaining: HashMap<Cow<'a, str>, Cow<'a, str>>,
        }

        if let Ok(AuthCallbackQuery {
            original_url: Some(cb),
            remaining,
        }) = serde_qs::from_str(query).log_err()
        {
            let Ok(macro_scheme) = MacroScheme::from_url(&cb) else {
                return url;
            };

            url.set_query(Some(
                serde_qs::to_string(&MacroCallbackQuery {
                    original_url: macro_scheme,
                    remaining,
                })
                .expect("serialization should not fail")
                .as_str(),
            ));
        }
        url.query_pairs_mut().append_pair("is_mobile", "true");
        url
    }
}

impl<R: Runtime> Plugin<R> for MacroNavigationPlugin {
    fn name(&self) -> &'static str {
        std::any::type_name_of_val(self)
    }

    fn on_navigation(&mut self, webview: &tauri::Webview<R>, url: &tauri::Url) -> bool {
        let allowed_internal = self.is_internal_domain(url);

        if !allowed_internal {
            // we are navigating somewhere external to the app
            // open in system default browser
            // spawn a detached thread to avoid blocking,
            // on android this panics if called on the main thread
            let app_handle = webview.app_handle().clone();
            let url = url.clone();
            std::thread::spawn(move || {
                app_handle
                    .opener()
                    .open_url(Self::transform_external(url).as_str(), None::<&str>)
                    .log_and_consume();
            });
        }
        allowed_internal
    }
}
