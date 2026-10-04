use super::*;
use crate::test_support::fonts;

#[test]
fn east_asian_characters_without_a_face_take_an_em() {
    let f = Fonts::new(fonts());
    let font = f.select("SimSun", false, false).unwrap();
    for c in ['中', 'あ', 'カ', '한', '，', '\u{3000}'] {
        assert!(is_wide(c), "{c}");
        assert!((f.glyph(font, c).advance - 1.0).abs() < 1e-6, "{c}");
    }
    assert!(!is_wide('a'));
    assert!(!is_wide('\u{FF61}'), "half-width forms stay narrow");
}

#[test]
fn arabic_and_hebrew_letters_come_from_the_bundled_faces() {
    let f = Fonts::new(fonts());
    let font = f.select("Simplified Arabic", false, false).unwrap();
    let beh = f.glyph(font, 'ب');
    assert_ne!(beh.id, 0);
    assert_eq!(f.db().family(beh.font.face), "Noto Naskh Arabic");
    let arial = f.select("Arial", false, false).unwrap();
    let shin = f.glyph(arial, 'ש');
    assert_ne!(shin.id, 0);
    assert_eq!(f.db().family(shin.font.face), "Noto Sans Hebrew");
    // Without a face for them, letters keep their script's typical width.
    assert_eq!(missing_advance('ب'), Some(ARABIC_ADVANCE));
    assert_eq!(missing_advance('\u{064E}'), Some(0.0));
    assert_eq!(missing_advance('ש'), Some(HEBREW_ADVANCE));
    assert_eq!(missing_advance('a'), None);
}

#[test]
fn condensed_families_squeeze_regular_substitutes() {
    let f = Fonts::new(fonts());
    let narrow = f.select("Arial Narrow", false, false).unwrap();
    assert!((f.width_factor("Arial Narrow", narrow.face) - 0.82).abs() < 1e-6);
    let arial = f.select("Arial", false, false).unwrap();
    assert!((f.width_factor("Arial", arial.face) - 1.0).abs() < 1e-6);
    let lucida = f.select("Lucida Sans", false, false).unwrap();
    assert!((f.width_factor("Lucida Sans", lucida.face) - 0.965).abs() < 1e-6);
}
