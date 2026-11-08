use regress::Regex;

#[test]
fn test_anchored_optimization() {
    // Test basic anchored regex
    let re = Regex::new(r"^abc").unwrap();
    assert!(re.find("abc").is_some());
    assert!(re.find("abcdef").is_some());
    assert!(re.find("xabc").is_none()); // Should not match when not at start

    // Test anchored regex with more complex pattern
    let re = Regex::new(r"^hello\s+world").unwrap();
    assert!(re.find("hello world").is_some());
    assert!(re.find("hello   world").is_some());
    assert!(re.find("  hello world").is_none()); // Should not match when not at start

    // Test anchored regex with capture groups
    let re = Regex::new(r"^(\w+)=(\d+)").unwrap();
    let text = "key=123 other=456";
    let m = re.find(text).unwrap();
    assert_eq!(m.group(1).map(|r| &text[r]), Some("key"));
    assert_eq!(m.group(2).map(|r| &text[r]), Some("123"));
    assert!(re.find(" key=123").is_none()); // Should not match when not at start
}
