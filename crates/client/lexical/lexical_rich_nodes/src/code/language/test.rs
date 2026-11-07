use super::*;
#[test]
fn language_aliases_and_labels_preserve_upstream_order() {
    assert_eq!(normalize_code_language("javascript"), "js");
    assert_eq!(normalize_code_language("python"), "py");
    assert_eq!(normalize_code_language("unknown"), "unknown");
    assert_eq!(get_language_friendly_name("ts"), "TypeScript");
    assert_eq!(get_language_friendly_name("unknown"), "unknown");
    assert_eq!(
        get_code_language_options(),
        vec![
            ("c", "C"),
            ("clike", "C-like"),
            ("cpp", "C++"),
            ("css", "CSS"),
            ("html", "HTML"),
            ("java", "Java"),
            ("js", "JavaScript"),
            ("markdown", "Markdown"),
            ("objc", "Objective-C"),
            ("plain", "Plain Text"),
            ("powershell", "PowerShell"),
            ("py", "Python"),
            ("rust", "Rust"),
            ("sql", "SQL"),
            ("swift", "Swift"),
            ("typescript", "TypeScript"),
            ("xml", "XML")
        ]
    );
    assert_eq!(
        CODE_LANGUAGE_MAP
            .entries()
            .map(|(k, v)| (*k, *v))
            .collect::<Vec<_>>(),
        vec![
            ("cpp", "cpp"),
            ("java", "java"),
            ("javascript", "js"),
            ("md", "markdown"),
            ("plaintext", "plain"),
            ("python", "py"),
            ("text", "plain"),
            ("ts", "typescript")
        ]
    );
}
