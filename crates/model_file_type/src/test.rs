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
