#![cfg_attr(doc_cfg, feature(doc_cfg))]
//! This crate implements necessary boiler plate code to serve Swagger UI via web server. It
//! works as a bridge for serving the OpenAPI documentation created with [`utoipa`][utoipa] library in the
//! Swagger UI.
//!
//! [utoipa]: <https://docs.rs/utoipa/>
//!
//! **Currently implemented boiler plate for:**
//!
//! * **actix-web** `version >= 4`
//! * **rocket** `version >=0.5`
//! * **axum** `version >=0.7`
//!
//! Serving Swagger UI is framework independent thus this crate also supports serving the Swagger UI with
//! other frameworks as well. With other frameworks there is bit more manual implementation to be done. See
//! more details at [`serve`] or [`examples`][examples].
//!
//! [examples]: <https://github.com/juhaku/utoipa/tree/master/examples>
//!
//! # Crate Features
//!
//! * **`actix-web`** Enables `actix-web` integration with pre-configured SwaggerUI service factory allowing
//!   users to use the Swagger UI without a hassle.
//! * **`rocket`** Enables `rocket` integration with with pre-configured routes for serving the Swagger UI
//!   and api doc without a hassle.
//! * **`axum`** Enables `axum` integration with pre-configured Router serving Swagger UI and OpenAPI specs
//!   hassle free.
//! * **`debug-embed`** Enables `debug-embed` feature on `rust_embed` crate to allow embedding files in debug
//!   builds as well.
//! * **`reqwest`** Use `reqwest` for downloading Swagger UI according to the `SWAGGER_UI_DOWNLOAD_URL` environment
//!   variable. This is only enabled by default on _Windows_.
//! * **`url`** Enabled by default for parsing and encoding the download URL.
//! * **`vendored`** Enables vendored Swagger UI via `utoipa-swagger-ui-vendored` crate.
//!
//! # Install
//!
//! Use only the raw types without any boiler plate implementation.
//! ```toml
//! [dependencies]
//! utoipa-swagger-ui = "9"
//! ```
//!
//! Enable actix-web framework with Swagger UI you could define the dependency as follows.
//! ```toml
//! [dependencies]
//! utoipa-swagger-ui = { version = "9", features = ["actix-web"] }
//! ```
//!
//! **Note!** Also remember that you already have defined `utoipa` dependency in your `Cargo.toml`
//!
//! ## Build Config
//!
//! <div class="warning">
//!
//! **Note!** _`utoipa-swagger-ui` crate will by default try to use system `curl` package for downloading the Swagger UI. It
//! can optionally be downloaded with `reqwest` by enabling `reqwest` feature. On Windows the `reqwest` feature
//! is enabled by default. Reqwest can be useful for platform independent builds however bringing quite a few
//! unnecessary dependencies just to download a file. If the `SWAGGER_UI_DOWNLOAD_URL` is a file path then no
//! downloading will happen._
//!
//! </div>
//!
//! <div class="warning">
//!
//! **Tip!** Use **`vendored`** feature flag to use vendored Swagger UI. This is especially useful for no network
//! environments.
//!
//! </div>
//!
//! **The following configuration env variables are available at build time:**
//!
//! * `SWAGGER_UI_DOWNLOAD_URL`: Defines the url from where to download the swagger-ui zip file.
//!
//!   * Current Swagger UI version: <https://github.com/swagger-api/swagger-ui/archive/refs/tags/v5.17.14.zip>
//!   * [All available Swagger UI versions](https://github.com/swagger-api/swagger-ui/tags)
//!
//! * `SWAGGER_UI_OVERWRITE_FOLDER`: Defines an _optional_ absolute path to a directory containing files
//!    to overwrite the Swagger UI files. Typically you might want to overwrite `index.html`.
//!
//! # Examples
//!
//! Serve Swagger UI with api doc via **`actix-web`**. See full example from
//! [examples](https://github.com/juhaku/utoipa/tree/master/examples/todo-actix).
//! ```no_run
//! # use actix_web::{App, HttpServer};
//! # use utoipa_swagger_ui::SwaggerUi;
//! # use utoipa::OpenApi;
//! # use std::net::Ipv4Addr;
//! # #[derive(OpenApi)]
//! # #[openapi()]
//! # struct ApiDoc;
//! HttpServer::new(move || {
//!         App::new()
//!             .service(
//!                 SwaggerUi::new("/swagger-ui/{_:.*}")
//!                     .url("/api-docs/openapi.json", ApiDoc::openapi()),
//!             )
//!     })
//!     .bind((Ipv4Addr::UNSPECIFIED, 8989)).unwrap()
//!     .run();
//! ```
//!
//! Serve Swagger UI with api doc via **`rocket`**. See full example from
//! [examples](https://github.com/juhaku/utoipa/tree/master/examples/rocket-todo).
//! ```no_run
//! # use rocket::{Build, Rocket};
//! # use utoipa_swagger_ui::SwaggerUi;
//! # use utoipa::OpenApi;
//! #[rocket::launch]
//! fn rocket() -> Rocket<Build> {
//! #
//! #     #[derive(OpenApi)]
//! #     #[openapi()]
//! #     struct ApiDoc;
//! #
//!     rocket::build()
//!         .mount(
//!             "/",
//!             SwaggerUi::new("/swagger-ui/<_..>")
//!                 .url("/api-docs/openapi.json", ApiDoc::openapi()),
//!         )
//! }
//! ```
//!
//! Setup Router to serve Swagger UI with **`axum`** framework. See full implementation of how to serve
//! Swagger UI with axum from [examples](https://github.com/juhaku/utoipa/tree/master/examples/todo-axum).
//!```no_run
//! # use axum::{routing, Router};
//! # use utoipa_swagger_ui::SwaggerUi;
//! # use utoipa::OpenApi;
//!# #[derive(OpenApi)]
//!# #[openapi()]
//!# struct ApiDoc;
//!#
//!# fn inner<S>()
//!# where
//!#     S: Clone + Send + Sync + 'static,
//!# {
//! let app = Router::<S>::new()
//!     .merge(SwaggerUi::new("/swagger-ui")
//!         .url("/api-docs/openapi.json", ApiDoc::openapi()));
//!# }
//! ```
use std::{borrow::Cow, error::Error, mem, sync::Arc};

mod actix;
mod axum;
pub mod oauth;
mod rocket;

use rust_embed::RustEmbed;
use serde::Serialize;
#[cfg(any(feature = "actix-web", feature = "rocket", feature = "axum"))]
use utoipa::openapi::OpenApi;

include!(concat!(env!("OUT_DIR"), "/embed.rs"));

