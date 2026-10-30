// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Ported from whatsmeow util/cbcutil/ (MPL-2.0, Copyright (c) Tulir Asokan)

//! AES-256-CBC with PKCS#7 padding, as WhatsApp media and app state use it.
//!
//! Unpadding is deliberately as lenient as Go's: only the last byte is read,
//! and it is only checked against the total length.

mod cbc;

pub use cbc::*;
