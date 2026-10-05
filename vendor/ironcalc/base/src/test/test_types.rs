#![allow(clippy::unwrap_used)]

use crate::types::{Alignment, HorizontalAlignment, VerticalAlignment};

#[test]
fn alignment_default() {
    let alignment = Alignment::default();
    assert_eq!(
        alignment,
        Alignment {
            horizontal: HorizontalAlignment::General,
            vertical: VerticalAlignment::Bottom,
            wrap_text: false
        }
    );

    let s = serde_json::to_string(&alignment).unwrap();
    // defaults stringifies as an empty object
    assert_eq!(s, "{}");

    let a: Alignment = serde_json::from_str("{}").unwrap();

    assert_eq!(a, alignment)
}
