use crate::scheme::MacroScheme;
use logger::Logger;
use serde::{Deserialize, Serialize};
use std::{borrow::Cow, collections::HashMap, path::PathBuf, sync::Arc};
use tauri::{Emitter, Manager, Runtime, plugin::Plugin};
use tauri_plugin_opener::OpenerExt;
use url::Url;

#[cfg(test)]
mod tests;

pub mod scheme;

#[derive(Debug, Clone)]
struct ExternalUrl<'a>(Cow<'a, Url>);

/// Possible outcomes when trying to perform on_navigation
#[derive(Debug, Clone)]
enum NavigationOutput<'a> {
    /// This is an external [Url] which will be opened in a browser
    External(ExternalUrl<'a>),
    /// A [Url] on one of the webview's own origins (`tauri://localhost`,
    /// the dev server, ...) — the webview is allowed to load it directly.
    /// This is what permits the SPA's own page loads.
    Internal,
    /// A link to content inside the Macro app whose literal [Url] points at
    /// the remote website (e.g. `https://macro.com/app/...`). The webview
    /// must not load it — that would replace the running SPA with the live
    /// site — so the navigation is cancelled and re-emitted as a `navigate`
    /// event for the SPA router to handle in-place.
    AppLink(MacroScheme),
}

/// Payload of the `navigate` event consumed by the frontend router bridge.
#[derive(Clone, Serialize, Debug)]
pub struct NavigatePayload<'a> {
    pub path: &'a str,
    pub query: &'a str,
}

#[derive(Clone, Copy, Debug)]
pub enum Platform {
    Mobile,
    Desktop,
}

#[derive(Clone)]
pub struct MacroNavigationPlugin {
    internal_domains: Arc<[Url]>,
    app_link_hosts: &'static [&'static str],
    allowed_file_prefix: Option<PathBuf>,
}

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

impl MacroNavigationPlugin {
    pub fn new(allow_list: &'static [&'static str]) -> Result<Self, url::ParseError> {
        Ok(MacroNavigationPlugin {
            internal_domains: allow_list
                .iter()
                .map(|s| s.parse())
                .collect::<Result<Arc<_>, _>>()?,
            app_link_hosts: &[],
            allowed_file_prefix: None,
        })
    }

    /// hosts whose `/app` urls are routed through the SPA router
    /// via the `navigate` event instead of loading the remote site
    pub fn with_app_link_hosts(mut self, hosts: &'static [&'static str]) -> Self {
        self.app_link_hosts = hosts;
        self
    }

    pub fn with_allowed_file_prefix(mut self, prefix: PathBuf) -> Self {
        self.allowed_file_prefix = Some(prefix);
        self
    }

    #[tracing::instrument(ret, level = tracing::Level::DEBUG, skip(self))]
    fn get_destination<'a>(&self, url: &'a Url) -> NavigationOutput<'a> {
        // checked before the allowlist: app link hosts (e.g. dev.macro.com)
        // are not necessarily allowlisted webview domains
        if let Some(scheme) = self.as_app_link(url) {
            return NavigationOutput::AppLink(scheme);
        }
        match self.as_internal_url(url) {
            Ok(()) => NavigationOutput::Internal,
            Err(external) => NavigationOutput::External(external),
        }
    }

    #[tracing::instrument(ret, level = tracing::Level::DEBUG, skip(self))]
    fn as_app_link(&self, url: &Url) -> Option<MacroScheme> {
        if !matches!(url.scheme(), "http" | "https") {
            return None;
        }
        let domain = url.domain()?;
        let domain = domain.strip_prefix("www.").unwrap_or(domain);
        if !self
            .app_link_hosts
            .iter()
            .any(|host| domain.eq_ignore_ascii_case(host))
        {
            return None;
        }
        let path = url.path();
        if path != "/app" && !path.starts_with("/app/") {
            return None;
        }
        MacroScheme::from_url(url).ok()
    }

    #[tracing::instrument(ret, level = tracing::Level::DEBUG, skip(self))]
    fn as_internal_url<'a>(&self, url: &'a Url) -> Result<(), ExternalUrl<'a>> {
        let is_allowed_domain = self.internal_domains.iter().any(|cur| {
            cur.scheme().eq(url.scheme())
                && cur.domain().eq(&url.domain())
                && cur.port().eq(&url.port())
        });

        let is_allowed_file = url.scheme() == "file"
            && self.allowed_file_prefix.as_ref().is_some_and(|prefix| {
                url.to_file_path()
                    .ok()
                    .and_then(|path| path.canonicalize().ok())
                    .and_then(|canonical| {
                        prefix
                            .canonicalize()
                            .ok()
                            .map(|cp| canonical.starts_with(cp))
                    })
                    .unwrap_or(false)
            });

        if is_allowed_domain || is_allowed_file {
            Ok(())
        } else {
            Err(ExternalUrl(Cow::Borrowed(url)))
        }
    }
}

#[tracing::instrument(ret, level = tracing::Level::DEBUG)]
fn transform_external_url(mut url: Url) -> Url {
    let Some(query) = url.query() else {
        return url;
    };

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
    if url
        .query_pairs()
        .find(|(k, _v)| k.as_ref() == "is_mobile")
        .is_none()
    {
        url.query_pairs_mut().append_pair("is_mobile", "true");
    }
    url
}

impl<R: Runtime> Plugin<R> for MacroNavigationPlugin {
    fn name(&self) -> &'static str {
        std::any::type_name_of_val(self)
    }

    fn initialize(
        &mut self,
        app: &tauri::AppHandle<R>,
        _config: serde_json::Value,
    ) -> Result<(), Box<dyn std::error::Error>> {
        if self.allowed_file_prefix.is_none()
            && let Ok(cache_dir) = app.path().app_cache_dir()
        {
            tracing::debug!("Setting allowed file prefix to {cache_dir:?}");
            self.allowed_file_prefix = Some(cache_dir);
        }
        Ok(())
    }

    fn on_navigation(&mut self, webview: &tauri::Webview<R>, url: &tauri::Url) -> bool {
        let dest = self.get_destination(url);

        match dest {
            NavigationOutput::External(external_url) => {
                // we are navigating somewhere external to the app
                // open in system default browser
                // spawn a detached thread to avoid blocking,
                // on android this panics if called on the main thread
                let app_handle = webview.app_handle().clone();
                let url = external_url.0.into_owned();
                std::thread::spawn(move || {
                    app_handle
                        .opener()
                        .open_url(transform_external_url(url).as_str(), None::<&str>)
                        .log_and_consume();
                });
                false
            }
            NavigationOutput::Internal => true,
            NavigationOutput::AppLink(scheme) => {
                webview
                    .app_handle()
                    .emit(
                        "navigate",
                        NavigatePayload {
                            path: scheme.path(),
                            query: scheme.query().unwrap_or_default(),
                        },
                    )
                    .log_and_consume();
                false
            }
        }
    }
}