/// Entry point for serving Swagger UI and api docs in application. It provides
/// builder style chainable configuration methods for configuring api doc urls.
///
/// # Examples
///
/// Create new [`SwaggerUi`] with defaults.
/// ```rust
/// # use utoipa_swagger_ui::SwaggerUi;
/// # use utoipa::OpenApi;
/// # #[derive(OpenApi)]
/// # #[openapi()]
/// # struct ApiDoc;
/// let swagger = SwaggerUi::new("/swagger-ui/{_:.*}")
///     .url("/api-docs/openapi.json", ApiDoc::openapi());
/// ```
///
/// Create a new [`SwaggerUi`] with custom [`Config`] and [`oauth::Config`].
/// ```rust
/// # use utoipa_swagger_ui::{SwaggerUi, Config, oauth};
/// # use utoipa::OpenApi;
/// # #[derive(OpenApi)]
/// # #[openapi()]
/// # struct ApiDoc;
/// let swagger = SwaggerUi::new("/swagger-ui/{_:.*}")
///     .url("/api-docs/openapi.json", ApiDoc::openapi())
///     .config(Config::default().try_it_out_enabled(true).filter(true))
///     .oauth(oauth::Config::new());
/// ```
///
#[non_exhaustive]
#[derive(Clone)]
#[cfg_attr(feature = "debug", derive(Debug))]
#[cfg(any(feature = "actix-web", feature = "rocket", feature = "axum"))]
#[cfg_attr(
    doc_cfg,
    doc(cfg(any(feature = "actix-web", feature = "rocket", feature = "axum")))
)]
pub struct SwaggerUi {
    path: Cow<'static, str>,
    urls: Vec<(Url<'static>, OpenApi)>,
    config: Option<Config<'static>>,
    external_urls: Vec<(Url<'static>, serde_json::Value)>,
}

#[cfg(any(feature = "actix-web", feature = "rocket", feature = "axum"))]
#[cfg_attr(
    doc_cfg,
    doc(cfg(any(feature = "actix-web", feature = "rocket", feature = "axum")))
)]
impl SwaggerUi {
    /// Create a new [`SwaggerUi`] for given path.
    ///
    /// Path argument will expose the Swagger UI to the user and should be something that
    /// the underlying application framework / library supports.
    ///
    /// # Examples
    ///
    /// Exposes Swagger UI using path `/swagger-ui` using actix-web supported syntax.
    ///
    /// ```rust
    /// # use utoipa_swagger_ui::SwaggerUi;
    /// let swagger = SwaggerUi::new("/swagger-ui/{_:.*}");
    /// ```
    pub fn new<P: Into<Cow<'static, str>>>(path: P) -> Self {
        Self {
            path: path.into(),
            urls: Vec::new(),
            config: None,
            external_urls: Vec::new(),
        }
    }

    /// Add api doc [`Url`] into [`SwaggerUi`].
    ///
    /// Method takes two arguments where first one is path which exposes the [`OpenApi`] to the user.
    /// Second argument is the actual Rust implementation of the OpenAPI doc which is being exposed.
    ///
    /// Calling this again will add another url to the Swagger UI.
    ///
    /// # Examples
    ///
    /// Expose manually created OpenAPI doc.
    /// ```rust
    /// # use utoipa_swagger_ui::SwaggerUi;
    /// let swagger = SwaggerUi::new("/swagger-ui/{_:.*}")
    ///     .url("/api-docs/openapi.json", utoipa::openapi::OpenApi::new(
    ///        utoipa::openapi::Info::new("my application", "0.1.0"),
    ///        utoipa::openapi::Paths::new(),
    /// ));
    /// ```
    ///
    /// Expose derived OpenAPI doc.
    /// ```rust
    /// # use utoipa_swagger_ui::SwaggerUi;
    /// # use utoipa::OpenApi;
    /// # #[derive(OpenApi)]
    /// # #[openapi()]
    /// # struct ApiDoc;
    /// let swagger = SwaggerUi::new("/swagger-ui/{_:.*}")
    ///     .url("/api-docs/openapi.json", ApiDoc::openapi());
    /// ```
    pub fn url<U: Into<Url<'static>>>(mut self, url: U, openapi: OpenApi) -> Self {
        self.urls.push((url.into(), openapi));

        self
    }

    /// Add multiple [`Url`]s to Swagger UI.
    ///
    /// Takes one [`Vec`] argument containing tuples of [`Url`] and [`OpenApi`].
    ///
    /// Situations where this comes handy is when there is a need or wish to separate different parts
    /// of the api to separate api docs.
    ///
    /// # Examples
    ///
    /// Expose multiple api docs via Swagger UI.
    /// ```rust
    /// # use utoipa_swagger_ui::{SwaggerUi, Url};
    /// # use utoipa::OpenApi;
    /// # #[derive(OpenApi)]
    /// # #[openapi()]
    /// # struct ApiDoc;
    /// # #[derive(OpenApi)]
    /// # #[openapi()]
    /// # struct ApiDoc2;
    /// let swagger = SwaggerUi::new("/swagger-ui/{_:.*}")
    ///     .urls(
    ///       vec![
    ///          (Url::with_primary("api doc 1", "/api-docs/openapi.json", true), ApiDoc::openapi()),
    ///          (Url::new("api doc 2", "/api-docs/openapi2.json"), ApiDoc2::openapi())
    ///     ]
    /// );
    /// ```
    pub fn urls(mut self, urls: Vec<(Url<'static>, OpenApi)>) -> Self {
        self.urls = urls;

        self
    }

    /// Add external API doc to the [`SwaggerUi`].
    ///
    /// This operation is unchecked and so it does not check any validity of provided content.
    /// Users are required to do their own check if any regarding validity of the external
    /// OpenAPI document.
    ///
    /// Method accepts two arguments, one is [`Url`] the API doc is served at and the second one is
    /// the [`serde_json::Value`] of the OpenAPI doc to be served.
    ///
    /// # Examples
    ///
    /// Add external API doc to the [`SwaggerUi`].
    /// ```rust
    /// # use utoipa_swagger_ui::{SwaggerUi, Url};
    /// # use utoipa::OpenApi;
    /// # use serde_json::json;
    /// let external_openapi = json!({"openapi": "3.0.0"});
    ///
    /// let swagger = SwaggerUi::new("/swagger-ui/{_:.*}")
    ///     .external_url_unchecked("/api-docs/openapi.json", external_openapi);
    /// ```
    pub fn external_url_unchecked<U: Into<Url<'static>>>(
        mut self,
        url: U,
        openapi: serde_json::Value,
    ) -> Self {
        self.external_urls.push((url.into(), openapi));

        self
    }

    /// Add external API docs to the [`SwaggerUi`] from iterator.
    ///
    /// This operation is unchecked and so it does not check any validity of provided content.
    /// Users are required to do their own check if any regarding validity of the external
    /// OpenAPI documents.
    ///
    /// Method accepts one argument, an `iter` of [`Url`] and [`serde_json::Value`] tuples. The
    /// [`Url`] will point to location the OpenAPI document is served and the [`serde_json::Value`]
    /// is the OpenAPI document to be served.
    ///
    /// # Examples
    ///
    /// Add external API docs to the [`SwaggerUi`].
    /// ```rust
    /// # use utoipa_swagger_ui::{SwaggerUi, Url};
    /// # use utoipa::OpenApi;
    /// # use serde_json::json;
    /// let external_openapi = json!({"openapi": "3.0.0"});
    /// let external_openapi2 = json!({"openapi": "3.0.0"});
    ///
    /// let swagger = SwaggerUi::new("/swagger-ui/{_:.*}")
    ///     .external_urls_from_iter_unchecked([
    ///         ("/api-docs/openapi.json", external_openapi),
    ///         ("/api-docs/openapi2.json", external_openapi2)
    ///     ]);
    /// ```
    pub fn external_urls_from_iter_unchecked<
        I: IntoIterator<Item = (U, serde_json::Value)>,
        U: Into<Url<'static>>,
    >(
        mut self,
        external_urls: I,
    ) -> Self {
        self.external_urls.extend(
            external_urls
                .into_iter()
                .map(|(url, doc)| (url.into(), doc)),
        );

        self
    }

    /// Add oauth [`oauth::Config`] into [`SwaggerUi`].
    ///
    /// Method takes one argument which exposes the [`oauth::Config`] to the user.
    ///
    /// # Examples
    ///
    /// Enable pkce with default client_id.
    /// ```rust
    /// # use utoipa_swagger_ui::{SwaggerUi, oauth};
    /// # use utoipa::OpenApi;
    /// # #[derive(OpenApi)]
    /// # #[openapi()]
    /// # struct ApiDoc;
    /// let swagger = SwaggerUi::new("/swagger-ui/{_:.*}")
    ///     .url("/api-docs/openapi.json", ApiDoc::openapi())
    ///     .oauth(oauth::Config::new()
    ///         .client_id("client-id")
    ///         .scopes(vec![String::from("openid")])
    ///         .use_pkce_with_authorization_code_grant(true)
    ///     );
    /// ```
    pub fn oauth(mut self, oauth: oauth::Config) -> Self {
        let config = self.config.get_or_insert(Default::default());
        config.oauth = Some(oauth);

        self
    }

    /// Add custom [`Config`] into [`SwaggerUi`] which gives users more granular control over
    /// Swagger UI options.
    ///
    /// Methods takes one [`Config`] argument which exposes Swagger UI's configurable options
    /// to the users.
    ///
    /// # Examples
    ///
    /// Create a new [`SwaggerUi`] with custom configuration.
    /// ```rust
    /// # use utoipa_swagger_ui::{SwaggerUi, Config};
    /// # use utoipa::OpenApi;
    /// # #[derive(OpenApi)]
    /// # #[openapi()]
    /// # struct ApiDoc;
    /// let swagger = SwaggerUi::new("/swagger-ui/{_:.*}")
    ///     .url("/api-docs/openapi.json", ApiDoc::openapi())
    ///     .config(Config::default().try_it_out_enabled(true).filter(true));
    /// ```
    pub fn config(mut self, config: Config<'static>) -> Self {
        self.config = Some(config);

        self
    }
}

