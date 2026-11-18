#![allow(clippy::uninlined_format_args)]

use regress::{Regex, escape};

#[test]
fn test_escape_basic() {
    assert_eq!(escape("hello"), "hello");
    assert_eq!(escape(""), "");
    assert_eq!(escape("abc123"), "abc123");
}

#[test]
fn test_escape_special_characters() {
    // Test individual special characters
    assert_eq!(escape("\\"), "\\\\");
    assert_eq!(escape("^"), "\\^");
    assert_eq!(escape("$"), "\\$");
    assert_eq!(escape("."), "\\.");
    assert_eq!(escape("|"), "\\|");
    assert_eq!(escape("?"), "\\?");
    assert_eq!(escape("*"), "\\*");
    assert_eq!(escape("+"), "\\+");
    assert_eq!(escape("("), "\\(");
    assert_eq!(escape(")"), "\\)");
    assert_eq!(escape("["), "\\[");
    assert_eq!(escape("]"), "\\]");
    assert_eq!(escape("{"), "\\{");
    assert_eq!(escape("}"), "\\}");
}

#[test]
fn test_escape_mixed_strings() {
    assert_eq!(escape("Hello. How are you?"), "Hello\\. How are you\\?");
    assert_eq!(escape("$100 + tax (15%)"), "\\$100 \\+ tax \\(15%\\)");
    assert_eq!(
        escape("a^b$c.d|e?f*g+h(i)j[k]l{m}n\\o"),
        "a\\^b\\$c\\.d\\|e\\?f\\*g\\+h\\(i\\)j\\[k\\]l\\{m\\}n\\\\o"
    );
    assert_eq!(escape("file.txt"), "file\\.txt");
    assert_eq!(escape("user@example.com"), "user@example\\.com");
}

#[test]
fn test_escape_with_regex() {
    // Test that escaped strings work as literal matches
    let test_cases = vec![
        "Hello. How are you?",
        "$100 + tax (15%)",
        "file.txt",
        "user@example.com",
        "a^b$c.d|e?f*g+h(i)j[k]l{m}n\\o",
        "C:\\Program Files\\MyApp",
        "[brackets] and {braces}",
        ".*+?|^$()[]{}\\",
    ];

    for test_case in test_cases {
        let escaped = escape(test_case);
        let regex = Regex::new(&escaped)
            .unwrap_or_else(|_| panic!("Failed to create regex for: {}", escaped));

        // The escaped pattern should match the original string literally
        assert!(
            regex.find(test_case).is_some(),
            "Escaped pattern '{}' should match original string '{}'",
            escaped,
            test_case
        );

        // The match should be the entire string
        let m = regex.find(test_case).unwrap();
        assert_eq!(
            &test_case[m.range()],
            test_case,
            "Match should be the entire string"
        );
    }
}

#[test]
fn test_escape_unicode() {
    let test_cases = vec![
        "café",
        "привет",
        "你好",
        "🌟 emoji 🎉",
        "混合 text with ünìcödè",
    ];

    for test_case in test_cases {
        let escaped = escape(test_case);
        let regex = Regex::new(&escaped)
            .unwrap_or_else(|_| panic!("Failed to create regex for: {}", escaped));
        assert!(
            regex.find(test_case).is_some(),
            "Escaped pattern should match original unicode string"
        );
    }
}

#[test]
fn test_escape_prevents_regex_interpretation() {
    // These strings would have special meaning in regex, but after escaping should be literal
    let test_cases = vec![
        (".*", "\\.\\*"),       // .* means "any character, any number of times"
        ("a+", "a\\+"),         // a+ means "one or more a's"
        ("(abc)", "\\(abc\\)"), // (abc) is a capture group
        ("[abc]", "\\[abc\\]"), // [abc] is a character class
        ("a|b", "a\\|b"),       // a|b is alternation
        ("^start", "\\^start"), // ^ is start anchor
        ("end$", "end\\$"),     // $ is end anchor
    ];

    for (original, expected_escaped) in test_cases {
        let escaped = escape(original);
        assert_eq!(escaped, expected_escaped);

        let regex = Regex::new(&escaped).unwrap();
        assert!(regex.find(original).is_some());
    }
}
