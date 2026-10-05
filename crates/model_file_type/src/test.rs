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
