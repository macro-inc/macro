// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

//! Expected values were produced by whatsmeow's Go code at the pinned revision.

use super::*;

#[test]
fn sha256_matches_go() {
    let key: Vec<u8> = (0..32).collect();
    assert_eq!(
        hex::encode(sha256(&key, &[], b"WhatsApp Media Retry Notification", 32)),
        "c84dfe50a708e0ec382a7ad2ba40135256f41b652cebe2129661d27871111cb2"
    );
    assert_eq!(
        hex::encode(sha256(&key, b"salt", b"WhatsApp Image Keys", 112)),
        "39136149f9a1c91144cb1c6bfbc618b0bbcd5cdfb00126e956ebbaf37549ce530dbaf75c7a4951bd2ba8f60aaec7f6db0468b2ecf9dada95e9b4314db65de8fb0857afd2b8f6dd84f0c46a63491d983cae4c2df209c8da79508816ebd81435c3bbae6dead3e5d06a54bd056db3a8f739"
    );
    assert_eq!(sha256(&key, &[], &[], 255).len(), 255);
}
