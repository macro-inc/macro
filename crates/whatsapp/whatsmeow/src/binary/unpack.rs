// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Ported from whatsmeow binary/unpack.go (MPL-2.0, Copyright (c) Tulir Asokan)

use super::errors::DecodeError;

/// Unpacks the given decrypted data from the WhatsApp web API.
///
/// It checks the first byte to decide whether to uncompress the data with zlib
/// or just return it as-is (without the first byte). There's no corresponding
/// pack function because [`super::marshal`] already returns the data with a
/// leading zero (i.e. not compressed).
pub fn unpack(data: &[u8]) -> Result<Vec<u8>, DecodeError> {
    let (&data_type, data) = data.split_first().ok_or(DecodeError::EmptyPayload)?;
    if 2 & data_type > 0 {
        miniz_oxide::inflate::decompress_to_vec_zlib(data)
            .map_err(|error| DecodeError::Decompress(error.to_string()))
    } else {
        Ok(data.to_vec())
    }
}