/// Rust type for Swagger UI url configuration object.
#[non_exhaustive]
#[cfg_attr(feature = "debug", derive(Debug))]
#[derive(Default, Serialize, Clone)]
pub struct Url<'a> {
    name: Cow<'a, str>,
    url: Cow<'a, str>,
    #[serde(skip)]
    primary: bool,
}

impl<'a> Url<'a> {
    /// Create new [`Url`].
    ///
    /// Name is shown in the select dropdown when there are multiple docs in Swagger UI.
    ///
    /// Url is path which exposes the OpenAPI doc.
    ///
    /// # Examples
    ///
    /// ```rust
    /// # use utoipa_swagger_ui::Url;
    /// let url = Url::new("My Api", "/api-docs/openapi.json");
    /// ```
    pub fn new(name: &'a str, url: &'a str) -> Self {
        Self {
            name: Cow::Borrowed(name),
            url: Cow::Borrowed(url),
            ..Default::default()
        }
    }

    /// Create new [`Url`] with primary flag.
    ///
    /// Primary flag allows users to override the default behavior of the Swagger UI for selecting the primary
    /// doc to display. By default when there are multiple docs in Swagger UI the first one in the list
    /// will be the primary.
    ///
    /// Name is shown in the select dropdown when there are multiple docs in Swagger UI.
    ///
    /// Url is path which exposes the OpenAPI doc.
    ///
    /// # Examples
    ///
    /// Set "My Api" as primary.
    /// ```rust
    /// # use utoipa_swagger_ui::Url;
    /// let url = Url::with_primary("My Api", "/api-docs/openapi.json", true);
    /// ```
    pub fn with_primary(name: &'a str, url: &'a str, primary: bool) -> Self {
        Self {
            name: Cow::Borrowed(name),
            url: Cow::Borrowed(url),
            primary,
        }
    }
}

impl<'a> From<&'a str> for Url<'a> {
    fn from(url: &'a str) -> Self {
        Self {
            url: Cow::Borrowed(url),
            ..Default::default()
        }
    }
}

impl From<String> for Url<'_> {
    fn from(url: String) -> Self {
        Self {
            url: Cow::Owned(url),
            ..Default::default()
        }
    }
}

impl<'a> From<Cow<'static, str>> for Url<'a> {
    fn from(url: Cow<'static, str>) -> Self {
        Self {
            url,
            ..Default::default()
        }
    }
}

const SWAGGER_STANDALONE_LAYOUT: &str = "StandaloneLayout";
const SWAGGER_BASE_LAYOUT: &str = "BaseLayout";

/// Object used to alter Swagger UI settings.
///
/// Config struct provides [Swagger UI configuration](https://github.com/swagger-api/swagger-ui/blob/master/docs/usage/configuration.md)
/// for settings which could be altered with **docker variables**.
///
/// # Examples
///
/// In simple case, create config directly from url that points to the api doc json.
/// ```rust
/// # use utoipa_swagger_ui::Config;
/// let config = Config::from("/api-doc.json");
/// ```
///
/// If there is multiple api docs to serve config, the [`Config`] can be also be directly created with [`Config::new`]
/// ```rust
/// # use utoipa_swagger_ui::Config;
/// let config = Config::new(["/api-docs/openapi1.json", "/api-docs/openapi2.json"]);
/// ```
///
/// Or same as above but more verbose syntax.
/// ```rust
/// # use utoipa_swagger_ui::{Config, Url};
/// let config = Config::new([
///     Url::new("api1", "/api-docs/openapi1.json"),
///     Url::new("api2", "/api-docs/openapi2.json")
/// ]);
/// ```
///
/// With oauth config.
/// ```rust
/// # use utoipa_swagger_ui::{Config, oauth};
/// let config = Config::with_oauth_config(
///     ["/api-docs/openapi1.json", "/api-docs/openapi2.json"],
///     oauth::Config::new(),
/// );
/// ```
#[non_exhaustive]
#[derive(Serialize, Clone)]
#[cfg_attr(feature = "debug", derive(Debug))]
#[serde(rename_all = "camelCase")]
pub struct Config<'a> {
    /// Url to fetch external configuration from.
    #[serde(skip_serializing_if = "Option::is_none")]
    config_url: Option<String>,

    /// Id of the DOM element where `Swagger UI` will put it's user interface.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(rename = "dom_id")]
    dom_id: Option<String>,

    /// [`Url`] the Swagger UI is serving.
    #[serde(skip_serializing_if = "Option::is_none")]
    url: Option<String>,

    /// Name of the primary url if any.
    #[serde(skip_serializing_if = "Option::is_none", rename = "urls.primaryName")]
    urls_primary_name: Option<String>,

    /// [`Url`]s the Swagger UI is serving.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    urls: Vec<Url<'a>>,

    /// Enables overriding configuration parameters with url query parameters.
    #[serde(skip_serializing_if = "Option::is_none")]
    query_config_enabled: Option<bool>,

    /// Controls whether [deep linking](https://github.com/swagger-api/swagger-ui/blob/master/docs/usage/deep-linking.md)
    /// is enabled in OpenAPI spec.
    ///
    /// Deep linking automatically scrolls and expands UI to given url fragment.
    #[serde(skip_serializing_if = "Option::is_none")]
    deep_linking: Option<bool>,

    /// Controls whether operation id is shown in the operation list.
    #[serde(skip_serializing_if = "Option::is_none")]
    display_operation_id: Option<bool>,

    /// Default models expansion depth; -1 will completely hide the models.
    #[serde(skip_serializing_if = "Option::is_none")]
    default_models_expand_depth: Option<isize>,

    /// Default model expansion depth from model example section.
    #[serde(skip_serializing_if = "Option::is_none")]
    default_model_expand_depth: Option<isize>,

    /// Defines how models is show when API is first rendered.
    #[serde(skip_serializing_if = "Option::is_none")]
    default_model_rendering: Option<String>,

    /// Define whether request duration in milliseconds is displayed for "Try it out" requests.
    #[serde(skip_serializing_if = "Option::is_none")]
    display_request_duration: Option<bool>,

    /// Controls default expansion for operations and tags.
    #[serde(skip_serializing_if = "Option::is_none")]
    doc_expansion: Option<String>,

    /// Defines is filtering of tagged operations allowed with edit box in top bar.
    #[serde(skip_serializing_if = "Option::is_none")]
    filter: Option<bool>,

    /// Controls how many tagged operations are shown. By default all operations are shown.
    #[serde(skip_serializing_if = "Option::is_none")]
    max_displayed_tags: Option<usize>,

    /// Defines whether extensions are shown.
    #[serde(skip_serializing_if = "Option::is_none")]
    show_extensions: Option<bool>,

    /// Defines whether common extensions are shown.
    #[serde(skip_serializing_if = "Option::is_none")]
    show_common_extensions: Option<bool>,

    /// Defines whether "Try it out" section should be enabled by default.
    #[serde(skip_serializing_if = "Option::is_none")]
    try_it_out_enabled: Option<bool>,

    /// Defines whether request snippets section is enabled. If disabled legacy curl snipped
    /// will be used.
    #[serde(skip_serializing_if = "Option::is_none")]
    request_snippets_enabled: Option<bool>,

    /// Oauth redirect url.
    #[serde(skip_serializing_if = "Option::is_none")]
    oauth2_redirect_url: Option<String>,

    /// Defines whether request mutated with `requestInterceptor` will be used to produce curl command
    /// in the UI.
    #[serde(skip_serializing_if = "Option::is_none")]
    show_mutated_request: Option<bool>,

    /// Define supported http request submit methods.
    #[serde(skip_serializing_if = "Option::is_none")]
    supported_submit_methods: Option<Vec<String>>,

    /// Define validator url which is used to validate the Swagger spec. By default the validator swagger.io's
    /// online validator is used. Setting this to none will disable spec validation.
    #[serde(skip_serializing_if = "Option::is_none")]
    validator_url: Option<String>,

    /// Enables passing credentials to CORS requests as defined
    /// [fetch standards](https://fetch.spec.whatwg.org/#credentials).
    #[serde(skip_serializing_if = "Option::is_none")]
    with_credentials: Option<bool>,

    /// Defines whether authorizations is persisted throughout browser refresh and close.
    #[serde(skip_serializing_if = "Option::is_none")]
    persist_authorization: Option<bool>,

    /// [`oauth::Config`] the Swagger UI is using for auth flow.
    #[serde(skip)]
    oauth: Option<oauth::Config>,

    /// Defines syntax highlighting specific options.
    #[serde(skip_serializing_if = "Option::is_none")]
    syntax_highlight: Option<SyntaxHighlight>,

    /// The layout of Swagger UI uses, default is `"StandaloneLayout"`.
    layout: &'a str,

    /// Basic authentication configuration. If configured, the Swagger UI will prompt for basic auth credentials.
    #[serde(skip_serializing_if = "Option::is_none")]
    basic_auth: Option<BasicAuth>,
}

