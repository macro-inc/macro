// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

use std::sync::Arc;

use super::*;
use crate::signal::{CurveSignatures, SignalAddress, SignalProtocolStore};
use crate::store::MemoryStore;

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
async fn cached_sessions_are_written_back_in_one_batch() {
    let store = Arc::new(MemoryStore::default());
    let device = store.new_device(&UnusedSignatures);
    device
        .sessions
        .put_session("111:0", b"existing".to_vec())
        .await
        .unwrap();

    let (existing, cache) = device
        .with_cached_sessions(&["111:0".to_owned(), "222:0".to_owned()])
        .await
        .unwrap();
    assert_eq!(
        existing,
        HashMap::from([("111:0".to_owned(), true), ("222:0".to_owned(), false)])
    );
    let cache = cache.unwrap();
    let signal_store = device.signal_store(Some(&cache));
    let new_address = SignalAddress::new("222".to_owned(), 0);
    assert_eq!(signal_store.load_session(&new_address).await.unwrap(), None);

    signal_store
        .store_session(&new_address, b"new".to_vec())
        .await
        .unwrap();
    assert_eq!(
        signal_store.load_session(&new_address).await.unwrap(),
        Some(b"new".to_vec())
    );
    // Not written through until the cache is flushed.
    assert_eq!(device.sessions.get_session("222:0").await.unwrap(), None);

    device.put_cached_sessions(&cache).await.unwrap();
    assert_eq!(
        device.sessions.get_session("222:0").await.unwrap(),
        Some(b"new".to_vec())
    );
    assert_eq!(
        device.sessions.get_session("111:0").await.unwrap(),
        Some(b"existing".to_vec())
    );
    assert_eq!(cache.get_cached_session("222:0"), None);
}

#[tokio::test]
async fn no_addresses_means_no_cache() {
    let store = Arc::new(MemoryStore::default());
    let device = store.new_device(&UnusedSignatures);
    let (existing, cache) = device.with_cached_sessions(&[]).await.unwrap();
    assert!(existing.is_empty());
    assert!(cache.is_none());
}

#[tokio::test]
async fn without_a_cache_the_signal_store_writes_through() {
    let store = Arc::new(MemoryStore::default());
    let device = store.new_device(&UnusedSignatures);
    let signal_store = device.signal_store(None);
    let address = SignalAddress::new("333_1".to_owned(), 2);
    signal_store
        .store_session(&address, b"record".to_vec())
        .await
        .unwrap();
    assert_eq!(
        device.sessions.get_session("333_1:2").await.unwrap(),
        Some(b"record".to_vec())
    );
    assert!(signal_store.contains_session(&address).await.unwrap());
    assert_eq!(
        signal_store
            .load_signed_pre_key(1)
            .map(|(public, _, _)| public),
        Some(device.signed_pre_key.key_pair.public)
    );
    assert_eq!(signal_store.load_signed_pre_key(2), None);
}
