//! Static Prism language labels; grammar loading belongs to the view.
/// Upstream friendly names in their insertion order.
pub static CODE_LANGUAGE_FRIENDLY_NAME_MAP: phf::OrderedMap<&'static str, &'static str> = phf::phf_ordered_map! {
    "c" => "C", "clike" => "C-like", "cpp" => "C++", "css" => "CSS", "html" => "HTML", "java" => "Java",
    "js" => "JavaScript", "markdown" => "Markdown", "objc" => "Objective-C", "plain" => "Plain Text",
    "powershell" => "PowerShell", "py" => "Python", "rust" => "Rust", "sql" => "SQL", "swift" => "Swift",
    "typescript" => "TypeScript", "xml" => "XML",
};
/// Upstream language aliases in their insertion order.
pub static CODE_LANGUAGE_MAP: phf::OrderedMap<&'static str, &'static str> = phf::phf_ordered_map! {
    "cpp" => "cpp", "java" => "java", "javascript" => "js", "md" => "markdown",
    "plaintext" => "plain", "python" => "py", "text" => "plain", "ts" => "typescript",
};
/// Resolve an alias, preserving an unknown language verbatim.
pub fn normalize_code_language(language: &str) -> &str {
    CODE_LANGUAGE_MAP.get(language).copied().unwrap_or(language)
}
/// Normalize, then return the friendly label or the normalized input.
pub fn get_language_friendly_name(language: &str) -> &str {
    let language = normalize_code_language(language);
    CODE_LANGUAGE_FRIENDLY_NAME_MAP
        .get(language)
        .copied()
        .unwrap_or(language)
}
/// Friendly-name entries in upstream insertion order.
pub fn get_code_language_options() -> Vec<(&'static str, &'static str)> {
    CODE_LANGUAGE_FRIENDLY_NAME_MAP
        .entries()
        .map(|(key, value)| (*key, *value))
        .collect()
}
#[cfg(test)]
mod test;
