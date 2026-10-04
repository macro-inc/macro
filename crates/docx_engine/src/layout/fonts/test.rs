use super::*;
use crate::test_support::fonts;

#[test]
fn condensed_families_squeeze_regular_substitutes() {
    let f = Fonts::new(fonts());
    let narrow = f.select("Arial Narrow", false, false).unwrap();
    assert!((f.width_factor("Arial Narrow", narrow.face) - 0.82).abs() < 1e-6);
    let arial = f.select("Arial", false, false).unwrap();
    assert!((f.width_factor("Arial", arial.face) - 1.0).abs() < 1e-6);
}
