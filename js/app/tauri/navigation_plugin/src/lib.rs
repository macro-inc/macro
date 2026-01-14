use crate::scheme::MacroScheme;
use logger::Logger;
use serde::{Deserialize, Serialize};
use std::{borrow::Cow, collections::HashMap, sync::Arc};
use tauri::{Manager, Runtime, plugin::Plugin};
use tauri_plugin_opener::OpenerExt;
use url::Url;

#[cfg(test)]
mod tests;

pub mod scheme;

#[derive(Debug, Clone)]
struct InternalUrl<'a>(Cow<'a, Url>);

impl<'a> InternalUrl<'a> {
    /// attempts to remap the internal url to a different path if required
    /// if no remap is required, returns None.
    /// the frontend sometimes tries to navigate to urls which are invalid in a tauri context
    /// via setting window.location.href to e.g. '/app/login' when tauri would expect '/#/app/login'
    /// this function returns the correctly remaped url if it exists.
    fn remap_path(&self) -> Option<InternalUrl<'static>> {
        None
    }
}

#[derive(Debug, Clone)]
struct ExternalUrl<'a>(Cow<'a, Url>);

/// Possible outcomes when trying to perform on_navigation
#[derive(Debug, Clone)]
enum NavigationOutput<'a> {
    /// This is an external [Url] which will be opened in a browser
    External(ExternalUrl<'a>),
    /// This is a valid internal [Url]
    Internal(InternalUrl<'a>),
    /// The frontend attempted to navigate to an internal [Url]
    /// which is invalid in a Tauri context.
    InternalTransformed {
        #[expect(dead_code)]
        original: InternalUrl<'a>,
        remapped: InternalUrl<'static>,
    },
}

#[derive(Clone, Copy, Debug)]
pub enum Platform {
    Mobile,
    Desktop,
}

#[derive(Clone)]
pub struct MacroNavigationPlugin {
    internal_domains: Arc<[Url]>,
    platform: Platform,
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
    pub fn new(
        allow_list: &'static [&'static str],
        platform: Platform,
    ) -> Result<Self, url::ParseError> {
        Ok(MacroNavigationPlugin {
            internal_domains: allow_list
                .iter()
                .map(|s| s.parse())
                .collect::<Result<Arc<_>, _>>()?,
            platform,
        })
    }

    #[tracing::instrument(ret, level = tracing::Level::DEBUG, skip(self))]
    fn get_destination<'a>(&self, url: &'a Url) -> NavigationOutput<'a> {
        let internal = match self.as_internal_url(url) {
            Ok(internal) => internal,
            Err(external) => return NavigationOutput::External(external),
        };
        match internal.remap_path() {
            Some(remapped) => NavigationOutput::InternalTransformed {
                original: internal,
                remapped,
            },
            None => NavigationOutput::Internal(internal),
        }
    }

    #[tracing::instrument(ret, level = tracing::Level::DEBUG, skip(self))]
    fn as_internal_url<'a>(&self, url: &'a Url) -> Result<InternalUrl<'a>, ExternalUrl<'a>> {
        self.internal_domains
            .iter()
            .any(|cur| {
                cur.scheme().eq(url.scheme())
                    && cur.domain().eq(&url.domain())
                    && cur.port().eq(&url.port())
            })
            .then_some(InternalUrl(Cow::Borrowed(url)))
            .ok_or(ExternalUrl(Cow::Borrowed(url)))
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
    if let None = url.query_pairs().find(|(k, _v)| k.as_ref() == "is_mobile") {
        url.query_pairs_mut().append_pair("is_mobile", "true");
    }
    url
}

impl<R: Runtime> Plugin<R> for MacroNavigationPlugin {
    fn name(&self) -> &'static str {
        std::any::type_name_of_val(self)
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
            NavigationOutput::Internal(_internal_url) => true,
            NavigationOutput::InternalTransformed {
                original: _,
                remapped,
            } => {
                webview.navigate(remapped.0.into_owned()).ok();
                false
            }
        }
    }
}
