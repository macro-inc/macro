use super::*;

#[test]
fn recognizes_current_and_legacy_ai_blocks_but_not_their_neighbours() {
    assert!(is_ai_peer(0xA1A1_A100_0000_0000));
    assert!(is_ai_peer(0xA1A1_A1FF_FFFF_FFFF));
    assert!(is_ai_peer(999_999_999_999_999_000));
    assert!(is_ai_peer(999_999_999_999_999_999));

    assert!(!is_ai_peer(0xA1A1_A0FF_FFFF_FFFF));
    assert!(!is_ai_peer(0xA1A1_A200_0000_0000));
    assert!(!is_ai_peer(999_999_999_999_998_999));
    assert!(!is_ai_peer(1_000_000_000_000_000_000));
    assert!(!is_ai_peer(42));
}
