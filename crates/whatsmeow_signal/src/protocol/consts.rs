//
// Copyright 2020 Signal Messenger, LLC.
// SPDX-License-Identifier: AGPL-3.0-only
//
// Vendored from libsignal v0.74.1 rust/protocol/src/consts.rs and modified by
// Macro: the unacknowledged-session age limit is gone, as go.mau.fi/libsignal
// has none. See NOTICE.

pub(crate) const MAX_FORWARD_JUMPS: usize = 25_000;
pub(crate) const MAX_MESSAGE_KEYS: usize = 2000;
pub(crate) const MAX_RECEIVER_CHAINS: usize = 5;
pub(crate) const ARCHIVED_STATES_MAX_LENGTH: usize = 40;
pub(crate) const MAX_SENDER_KEY_STATES: usize = 5;
