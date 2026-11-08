use super::*;

#[test]
fn document_and_surface_ids_share_a_verbatim_wire_key() {
    let document: document_id::DocumentId = "legacy-document".parse().unwrap();
    let key = SyncDocId::from(document);
    assert_eq!(key.as_str(), "legacy-document");
    let surface: SyncDocId = "surface:opaque".parse().unwrap();
    assert_eq!(
        serde_json::to_string(&surface).unwrap(),
        "\"surface:opaque\""
    );
    assert_eq!(
        serde_json::from_str::<SyncDocId>("\"surface:opaque\"").unwrap(),
        surface
    );
    assert!("".parse::<SyncDocId>().is_err());
    assert!(serde_json::from_str::<SyncDocId>("\"\"").is_err());
}
