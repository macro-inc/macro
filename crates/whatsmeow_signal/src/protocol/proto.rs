//
// Copyright 2020 Signal Messenger, LLC.
// SPDX-License-Identifier: AGPL-3.0-only
//
// Vendored from libsignal v0.74.1 rust/protocol/src/proto.rs and modified by
// Macro: only the wire and storage protos are kept. See NOTICE.

pub(crate) mod storage {
    include!(concat!(env!("OUT_DIR"), "/signal.proto.storage.rs"));
}

pub(crate) mod wire {
    include!(concat!(env!("OUT_DIR"), "/signal.proto.wire.rs"));
}
