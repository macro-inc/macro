//! Outbound adapters: the concrete providers, stores, and carriers the domain
//! ports are satisfied by.

pub mod channel_announcer;
pub mod daytona;
// pub mod namespace;
pub mod sidecar;

/// Give credential newtypes their constructor and their one escape hatch.
///
/// The point of the newtypes is that they derive neither `Debug` nor
/// `Display`, so a secret cannot reach a log or an error message without an
/// explicit `expose()` - and every `expose()` call site is then a place worth
/// looking at.
#[allow(unused_macros)]
macro_rules! secret {
    ($($name:ident),* $(,)?) => {
        $(
            impl $name {
                /// Wrap a credential value.
                #[must_use]
                pub fn new(value: String) -> Self {
                    Self(value)
                }

                /// Borrow the raw credential. Every call site is a place a
                /// secret escapes this type, so they should be few and
                /// obvious.
                #[must_use]
                pub(crate) fn expose(&self) -> &str {
                    &self.0
                }
            }
        )*
    };
}

#[allow(unused_imports)]
pub(crate) use secret;
