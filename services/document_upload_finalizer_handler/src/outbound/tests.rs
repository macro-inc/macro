use super::*;

const OWNER: &str = "macro|owner@macro.com";
const DOCUMENT_ID: &str = "01a0914f-1fde-7873-80ba-6eef315d3b50";

fn owner() -> Owner {
    Owner::from_principal_str(OWNER).unwrap()
}

fn request(from: FileType, to: FileType) -> LegacyOfficeUpgradeRequest {
    LegacyOfficeUpgradeRequest {
        owner: owner(),
        document_id: DOCUMENT_ID.to_string(),
        source_version_id: 314,
        from,
        to,
    }
}

#[test]
fn convert_message_reads_the_version_and_writes_the_upgraded_key() {
    for (from, to, extension) in [
        (FileType::Ppt, FileType::Pptx, "pptx"),
        (FileType::Doc, FileType::Docx, "docx"),
        (FileType::Xls, FileType::Xlsx, "xlsx"),
    ] {
        let message =
            upgrade_convert_message(&request(from, to), "doc-storage", "job".to_string()).unwrap();

        assert_eq!(message.job_id, "job");
        assert_eq!(message.from_bucket, "doc-storage");
        assert_eq!(message.to_bucket, "doc-storage");
        assert_eq!(message.from_key, format!("{OWNER}/{DOCUMENT_ID}/314"));
        assert_eq!(
            message.to_key,
            format!("{OWNER}/{DOCUMENT_ID}/upgraded.{extension}")
        );
        assert_eq!(message.from_file_type, Some(from));
        assert_eq!(message.to_file_type, Some(to));
    }
}

#[test]
fn convert_message_round_trips_through_json() {
    let message = upgrade_convert_message(
        &request(FileType::Doc, FileType::Docx),
        "doc-storage",
        "job".to_string(),
    )
    .unwrap();

    let json = serde_json::to_value(&message).unwrap();
    assert_eq!(json["from_file_type"], "doc");
    assert_eq!(json["to_file_type"], "docx");
    let parsed: ConvertQueueMessage = serde_json::from_value(json).unwrap();
    assert_eq!(parsed.from_file_type, Some(FileType::Doc));
}

#[test]
fn convert_message_rejects_non_upgrade_targets() {
    assert!(
        upgrade_convert_message(
            &request(FileType::Pdf, FileType::Pdf),
            "doc-storage",
            "job".to_string()
        )
        .is_err()
    );
}

#[test]
fn versions_are_copied_into_document_storage() {
    assert_eq!(
        upgraded_object_destination(
            &owner(),
            DOCUMENT_ID,
            UpgradedObjectDestination::DocumentVersion { version_id: 77 },
            "doc-storage",
            "docx-upload",
        ),
        (
            "doc-storage".to_string(),
            format!("{OWNER}/{DOCUMENT_ID}/77")
        )
    );
}

#[test]
fn word_upgrades_are_staged_in_the_docx_bucket() {
    assert_eq!(
        upgraded_object_destination(
            &owner(),
            DOCUMENT_ID,
            UpgradedObjectDestination::DocxStaging { bom_id: 8 },
            "doc-storage",
            "docx-upload",
        ),
        (
            "docx-upload".to_string(),
            format!("{OWNER}/{DOCUMENT_ID}/8.docx")
        )
    );
}
