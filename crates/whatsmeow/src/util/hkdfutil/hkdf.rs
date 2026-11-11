// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Ported from whatsmeow util/hkdfutil/hkdf.go (MPL-2.0, Copyright (c) Tulir Asokan)

use hkdf::Hkdf;
use sha2::Sha256;

/// Derives `length` bytes with HKDF-SHA256. An empty salt is the same as none.
pub fn sha256(key: &[u8], salt: &[u8], info: &[u8], length: u8) -> Vec<u8> {
    let mut data = vec![0; usize::from(length)];
    Hkdf::<Sha256>::new(Some(salt), key)
        .expand(info, &mut data)
        .expect("HKDF-SHA256 expands up to 8160 bytes and length is at most 255");
    data
}

#[cfg(test)]
mod test;
