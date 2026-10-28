// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Ported from whatsmeow socket/ (MPL-2.0, Copyright (c) Tulir Asokan)

//! A subset of the Noise protocol framework on top of websockets, as used by
//! WhatsApp.
//!
//! Go hands frames to callbacks (`Frames` channel plus `OnDisconnect` on the
//! frame socket, `FrameHandler` plus `DisconnectHandler` on the noise
//! socket); the port delivers each as one event receiver instead.
//!
//! Not ported: `dialopts_js.go` (the WebAssembly build).

mod constants;
mod dialopts;
mod framesocket;
mod noisehandshake;
mod noisesocket;

pub use constants::*;
pub use framesocket::{FrameAssembler, FrameEvent, FrameSocket};
pub use noisehandshake::{NoiseHandshake, NoiseHandshakeError};
pub use noisesocket::{NoiseEvent, NoiseSocket, generate_iv};
