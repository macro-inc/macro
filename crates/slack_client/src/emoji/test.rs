use super::*;

#[test]
fn slack_aliases_match_canonical_frontend_unicode() {
    for (names, expected) in [
        (&["+1", "thumbsup"][..], "\u{1f44d}"),
        (&["-1", "thumbsdown"][..], "\u{1f44e}"),
        (&["hankey", "poop", "shit"][..], "\u{1f4a9}"),
        (&["email", "envelope"][..], "\u{2709}\u{fe0f}"),
        (&["us", "flag-us"][..], "\u{1f1fa}\u{1f1f8}"),
        (&["heart"][..], "\u{2764}\u{fe0f}"),
        (&["thinking_face"][..], "\u{1f914}"),
    ] {
        for name in names {
            assert_eq!(unicode(name), Some(expected), "{name}");
        }
    }
    assert!(SHORTCODES.len() > 2000);
    assert!(SHORTCODES.values().all(|value| {
        !value
            .chars()
            .any(|c| ('\u{1f3fb}'..='\u{1f3ff}').contains(&c))
    }));
}

#[test]
fn valid_skin_tones_strip_but_custom_names_do_not_guess() {
    for name in [
        "thumbsup::skin-tone-2",
        "+1::skin-tone-6",
        ":thumbsup::skin-tone-3:",
        "thumbsup::skin-tone-2::skin-tone-6",
        ":+1:",
    ] {
        assert_eq!(unicode(name), unicode("thumbsup"));
    }
    for name in [
        "custom_company",
        "party_parrot",
        "thumbsup::skin-tone-7",
        "thumbsup::skin-tone-2::custom",
        "thumbsup:custom",
        "skin-tone-2",
        "",
        "::",
        "THUMBSUP",
    ] {
        assert_eq!(unicode(name), None, "{name}");
    }
}

#[test]
fn every_emoji_maps_back_to_a_slack_name_for_it() {
    for (name_in, expected) in [
        ("+1", "+1"),
        ("thumbsup", "+1"),
        ("heart", "heart"),
        ("eyes", "eyes"),
    ] {
        let emoji = unicode(name_in).expect(name_in);
        assert_eq!(name(emoji), Some(expected), "{name_in}");
    }
    assert!(
        NAMES
            .iter()
            .all(|(emoji, chosen)| unicode(chosen) == Some(*emoji))
    );
    assert_eq!(name("not an emoji"), None);
    assert_eq!(name("\u{1f44d}\u{1f3fd}"), None);
}
