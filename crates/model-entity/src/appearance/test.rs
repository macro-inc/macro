use super::*;

#[test]
fn rejects_unknown_glyphs_and_non_emoji_input() {
    for icon in [
        AppearanceIcon::Macro {
            name: "../star".into(),
        },
        AppearanceIcon::Macro {
            name: "not-a-macro-icon".into(),
        },
        AppearanceIcon::Emoji {
            value: "<img>".into(),
        },
        AppearanceIcon::Emoji {
            value: "😀😀".into(),
        },
        AppearanceIcon::Emoji { value: "\n".into() },
    ] {
        assert!(
            EntityAppearance {
                icon: Some(icon),
                color: None
            }
            .validate()
            .is_err()
        );
    }
}

#[test]
fn accepts_joined_emoji_and_independent_color() {
    for value in ["😀", "👩🏽‍💻", "🇺🇸", "1️⃣"] {
        assert!(
            EntityAppearance {
                icon: Some(AppearanceIcon::Emoji {
                    value: value.into()
                }),
                color: Some(AppearanceColor::Blue),
            }
            .validate()
            .is_ok()
        );
    }
    assert!(
        EntityAppearance {
            icon: None,
            color: Some(AppearanceColor::Blue)
        }
        .validate()
        .is_ok()
    );
    assert!(
        EntityAppearance {
            icon: Some(AppearanceIcon::Macro {
                name: "star".into()
            }),
            color: None,
        }
        .validate()
        .is_ok()
    );
}
