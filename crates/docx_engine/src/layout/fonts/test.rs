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
fn letters_of_uncovered_scripts_keep_their_typical_width() {
    let f = Fonts::new(fonts());
    let font = f.select("Simplified Arabic", false, false).unwrap();
    // Arabic letters, a vowel mark, Hebrew.
    assert!((f.glyph(font, 'ب').advance - ARABIC_ADVANCE).abs() < 1e-6);
    assert!(f.glyph(font, '\u{064E}').advance.abs() < 1e-6);
    assert!((f.glyph(font, 'ש').advance - HEBREW_ADVANCE).abs() < 1e-6);
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

#[test]
fn tahoma_takes_its_own_advances() {
    let f = Fonts::new(fonts());
    let regular = f.select("Tahoma", false, false).unwrap();
    let bold = f.select("Tahoma", true, false).unwrap();
    let arial = f.select("Arial", false, false).unwrap();
    assert_eq!(regular.face, arial.face, "drawn with the Arial substitute");
    assert!((f.glyph(regular, 't').advance - 0.334).abs() < 1e-6);
    assert!((f.glyph(regular, ' ').advance - 0.313).abs() < 1e-6);
    assert!((f.glyph(bold, 'W').advance - 1.028).abs() < 1e-6);
    // Characters the table lacks keep the substitute's advance.
    let z = f.glyph(regular, 'z').advance;
    assert!((z - f.glyph(arial, 'z').advance).abs() < 1e-6);
}
