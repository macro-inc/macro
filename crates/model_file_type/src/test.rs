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
