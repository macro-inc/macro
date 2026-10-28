#[cfg(target_arch = "wasm32")]
mod browser_tz;
#[cfg(target_arch = "wasm32")]
pub(crate) use browser_tz::*;

#[cfg(not(target_arch = "wasm32"))]
mod os_tz;
#[cfg(not(target_arch = "wasm32"))]
pub(crate) use os_tz::*;
