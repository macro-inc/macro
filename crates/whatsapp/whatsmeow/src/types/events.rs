// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Ported from whatsmeow types/events/ (MPL-2.0, Copyright (c) Tulir Asokan)

//! All the events that the client can emit.
//!
//! Go dispatches each event as its own struct through `any`; here every
//! event is a variant of [`Event`] wrapping the same struct.
//!
//! Not ported: `call.go` and the newsletter, passkey, FB/Instagram message
//! and mex events (features the port skips).

mod appstate;
#[expect(
    clippy::module_inception,
    reason = "mirrors whatsmeow's types/events/events.go"
)]
mod events;

pub use appstate::*;
pub use events::*;
