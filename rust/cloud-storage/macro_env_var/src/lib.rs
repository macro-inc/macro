// Re-export paste and serde so users don't need to depend on them directly
pub use paste;
pub use serde;
use thiserror::Error;

const APP_SECRETS_JSON_ENV: &str = "APP_SECRETS_JSON";

fn read_std_env(s: &'static str) -> Result<String, std::env::VarError> {
    std::env::var(s)
}

fn read_from_app_secrets_json_with<F>(key: &'static str, read_var: F) -> Option<String>
where
    F: Fn(&'static str) -> Result<String, std::env::VarError>,
{
    let secrets_json = read_var(APP_SECRETS_JSON_ENV).ok()?;
    let secrets = serde_json::from_str::<serde_json::Value>(&secrets_json).ok()?;
    let value = secrets.get(key)?;

    match value {
        serde_json::Value::String(value) => Some(value.clone()),
        value => Some(value.to_string()),
    }
}

/// Read a value from `APP_SECRETS_JSON` without mutating the process environment.
pub fn read_from_app_secrets_json(key: &'static str) -> Option<String> {
    read_from_app_secrets_json_with(key, read_std_env)
}

fn read_env_with<F>(s: &'static str, read_var: F) -> Result<String, VarNameErr>
where
    F: Fn(&'static str) -> Result<String, std::env::VarError>,
{
    match read_from_app_secrets_json_with(s, &read_var) {
        Some(value) => Ok(value),
        None => read_var(s).map_err(|err| VarNameErr { var_name: s, err }),
    }
}

fn maybe_read_env_with<F>(s: &'static str, read_var: F) -> Option<String>
where
    F: Fn(&'static str) -> Result<String, std::env::VarError>,
{
    read_from_app_secrets_json_with(s, &read_var).or_else(|| read_var(s).ok())
}

#[cfg(test)]
mod tests;

#[cfg(test)]
mod testing_harness {
    use super::{VarNameErr, maybe_read_env_with, read_env_with};
    use std::cell::Cell;

    type MockValue = Cell<Option<Box<dyn Fn(&'static str) -> Result<String, std::env::VarError>>>>;
    thread_local! {
        static MOCK_VAR_GETTER: MockValue = const { Cell::new(None) };
    }

    struct MockEnvGuard;

    impl Drop for MockEnvGuard {
        fn drop(&mut self) {
            MOCK_VAR_GETTER.replace(None);
        }
    }

    fn get_env(s: &'static str) -> Result<String, std::env::VarError> {
        let cur_getter = MOCK_VAR_GETTER.replace(None);
        match cur_getter {
            Some(mock) => {
                let out = mock(s);
                MOCK_VAR_GETTER.replace(Some(mock));
                out
            }
            None => std::env::var(s),
        }
    }

    pub fn read_env(s: &'static str) -> Result<String, VarNameErr> {
        read_env_with(s, get_env)
    }

    pub fn maybe_read_env(s: &'static str) -> Option<String> {
        maybe_read_env_with(s, get_env)
    }

    pub(crate) fn with_mock_env<F, Cb, U>(f: F, cb: Cb) -> U
    where
        F: Fn(&'static str) -> Result<String, std::env::VarError> + 'static,
        Cb: FnOnce() -> U,
    {
        MOCK_VAR_GETTER.replace(Some(Box::new(f)));
        let _guard = MockEnvGuard;
        cb()
    }
}

#[cfg(test)]
pub use testing_harness::maybe_read_env;
#[cfg(test)]
pub use testing_harness::read_env;

#[cfg(not(test))]
pub fn read_env(s: &'static str) -> Result<String, VarNameErr> {
    read_env_with(s, read_std_env)
}

/// Read an environment variable, returning `None` if it is not present.
#[cfg(not(test))]
pub fn maybe_read_env(s: &'static str) -> Option<String> {
    maybe_read_env_with(s, read_std_env)
}

/// The type of error that is produced by this crate
#[derive(Debug, Error)]
#[error("An error occurred while reading envvar: {var_name}. Err: {err}")]
pub struct VarNameErr {
    var_name: &'static str,
    err: std::env::VarError,
}

#[macro_export]
macro_rules! env_var {
    (
        $(#[$attr:meta])*
        $v:vis struct $n:ident;
    ) => {
        $crate::paste::paste! {
            #[doc = "struct which represents the existence of the `" $n:snake:upper "` environment variable.
            this can be used as a sentinel value to guarantee the existence of the variable.
            See [`" $n "`::new] and [`" $n "`::unwrap_new] for usage methods"]
            $(#[$attr])*
            $v enum $n {
                #[doc = "This environment var is allocated and read at runtime"]
                Runtime(std::sync::Arc<str>),
                #[doc = "This environment var was present at compile time. It may or may not currently exist at runtime."]
                Comptime(&'static str)
            }

            impl $n {
                #[doc = "Attempt to create a new instance of [Self] by reading `" $n:snake:upper "` from the environment variables.
                     If this value does not exist this returns a [std::env::VarError]"]
                #[allow(dead_code)]
                #[tracing::instrument(err, level = tracing::Level::TRACE)]
                $v fn new() -> Result<Self, $crate::VarNameErr> {
                    let res = $crate::read_env($crate::paste::paste! { stringify!([<$n:snake:upper>]) })?;
                    Ok(Self::Runtime(std::sync::Arc::from(res)))
                }

                #[doc = "This calls [Self::new] put panics if the result is an error"]
                #[allow(dead_code)]
                $v fn unwrap_new() -> Self {
                    $crate::paste::paste! {
                        Self::new().expect(concat!("Failed to find the ", stringify!([<$n:snake:upper>]), " variable in environment"))
                    }
                }

                #[doc = "This is a const fn which will panic at compile time if the environment variable is not found"]
                #[allow(dead_code)]
                $v const fn new_comptime() -> Self {
                    let val = std::option_env!($crate::paste::paste! { stringify!([<$n:snake:upper>]) });
                    $crate::paste::paste! {
                        Self::Comptime(val.expect(concat!("Failed to find the ", stringify!([<$n:snake:upper>]), " variable in environment at compile time")))
                    }
                }


                #[doc = "Function used for testing purposes. Allows the caller to create a new Self via a static str"]
                #[cfg(test)]
                #[allow(dead_code)]
                $v const fn new_testing(s: &'static str) -> Self {
                    Self::Comptime(s)
                }

                #[allow(dead_code)]
                #[doc = "Get a reference to the internal [std::sync::Arc] if this is a runtime allocated env var"]
                $v fn runtime_inner(&self) -> Option<&std::sync::Arc<str>> {
                    match self {
                        Self::Runtime(i) => Some(i),
                        Self::Comptime(_) => None
                    }
                }

                #[allow(dead_code)]
                #[doc = "Get a reference to the static string slice that was present at compile time"]
                $v fn comptime_inner(&self) -> Option<&'static str> {
                    match self {
                        Self::Comptime(i) => Some(i),
                        Self::Runtime(_) => None
                    }
                }

                #[allow(dead_code)]
                #[doc = "Returns an Arc<str> of the contained value"]
                $v fn as_arc(&self) -> std::sync::Arc<str> {
                    match self {
                        Self::Comptime(i) => std::sync::Arc::from(*i),
                        Self::Runtime(i) => i.clone()
                    }
                }
            }

            impl std::ops::Deref for $n {
                type Target = str;

                fn deref(&self) -> &Self::Target {
                    match self {
                        Self::Runtime(i) => &*i,
                        Self::Comptime(i) => i
                    }
                }
            }

            impl std::convert::AsRef<str> for $n {
                fn as_ref(&self) -> &str {
                    match self {
                        Self::Runtime(i) => &*i,
                        Self::Comptime(i) => i
                    }
                }
            }

            impl<'de> $crate::serde::Deserialize<'de> for $n {
                fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
                where
                    D: $crate::serde::Deserializer<'de>,
                {
                    let value = <String as $crate::serde::Deserialize>::deserialize(deserializer)?;
                    Ok(Self::Runtime(std::sync::Arc::from(value)))
                }
            }
        }
    };
    (
        $(#[$attr:meta])*
        $v:vis struct $n:ident {
            $(
                $(#[$field_attr:meta])*
                $field_vis:vis $field_name:ident
            ),* $(,)?
        }
    ) => {
        $crate::paste::paste! {
            $(
                $crate::env_var!(
                    $(#[$field_attr])*
                    $field_vis struct $field_name;
                );
            )*

            $(#[$attr])*
            pub struct $n {
                $(
                    pub [<$field_name:snake>]: $field_name,
                )*
            }

            impl $n {
                #[doc = "Create a new instance of self with all the internal env vals retrieved. Returns an error if one of the values cannot be found"]
                #[allow(dead_code)]
                $v fn new() -> Result<Self, $crate::VarNameErr> {
                    Ok(Self {
                        $(
                            [<$field_name:snake>]: $field_name::new()?,
                        )*
                    })
                }


                #[doc = "Create a new instance of self with all the internal env vals retrieved. Panics if any of the values cannot be found"]
                #[allow(dead_code)]
                $v fn unwrap_new() -> Self {
                    Self {
                        $(
                            [<$field_name:snake>]: $field_name::unwrap_new(),
                        )*
                    }
                }

                #[doc = "Create a new instance of self with all the internal env vals set at compile time. Will fail to compile if any value is not set at compile time"]
                #[allow(dead_code)]
                $v const fn new_comptime() -> Self {
                    Self {
                        $(
                            [<$field_name:snake>]: $field_name::new_comptime(),
                        )*
                    }
                }
            }
        }
    };
}

/// A macro for defining multiple environment variable structs in a single invocation.
///
/// Each definition expands exactly as if it were passed to [`env_var!`] on its own.
///
/// # Example
///
/// ```
/// use macro_env_var::env_vars;
///
/// env_vars! {
///     pub struct BaseUrl;
///     pub struct DatabaseUrl;
///     #[derive(Debug, Clone)]
///     pub struct RedisUri;
/// }
///
/// let _url: Result<BaseUrl, _> = BaseUrl::new();
/// ```
#[macro_export]
macro_rules! env_vars {
    (
        $(
            $(#[$attr:meta])*
            $v:vis struct $n:ident;
        )*
    ) => {
        $(
            $crate::env_var! {
                $(#[$attr])*
                $v struct $n;
            }
        )*
    };
}

/// A macro for defining multiple optional environment variable structs in a single invocation.
///
/// Each definition expands exactly as if it were passed to [`maybe_env_var!`] on its own.
///
/// # Example
///
/// ```
/// use macro_env_var::maybe_env_vars;
///
/// maybe_env_vars! {
///     pub struct OptionalApiKey;
///     pub struct OptionalFeatureFlag;
/// }
///
/// let _key: Option<OptionalApiKey> = OptionalApiKey::new();
/// ```
#[macro_export]
macro_rules! maybe_env_vars {
    (
        $(
            $(#[$attr:meta])*
            $v:vis struct $n:ident;
        )*
    ) => {
        $(
            $crate::maybe_env_var! {
                $(#[$attr])*
                $v struct $n;
            }
        )*
    };
}

/// A macro for defining optional environment variables that return `Option` instead of `Result`.
///
/// Use this when an environment variable is optional and its absence is expected behavior,
/// not an error condition.
///
/// # Example
///
/// ```
/// use macro_env_var::maybe_env_var;
///
/// maybe_env_var! {
///     pub struct OptionalApiKey;
/// }
///
/// // Returns None if OPTIONAL_API_KEY is not set
/// let _key: Option<OptionalApiKey> = OptionalApiKey::new();
/// ```
#[macro_export]
macro_rules! maybe_env_var {
    (
        $(#[$attr:meta])*
        $v:vis struct $n:ident;
    ) => {
        $crate::paste::paste! {
            #[doc = "struct which represents the optional `" $n:snake:upper "` environment variable.
            This returns `Option<Self>` when the variable may or may not be present.
            See [`" $n "`::new] for usage methods"]
            $(#[$attr])*
            $v enum $n {
                #[doc = "This environment var is allocated and read at runtime"]
                Runtime(std::sync::Arc<str>),
                #[doc = "This environment var was present at compile time. It may or may not currently exist at runtime."]
                Comptime(&'static str)
            }

            impl $n {
                #[doc = "Attempt to create a new instance of [Self] by reading `" $n:snake:upper "` from the environment variables.
                     Returns `None` if the variable is not set."]
                #[allow(dead_code)]
                $v fn new() -> Option<Self> {
                    let res = $crate::maybe_read_env($crate::paste::paste! { stringify!([<$n:snake:upper>]) })?;
                    Some(Self::Runtime(std::sync::Arc::from(res)))
                }

                #[doc = "Returns the value at compile time if present, otherwise `None`"]
                #[allow(dead_code)]
                $v const fn new_comptime() -> Option<Self> {
                    match std::option_env!($crate::paste::paste! { stringify!([<$n:snake:upper>]) }) {
                        Some(val) => Some(Self::Comptime(val)),
                        None => None,
                    }
                }

                #[doc = "Function used for testing purposes. Allows the caller to create a new Self via a static str"]
                #[cfg(test)]
                #[allow(dead_code)]
                $v const fn new_testing(s: &'static str) -> Self {
                    Self::Comptime(s)
                }

                #[allow(dead_code)]
                #[doc = "Get a reference to the internal [std::sync::Arc] if this is a runtime allocated env var"]
                $v fn runtime_inner(&self) -> Option<&std::sync::Arc<str>> {
                    match self {
                        Self::Runtime(i) => Some(i),
                        Self::Comptime(_) => None
                    }
                }

                #[allow(dead_code)]
                #[doc = "Get a reference to the static string slice that was present at compile time"]
                $v fn comptime_inner(&self) -> Option<&'static str> {
                    match self {
                        Self::Comptime(i) => Some(i),
                        Self::Runtime(_) => None
                    }
                }

                #[allow(dead_code)]
                #[doc = "Returns an Arc<str> of the contained value"]
                $v fn as_arc(&self) -> std::sync::Arc<str> {
                    match self {
                        Self::Comptime(i) => std::sync::Arc::from(*i),
                        Self::Runtime(i) => i.clone()
                    }
                }
            }

            impl std::ops::Deref for $n {
                type Target = str;

                fn deref(&self) -> &Self::Target {
                    match self {
                        Self::Runtime(i) => &*i,
                        Self::Comptime(i) => i
                    }
                }
            }

            impl std::convert::AsRef<str> for $n {
                fn as_ref(&self) -> &str {
                    match self {
                        Self::Runtime(i) => &*i,
                        Self::Comptime(i) => i
                    }
                }
            }

            impl<'de> $crate::serde::Deserialize<'de> for $n {
                fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
                where
                    D: $crate::serde::Deserializer<'de>,
                {
                    let value = <String as $crate::serde::Deserialize>::deserialize(deserializer)?;
                    Ok(Self::Runtime(std::sync::Arc::from(value)))
                }
            }
        }
    };
    (
        $(#[$attr:meta])*
        $v:vis struct $n:ident {
            $(
                $(#[$field_attr:meta])*
                $field_vis:vis $field_name:ident
            ),* $(,)?
        }
    ) => {
        $crate::paste::paste! {
            $(
                $crate::maybe_env_var!(
                    $(#[$field_attr])*
                    $field_vis struct $field_name;
                );
            )*

            $(#[$attr])*
            pub struct $n {
                $(
                    pub [<$field_name:snake>]: Option<$field_name>,
                )*
            }

            impl $n {
                #[doc = "Create a new instance of self with all the internal env vals retrieved. Each field is `Option<T>` since values may not be set."]
                #[allow(dead_code)]
                $v fn new() -> Self {
                    Self {
                        $(
                            [<$field_name:snake>]: $field_name::new(),
                        )*
                    }
                }

                #[doc = "Create a new instance of self with all the internal env vals set at compile time. Each field is `Option<T>`."]
                #[allow(dead_code)]
                $v const fn new_comptime() -> Self {
                    Self {
                        $(
                            [<$field_name:snake>]: $field_name::new_comptime(),
                        )*
                    }
                }
            }
        }
    };
}
