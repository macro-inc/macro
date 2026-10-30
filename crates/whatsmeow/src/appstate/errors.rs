// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Ported from whatsmeow appstate/errors.go (MPL-2.0, Copyright (c) Tulir Asokan)

/// Errors that this package can return: Go's `Err*` sentinels. The error
/// types of the package's functions wrap them; their `sentinel` methods take
/// the place of Go's `errors.Is`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, thiserror::Error)]
pub enum AppStateError {
    /// `ErrMissingPreviousSetValueOperation`.
    #[error("missing value MAC of previous SET operation")]
    MissingPreviousSetValueOperation,
    /// `ErrMismatchingLTHash`.
    #[error("mismatching LTHash")]
    MismatchingLtHash,
    /// `ErrMismatchingPatchMAC`.
    #[error("mismatching patch MAC")]
    MismatchingPatchMac,
    /// `ErrMismatchingContentMAC`.
    #[error("mismatching content MAC")]
    MismatchingContentMac,
    /// `ErrMismatchingIndexMAC`.
    #[error("mismatching index MAC")]
    MismatchingIndexMac,
    /// `ErrKeyNotFound`.
    #[error("didn't find app state key")]
    KeyNotFound,
}
