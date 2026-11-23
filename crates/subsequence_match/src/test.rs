use super::*;

#[test]
fn preserves_unicode_normalization_and_literal_subsequence_matching() {
    assert_eq!(normalize_text("  CAFÉ\tİ\n计划  "), "café i\u{307} 计划");
    assert_eq!(subsequence_score("aéxb", "ab"), Some(0.5));
    assert_eq!(subsequence_score("weekly plan", "plan"), Some(1.0));
    assert_eq!(subsequence_score("weekly plan", "lan"), Some(0.9));
    assert!(subsequence_score("100%_\\", "%_\\").is_some());
    assert_eq!(subsequence_score("100 plain", "%"), None);
    assert_eq!(subsequence_score("a\0b", "a\0b"), Some(1.0));
    assert_eq!(subsequence_score("abc", "acb"), None);
}
