use super::convert::is_docx_key;

#[test]
fn docx_detection_accepts_mixed_case_extensions() {
    assert!(is_docx_key("uploads/report.DOCX"));
    assert!(is_docx_key("uploads/report.DoCx"));
}

#[test]
fn docx_detection_requires_the_final_extension() {
    assert!(!is_docx_key("uploads/report.docx.tmp"));
    assert!(!is_docx_key("uploads/docx"));
}