impl<'a> Config<'a> {
    fn new_<I: IntoIterator<Item = U>, U: Into<Url<'a>>>(
        urls: I,
        oauth_config: Option<oauth::Config>,
    ) -> Self {
        let urls = urls.into_iter().map(Into::into).collect::<Vec<Url<'a>>>();
        let urls_len = urls.len();

        Self {
            oauth: oauth_config,
            ..if urls_len == 1 {
                Self::new_config_with_single_url(urls)
            } else {
                Self::new_config_with_multiple_urls(urls)
            }
        }
    }

    fn new_config_with_multiple_urls(urls: Vec<Url<'a>>) -> Self {
        let primary_name = urls
            .iter()
            .find(|url| url.primary)
            .map(|url| url.name.to_string());

        Self {
            urls_primary_name: primary_name,
            urls: urls
                .into_iter()
                .map(|mut url| {
                    if url.name == "" {
                        url.name = Cow::Owned(String::from(&url.url[..]));

                        url
                    } else {
                        url
                    }
                })
                .collect(),
            ..Default::default()
        }
    }

    fn new_config_with_single_url(mut urls: Vec<Url<'a>>) -> Self {
        let url = urls.get_mut(0).map(mem::take).unwrap();
        let primary_name = if url.primary {
            Some(url.name.to_string())
        } else {
            None
        };

        Self {
            urls_primary_name: primary_name,
            url: if url.name == "" {
                Some(url.url.to_string())
            } else {
                None
            },
            urls: if url.name != "" {
                vec![url]
            } else {
                Vec::new()
            },
            ..Default::default()
        }
    }

    /// Constructs a new [`Config`] from [`Iterator`] of [`Url`]s.
    ///
    /// [`Url`]s provided to the [`Config`] will only change the urls Swagger UI is going to use to
    /// fetch the API document. This does not change the URL that is defined with [`SwaggerUi::url`]
    /// or [`SwaggerUi::urls`] which defines the URL the API document is exposed from.
    ///
    /// # Examples
    /// Create new config with 2 api doc urls.
    /// ```rust
    /// # use utoipa_swagger_ui::Config;
    /// let config = Config::new(["/api-docs/openapi1.json", "/api-docs/openapi2.json"]);
    /// ```
    pub fn new<I: IntoIterator<Item = U>, U: Into<Url<'a>>>(urls: I) -> Self {
        Self::new_(urls, None)
    }

    /// Constructs a new [`Config`] from [`Iterator`] of [`Url`]s.
    ///
    /// # Examples
    /// Create new config with oauth config.
    /// ```rust
    /// # use utoipa_swagger_ui::{Config, oauth};
    /// let config = Config::with_oauth_config(
    ///     ["/api-docs/openapi1.json", "/api-docs/openapi2.json"],
    ///     oauth::Config::new(),
    /// );
    /// ```
    pub fn with_oauth_config<I: IntoIterator<Item = U>, U: Into<Url<'a>>>(
        urls: I,
        oauth_config: oauth::Config,
    ) -> Self {
        Self::new_(urls, Some(oauth_config))
    }

    /// Configure defaults for current [`Config`].
    ///
    /// A new [`Config`] will be created with given `urls` and its _**default values**_ and
    /// _**url, urls and urls_primary_name**_ will be moved to the current [`Config`] the method
    /// is called on.
    ///
    /// Current config will be returned with configured default values.
    #[cfg(any(feature = "actix-web", feature = "rocket", feature = "axum"))]
    #[cfg_attr(
        doc_cfg,
        doc(cfg(any(feature = "actix-web", feature = "rocket", feature = "axum")))
    )]
    fn configure_defaults<I: IntoIterator<Item = U>, U: Into<Url<'a>>>(mut self, urls: I) -> Self {
        let Config {
            dom_id,
            deep_linking,
            url,
            urls,
            urls_primary_name,
            ..
        } = Config::new(urls);

        self.dom_id = dom_id;
        self.deep_linking = deep_linking;
        self.url = url;
        self.urls = urls;
        self.urls_primary_name = urls_primary_name;

        self
    }

    /// Add url to fetch external configuration from.
    ///
    /// # Examples
    ///
    /// Set external config url.
    /// ```rust
    /// # use utoipa_swagger_ui::Config;
    /// let config = Config::new(["/api-docs/openapi.json"])
    ///     .config_url("http://url.to.external.config");
    /// ```
    pub fn config_url<S: Into<String>>(mut self, config_url: S) -> Self {
        self.config_url = Some(config_url.into());

        self
    }

    /// Add id of the DOM element where `Swagger UI` will put it's user interface.
    ///
    /// The default value is `#swagger-ui`.
    ///
    /// # Examples
    ///
    /// Set custom dom id where the Swagger UI will place it's content.
    /// ```rust
    /// # use utoipa_swagger_ui::Config;
    /// let config = Config::new(["/api-docs/openapi.json"]).dom_id("#my-id");
    /// ```
    pub fn dom_id<S: Into<String>>(mut self, dom_id: S) -> Self {
        self.dom_id = Some(dom_id.into());

        self
    }

    /// Set `query_config_enabled` to allow overriding configuration parameters via url `query`
    /// parameters.
    ///
    /// Default value is `false`.
    ///
    /// # Examples
    ///
    /// Enable query config.
    /// ```rust
    /// # use utoipa_swagger_ui::Config;
    /// let config = Config::new(["/api-docs/openapi.json"])
    ///     .query_config_enabled(true);
    /// ```
    pub fn query_config_enabled(mut self, query_config_enabled: bool) -> Self {
        self.query_config_enabled = Some(query_config_enabled);

        self
    }

    /// Set `deep_linking` to allow deep linking tags and operations.
    ///
    /// Deep linking will automatically scroll to and expand operation when Swagger UI is
    /// given corresponding url fragment. See more at
    /// [deep linking docs](https://github.com/swagger-api/swagger-ui/blob/master/docs/usage/deep-linking.md).
    ///
    /// Deep linking is enabled by default.
    ///
    /// # Examples
    ///
    /// Disable the deep linking.
    /// ```rust
    /// # use utoipa_swagger_ui::Config;
    /// let config = Config::new(["/api-docs/openapi.json"])
    ///     .deep_linking(false);
    /// ```
    pub fn deep_linking(mut self, deep_linking: bool) -> Self {
        self.deep_linking = Some(deep_linking);

        self
    }

    /// Set `display_operation_id` to `true` to show operation id in the operations list.
    ///
    /// Default value is `false`.
    ///
    /// # Examples
    ///
    /// Allow operation id to be shown.
    /// ```rust
    /// # use utoipa_swagger_ui::Config;
    /// let config = Config::new(["/api-docs/openapi.json"])
    ///     .display_operation_id(true);
    /// ```
    pub fn display_operation_id(mut self, display_operation_id: bool) -> Self {
        self.display_operation_id = Some(display_operation_id);

        self
    }

    /// Set 'layout' to 'BaseLayout' to only use the base swagger layout without a search header.
    ///
    /// Default value is 'StandaloneLayout'.
    ///
    /// # Examples
    ///
    /// Configure Swagger to use Base Layout instead of Standalone
    /// ```rust
    /// # use utoipa_swagger_ui::Config;
    /// let config = Config::new(["/api-docs/openapi.json"])
    ///     .use_base_layout();
    /// ```
    pub fn use_base_layout(mut self) -> Self {
        self.layout = SWAGGER_BASE_LAYOUT;

        self
    }

    /// Add default models expansion depth.
    ///
    /// Setting this to `-1` will completely hide the models.
    ///
    /// # Examples
    ///
    /// Hide all the models.
    /// ```rust
    /// # use utoipa_swagger_ui::Config;
    /// let config = Config::new(["/api-docs/openapi.json"])
    ///     .default_models_expand_depth(-1);
    /// ```
    pub fn default_models_expand_depth(mut self, default_models_expand_depth: isize) -> Self {
        self.default_models_expand_depth = Some(default_models_expand_depth);

        self
    }

    /// Add default model expansion depth for model on the example section.
    ///
    /// # Examples
    ///
    /// ```rust
    /// # use utoipa_swagger_ui::Config;
    /// let config = Config::new(["/api-docs/openapi.json"])
    ///     .default_model_expand_depth(1);
    /// ```
    pub fn default_model_expand_depth(mut self, default_model_expand_depth: isize) -> Self {
        self.default_model_expand_depth = Some(default_model_expand_depth);

        self
    }

    /// Add `default_model_rendering` to set how models is show when API is first rendered.
    ///
    /// The user can always switch the rendering for given model by clicking the `Model` and `Example Value` links.
    ///
    /// * `example` Makes example rendered first by default.
    /// * `model` Makes model rendered first by default.
    ///
    /// # Examples
    ///
    /// ```rust
    /// # use utoipa_swagger_ui::Config;
    /// let config = Config::new(["/api-docs/openapi.json"])
    ///     .default_model_rendering(r#"["example"*, "model"]"#);
    /// ```
    pub fn default_model_rendering<S: Into<String>>(mut self, default_model_rendering: S) -> Self {
        self.default_model_rendering = Some(default_model_rendering.into());

        self
    }

    /// Set to `true` to show request duration of _**'Try it out'**_ requests _**(in milliseconds)**_.
    ///
    /// Default value is `false`.
    ///
    /// # Examples
    /// Enable request duration of the _**'Try it out'**_ requests.
    /// ```rust
    /// # use utoipa_swagger_ui::Config;
    /// let config = Config::new(["/api-docs/openapi.json"])
    ///     .display_request_duration(true);
    /// ```
    pub fn display_request_duration(mut self, display_request_duration: bool) -> Self {
        self.display_request_duration = Some(display_request_duration);

        self
    }

    /// Add `doc_expansion` to control default expansion for operations and tags.
    ///
    /// * `list` Will expand only tags.
    /// * `full` Will expand tags and operations.
    /// * `none` Will expand nothing.
    ///
    /// # Examples
    ///
    /// ```rust
    /// # use utoipa_swagger_ui::Config;
    /// let config = Config::new(["/api-docs/openapi.json"])
    ///     .doc_expansion(r#"["list"*, "full", "none"]"#);
    /// ```
    pub fn doc_expansion<S: Into<String>>(mut self, doc_expansion: S) -> Self {
        self.doc_expansion = Some(doc_expansion.into());

        self
    }

    /// Add `filter` to allow filtering of tagged operations.
    ///
    /// When enabled top bar will show and edit box that can be used to filter visible tagged operations.
    /// Filter behaves case sensitive manner and matches anywhere inside the tag.
    ///
    /// Default value is `false`.
    ///
    /// # Examples
    ///
    /// Enable filtering.
    /// ```rust
    /// # use utoipa_swagger_ui::Config;
    /// let config = Config::new(["/api-docs/openapi.json"])
    ///     .filter(true);
    /// ```
    pub fn filter(mut self, filter: bool) -> Self {
        self.filter = Some(filter);

        self
    }

    /// Add `max_displayed_tags` to restrict shown tagged operations.
    ///
    /// By default all operations are shown.
    ///
    /// # Examples
    ///
    /// Display only 4 operations.
    /// ```rust
    /// # use utoipa_swagger_ui::Config;
    /// let config = Config::new(["/api-docs/openapi.json"])
    ///     .max_displayed_tags(4);
    /// ```
    pub fn max_displayed_tags(mut self, max_displayed_tags: usize) -> Self {
        self.max_displayed_tags = Some(max_displayed_tags);

        self
    }

    /// Set `show_extensions` to adjust whether vendor extension _**`(x-)`**_ fields and values
    /// are shown for operations, parameters, responses and schemas.
    ///
    /// # Example
    ///
    /// Show vendor extensions.
    /// ```rust
    /// # use utoipa_swagger_ui::Config;
    /// let config = Config::new(["/api-docs/openapi.json"])
    ///     .show_extensions(true);
    /// ```
    pub fn show_extensions(mut self, show_extensions: bool) -> Self {
        self.show_extensions = Some(show_extensions);

        self
    }

    /// Add `show_common_extensions` to define whether common extension
    /// _**`(pattern, maxLength, minLength, maximum, minimum)`**_ fields and values are shown
    /// for parameters.
    ///
    /// # Examples
    ///
    /// Show common extensions.
    /// ```rust
    /// # use utoipa_swagger_ui::Config;
    /// let config = Config::new(["/api-docs/openapi.json"])
    ///     .show_common_extensions(true);
    /// ```
    pub fn show_common_extensions(mut self, show_common_extensions: bool) -> Self {
        self.show_common_extensions = Some(show_common_extensions);

        self
    }

    /// Add `try_it_out_enabled` to enable _**'Try it out'**_ section by default.
    ///
    /// Default value is `false`.
    ///
    /// # Examples
    ///
    /// Enable _**'Try it out'**_ section by default.
    /// ```rust
    /// # use utoipa_swagger_ui::Config;
    /// let config = Config::new(["/api-docs/openapi.json"])
    ///     .try_it_out_enabled(true);
    /// ```
    pub fn try_it_out_enabled(mut self, try_it_out_enabled: bool) -> Self {
        self.try_it_out_enabled = Some(try_it_out_enabled);

        self
    }

    /// Set `request_snippets_enabled` to enable request snippets section.
    ///
    /// If disabled legacy curl snipped will be used.
    ///
    /// Default value is `false`.
    ///
    /// # Examples
    ///
    /// Enable request snippets section.
    /// ```rust
    /// # use utoipa_swagger_ui::Config;
    /// let config = Config::new(["/api-docs/openapi.json"])
    ///     .request_snippets_enabled(true);
    /// ```
    pub fn request_snippets_enabled(mut self, request_snippets_enabled: bool) -> Self {
        self.request_snippets_enabled = Some(request_snippets_enabled);

        self
    }

    /// Add oauth redirect url.
    ///
    /// # Examples
    ///
    /// Add oauth redirect url.
    /// ```rust
    /// # use utoipa_swagger_ui::Config;
    /// let config = Config::new(["/api-docs/openapi.json"])
    ///     .oauth2_redirect_url("http://my.oauth2.redirect.url");
    /// ```
    pub fn oauth2_redirect_url<S: Into<String>>(mut self, oauth2_redirect_url: S) -> Self {
        self.oauth2_redirect_url = Some(oauth2_redirect_url.into());

        self
    }

    /// Add `show_mutated_request` to use request returned from `requestInterceptor`
    /// to produce curl command in the UI. If set to `false` the request before `requestInterceptor`
    /// was applied will be used.
    ///
    /// # Examples
    ///
    /// Use request after `requestInterceptor` to produce the curl command.
    /// ```rust
    /// # use utoipa_swagger_ui::Config;
    /// let config = Config::new(["/api-docs/openapi.json"])
    ///     .show_mutated_request(true);
    /// ```
    pub fn show_mutated_request(mut self, show_mutated_request: bool) -> Self {
        self.show_mutated_request = Some(show_mutated_request);

        self
    }

    /// Add supported http methods for _**'Try it out'**_ operation.
    ///
    /// _**'Try it out'**_ will be enabled based on the given list of http methods when
    /// the operation's http method is included within the list.
    /// By giving an empty list will disable _**'Try it out'**_ from all operations but it will
    /// **not** filter operations from the UI.
    ///
    /// By default all http operations are enabled.
    ///
    /// # Examples
    ///
    /// Set allowed http methods explicitly.
    /// ```rust
    /// # use utoipa_swagger_ui::Config;
    /// let config = Config::new(["/api-docs/openapi.json"])
    ///     .supported_submit_methods(["get", "put", "post", "delete", "options", "head", "patch", "trace"]);
    /// ```
    ///
    /// Allow _**'Try it out'**_ for only GET operations.
    /// ```rust
    /// # use utoipa_swagger_ui::Config;
    /// let config = Config::new(["/api-docs/openapi.json"])
    ///     .supported_submit_methods(["get"]);
    /// ```
    pub fn supported_submit_methods<I: IntoIterator<Item = S>, S: Into<String>>(
        mut self,
        supported_submit_methods: I,
    ) -> Self {
        self.supported_submit_methods = Some(
            supported_submit_methods
                .into_iter()
                .map(|method| method.into())
                .collect(),
        );

        self
    }

    /// Add validator url which is used to validate the Swagger spec.
    ///
    /// This can also be set to use locally deployed validator for example see
    /// [Validator Badge](https://github.com/swagger-api/validator-badge) for more details.
    ///
    /// By default swagger.io's online validator _**`(https://validator.swagger.io/validator)`**_ will be used.
    /// Setting this to `none` will disable the validator.
    ///
    /// # Examples
    ///
    /// Disable the validator.
    /// ```rust
    /// # use utoipa_swagger_ui::Config;
    /// let config = Config::new(["/api-docs/openapi.json"])
    ///     .validator_url("none");
    /// ```
    pub fn validator_url<S: Into<String>>(mut self, validator_url: S) -> Self {
        self.validator_url = Some(validator_url.into());

        self
    }

    /// Set `with_credentials` to enable passing credentials to CORS requests send by browser as defined
    /// [fetch standards](https://fetch.spec.whatwg.org/#credentials).
    ///
    /// **Note!** that Swagger UI cannot currently set cookies cross-domain
    /// (see [swagger-js#1163](https://github.com/swagger-api/swagger-js/issues/1163)) -
    /// as a result, you will have to rely on browser-supplied cookies (which this setting enables sending)
    /// that Swagger UI cannot control.
    ///
    /// # Examples
    ///
    /// Enable passing credentials to CORS requests.
    /// ```rust
    /// # use utoipa_swagger_ui::Config;
    /// let config = Config::new(["/api-docs/openapi.json"])
    ///     .with_credentials(true);
    /// ```
    pub fn with_credentials(mut self, with_credentials: bool) -> Self {
        self.with_credentials = Some(with_credentials);

        self
    }

    /// Set to `true` to enable authorizations to be persisted throughout browser refresh and close.
    ///
    /// Default value is `false`.
    ///
    ///
    /// # Examples
    ///
    /// Persists authorization throughout browser close and refresh.
    /// ```rust
    /// # use utoipa_swagger_ui::Config;
    /// let config = Config::new(["/api-docs/openapi.json"])
    ///     .persist_authorization(true);
    /// ```
    pub fn persist_authorization(mut self, persist_authorization: bool) -> Self {
        self.persist_authorization = Some(persist_authorization);

        self
    }

    /// Set a specific configuration for syntax highlighting responses
    /// and curl commands.
    ///
    /// By default, swagger-ui does syntax highlighting of responses
    /// and curl commands.  This may consume considerable resources in
    /// the browser when executed on large responses.
    ///
    /// # Example
    ///
    /// Disable syntax highlighting.
    /// ```rust
    /// # use utoipa_swagger_ui::Config;
    /// let config = Config::new(["/api-docs/openapi.json"])
    ///     .with_syntax_highlight(false);
    /// ```
    pub fn with_syntax_highlight<H: Into<SyntaxHighlight>>(mut self, syntax_highlight: H) -> Self {
        self.syntax_highlight = Some(syntax_highlight.into());

        self
    }

    /// Set basic authentication configuration.
    /// If configured, the Swagger UI will prompt for basic auth credentials.
    /// username and password are required. "{username}:{password}" will be base64 encoded and added to the "Authorization" header.
    /// If not provided or wrong credentials are provided, the user will be prompted again.
    /// # Examples
    ///
    /// Configure basic authentication.
    /// ```rust
    /// # use utoipa_swagger_ui::Config;
    /// # use utoipa_swagger_ui::BasicAuth;
    /// let config = Config::new(["/api-docs/openapi.json"])
    ///     .basic_auth(BasicAuth { username: "admin".to_string(), password: "password".to_string() });
    /// ```
    pub fn basic_auth(mut self, basic_auth: BasicAuth) -> Self {
        self.basic_auth = Some(basic_auth);

        self
    }
}

