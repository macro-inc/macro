#![deny(missing_docs)]

//! Lambda handler for generating call recording preview thumbnails.

mod db;
mod event;
mod ffmpeg;
mod key;

pub use event::{HandlerConfig, HandlerState, handler};
