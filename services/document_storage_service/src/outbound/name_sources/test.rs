use search_service::names::Needle;

use super::contains_any;

#[test]
fn contains_any_compares_names_as_the_lookup_does() {
    let needles = vec![
        Needle::parse("#Q4  launch").expect("needle"),
        Needle::parse("design").expect("needle"),
    ];

    assert!(contains_any("  Q4 Launch Plan", &needles));
    assert!(contains_any("@q4   LAUNCH", &needles));
    assert!(contains_any("Product Design", &needles));
    assert!(!contains_any("Q3 launch", &needles));
    assert!(!contains_any("   ", &needles));
    assert!(!contains_any("Design", &[]));
}