impl Default for Config<'_> {
    fn default() -> Self {
        Self {
            config_url: Default::default(),
            dom_id: Some("#swagger-ui".to_string()),
            url: Default::default(),
            urls_primary_name: Default::default(),
            urls: Default::default(),
            query_config_enabled: Default::default(),
            deep_linking: Some(true),
            display_operation_id: Default::default(),
            default_models_expand_depth: Default::default(),
            default_model_expand_depth: Default::default(),
            default_model_rendering: Default::default(),
            display_request_duration: Default::default(),
            doc_expansion: Default::default(),
            filter: Default::default(),
            max_displayed_tags: Default::default(),
            show_extensions: Default::default(),
            show_common_extensions: Default::default(),
            try_it_out_enabled: Default::default(),
            request_snippets_enabled: Default::default(),
            oauth2_redirect_url: Default::default(),
            show_mutated_request: Default::default(),
            supported_submit_methods: Default::default(),
            validator_url: Default::default(),
            with_credentials: Default::default(),
            persist_authorization: Default::default(),
            oauth: Default::default(),
            syntax_highlight: Default::default(),
            layout: SWAGGER_STANDALONE_LAYOUT,
            basic_auth: Default::default(),
        }
    }
}

impl<'a> From<&'a str> for Config<'a> {
    fn from(s: &'a str) -> Self {
        Self::new([s])
    }
}

