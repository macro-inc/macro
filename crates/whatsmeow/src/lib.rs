// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

//! A Rust port of [whatsmeow](https://github.com/tulir/whatsmeow), the Go
//! library for the WhatsApp web multidevice API.
//!
//! Each module mirrors the Go package of the same name, and each file in it
//! the Go file of the same name. Top-level Go files (`client.go`,
//! `send.go`, …) are top-level modules whose `impl Client` blocks add the
//! methods Go defines on `*Client`. [`signal`] is the exception: it is the
//! boundary implemented by the separate `whatsmeow_signal` crate.
#![deny(missing_docs)]

pub mod appstate;
pub mod binary;
pub mod client;
mod connectionevents;
mod cstoken;
pub mod download;
pub mod download_to_file;
pub mod errors;
pub mod group;
pub mod handshake;
mod keepalive;
pub mod mediaconn;
pub mod mediaretry;
mod message;
pub mod msgsecret;
mod notification;
pub mod pair;
pub mod pair_code;
pub mod pair_passkey;
pub mod prekeys;
pub mod presence;
mod privacysettings;
pub use whatsmeow_proto as proto;
pub mod qrchan;
pub mod receipt;
pub mod request;
mod retry;
pub mod send;
pub mod signal;
pub mod socket;
pub mod store;
mod tctoken;
#[cfg(any(test, feature = "testing"))]
pub mod testing;
pub mod types;
pub mod upload;
pub mod user;
pub mod util;
#[cfg(test)]
mod vectors;

pub use client::{Client, ClientConfig, Dialer, EventHandler, Signal, WebSocketDialer};
pub use errors::ClientError;
pub use qrchan::QrChannelItem;
pub use types::events::Event;
