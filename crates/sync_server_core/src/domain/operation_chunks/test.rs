use super::*;
#[test]
fn complete_operations_reject_missing_reordered_and_corrupt_chunks() {
    let data: Vec<u8> = (0..INLINE_BYTES + 31)
        .map(|i| (i.wrapping_mul(17) % 251) as u8)
        .collect();
    assert_eq!(
        chunk_key("o/record", 1),
        "operation-chunks/o/record/00000001"
    );
    let manifest = Manifest::for_update(&data).unwrap();
    assert_eq!(
        Manifest::decode(&manifest.encode()).unwrap(),
        Some(manifest.clone())
    );
    let mut chunks: Vec<_> = data.chunks(CHUNK_BYTES).map(<[u8]>::to_vec).collect();
    assert_eq!(manifest.assemble(&chunks).unwrap(), data);
    assert_eq!(manifest.assemble(&chunks[..2]), Err(ChunkError::Incomplete));
    chunks.swap(0, 1);
    assert_eq!(manifest.assemble(&chunks), Err(ChunkError::Checksum));
    chunks.swap(0, 1);
    chunks[0][1] ^= 1;
    assert_eq!(manifest.assemble(&chunks), Err(ChunkError::Checksum));
    assert!(Manifest::for_update(&vec![0; INLINE_BYTES]).is_none());
    assert_eq!(Manifest::decode(b"loro legacy bytes").unwrap(), None);
    assert_eq!(Manifest::decode(MAGIC), Err(ChunkError::Manifest));
}

#[test]
fn inline_completion_receipt_retains_exact_payload_in_a_separate_byte_buffer() {
    let update: Vec<u8> = (0..=255).collect();
    let encoded = serde_json::to_value(CompleteInline(&update)).unwrap();
    assert_eq!(encoded, serde_json::json!([INLINE_COMPLETE_TAG, update]));
    let decoded: (u32, Vec<u8>) = serde_json::from_value(encoded).unwrap();
    assert_eq!(decoded.0, INLINE_COMPLETE_TAG);
    assert_eq!(decoded.1, update);
}

#[test]
fn chunk_manifest_completion_changes_only_the_version_byte_not_payload_geometry() {
    let update = vec![231; INLINE_BYTES + 1];
    let original = Manifest::for_update(&update).unwrap();
    let mut expected = original.encode();
    expected[MAGIC.len() - 1] = 2;
    let complete = original.clone().with_archive_complete();
    assert_eq!(complete.encode(), expected);
    assert_eq!(Manifest::decode(&expected).unwrap(), Some(complete.clone()));
    assert!(complete.archive_complete());
    assert!(
        !Manifest::decode(&original.encode())
            .unwrap()
            .unwrap()
            .archive_complete()
    );
    let chunks = update
        .chunks(CHUNK_BYTES)
        .map(<[u8]>::to_vec)
        .collect::<Vec<_>>();
    assert_eq!(complete.assemble(&chunks).unwrap(), update);
}
