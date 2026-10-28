use crate::edit::ops::ThemeColor;
use crate::edit::{EditOp, Editor};
use crate::model::presentation::Presentation;
use crate::test_support::{deck, fonts, text_box};

fn editor() -> Editor {
    let shape = text_box(
        2,
        0,
        0,
        914_400,
        457_200,
        "<a:p><a:r><a:rPr lang=\"en-US\"/><a:t>Hello</a:t></a:r></a:p>",
    );
    Editor::new(Presentation::open(deck(&[&shape])).unwrap())
}

#[test]
fn theme_colors_change_every_slide_and_round_trip() {
    let mut ed = editor();
    let before = ed.presentation_mut().outline().unwrap();
    let result = ed
        .apply(
            &[EditOp::SetThemeColors {
                colors: vec![
                    ThemeColor {
                        slot: "accent1".into(),
                        color: "#E32D91".into(),
                    },
                    ThemeColor {
                        slot: "dk2".into(),
                        color: "454551".into(),
                    },
                ],
                name: Some("Red Violet".into()),
            }],
            None,
            fonts(),
        )
        .unwrap();
    assert_eq!(
        result.changed_slides.len(),
        before.slides.len(),
        "a theme change redraws every slide"
    );
    let after = ed.presentation_mut().outline().unwrap();
    let accent1 = after
        .theme_colors
        .iter()
        .find(|(slot, _)| slot == "accent1")
        .map(|(_, hex)| hex.clone());
    assert_eq!(accent1.as_deref(), Some("#E32D91"));
    // Survives save and reopen.
    let bytes = ed.presentation_mut().save().unwrap();
    let mut reopened = Presentation::open(bytes).unwrap();
    let outline = reopened.outline().unwrap();
    assert!(
        outline
            .theme_colors
            .iter()
            .any(|(slot, hex)| slot == "dk2" && hex == "#454551")
    );
    // Undo restores the old palette.
    ed.undo().unwrap();
    assert_eq!(
        ed.presentation_mut().outline().unwrap().theme_colors,
        before.theme_colors
    );
}

#[test]
fn theme_fonts_set_headings_and_body() {
    let mut ed = editor();
    ed.apply(
        &[EditOp::SetThemeFonts {
            major: Some("Georgia".into()),
            minor: Some("Verdana".into()),
            name: None,
        }],
        None,
        fonts(),
    )
    .unwrap();
    let theme = ed
        .presentation_mut()
        .outline()
        .unwrap()
        .theme_fonts
        .unwrap();
    assert_eq!(
        (theme.major.as_str(), theme.minor.as_str()),
        ("Georgia", "Verdana")
    );
}

#[test]
fn bad_theme_values_are_refused() {
    let mut ed = editor();
    let slot = ed.apply(
        &[EditOp::SetThemeColors {
            colors: vec![ThemeColor {
                slot: "accent9".into(),
                color: "FF0000".into(),
            }],
            name: None,
        }],
        None,
        fonts(),
    );
    assert!(slot.is_err());
    let color = ed.apply(
        &[EditOp::SetThemeColors {
            colors: vec![ThemeColor {
                slot: "accent1".into(),
                color: "red".into(),
            }],
            name: None,
        }],
        None,
        fonts(),
    );
    assert!(color.is_err());
}
