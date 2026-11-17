mod concurrency;
mod container;
mod defaults;
mod env;
mod environment;
pub mod error;
mod event;
mod expression;
mod job;
mod permissions;
mod secret;
mod step;
mod strategy;

pub(crate) mod workflow;

pub use concurrency::*;
pub use container::*;
pub use defaults::*;
pub use env::*;
pub use environment::*;
pub use event::*;
pub use expression::*;
pub use job::*;
pub use permissions::*;
pub use secret::*;
pub use step::*;
pub use strategy::*;
pub use workflow::*;

pub(crate) fn is_default<T: Default + PartialEq>(value: &T) -> bool {
    *value == T::default()
}

mod private {
    pub trait Sealed {}
}