impl From<String> for Config<'_> {
    fn from(s: String) -> Self {
        Self::new([s])
    }
}

/// Basic auth options for Swagger UI. By providing `BasicAuth` to `Config::basic_auth` the access to the
/// Swagger UI can be restricted behind given basic authentication.
#[derive(Serialize, Clone)]
#[cfg_attr(feature = "debug", derive(Debug))]
pub struct BasicAuth {
    /// Username for the `BasicAuth`
    pub username: String,
    /// Password of the _`username`_ for the `BasicAuth`
    pub password: String,
}

/// Represents settings related to syntax highlighting of payloads and
/// cURL commands.
#[derive(Serialize, Clone)]
#[cfg_attr(feature = "debug", derive(Debug))]
#[non_exhaustive]
pub struct SyntaxHighlight {
    /// Boolean telling whether syntax highlighting should be
    /// activated or not. Defaults to `true`.
    pub activated: bool,
    /// Highlight.js syntax coloring theme to use.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub theme: Option<&'static str>,
}

impl Default for SyntaxHighlight {
    fn default() -> Self {
        Self {
            activated: true,
            theme: None,
        }
    }
}

impl From<bool> for SyntaxHighlight {
    fn from(value: bool) -> Self {
        Self {
            activated: value,
            ..Default::default()
        }
    }
}

impl SyntaxHighlight {
    /// Explicitly specifies whether syntax highlighting is to be
    /// activated or not.  Defaults to true.
    pub fn activated(mut self, activated: bool) -> Self {
        self.activated = activated;
        self
    }

    /// Explicitly specifies the
    /// [Highlight.js](https://highlightjs.org/) coloring theme to
    /// utilize for syntax highlighting.
    pub fn theme(mut self, theme: &'static str) -> Self {
        self.theme = Some(theme);
        self
    }
}

