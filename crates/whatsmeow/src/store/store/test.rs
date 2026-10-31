// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

use std::sync::Arc;

use super::*;
use crate::signal::CurveSignatures;
use crate::store::MemoryStore;
use crate::types::{DEFAULT_USER_SERVER, HIDDEN_USER_SERVER, new_jid};

struct UnusedSignatures;

impl CurveSignatures for UnusedSignatures {
    fn calculate_signature(&self, _: &[u8; 32], _: &[u8]) -> [u8; 64] {
        [0; 64]
    }

    fn verify_signature(&self, _: &[u8; 32], _: &[u8], _: &[u8; 64]) -> bool {
        false
    }
}

#[tokio::test]
async fn save_requires_a_jid_and_delete_disables_every_store() {
    let store = Arc::new(MemoryStore::default());
    let mut device = store.new_device(&UnusedSignatures);
    assert!(matches!(
        device.save().await,
        Err(StoreError::InvalidArgument(_))
    ));

    let jid = new_jid("1234567890", DEFAULT_USER_SERVER);
    device.id = Some(jid.clone());
    device.save().await.unwrap();
    assert_eq!(store.saved_devices(), vec![jid.clone()]);
    assert_eq!(device.get_jid(), jid);

    device.delete().await.unwrap();
    assert!(store.saved_devices().is_empty());
    assert!(device.deleted);
    assert_eq!(device.get_jid(), Jid::default());
    assert!(matches!(
        device.sessions.get_session("1:0").await,
        Err(StoreError::DeviceDeleted)
    ));
    assert!(matches!(
        device.save().await,
        Err(StoreError::DeviceDeleted)
    ));
    // Deleting twice is a no-op.
    device.delete().await.unwrap();
}

#[tokio::test]
async fn get_alt_jid_maps_between_phone_numbers_and_lids() {
    let store = Arc::new(MemoryStore::default());
    let device = store.new_device(&UnusedSignatures);
    let pn = new_jid("1234567890", DEFAULT_USER_SERVER);
    let lid = new_jid("98765432101234", HIDDEN_USER_SERVER);
    device.lids.put_lid_mapping(&lid, &pn).await.unwrap();

    assert_eq!(device.get_alt_jid(&pn).await.unwrap(), Some(lid.clone()));
    assert_eq!(device.get_alt_jid(&lid).await.unwrap(), Some(pn));
    assert_eq!(
        device
            .get_alt_jid(&new_jid("120363012345678901", "g.us"))
            .await
            .unwrap(),
        None
    );
}

#[test]
fn muted_forever_is_the_end_of_year_9999() {
    assert_eq!(
        MUTED_FOREVER.to_rfc3339(),
        "9999-12-31T23:59:59.999999999+00:00"
    );
}
