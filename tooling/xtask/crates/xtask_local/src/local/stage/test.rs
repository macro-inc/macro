use super::*;

#[test]
fn spinner_draw_stays_away_from_wide_terminal_right_edge() {
    assert_eq!(spinner_draw_width(240), SPINNER_MAX_WIDTH);
}

#[test]
fn spinner_draw_tracks_narrow_terminal_widths() {
    assert_eq!(spinner_draw_width(40), 40);
    assert_eq!(spinner_draw_width(0), 1);
}
