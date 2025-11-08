// Re-export paste so users don't need to depend on it directly
pub use paste;
use thiserror::Error;

#[cfg(test)]
mod tests;

#[cfg(test)]
mod testing_harness {
    use super::VarNameErr;
    use std::cell::Cell;

    type MockValue = Cell<Option<Box<dyn Fn(&'static str) -> Result<String, std::env::VarError>>>>;
    thread_local! {
        static MOCK_VAR_GETTER: MockValue = const { Cell::new(None) };
    }

    pub fn read_env(s: &'static str) -> Result<String, VarNameErr> {
        let cur_getter = MOCK_VAR_GETTER.replace(None);
        match cur_getter {
            Some(mock) => {
                let out = mock(s);
                MOCK_VAR_GETTER.replace(Some(mock));
                out
            }
            None => std::env::var(s),
        }
        .map_err(|err| VarNameErr { var_name: s, err })
    }

    pub(crate) fn with_mock_env<F, Cb, U>(f: F, cb: Cb) -> U
    where
        F: Fn(&'static str) -> Result<String, std::env::VarError> + 'static,
        Cb: FnOnce() -> U,
    {
        MOCK_VAR_GETTER.replace(Some(Box::new(f)));
        let output = cb();
        MOCK_VAR_GETTER.replace(None);
        output
    }
}

#[cfg(test)]
pub use testing_harness::read_env;

#[cfg(not(test))]
pub fn read_env(s: &'static str) -> Result<String, VarNameErr> {
    std::env::var(s).map_err(|err| VarNameErr { var_name: s, err })
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
                #[tracing::instrument(err)]
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
