#![deny(missing_docs)]

//! This crate implements the commen [MaybeSend] and [MaybeSync] patterns for async rust code which must compile for both wasm and native targets.

/// Maybe send on non-wasm32 targets requires the Send bound
#[cfg(not(target_arch = "wasm32"))]
pub trait MaybeSend: Send {}

/// Maybe send on wasm32 targets does not required the send bound
#[cfg(target_arch = "wasm32")]
pub trait MaybeSend {}

#[cfg(not(target_arch = "wasm32"))]
impl<T: Send> MaybeSend for T {}

#[cfg(target_arch = "wasm32")]
impl<T> MaybeSend for T {}

/// Maybe Sync on non-wasm32 targets requires the Sync bound
#[cfg(not(target_arch = "wasm32"))]
pub trait MaybeSync: Sync {}

/// Maybe Sync on wasm32 targets does not required the sync bound
#[cfg(target_arch = "wasm32")]
pub trait MaybeSync {}

#[cfg(not(target_arch = "wasm32"))]
impl<T: Sync> MaybeSync for T {}

#[cfg(target_arch = "wasm32")]
impl<T> MaybeSync for T {}
