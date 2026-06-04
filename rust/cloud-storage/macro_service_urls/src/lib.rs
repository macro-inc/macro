#![deny(missing_docs)]

//! Macro service URL values with per-environment defaults and environment
//! variable overrides.
//!
//! Use [`service_url!`] to define a newtype whose default value is selected
//! from [`macro_env::Environment`]. The generated type also checks an override
//! environment variable derived from the type name. For example,
//! `DocumentStorageServiceUrl` checks `OVERRIDE_DOCUMENT_STORAGE_SERVICE_URL`
//! before falling back to its `local`, `dev`, or `prod` default.

use std::{borrow::Cow, fmt, ops::Deref};

#[doc(hidden)]
pub use macro_env;
#[doc(hidden)]
pub use paste;
use thiserror::Error;
use url::Url;

#[cfg(test)]
mod test;

#[cfg(test)]
mod testing_harness {
    use super::ServiceUrlVarErr;
    use std::cell::Cell;

    type MockValue = Cell<Option<Box<dyn Fn(&'static str) -> Result<String, std::env::VarError>>>>;

    thread_local! {
        static MOCK_VAR_GETTER: MockValue = const { Cell::new(None) };
    }

    struct ResetMockEnv;

    impl Drop for ResetMockEnv {
        fn drop(&mut self) {
            MOCK_VAR_GETTER.replace(None);
        }
    }

    #[doc(hidden)]
    pub fn read_override_env(var_name: &'static str) -> Result<Option<String>, ServiceUrlVarErr> {
        let cur_getter = MOCK_VAR_GETTER.replace(None);
        match cur_getter {
            Some(mock) => {
                let out = mock(var_name);
                MOCK_VAR_GETTER.replace(Some(mock));
                out
            }
            None => std::env::var(var_name),
        }
        .map(Some)
        .or_else(|err| match err {
            std::env::VarError::NotPresent => Ok(None),
            err => Err(ServiceUrlVarErr { var_name, err }),
        })
    }

    pub(crate) fn with_mock_override_env<F, Cb, U>(f: F, cb: Cb) -> U
    where
        F: Fn(&'static str) -> Result<String, std::env::VarError> + 'static,
        Cb: FnOnce() -> U,
    {
        MOCK_VAR_GETTER.replace(Some(Box::new(f)));
        let _guard = ResetMockEnv;
        cb()
    }
}

#[cfg(test)]
#[doc(hidden)]
pub use testing_harness::read_override_env;

/// Read an override environment variable for a service URL.
#[cfg(not(test))]
#[doc(hidden)]
pub fn read_override_env(var_name: &'static str) -> Result<Option<String>, ServiceUrlVarErr> {
    std::env::var(var_name).map(Some).or_else(|err| match err {
        std::env::VarError::NotPresent => Ok(None),
        err => Err(ServiceUrlVarErr { var_name, err }),
    })
}

/// A service URL string that can either borrow an existing string slice or own
/// a runtime override value.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct ServiceUrl<'a>(Cow<'a, str>);

impl<'a> ServiceUrl<'a> {
    /// Create a service URL that borrows a string slice.
    pub const fn borrowed(url: &'a str) -> Self {
        Self(Cow::Borrowed(url))
    }

    /// Create a service URL that owns a runtime string.
    pub fn owned(url: impl Into<String>) -> ServiceUrl<'static> {
        ServiceUrl(Cow::Owned(url.into()))
    }

    /// Return the URL as a string slice.
    pub fn as_str(&self) -> &str {
        self.0.as_ref()
    }

    /// Return a cheaply copied borrowed view of this URL.
    pub fn copied(&self) -> ServiceUrl<'_> {
        ServiceUrl(Cow::Borrowed(self.as_str()))
    }

    /// Convert this URL into an owned `'static` value.
    pub fn into_owned(self) -> ServiceUrl<'static> {
        ServiceUrl(Cow::Owned(self.0.into_owned()))
    }

    /// Convert this URL into its internal [`Cow`].
    pub fn into_cow(self) -> Cow<'a, str> {
        self.0
    }

    /// Return the borrowed string if this URL is currently borrowed.
    pub fn borrowed_inner(&self) -> Option<&'a str> {
        match &self.0 {
            Cow::Borrowed(url) => Some(*url),
            Cow::Owned(_) => None,
        }
    }

    /// Return the owned string if this URL is currently owned.
    pub fn owned_inner(&self) -> Option<&String> {
        match &self.0 {
            Cow::Borrowed(_) => None,
            Cow::Owned(url) => Some(url),
        }
    }
}

