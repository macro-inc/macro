#![deny(missing_docs)]

//! Lambda handler for generating call recording preview thumbnails.

mod event;
mod ffmpeg;
mod key;
mod db;

pub use event::{HandlerConfig, HandlerState, handler};
