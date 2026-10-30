use super::*;
use std::io::Read;

#[test]
fn cache_identity_bypasses_legacy_exports_and_tracks_part_content_and_paths() {
    let mut parts = vec![BomPart {
        id: "part-id".into(),
        sha: "first-sha".into(),
        path: "word/document.xml".into(),
    }];
    let original = export_key("document-id", &parts);
    assert_ne!(original, s3_key::build_temp_docx_key("document-id"));
    assert!(original.starts_with("temp_files/document-id-"));
    assert!(original.ends_with(".docx"));
    assert!(
        s3_key::DocumentKey::from_s3_key(&original)
            .unwrap()
            .is_temp()
    );

    parts[0].sha = "second-sha".into();
    assert_ne!(original, export_key("document-id", &parts));
    parts[0].sha = "first-sha".into();
    parts[0].path = "word/styles.xml".into();
    assert_ne!(original, export_key("document-id", &parts));
}

#[tokio::test]
async fn exports_complete_parts_without_reusing_a_legacy_empty_archive() {
    let mut s3 = S3::default();
    s3.expect_exists().times(1).returning(|key| {
        // The old export exists, but must never be used or signed again.
        Ok(key == s3_key::build_temp_docx_key("document-id"))
    });
    s3.expect_get_document()
        .withf(|sha| sha == "content-sha")
        .times(1)
        .returning(|_| Ok(b"<document>original content</document>".to_vec()));
    s3.expect_upload_document()
        .times(1)
        .returning(|key, bytes| {
            assert_ne!(key, s3_key::build_temp_docx_key("document-id"));
            let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).unwrap();
            assert_eq!(archive.len(), 1);
            let mut xml = String::new();
            archive
                .by_name("word/document.xml")
                .unwrap()
                .read_to_string(&mut xml)
                .unwrap();
            assert_eq!(xml, "<document>original content</document>");
            Ok(())
        });
    store_export(
        &s3,
        "document-id",
        vec![BomPart {
            id: "part-id".into(),
            path: "word/document.xml".into(),
            sha: "content-sha".into(),
        }],
    )
    .await
    .unwrap();
}

#[tokio::test]
async fn complete_cached_export_is_reused_regardless_of_database_part_order() {
    let mut s3 = S3::default();
    s3.expect_exists().times(2).returning(|_| Ok(true));
    s3.expect_get_document().never();
    s3.expect_upload_document().never();
    let mut parts = vec![
        BomPart {
            id: "document-part".into(),
            path: "word/document.xml".into(),
            sha: "document-sha".into(),
        },
        BomPart {
            id: "styles-part".into(),
            path: "word/styles.xml".into(),
            sha: "styles-sha".into(),
        },
    ];
    let first = store_export(&s3, "document-id", parts.clone())
        .await
        .unwrap();
    parts.reverse();
    assert_eq!(
        first,
        store_export(&s3, "document-id", parts).await.unwrap()
    );
}

#[tokio::test]
async fn failed_part_download_does_not_publish_a_partial_archive() {
    let mut s3 = S3::default();
    s3.expect_exists().returning(|_| Ok(false));
    s3.expect_get_document()
        .returning(|_| Err(anyhow::anyhow!("object storage unavailable")));
    s3.expect_upload_document().never();
    assert!(
        store_export(
            &s3,
            "document-id",
            vec![BomPart {
                id: "part-id".into(),
                path: "word/document.xml".into(),
                sha: "content-sha".into(),
            }],
        )
        .await
        .is_err()
    );
}
