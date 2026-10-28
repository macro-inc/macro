// SPDX-License-Identifier: AGPL-3.0-only

//! Signal's libsignal protocol modules, vendored from libsignal v0.74.1 (the
//! last release that still speaks X3DH) and patched for WhatsApp's wire
//! format. Every file names its upstream source and what changed; `NOTICE`
//! lists the changes in one place.

mod consts;
pub(crate) mod crypto;
pub(crate) mod error;
pub(crate) mod group_cipher;
pub(crate) mod messages;
mod proto;
mod ratchet;
pub(crate) mod sender_keys;
pub(crate) mod session;
pub(crate) mod session_cipher;
pub(crate) mod session_state;