impl<'a> From<&'a str> for ServiceUrl<'a> {
    fn from(value: &'a str) -> Self {
        Self::borrowed(value)
    }
}

impl From<String> for ServiceUrl<'static> {
    fn from(value: String) -> Self {
        Self(Cow::Owned(value))
    }
}

impl<'a> From<Cow<'a, str>> for ServiceUrl<'a> {
    fn from(value: Cow<'a, str>) -> Self {
        Self(value)
    }
}

impl<'a> From<ServiceUrl<'a>> for String {
    fn from(value: ServiceUrl<'a>) -> Self {
        value.0.into_owned()
    }
}

impl<'a> Deref for ServiceUrl<'a> {
    type Target = str;

    fn deref(&self) -> &Self::Target {
        self.as_str()
    }
}

impl<'a> AsRef<str> for ServiceUrl<'a> {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}

impl<'a> fmt::Display for ServiceUrl<'a> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Error returned when a service URL override environment variable cannot be
/// read.
#[derive(Debug, Error)]
#[error("failed to read service URL override env var `{var_name}`: {err}")]
pub struct ServiceUrlVarErr {
    var_name: &'static str,
    #[source]
    err: std::env::VarError,
}

impl ServiceUrlVarErr {
    /// The environment variable name that failed to load.
    pub const fn var_name(&self) -> &'static str {
        self.var_name
    }

    /// The underlying environment-variable error.
    pub const fn env_var_error(&self) -> &std::env::VarError {
        &self.err
    }
}