/// Represents servable file of Swagger UI. This is used together with [`serve`] function
/// to serve Swagger UI files via web server.
#[non_exhaustive]
pub struct SwaggerFile<'a> {
    /// Content of the file as [`Cow`] [`slice`] of bytes.
    pub bytes: Cow<'a, [u8]>,
    /// Content type of the file e.g `"text/xml"`.
    pub content_type: String,
}

/// User friendly way to serve Swagger UI and its content via web server.
///
/// * **path** Should be the relative path to Swagger UI resource within the web server.
/// * **config** Swagger [`Config`] to use for the Swagger UI.
///
/// Typically this function is implemented _**within**_ handler what serves the Swagger UI. Handler itself must
/// match to user defined path that points to the root of the Swagger UI and match everything relatively
/// from the root of the Swagger UI _**(tail path)**_. The relative path from root of the Swagger UI
/// is used to serve [`SwaggerFile`]s. If Swagger UI is served from path `/swagger-ui/` then the `tail`
/// is everything under the `/swagger-ui/` prefix.
///
/// _There are also implementations in [examples of utoipa repository][examples]._
///
/// [examples]: https://github.com/juhaku/utoipa/tree/master/examples
///
/// # Examples
///
/// _**Reference implementation with `actix-web`.**_
/// ```rust
/// # use actix_web::HttpResponse;
/// # use std::sync::Arc;
/// # use utoipa_swagger_ui::Config;
/// // The config should be created in main function or in initialization before
/// // creation of the handler which will handle serving the Swagger UI.
/// let config = Arc::new(Config::from("/api-doc.json"));
///
/// // This "/" is for demonstrative purposes only. The actual path should point to
/// // file within Swagger UI. In real implementation this is the `tail` path from root of the
/// // Swagger UI to the file served.
/// let tail_path = "/";
///
/// fn get_swagger_ui(tail_path: String, config: Arc<Config>) -> HttpResponse {
///   match utoipa_swagger_ui::serve(tail_path.as_ref(), config) {
///       Ok(swagger_file) => swagger_file
///           .map(|file| {
///               HttpResponse::Ok()
///                   .content_type(file.content_type)
///                   .body(file.bytes.to_vec())
///           })
///           .unwrap_or_else(|| HttpResponse::NotFound().finish()),
///       Err(error) => HttpResponse::InternalServerError().body(error.to_string()),
///   }
/// }
/// ```
pub fn serve<'a>(
    path: &str,
    config: Arc<Config<'a>>,
) -> Result<Option<SwaggerFile<'a>>, Box<dyn Error>> {
    let mut file_path = path;

    if file_path.is_empty() || file_path == "/" {
        file_path = "index.html";
    }

    if let Some(file) = SwaggerUiDist::get(file_path) {
        let mut bytes = file.data;

        if file_path == "swagger-initializer.js" {
            let mut file = match String::from_utf8(bytes.to_vec()) {
                Ok(file) => file,
                Err(error) => return Err(Box::new(error)),
            };

            file = format_config(config.as_ref(), file)?;

            if let Some(oauth) = &config.oauth {
                match oauth::format_swagger_config(oauth, file) {
                    Ok(oauth_file) => file = oauth_file,
                    Err(error) => return Err(Box::new(error)),
                }
            }

            bytes = Cow::Owned(file.as_bytes().to_vec())
        };

        Ok(Some(SwaggerFile {
            bytes,
            content_type: mime_guess::from_path(file_path)
                .first_or_octet_stream()
                .to_string(),
        }))
    } else {
        Ok(None)
    }
}

#[inline]
fn format_config(config: &Config, file: String) -> Result<String, Box<dyn Error>> {
    let config_json = match serde_json::to_string_pretty(&config) {
        Ok(config) => config,
        Err(error) => return Err(Box::new(error)),
    };

    // Replace {{config}} with pretty config json and remove the curly brackets `{ }` from beginning and the end.
    Ok(file.replace("{{config}}", &config_json[2..&config_json.len() - 2]))
}

/// Is used to provide general way to deliver multiple types of OpenAPI docs via `utoipa-swagger-ui`.
#[cfg(any(feature = "actix-web", feature = "rocket", feature = "axum"))]
#[derive(Clone)]
enum ApiDoc {
    Utoipa(utoipa::openapi::OpenApi),
    Value(serde_json::Value),
}

// Delegate serde's `Serialize` to the variant itself.
#[cfg(any(feature = "actix-web", feature = "rocket", feature = "axum"))]
impl Serialize for ApiDoc {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        match self {
            Self::Value(value) => value.serialize(serializer),
            Self::Utoipa(utoipa) => utoipa.serialize(serializer),
        }
    }
}

#[cfg(test)]
mod tests {
    use similar::TextDiff;

    use super::*;

    fn assert_diff_equal(expected: &str, new: &str) {
        let diff = TextDiff::from_lines(expected, new);

        assert_eq!(expected, new, "\nDifference:\n{}", diff.unified_diff());
    }

    const TEST_INITIAL_CONFIG: &str = r#"
window.ui = SwaggerUIBundle({
  {{config}},
  presets: [
    SwaggerUIBundle.presets.apis,
    SwaggerUIStandalonePreset
  ],
  plugins: [
    SwaggerUIBundle.plugins.DownloadUrl
  ],
});"#;

    #[test]
    fn format_swagger_config_json_single_url() {
        let formatted_config = match format_config(
            &Config::new(["/api-docs/openapi1.json"]),
            String::from(TEST_INITIAL_CONFIG),
        ) {
            Ok(file) => file,
            Err(error) => panic!("{error}"),
        };

        const EXPECTED: &str = r###"
window.ui = SwaggerUIBundle({
    "dom_id": "#swagger-ui",
  "url": "/api-docs/openapi1.json",
  "deepLinking": true,
  "layout": "StandaloneLayout",
  presets: [
    SwaggerUIBundle.presets.apis,
    SwaggerUIStandalonePreset
  ],
  plugins: [
    SwaggerUIBundle.plugins.DownloadUrl
  ],
});"###;

        assert_diff_equal(EXPECTED, &formatted_config)
    }

    #[test]
    fn format_swagger_config_json_single_url_with_name() {
        let formatted_config = match format_config(
            &Config::new([Url::new("api-doc1", "/api-docs/openapi1.json")]),
            String::from(TEST_INITIAL_CONFIG),
        ) {
            Ok(file) => file,
            Err(error) => panic!("{error}"),
        };

        const EXPECTED: &str = r###"
window.ui = SwaggerUIBundle({
    "dom_id": "#swagger-ui",
  "urls": [
    {
      "name": "api-doc1",
      "url": "/api-docs/openapi1.json"
    }
  ],
  "deepLinking": true,
  "layout": "StandaloneLayout",
  presets: [
    SwaggerUIBundle.presets.apis,
    SwaggerUIStandalonePreset
  ],
  plugins: [
    SwaggerUIBundle.plugins.DownloadUrl
  ],
});"###;

        assert_diff_equal(EXPECTED, &formatted_config);
    }

    #[test]
    fn format_swagger_config_json_single_url_primary() {
        let formatted_config = match format_config(
            &Config::new([Url::with_primary(
                "api-doc1",
                "/api-docs/openapi1.json",
                true,
            )]),
            String::from(TEST_INITIAL_CONFIG),
        ) {
            Ok(file) => file,
            Err(error) => panic!("{error}"),
        };

        const EXPECTED: &str = r###"
window.ui = SwaggerUIBundle({
    "dom_id": "#swagger-ui",
  "urls.primaryName": "api-doc1",
  "urls": [
    {
      "name": "api-doc1",
      "url": "/api-docs/openapi1.json"
    }
  ],
  "deepLinking": true,
  "layout": "StandaloneLayout",
  presets: [
    SwaggerUIBundle.presets.apis,
    SwaggerUIStandalonePreset
  ],
  plugins: [
    SwaggerUIBundle.plugins.DownloadUrl
  ],
});"###;

        assert_diff_equal(EXPECTED, &formatted_config);
    }

