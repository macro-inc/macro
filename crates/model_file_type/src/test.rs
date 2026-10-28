use super::*;

#[test]
fn native_spreadsheet_extension_and_content_type_round_trip() {
    let file_type = FileType::from_str(".spreadsheet").unwrap();
    assert_eq!(file_type, FileType::Spreadsheet);
    assert_eq!(file_type.as_str(), "spreadsheet");
    assert_eq!(file_type.mime_type(), "application/x-macro-spreadsheet");
    assert_eq!(file_type.macro_app_path().to_string(), "document");
    assert_eq!(
        ContentType::from_str(file_type.mime_type()).unwrap(),
        ContentType::Spreadsheet
    );
    assert_ne!(FileType::from_str("xlsx").unwrap(), file_type);
    assert_ne!(FileType::from_str("csv").unwrap(), file_type);
}

#[test]
fn office_extensions_parse_case_insensitively() {
    for (extension, expected) in [
        ("docx", FileType::Docx),
        ("DOCX", FileType::Docx),
        ("doc", FileType::Doc),
        ("DOC", FileType::Doc),
        ("pptx", FileType::Pptx),
        ("Pptx", FileType::Pptx),
        ("ppt", FileType::Ppt),
        ("xlsx", FileType::Xlsx),
        ("XLSX", FileType::Xlsx),
        ("xls", FileType::Xls),
        ("xlsm", FileType::Xlsm),
        ("XLSM", FileType::Xlsm),
    ] {
        assert_eq!(
            FileType::from_str(extension).unwrap(),
            expected,
            "{extension}"
        );
    }
}

#[test]
fn legacy_office_types_round_trip() {
    for (file_type, extension, mime) in [
        (FileType::Doc, "doc", "application/msword"),
        (
            FileType::Xlsm,
            "xlsm",
            "application/vnd.ms-excel.sheet.macroEnabled.12",
        ),
    ] {
        assert_eq!(file_type.as_str(), extension);
        assert_eq!(file_type.mime_type(), mime);
        assert_eq!(file_type.macro_app_path().to_string(), "document");
        assert_eq!(FileType::from_str(extension).unwrap(), file_type);
        assert_eq!(
            serde_json::to_string(&file_type).unwrap(),
            format!("\"{extension}\"")
        );
    }
}

#[test]
fn every_mime_type_parses_back_to_a_content_type() {
    for file_type in FileType::all() {
        let content_type = ContentType::from_str(file_type.mime_type())
            .unwrap_or_else(|e| panic!("{file_type}: {e}"));
        assert_eq!(content_type.mime_type(), file_type.mime_type());
    }
}

#[test]
fn mime_types_parse_case_insensitively() {
    assert_eq!(
        ContentType::from_str("application/vnd.ms-excel.sheet.macroEnabled.12").unwrap(),
        ContentType::from(FileType::Xlsm)
    );
    assert_eq!(
        ContentType::from_str("APPLICATION/VND.MS-EXCEL.SHEET.MACROENABLED.12").unwrap(),
        ContentType::from(FileType::Xlsm)
    );
    assert_eq!(
        ContentType::from_str("Application/MSWord").unwrap(),
        ContentType::from(FileType::Doc)
    );
    assert!(ContentType::from_str("application/x-not-a-type").is_err());
}

#[test]
fn photoshop_documents_are_design_files_not_images() {
    for (extension, file_type) in [("psd", FileType::Psd), (".PSB", FileType::Psb)] {
        assert_eq!(FileType::from_str(extension).unwrap(), file_type);
        assert_eq!(file_type.mime_type(), "image/vnd.adobe.photoshop");
        assert_eq!(file_type.macro_app_path(), FileType::Fig.macro_app_path());
    }
    assert_eq!(FileType::Psd.as_str(), "psd");
    assert_eq!(FileType::Psb.as_str(), "psb");
    assert_eq!(FileType::Psd.macro_app_path().to_string(), "vector");
    // Both formats share a media type, which reads back as the first.
    assert_eq!(
        ContentType::from_str("image/vnd.adobe.photoshop").unwrap(),
        ContentType::Psd
    );
}

#[test]
fn illustrator_documents_keep_their_extension_and_media_type() {
    assert_eq!(FileType::from_str(".ai").unwrap(), FileType::Ai);
    assert_eq!(FileType::Ai.mime_type(), "application/postscript");
    assert_eq!(FileType::Ai.macro_app_path().to_string(), "vector");
}
