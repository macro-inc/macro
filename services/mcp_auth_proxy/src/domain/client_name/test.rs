use super::*;

fn parsed(raw: &str) -> Option<String> {
    ClientName::parse(raw)
        .expect("name should be accepted")
        .map(String::from)
}

#[test]
fn an_ordinary_name_is_kept() {
    assert_eq!(parsed("Claude Code").as_deref(), Some("Claude Code"));
    assert_eq!(
        parsed("cursor-vscode (1.2)").as_deref(),
        Some("cursor-vscode (1.2)")
    );
}

#[test]
fn control_bidi_and_zero_width_characters_are_dropped() {
    assert_eq!(
        parsed("Claude\u{202e}edoC\u{200b} Code\u{0007}").as_deref(),
        Some("ClaudeedoC Code")
    );
}

#[test]
fn line_breaks_and_runs_of_whitespace_collapse_to_one_space() {
    assert_eq!(
        parsed("  Claude\n\t  Code  ").as_deref(),
        Some("Claude Code")
    );
}

#[test]
fn mention_markup_characters_are_dropped() {
    assert_eq!(
        parsed("<m-user-mention>@everyone</m-user-mention> [bot](x) #general").as_deref(),
        Some("m-user-mentioneveryone/m-user-mention bot(x) general")
    );
}

#[test]
fn non_ascii_characters_are_dropped_so_lookalikes_cannot_pass() {
    // Cyrillic "М" in place of Latin "M".
    assert_eq!(
        parsed("\u{041c}acr\u{043e} Helper").as_deref(),
        Some("acr Helper")
    );
}

#[test]
fn a_long_name_is_cut_without_a_trailing_space() {
    let name = format!("{} tail", "x".repeat(MAX_CLIENT_NAME_CHARS - 1));
    assert_eq!(parsed(&name), Some("x".repeat(MAX_CLIENT_NAME_CHARS - 1)));
    assert_eq!(
        parsed(&"y".repeat(500)),
        Some("y".repeat(MAX_CLIENT_NAME_CHARS))
    );
}

#[test]
fn a_name_with_nothing_left_is_no_name() {
    assert_eq!(parsed(""), None);
    assert_eq!(parsed(" \u{200b}\u{202e}\n"), None);
    assert_eq!(parsed("🤖"), None);
}

#[test]
fn names_claiming_to_be_macro_or_its_staff_are_reserved() {
    for name in [
        "Macro",
        "macro ai",
        "MacroBot",
        "M.A.C.R.O",
        "Security Team",
        "Support",
        "IT admin",
        "Official Assistant",
        "System",
        "Staff notice",
        "Moderator",
    ] {
        assert!(
            matches!(ClientName::parse(name), Err(ReservedClientName)),
            "{name:?} should be reserved"
        );
    }
}

#[test]
fn a_reserved_word_hidden_by_stripped_characters_is_still_reserved() {
    assert!(ClientName::parse("Ma\u{200b}cro").is_err());
    assert!(ClientName::parse("<Support>").is_err());
}

#[test]
fn a_reserved_word_inside_another_word_is_allowed() {
    // Only "macro" is matched inside words; the staff words must stand alone.
    assert_eq!(
        parsed("Systematic Helper").as_deref(),
        Some("Systematic Helper")
    );
    assert_eq!(parsed("Supportive Bot").as_deref(), Some("Supportive Bot"));
}