    #[test]
    fn format_swagger_config_multiple_urls_with_primary() {
        let formatted_config = match format_config(
            &Config::new([
                Url::with_primary("api-doc1", "/api-docs/openapi1.json", true),
                Url::new("api-doc2", "/api-docs/openapi2.json"),
            ]),
            String::from(TEST_INITIAL_CONFIG),
        ) {
            Ok(file) => file,
            Err(error) => panic!("{error}"),
        };

        const EXPECTED: &str = r###"
window.ui = SwaggerUIBundle({
    "dom_id": "#swagger-ui",
  "urls.primaryName": "api-doc1",
  "urls": [
    {
      "name": "api-doc1",
      "url": "/api-docs/openapi1.json"
    },
    {
      "name": "api-doc2",
      "url": "/api-docs/openapi2.json"
    }
  ],
  "deepLinking": true,
  "layout": "StandaloneLayout",
  presets: [
    SwaggerUIBundle.presets.apis,
    SwaggerUIStandalonePreset
  ],
  plugins: [
    SwaggerUIBundle.plugins.DownloadUrl
  ],
});"###;

        assert_diff_equal(EXPECTED, &formatted_config);
    }

    #[test]
    fn format_swagger_config_multiple_urls() {
        let formatted_config = match format_config(
            &Config::new(["/api-docs/openapi1.json", "/api-docs/openapi2.json"]),
            String::from(TEST_INITIAL_CONFIG),
        ) {
            Ok(file) => file,
            Err(error) => panic!("{error}"),
        };

        const EXPECTED: &str = r###"
window.ui = SwaggerUIBundle({
    "dom_id": "#swagger-ui",
  "urls": [
    {
      "name": "/api-docs/openapi1.json",
      "url": "/api-docs/openapi1.json"
    },
    {
      "name": "/api-docs/openapi2.json",
      "url": "/api-docs/openapi2.json"
    }
  ],
  "deepLinking": true,
  "layout": "StandaloneLayout",
  presets: [
    SwaggerUIBundle.presets.apis,
    SwaggerUIStandalonePreset
  ],
  plugins: [
    SwaggerUIBundle.plugins.DownloadUrl
  ],
});"###;

        assert_diff_equal(EXPECTED, &formatted_config);
    }

    #[test]
    fn format_swagger_config_with_multiple_fields() {
        let formatted_config = match format_config(
            &Config::new(["/api-docs/openapi1.json"])
                .deep_linking(false)
                .dom_id("#another-el")
                .default_model_expand_depth(-1)
                .default_model_rendering(r#"["example"*]"#)
                .default_models_expand_depth(1)
                .display_operation_id(true)
                .display_request_duration(true)
                .filter(true)
                .use_base_layout()
                .doc_expansion(r#"["list"*]"#)
                .max_displayed_tags(1)
                .oauth2_redirect_url("http://auth")
                .persist_authorization(true)
                .query_config_enabled(true)
                .request_snippets_enabled(true)
                .show_common_extensions(true)
                .show_extensions(true)
                .show_mutated_request(true)
                .supported_submit_methods(["get"])
                .try_it_out_enabled(true)
                .validator_url("none")
                .with_credentials(true),
            String::from(TEST_INITIAL_CONFIG),
        ) {
            Ok(file) => file,
            Err(error) => panic!("{error}"),
        };

        const EXPECTED: &str = r###"
window.ui = SwaggerUIBundle({
    "dom_id": "#another-el",
  "url": "/api-docs/openapi1.json",
  "queryConfigEnabled": true,
  "deepLinking": false,
  "displayOperationId": true,
  "defaultModelsExpandDepth": 1,
  "defaultModelExpandDepth": -1,
  "defaultModelRendering": "[\"example\"*]",
  "displayRequestDuration": true,
  "docExpansion": "[\"list\"*]",
  "filter": true,
  "maxDisplayedTags": 1,
  "showExtensions": true,
  "showCommonExtensions": true,
  "tryItOutEnabled": true,
  "requestSnippetsEnabled": true,
  "oauth2RedirectUrl": "http://auth",
  "showMutatedRequest": true,
  "supportedSubmitMethods": [
    "get"
  ],
  "validatorUrl": "none",
  "withCredentials": true,
  "persistAuthorization": true,
  "layout": "BaseLayout",
  presets: [
    SwaggerUIBundle.presets.apis,
    SwaggerUIStandalonePreset
  ],
  plugins: [
    SwaggerUIBundle.plugins.DownloadUrl
  ],
});"###;

        assert_diff_equal(EXPECTED, &formatted_config);
    }

    #[test]
    fn format_swagger_config_with_syntax_highlight_default() {
        let formatted_config = match format_config(
            &Config::new(["/api-docs/openapi1.json"])
                .with_syntax_highlight(SyntaxHighlight::default()),
            String::from(TEST_INITIAL_CONFIG),
        ) {
            Ok(file) => file,
            Err(error) => panic!("{error}"),
        };

        const EXPECTED: &str = r###"
window.ui = SwaggerUIBundle({
    "dom_id": "#swagger-ui",
  "url": "/api-docs/openapi1.json",
  "deepLinking": true,
  "syntaxHighlight": {
    "activated": true
  },
  "layout": "StandaloneLayout",
  presets: [
    SwaggerUIBundle.presets.apis,
    SwaggerUIStandalonePreset
  ],
  plugins: [
    SwaggerUIBundle.plugins.DownloadUrl
  ],
});"###;

        assert_diff_equal(EXPECTED, &formatted_config);
    }

    #[test]
    fn format_swagger_config_with_syntax_highlight_on() {
        let formatted_config = match format_config(
            &Config::new(["/api-docs/openapi1.json"]).with_syntax_highlight(true),
            String::from(TEST_INITIAL_CONFIG),
        ) {
            Ok(file) => file,
            Err(error) => panic!("{error}"),
        };

        const EXPECTED: &str = r###"
window.ui = SwaggerUIBundle({
    "dom_id": "#swagger-ui",
  "url": "/api-docs/openapi1.json",
  "deepLinking": true,
  "syntaxHighlight": {
    "activated": true
  },
  "layout": "StandaloneLayout",
  presets: [
    SwaggerUIBundle.presets.apis,
    SwaggerUIStandalonePreset
  ],
  plugins: [
    SwaggerUIBundle.plugins.DownloadUrl
  ],
});"###;

        assert_diff_equal(EXPECTED, &formatted_config);
    }

    #[test]
    fn format_swagger_config_with_syntax_highlight_off() {
        let formatted_config = match format_config(
            &Config::new(["/api-docs/openapi1.json"]).with_syntax_highlight(false),
            String::from(TEST_INITIAL_CONFIG),
        ) {
            Ok(file) => file,
            Err(error) => panic!("{error}"),
        };

        const EXPECTED: &str = r###"
window.ui = SwaggerUIBundle({
    "dom_id": "#swagger-ui",
  "url": "/api-docs/openapi1.json",
  "deepLinking": true,
  "syntaxHighlight": {
    "activated": false
  },
  "layout": "StandaloneLayout",
  presets: [
    SwaggerUIBundle.presets.apis,
    SwaggerUIStandalonePreset
  ],
  plugins: [
    SwaggerUIBundle.plugins.DownloadUrl
  ],
});"###;

        assert_diff_equal(EXPECTED, &formatted_config);
    }

    #[test]
    fn format_swagger_config_with_syntax_highlight_default_with_theme() {
        let formatted_config = match format_config(
            &Config::new(["/api-docs/openapi1.json"])
                .with_syntax_highlight(SyntaxHighlight::default().theme("monokai")),
            String::from(TEST_INITIAL_CONFIG),
        ) {
            Ok(file) => file,
            Err(error) => panic!("{error}"),
        };

        const EXPECTED: &str = r###"
window.ui = SwaggerUIBundle({
    "dom_id": "#swagger-ui",
  "url": "/api-docs/openapi1.json",
  "deepLinking": true,
  "syntaxHighlight": {
    "activated": true,
    "theme": "monokai"
  },
  "layout": "StandaloneLayout",
  presets: [
    SwaggerUIBundle.presets.apis,
    SwaggerUIStandalonePreset
  ],
  plugins: [
    SwaggerUIBundle.plugins.DownloadUrl
  ],
});"###;

        assert_diff_equal(EXPECTED, &formatted_config);
    }
}
