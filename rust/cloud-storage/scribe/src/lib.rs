#[cfg(feature = "channel")]
pub mod channel;

mod compress_image;
#[cfg(feature = "dcs")]
pub mod dcs;
#[cfg(feature = "document")]
pub mod document;
#[cfg(feature = "email")]
pub mod email;
#[cfg(feature = "static_file")]
pub mod static_file;

mod client;
pub use client::ScribeClient;
