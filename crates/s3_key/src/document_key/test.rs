use super::*;

const USER_PRINCIPAL: &str = "macro|hutch@macro.com";
const BOT_PRINCIPAL: &str = "bot|00000000-0000-0000-0000-00000000a1a1";
const TEAM_PRINCIPAL: &str = "019ce2bb-e97e-7fdb-b6b4-d6b36fbe9da0";
const DOCUMENT_ID: &str = "01a0914f-1fde-7873-80ba-6eef315d3b50";

fn owner(principal: &str) -> Owner {
    Owner::from_principal_str(principal).expect("test principal is valid")
}

/// One owner of each kind, paired with the principal string its segment must equal.
fn owners() -> [(&'static str, Owner); 3] {
    [
        (USER_PRINCIPAL, owner(USER_PRINCIPAL)),
        (BOT_PRINCIPAL, owner(BOT_PRINCIPAL)),
        (TEAM_PRINCIPAL, owner(TEAM_PRINCIPAL)),
    ]
}

/// Golden test: a user-owned document must produce exactly the keys production
/// wrote before the owner segment became a principal string. Any drift here
/// orphans every stored object.
#[test]
fn user_owned_keys_are_byte_identical_to_legacy_keys() {
    let owner = owner(USER_PRINCIPAL);

    assert_eq!(
        build_cloud_storage_bucket_document_key(&owner, DOCUMENT_ID, 789),
        "macro|hutch@macro.com/01a0914f-1fde-7873-80ba-6eef315d3b50/789"
    );
    assert_eq!(
        build_docx_to_pdf_converted_document_key(&owner, DOCUMENT_ID),
        "macro|hutch@macro.com/01a0914f-1fde-7873-80ba-6eef315d3b50/converted.pdf"
    );
    assert_eq!(
        build_docx_staging_bucket_document_key(&owner, DOCUMENT_ID, 789),
        "macro|hutch@macro.com/01a0914f-1fde-7873-80ba-6eef315d3b50/789.docx"
    );
    assert_eq!(
        build_cloud_storage_bucket_document_prefix(&owner, DOCUMENT_ID),
        "macro|hutch@macro.com/01a0914f-1fde-7873-80ba-6eef315d3b50"
    );
}

/// Golden test for the read side: the CloudFront URL path for a user-owned key
/// must match what the callers produced when they percent-encoded the owner
/// themselves.
#[test]
fn user_owned_url_path_is_byte_identical_to_legacy_url_path() {
    let owner = owner(USER_PRINCIPAL);

    let versioned = build_cloud_storage_bucket_document_key(&owner, DOCUMENT_ID, 789);
    assert_eq!(
        document_key_url_path(&versioned),
        "macro%7Chutch%40macro.com/01a0914f-1fde-7873-80ba-6eef315d3b50/789"
    );

    let converted = build_docx_to_pdf_converted_document_key(&owner, DOCUMENT_ID);
    assert_eq!(
        document_key_url_path(&converted),
        "macro%7Chutch%40macro.com/01a0914f-1fde-7873-80ba-6eef315d3b50/converted.pdf"
    );
}

#[test]
fn owner_segment_is_the_principal_for_every_owner_kind() {
    for (principal, owner) in owners() {
        assert_eq!(
            build_cloud_storage_bucket_document_key(&owner, DOCUMENT_ID, 1),
            format!("{principal}/{DOCUMENT_ID}/1"),
        );
        assert_eq!(
            build_docx_to_pdf_converted_document_key(&owner, DOCUMENT_ID),
            format!("{principal}/{DOCUMENT_ID}/converted.pdf"),
        );
        assert_eq!(
            build_docx_staging_bucket_document_key(&owner, DOCUMENT_ID, 1),
            format!("{principal}/{DOCUMENT_ID}/1.docx"),
        );
        assert_eq!(
            build_cloud_storage_bucket_document_prefix(&owner, DOCUMENT_ID),
            format!("{principal}/{DOCUMENT_ID}"),
        );
    }
}

#[test]
fn versioned_key_round_trips_for_every_owner_kind() {
    for (principal, owner) in owners() {
        let key = build_cloud_storage_bucket_document_key(&owner, DOCUMENT_ID, 789);
        let parsed = DocumentKey::from_s3_key(&key).unwrap();

        assert_eq!(
            parsed,
            DocumentKey::Versioned {
                owner_segment: principal.to_string(),
                document_id: DOCUMENT_ID.to_string(),
                version_id: 789,
            }
        );
        assert_eq!(parsed.owner_segment(), Some(principal));
        assert_eq!(parsed.to_key(), key);
        assert!(parsed.is_versioned());
    }
}

#[test]
fn converted_pdf_key_round_trips_for_every_owner_kind() {
    for (principal, owner) in owners() {
        let key = build_docx_to_pdf_converted_document_key(&owner, DOCUMENT_ID);
        let parsed = DocumentKey::from_s3_key(&key).unwrap();

        assert_eq!(
            parsed,
            DocumentKey::ConvertedPdf {
                owner_segment: principal.to_string(),
                document_id: DOCUMENT_ID.to_string(),
            }
        );
        assert_eq!(parsed.owner_segment(), Some(principal));
        assert_eq!(parsed.to_key(), key);
        assert!(parsed.is_converted_pdf());
    }
}

#[test]
fn parsed_owner_segment_is_a_valid_principal_for_every_owner_kind() {
    for (_, owner) in owners() {
        let key = build_cloud_storage_bucket_document_key(&owner, DOCUMENT_ID, 1);
        let parsed = DocumentKey::from_s3_key(&key).unwrap();
        let segment = parsed.owner_segment().unwrap();

        assert_eq!(Owner::from_principal_str(segment).unwrap(), owner);
    }
}

#[test]
fn url_path_encodes_each_segment_and_keeps_separators() {
    for (principal, owner) in owners() {
        let key = build_cloud_storage_bucket_document_key(&owner, DOCUMENT_ID, 789);
        let path = document_key_url_path(&key);

        assert_eq!(
            path,
            format!("{}/{DOCUMENT_ID}/789", urlencoding::encode(principal))
        );
        assert_eq!(path.matches('/').count(), 2);
        assert!(!path.contains('|'));
        assert!(!path.contains('@'));
    }
}

#[test]
fn url_path_leaves_a_team_owned_key_unchanged() {
    let key = build_cloud_storage_bucket_document_key(&owner(TEAM_PRINCIPAL), DOCUMENT_ID, 789);
    assert_eq!(document_key_url_path(&key), key);
}

#[test]
fn url_path_leaves_owner_less_keys_unchanged() {
    for key in [
        build_temp_docx_key(DOCUMENT_ID),
        format!("{SYNC_SERVICE_SNAPSHOT_PREFIX}/{DOCUMENT_ID}"),
        "7b5ce90c96ec3c24d8764ba75076bc0c2c5256b2d44e71cf9a8f001ea21ed678".to_string(),
    ] {
        assert_eq!(document_key_url_path(&key), key);
    }
}

/// `%` is legal in an email local part, so an owner can contain a literal
/// percent sequence. Parsing must not decode it into a different owner.
#[test]
fn owner_with_a_literal_percent_sequence_round_trips_unchanged() {
    let owner = owner("macro|a%2bb@macro.com");
    let key = build_cloud_storage_bucket_document_key(&owner, DOCUMENT_ID, 1);
    assert_eq!(key, format!("macro|a%2bb@macro.com/{DOCUMENT_ID}/1"));

    let parsed = DocumentKey::from_s3_key(&key).unwrap();
    assert_eq!(parsed.owner_segment(), Some("macro|a%2bb@macro.com"));
    assert_eq!(parsed.to_key(), key);
    assert_eq!(
        Owner::from_principal_str(parsed.owner_segment().unwrap()).unwrap(),
        owner
    );
}

/// A form-encoded key is a different key. Callers decode at their inbound
/// boundary; the parser never guesses.
#[test]
fn from_s3_key_keeps_a_percent_encoded_owner_segment_verbatim() {
    let encoded = "macro%7Chutch%40macro.com/01a0914f-1fde-7873-80ba-6eef315d3b50/789";
    let key = DocumentKey::from_s3_key(encoded).unwrap();

    assert_eq!(
        key,
        DocumentKey::Versioned {
            owner_segment: "macro%7Chutch%40macro.com".to_string(),
            document_id: DOCUMENT_ID.to_string(),
            version_id: 789,
        }
    );
    assert_eq!(key.to_key(), encoded);
}

#[test]
fn test_versioned_key_from_s3_key() {
    let key = DocumentKey::from_s3_key("user123/doc456/789").unwrap();
    assert_eq!(
        key,
        DocumentKey::Versioned {
            owner_segment: "user123".to_string(),
            document_id: "doc456".to_string(),
            version_id: 789,
        }
    );
    assert_eq!(key.to_key(), "user123/doc456/789");
}

#[test]
fn test_converted_key_from_s3_key() {
    let key = DocumentKey::from_s3_key("user123/doc456/converted.pdf").unwrap();
    assert_eq!(
        key,
        DocumentKey::ConvertedPdf {
            owner_segment: "user123".to_string(),
            document_id: "doc456".to_string(),
        }
    );
    assert_eq!(key.to_key(), "user123/doc456/converted.pdf");
    assert!(key.is_converted_pdf());
    assert!(!key.is_temp());
}

#[test]
fn test_temp_docx_key_from_s3_key() {
    let key = DocumentKey::from_s3_key("temp_files/doc456.docx").unwrap();
    assert_eq!(
        key,
        DocumentKey::TempDocx {
            document_id: "doc456".to_string(),
        }
    );
    assert_eq!(key.to_key(), "temp_files/doc456.docx");
    assert_eq!(key.owner_segment(), None);
    assert!(key.is_temp());
    assert!(!key.is_converted_pdf());
}

#[test]
fn test_sync_service_snapshot_key_from_s3_key() {
    let key = DocumentKey::from_s3_key("sync_service_snapshot/doc456").unwrap();
    assert_eq!(
        key,
        DocumentKey::SyncServiceSnapshot {
            document_id: "doc456".to_string(),
        }
    );
    assert_eq!(key.to_key(), "sync_service_snapshot/doc456");
    assert_eq!(key.document_id(), Some("doc456"));
    assert_eq!(key.owner_segment(), None);
    assert_eq!(key.version_id_string(), None);
    assert!(key.is_sync_service_snapshot());
    assert!(!key.is_temp());
    assert!(!key.is_bom_part());
    assert!(!key.is_converted_pdf());
}

#[test]
fn test_invalid_key_format() {
    assert!(DocumentKey::from_s3_key("only-one").is_err());
    assert!(DocumentKey::from_s3_key("too/many/segments/here").is_err());
}

#[test]
fn test_bom_part_key() {
    let key = DocumentKey::from_s3_key(
        "7b5ce90c96ec3c24d8764ba75076bc0c2c5256b2d44e71cf9a8f001ea21ed678",
    )
    .unwrap();
    assert_eq!(
        key,
        DocumentKey::BomPart {
            sha: "7b5ce90c96ec3c24d8764ba75076bc0c2c5256b2d44e71cf9a8f001ea21ed678".to_string(),
        }
    );
    assert!(key.is_bom_part());
    assert_eq!(key.document_id(), None);
    assert_eq!(key.owner_segment(), None);
    assert_eq!(key.version_id_string(), None);
    assert_eq!(
        key.to_key(),
        "7b5ce90c96ec3c24d8764ba75076bc0c2c5256b2d44e71cf9a8f001ea21ed678"
    );
}

#[test]
fn test_invalid_version_id() {
    assert!(DocumentKey::from_s3_key("user123/doc456/not_a_number").is_err());
    assert!(DocumentKey::from_s3_key("user123/doc456/abc.pdf").is_err());
}

#[test]
fn test_invalid_temp_file_extension() {
    assert!(DocumentKey::from_s3_key("temp_files/doc456.pdf").is_err());
}

#[test]
fn test_document_id_accessor() {
    let versioned = DocumentKey::from_s3_key("user/doc1/1").unwrap();
    assert_eq!(versioned.document_id(), Some("doc1"));

    let converted = DocumentKey::from_s3_key("user/doc2/converted.pdf").unwrap();
    assert_eq!(converted.document_id(), Some("doc2"));

    let temp = DocumentKey::from_s3_key("temp_files/doc3.docx").unwrap();
    assert_eq!(temp.document_id(), Some("doc3"));

    let snapshot = DocumentKey::from_s3_key("sync_service_snapshot/doc4").unwrap();
    assert_eq!(snapshot.document_id(), Some("doc4"));
}

#[test]
fn test_version_id_string() {
    let versioned = DocumentKey::from_s3_key("user/doc/42").unwrap();
    assert_eq!(versioned.version_id_string(), Some("42".to_string()));

    let converted = DocumentKey::from_s3_key("user/doc/converted.pdf").unwrap();
    assert_eq!(converted.version_id_string(), Some("converted".to_string()));

    let temp = DocumentKey::from_s3_key("temp_files/doc.docx").unwrap();
    assert_eq!(temp.version_id_string(), None);

    let snapshot = DocumentKey::from_s3_key("sync_service_snapshot/doc").unwrap();
    assert_eq!(snapshot.version_id_string(), None);
}

#[test]
fn test_build_temp_docx_key() {
    let key = build_temp_docx_key("document-id");
    assert_eq!(key, "temp_files/document-id.docx");
}
