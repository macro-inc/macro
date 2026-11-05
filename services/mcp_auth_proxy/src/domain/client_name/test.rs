use super::*;

#[test]
fn an_ordinary_name_is_kept() {
    assert_eq!(
        ClientName::parse("Claude Code"),
        Ok(Some(ClientName("Claude Code".to_owned())))
    );
    assert_eq!(
        ClientName::parse("cursor-vscode (1.2)"),
        Ok(Some(ClientName("cursor-vscode (1.2)".to_owned())))
    );
}

#[test]
fn control_bidi_and_zero_width_characters_are_dropped() {
    assert_eq!(
        ClientName::parse("Claude\u{202e}edoC\u{200b} Code\u{0007}"),
        Ok(Some(ClientName("ClaudeedoC Code".to_owned())))
    );
}

#[test]
fn line_breaks_and_runs_of_whitespace_collapse_to_one_space() {
    assert_eq!(
        ClientName::parse("  Claude\n\t  Code  "),
        Ok(Some(ClientName("Claude Code".to_owned())))
    );
}

#[test]
fn mention_markup_characters_are_dropped() {
    assert_eq!(
        ClientName::parse("<m-user-mention>@everyone</m-user-mention> [bot](x) #general"),
        Ok(Some(ClientName(
            "m-user-mentioneveryone/m-user-mention bot(x) general".to_owned()
        )))
    );
}

#[test]
fn non_ascii_characters_are_dropped_so_lookalikes_cannot_pass() {
    // Cyrillic "М" in place of Latin "M".
    assert_eq!(
        ClientName::parse("\u{041c}acr\u{043e} Helper"),
        Ok(Some(ClientName("acr Helper".to_owned())))
    );
}

#[test]
fn a_long_name_is_cut_without_a_trailing_space() {
    let name = format!("{} tail", "x".repeat(MAX_CLIENT_NAME_CHARS - 1));
    assert_eq!(
        ClientName::parse(&name),
        Ok(Some(ClientName("x".repeat(MAX_CLIENT_NAME_CHARS - 1))))
    );
    assert_eq!(
        ClientName::parse(&"y".repeat(500)),
        Ok(Some(ClientName("y".repeat(MAX_CLIENT_NAME_CHARS))))
    );
}

#[test]
fn a_name_with_nothing_left_is_no_name() {
    assert_eq!(ClientName::parse(""), Ok(None));
    assert_eq!(ClientName::parse(" \u{200b}\u{202e}\n"), Ok(None));
    assert_eq!(ClientName::parse("🤖"), Ok(None));
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
        ClientName::parse("Systematic Helper"),
        Ok(Some(ClientName("Systematic Helper".to_owned())))
    );
    assert_eq!(
        ClientName::parse("Supportive Bot"),
        Ok(Some(ClientName("Supportive Bot".to_owned())))
    );
}
