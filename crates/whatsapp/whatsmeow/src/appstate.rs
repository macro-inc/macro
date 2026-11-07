// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Ported from whatsmeow appstate/ (MPL-2.0, Copyright (c) Tulir Asokan)

//! Encoding and decoding WhatsApp's app state patches.
//!
//! [`Processor`] decodes the patch lists and snapshots the server sends
//! ([`Processor::decode_patches`]), encodes outgoing patches
//! ([`Processor::encode_patch`]) and applies recovery snapshots from the
//! primary device ([`Processor::process_recovery`]).
//!
//! The client side (whatsmeow's top-level `appstate.go`: fetching, applying
//! and sending patches) is in `client.rs`, an `impl Client` block
//! ([`crate::Client::fetch_app_state`], [`crate::Client::send_app_state`]),
//! plus the free functions [`build_app_state_recovery_request`] and
//! [`build_fatal_app_state_exception_notification`].

mod client;
mod decode;
mod encode;
mod errors;
mod hash;
mod keys;
pub mod lthash;
mod recovery;
#[cfg(test)]
mod vectors;

pub use client::{build_app_state_recovery_request, build_fatal_app_state_exception_notification};
pub use decode::*;
pub use encode::*;
pub use errors::*;
pub use hash::*;
pub use keys::*;
pub use recovery::*;