/// Define typed service URL values with per-environment defaults and override
/// environment variables.
///
/// The override environment variable name is derived from the struct name:
/// `DocumentStorageServiceUrl` checks `OVERRIDE_DOCUMENT_STORAGE_SERVICE_URL`.
/// If that override is not set, [`macro_env::Environment`] selects one of the
/// provided `local`, `dev`, or `prod` defaults.
///
/// # Example
///
/// ```ignore
/// macro_service_urls::service_url! {
///     #[derive(Debug, Clone)]
///     pub struct DocumentStorageServiceUrl {
///         local: "http://localhost:8086",
///         dev: "https://cloud-storage-dev.macro.com",
///         prod: "https://cloud-storage.macro.com",
///     }
/// }
///
/// let url = DocumentStorageServiceUrl::new()?;
/// assert_eq!(
///     url.override_env_var_name(),
///     "OVERRIDE_DOCUMENT_STORAGE_SERVICE_URL",
/// );
/// ```
#[macro_export]
macro_rules! service_url {
    (
        $(#[$attr:meta])*
        $v:vis struct $n:ident {
            local: $local:literal,
            dev: $dev:literal,
            prod: $prod:literal $(,)?
        }
    ) => {
        $crate::paste::paste! {
            #[doc = "Typed service URL loaded from `OVERRIDE_" $n:snake:upper "` or selected from per-environment defaults."]
            $(#[$attr])*
            $v struct $n($crate::ServiceUrl<'static>);

            impl $n {
                #[doc = "Override environment variable checked before falling back to per-environment defaults."]
                $v const OVERRIDE_ENV_VAR_NAME: &'static str = concat!("OVERRIDE_", stringify!([<$n:snake:upper>]));

                #[doc = "Default URL for [`macro_env::Environment::Local`]."]
                $v const LOCAL: &'static str = $local;

                #[doc = "Default URL for [`macro_env::Environment::Develop`]."]
                $v const DEV: &'static str = $dev;

                #[doc = "Default URL for [`macro_env::Environment::Production`]."]
                $v const PROD: &'static str = $prod;

                #[doc = "Create a new instance of [`Self`], using the override env var if set and otherwise selecting a default from [`macro_env::Environment::new_or_prod`]."]
                #[allow(dead_code)]
                $v fn new() -> Result<Self, $crate::ServiceUrlVarErr> {
                    if let Some(value) = $crate::read_override_env(Self::OVERRIDE_ENV_VAR_NAME)? {
                        return Ok(Self($crate::ServiceUrl::owned(value)));
                    }

                    Ok(Self::default_for_environment($crate::macro_env::Environment::new_or_prod()))
                }

                #[doc = "Create a new instance of [`Self`], panicking if the override env var is set but cannot be read."]
                #[allow(dead_code)]
                $v fn unwrap_new() -> Self {
                    Self::new().expect(concat!("Failed to resolve service URL for ", stringify!($n)))
                }

                #[doc = "Create a new instance of [`Self`] for a specific environment, using the override env var if set."]
                #[allow(dead_code)]
                $v fn new_for_environment(environment: $crate::macro_env::Environment) -> Result<Self, $crate::ServiceUrlVarErr> {
                    if let Some(value) = $crate::read_override_env(Self::OVERRIDE_ENV_VAR_NAME)? {
                        return Ok(Self($crate::ServiceUrl::owned(value)));
                    }

                    Ok(Self::default_for_environment(environment))
                }

                #[doc = "Create a new instance of [`Self`] for a specific environment without checking the override env var."]
                #[allow(dead_code)]
                $v const fn default_for_environment(environment: $crate::macro_env::Environment) -> Self {
                    match environment {
                        $crate::macro_env::Environment::Local => Self::from_static(Self::LOCAL),
                        $crate::macro_env::Environment::Develop => Self::from_static(Self::DEV),
                        $crate::macro_env::Environment::Production => Self::from_static(Self::PROD),
                    }
                }

                #[doc = "Create a new instance of [`Self`] from the local default URL."]
                #[allow(dead_code)]
                $v const fn local() -> Self {
                    Self::from_static(Self::LOCAL)
                }

                #[doc = "Create a new instance of [`Self`] from the dev default URL."]
                #[allow(dead_code)]
                $v const fn dev() -> Self {
                    Self::from_static(Self::DEV)
                }

                #[doc = "Create a new instance of [`Self`] from the prod default URL."]
                #[allow(dead_code)]
                $v const fn prod() -> Self {
                    Self::from_static(Self::PROD)
                }

                #[doc = "Create a new instance of [`Self`] from a static URL."]
                #[allow(dead_code)]
                $v const fn from_static(url: &'static str) -> Self {
                    Self($crate::ServiceUrl::borrowed(url))
                }

                #[doc = "Create a new instance of [`Self`] from an owned runtime URL."]
                #[allow(dead_code)]
                $v fn from_owned(url: impl Into<String>) -> Self {
                    Self($crate::ServiceUrl::owned(url))
                }

                #[doc = "Return the override environment variable name checked by [`Self::new`]."]
                #[allow(dead_code)]
                $v const fn override_env_var_name(&self) -> &'static str {
                    Self::OVERRIDE_ENV_VAR_NAME
                }

                #[doc = "Return the contained [`ServiceUrl`]."]
                #[allow(dead_code)]
                $v fn into_inner(self) -> $crate::ServiceUrl<'static> {
                    self.0
                }

                #[doc = "Return a reference to the contained [`ServiceUrl`]."]
                #[allow(dead_code)]
                $v fn inner(&self) -> &$crate::ServiceUrl<'static> {
                    &self.0
                }

                #[doc = "Return the URL as a string slice."]
                #[allow(dead_code)]
                $v fn as_str(&self) -> &str {
                    self.0.as_str()
                }

                #[doc = "Return a cheaply copied borrowed view of this URL."]
                #[allow(dead_code)]
                $v fn copied(&self) -> $crate::ServiceUrl<'_> {
                    self.0.copied()
                }
            }

            impl std::ops::Deref for $n {
                type Target = str;

                fn deref(&self) -> &Self::Target {
                    self.as_str()
                }
            }

            impl std::convert::AsRef<str> for $n {
                fn as_ref(&self) -> &str {
                    self.as_str()
                }
            }

            impl std::fmt::Display for $n {
                fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                    f.write_str(self.as_str())
                }
            }

            impl std::convert::From<$crate::ServiceUrl<'static>> for $n {
                fn from(value: $crate::ServiceUrl<'static>) -> Self {
                    Self(value)
                }
            }

            impl std::convert::From<$n> for $crate::ServiceUrl<'static> {
                fn from(value: $n) -> Self {
                    value.0
                }
            }

            impl std::convert::From<String> for $n {
                fn from(value: String) -> Self {
                    Self::from_owned(value)
                }
            }

            impl std::convert::From<&'static str> for $n {
                fn from(value: &'static str) -> Self {
                    Self::from_static(value)
                }
            }
        }
    };
    (
        $(#[$attr:meta])*
        $v:vis struct $n:ident {
            $(
                $(#[$field_attr:meta])*
                $field_vis:vis $field_name:ident {
                    local: $field_local:literal,
                    dev: $field_dev:literal,
                    prod: $field_prod:literal $(,)?
                }
            ),* $(,)?
        }
    ) => {
        $crate::paste::paste! {
            $(
                $crate::service_url!(
                    $(#[$field_attr])*
                    $field_vis struct $field_name {
                        local: $field_local,
                        dev: $field_dev,
                        prod: $field_prod,
                    }
                );
            )*

            #[doc = "A collection of typed service URLs."]
            $(#[$attr])*
            $v struct $n {
                $(
                    #[doc = "Typed service URL loaded from `OVERRIDE_" $field_name:snake:upper "` or selected from per-environment defaults."]
                    $field_vis [<$field_name:snake>]: $field_name,
                )*
            }

            impl $n {
                #[doc = "Create a new instance of [`Self`] with all service URLs resolved for the current macro environment."]
                #[allow(dead_code)]
                $v fn new() -> Result<Self, $crate::ServiceUrlVarErr> {
                    let environment = $crate::macro_env::Environment::new_or_prod();
                    Self::new_for_environment(environment)
                }

                #[doc = "Create a new instance of [`Self`] with all service URLs resolved for the current macro environment, panicking if an override env var is set but cannot be read."]
                #[allow(dead_code)]
                $v fn unwrap_new() -> Self {
                    Self::new().expect(concat!("Failed to resolve service URL collection for ", stringify!($n)))
                }

                #[doc = "Create a new instance of [`Self`] with all service URLs resolved for a specific environment."]
                #[allow(dead_code)]
                $v fn new_for_environment(environment: $crate::macro_env::Environment) -> Result<Self, $crate::ServiceUrlVarErr> {
                    Ok(Self {
                        $(
                            [<$field_name:snake>]: $field_name::new_for_environment(environment)?,
                        )*
                    })
                }

                #[doc = "Create a new instance of [`Self`] with all service URLs set to environment defaults without checking overrides."]
                #[allow(dead_code)]
                $v const fn default_for_environment(environment: $crate::macro_env::Environment) -> Self {
                    Self {
                        $(
                            [<$field_name:snake>]: $field_name::default_for_environment(environment),
                        )*
                    }
                }
            }
        }
    };
}

service_url! {
    /// Common service URLs used by Macro services.
    pub struct ServiceUrls {
        /// Document storage service API URL.
        pub DocumentStorageServiceUrl {
            local: "http://localhost:8086",
            dev: "https://cloud-storage-dev.macro.com",
            prod: "https://cloud-storage.macro.com",
        },
        /// Connection gateway HTTP API URL.
        pub ConnectionGatewayUrl {
            local: "http://localhost:8082",
            dev: "https://connection-gateway-dev.macro.com",
            prod: "https://connection-gateway.macro.com",
        },
        /// Document cognition service API URL.
        pub DocumentCognitionServiceUrl {
            local: "http://localhost:8085",
            dev: "https://document-cognition-dev.macro.com",
            prod: "https://document-cognition.macro.com",
        },
        /// Lexical conversion service API URL.
        pub LexicalServiceUrl {
            local: "http://localhost:8096",
            dev: "https://lexical-service-dev.macroverse.workers.dev",
            prod: "https://lexical-service.macroverse.workers.dev",
        },
        /// Sync service API URL.
        pub SyncServiceUrl {
            local: "http://localhost:8787",
            dev: "https://sync-service-dev3.macroverse.workers.dev",
            prod: "https://sync-service-prod2.macroverse.workers.dev",
        },
        /// Static file service/CDN URL.
        pub StaticFileServiceUrl {
            local: "http://localhost:8100",
            dev: "https://static-file-service-dev.macro.com",
            prod: "https://static-file-service.macro.com",
        },
        /// Email service API URL.
        pub EmailServiceUrl {
            local: "http://localhost:8087",
            dev: "https://email-service-dev.macro.com",
            prod: "https://email-service.macro.com",
        },
    }
}
/// Extension trait that provides service URLs based on the current environment.
pub trait EnvExtMacroServiceUrls {
    /// The main app URL.
    fn app(&self) -> Url;
    /// Authentication service URL.
    fn auth_service(&self) -> Url;
    /// PDF rendering service URL.
    fn pdf_service(&self) -> Url;
    /// Document storage service URL.
    fn document_storage_service(&self) -> Url;
    /// WebSocket service URL.
    fn websocket_service(&self) -> Url;
    /// Document cognition service URL.
    fn cognition_service(&self) -> Url;
    /// WebSocket connection gateway URL.
    fn connection_gateway(&self) -> Url;
    /// Notification service URL.
    fn notification_service(&self) -> Url;
    /// Static file service URL.
    fn static_file_service(&self) -> Url;
    /// Link unfurl service URL.
    fn unfurl_service(&self) -> Url;
    /// Contacts service URL.
    fn contacts_service(&self) -> Url;
    /// Email service URL.
    fn email_service(&self) -> Url;
    /// Image proxy service URL.
    fn image_proxy_service(&self) -> Url;
}

/// Helper to parse a static URL string. All URLs here are compile-time constants
/// so parsing can never fail.
fn url(s: &str) -> Url {
    Url::parse(s).unwrap()
}

impl EnvExtMacroServiceUrls for macro_env::Environment {
    fn app(&self) -> Url {
        match self {
            macro_env::Environment::Production => url("https://macro.com"),
            macro_env::Environment::Develop => url("https://dev.macro.com"),
            macro_env::Environment::Local => {
                let port = std::env::var("FRONTEND_PORT").unwrap_or_else(|_| "3000".to_string());
                url(&format!("http://localhost:{port}"))
            }
        }
    }

    fn auth_service(&self) -> Url {
        match self {
            macro_env::Environment::Production => url("https://auth-service.macro.com"),
            macro_env::Environment::Develop => url("https://auth-service-dev.macro.com"),
            macro_env::Environment::Local => url("http://localhost:8080"),
        }
    }

    fn pdf_service(&self) -> Url {
        match self {
            macro_env::Environment::Production => url("https://pdf-service.macro.com"),
            macro_env::Environment::Develop => url("https://pdf-service-dev.macro.com"),
            macro_env::Environment::Local => url("http://localhost:4567"),
        }
    }

    fn document_storage_service(&self) -> Url {
        match self {
            macro_env::Environment::Production => url("https://cloud-storage.macro.com"),
            macro_env::Environment::Develop => url("https://cloud-storage-dev.macro.com"),
            macro_env::Environment::Local => url("http://localhost:8086"),
        }
    }

    fn websocket_service(&self) -> Url {
        match self {
            macro_env::Environment::Production => url("wss://services.macro.com"),
            macro_env::Environment::Develop => url("wss://services-dev.macro.com"),
            macro_env::Environment::Local => url("ws://localhost:6969"),
        }
    }

    fn cognition_service(&self) -> Url {
        match self {
            macro_env::Environment::Production => url("https://document-cognition.macro.com"),
            macro_env::Environment::Develop => url("https://document-cognition-dev.macro.com"),
            macro_env::Environment::Local => url("http://localhost:8085"),
        }
    }

    fn connection_gateway(&self) -> Url {
        match self {
            macro_env::Environment::Production => url("wss://connection-gateway.macro.com"),
            macro_env::Environment::Develop => url("wss://connection-gateway-dev.macro.com"),
            macro_env::Environment::Local => url("ws://localhost:8082"),
        }
    }

    fn notification_service(&self) -> Url {
        match self {
            macro_env::Environment::Production => url("https://notifications.macro.com"),
            macro_env::Environment::Develop => url("https://notifications-dev.macro.com"),
            macro_env::Environment::Local => url("http://localhost:8089"),
        }
    }

    fn static_file_service(&self) -> Url {
        match self {
            macro_env::Environment::Production => url("https://static-file-service.macro.com"),
            macro_env::Environment::Develop => url("https://static-file-service-dev.macro.com"),
            macro_env::Environment::Local => url("http://localhost:8100"),
        }
    }

    fn unfurl_service(&self) -> Url {
        match self {
            macro_env::Environment::Production => url("https://unfurl-service.macro.com"),
            macro_env::Environment::Develop => url("https://unfurl-service-dev.macro.com"),
            macro_env::Environment::Local => url("http://localhost:8095"),
        }
    }

    fn contacts_service(&self) -> Url {
        match self {
            macro_env::Environment::Production => url("https://contacts.macro.com"),
            macro_env::Environment::Develop => url("https://contacts-dev.macro.com"),
            macro_env::Environment::Local => url("http://localhost:8083"),
        }
    }

    fn email_service(&self) -> Url {
        match self {
            macro_env::Environment::Production => url("https://email-service.macro.com"),
            macro_env::Environment::Develop => url("https://email-service-dev.macro.com"),
            macro_env::Environment::Local => url("http://localhost:8087"),
        }
    }

    fn image_proxy_service(&self) -> Url {
        match self {
            macro_env::Environment::Production => url("https://image-proxy.macro.com"),
            macro_env::Environment::Develop => url("https://image-proxy-dev.macro.com"),
            macro_env::Environment::Local => url("http://localhost:8097"),
        }
    }
}
