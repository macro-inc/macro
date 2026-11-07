// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Ported from whatsmeow util/hkdfutil/ (MPL-2.0, Copyright (c) Tulir Asokan)

//! A simple HKDF wrapper that reads a specified number of bytes.

mod hkdf;

pub use hkdf::*;
