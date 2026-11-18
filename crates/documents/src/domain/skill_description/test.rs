use super::*;

#[test]
fn a_one_line_use_when_sentence_is_a_description() {
    let description =
        SkillDescription::parse("  Use when drafting release notes; not changelog entries.  ")
            .unwrap();
    assert_eq!(
        description.as_str(),
        "Use when drafting release notes; not changelog entries."
    );
}

#[test]
fn the_use_when_opening_is_case_insensitive() {
    assert!(SkillDescription::parse("use when triaging bugs").is_ok());
}

#[test]
fn blank_multi_line_long_or_unprefixed_descriptions_are_rejected() {
    for invalid in [
        "",
        "   ",
        "Use when one thing\nand another",
        "Drafts release notes",
        &format!("Use when {}", "x".repeat(300)),
    ] {
        assert!(
            SkillDescription::parse(invalid).is_err(),
            "accepted {invalid:?}"
        );
    }
}

#[test]
fn the_longest_description_fits_exactly() {
    let longest = format!("Use when {}", "x".repeat(MAX_CHARS - "Use when ".len()));
    assert_eq!(longest.chars().count(), MAX_CHARS);
    assert!(SkillDescription::parse(&longest).is_ok());
}
