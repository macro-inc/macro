// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

//! Expected values were produced by whatsmeow's Go code at the pinned revision.

use super::*;
use crate::appstate::vectors;

#[test]
fn subtract_then_add_matches_go() {
    let vectors = vectors::load();
    assert_eq!(vectors.lthash.len(), 2);
    for vector in vectors.lthash {
        let subtract: Vec<&[u8]> = vector
            .subtract
            .iter()
            .map(|item| item.0.as_slice())
            .collect();
        let add: Vec<&[u8]> = vector.add.iter().map(|item| item.0.as_slice()).collect();
        let result = WA_PATCH_INTEGRITY
            .subtract_then_add(&vector.base.0, &subtract, &add)
            .unwrap();
        assert_eq!(hex::encode(&result), hex::encode(&vector.result.0));

        // Subtracting what was added gives back the base.
        let back = WA_PATCH_INTEGRITY
            .subtract_then_add(&result, &add, &subtract)
            .unwrap();
        assert_eq!(back, vector.base.0);
    }
}

#[test]
fn subtract_then_add_in_place_rejects_bases_go_panics_on() {
    let mut odd = [0; 127];
    assert_eq!(
        WA_PATCH_INTEGRITY.subtract_then_add_in_place(&mut odd, &[b"x"], &[b"y"]),
        Err(LtHashLengthError {
            base_length: 127,
            hkdf_size: 128
        })
    );
    let mut long = [0; 130];
    assert!(
        WA_PATCH_INTEGRITY
            .subtract_then_add_in_place(&mut long, &[b"x"], &[b"y"])
            .is_err()
    );
    assert_eq!(long, [0; 130]);
}
