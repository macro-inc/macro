
use super::*;

#[test]
fn test_clean_document_name() {
    assert_eq!(
        FileType::clean_document_name("report.docx").as_deref(),
        Some("report")
    );
    assert_eq!(
        FileType::clean_document_name("proposal.pdf").as_deref(),
        Some("proposal")
    );
    assert_eq!(
        FileType::clean_document_name("testing.md").as_deref(),
        Some("testing")
    );
    assert_eq!(
        FileType::clean_document_name("testing.py").as_deref(),
        Some("testing")
    );
    assert_eq!(
        FileType::clean_document_name("testing.html").as_deref(),
        Some("testing")
    );
    assert_eq!(
        FileType::clean_document_name("testing.txt").as_deref(),
        Some("testing")
    );
    assert_eq!(
        FileType::clean_document_name("notes.backup.pdf").as_deref(),
        Some("notes.backup")
    );

    assert_eq!(
        FileType::clean_document_name("testing.random").as_deref(),
        None
    );
    assert_eq!(FileType::clean_document_name("note."), None);
    assert_eq!(FileType::clean_document_name(""), None);
    assert_eq!(FileType::clean_document_name("testing"), None);
    assert_eq!(
        FileType::clean_document_name("testing.zip").as_deref(),
        Some("testing")
    );
    assert_eq!(
        FileType::clean_document_name("testing.tar.gz").as_deref(),
        Some("testing")
    );
    assert_eq!(
        FileType::clean_document_name("testing.js.map").as_deref(),
        Some("testing")
    );
}

#[test]
fn test_is_suffix_match() {
    assert!(FileType::is_suffix_match("testing.docx"));
    assert!(FileType::is_suffix_match("testing.pdf"));
    assert!(FileType::is_suffix_match("testing.md"));
    assert!(FileType::is_suffix_match("testing.canvas"));
    assert!(FileType::is_suffix_match("testing.coffee"));
    assert!(FileType::is_suffix_match("testing.cson"));
    assert!(FileType::is_suffix_match("testing.iced"));
    assert!(FileType::is_suffix_match("testing.c"));
    assert!(FileType::is_suffix_match("testing.i"));
    assert!(FileType::is_suffix_match("testing.cpp"));
    assert!(FileType::is_suffix_match("testing.c++m"));
    assert!(FileType::is_suffix_match("testing.cppm"));
    assert!(FileType::is_suffix_match("testing.cc"));
    assert!(FileType::is_suffix_match("testing.ccm"));
    assert!(FileType::is_suffix_match("testing.cxx"));
    assert!(FileType::is_suffix_match("testing.cxxm"));
    assert!(FileType::is_suffix_match("testing.zip"));
    assert!(FileType::is_suffix_match("testing.js.map"));
    assert!(FileType::is_suffix_match("testing.docx.zip"));
    assert!(FileType::is_suffix_match("testing.tar.gz"));
    assert!(FileType::is_suffix_match(".pdf"));
}

#[test]
fn test_is_suffix_match_false() {
    assert!(!FileType::is_suffix_match("testing.cp"));
    assert!(!FileType::is_suffix_match("testing.cpm"));
    assert!(!FileType::is_suffix_match("testing."));
    assert!(!FileType::is_suffix_match(".testing"));
}

#[test]
fn test_split_suffix_match() {
    assert_eq!(FileType::split_suffix_match("testing"), None);
    assert_eq!(FileType::split_suffix_match("testing."), None);
    assert_eq!(FileType::split_suffix_match(".testing"), None);
    assert_eq!(
        FileType::split_suffix_match("testing.docx"),
        Some(("testing", "docx"))
    );
    assert_eq!(
        FileType::split_suffix_match("testing.pdf"),
        Some(("testing", "pdf"))
    );
    assert_eq!(
        FileType::split_suffix_match("testing.md"),
        Some(("testing", "md"))
    );
    assert_eq!(
        FileType::split_suffix_match("testing.canvas"),
        Some(("testing", "canvas"))
    );
    assert_eq!(
        FileType::split_suffix_match("testing.coffee"),
        Some(("testing", "coffee"))
    );
    assert_eq!(
        FileType::split_suffix_match("testing.cson"),
        Some(("testing", "cson"))
    );
    assert_eq!(
        FileType::split_suffix_match("testing.iced"),
        Some(("testing", "iced"))
    );
    assert_eq!(
        FileType::split_suffix_match("testing.c"),
        Some(("testing", "c"))
    );
    assert_eq!(
        FileType::split_suffix_match("testing.i"),
        Some(("testing", "i"))
    );
    assert_eq!(
        FileType::split_suffix_match("testing.1.5.0.tar.gz"),
        Some(("testing.1.5.0", "tar.gz"))
    );
}
