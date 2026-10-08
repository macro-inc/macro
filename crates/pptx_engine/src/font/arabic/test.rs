use super::*;

fn shapes(text: &str) -> Vec<Option<JoinForm>> {
    forms(&text.chars().collect::<Vec<_>>())
}

#[test]
fn letters_join_their_neighbours() {
    use JoinForm::*;
    // beh seen meem: joined all through.
    assert_eq!(
        shapes("\u{0628}\u{0633}\u{0645}"),
        vec![Some(Initial), Some(Medial), Some(Final)]
    );
    // dal, alef and reh join only what comes before them.
    assert_eq!(
        shapes("\u{062F}\u{0627}\u{0631}"),
        vec![Some(Isolated), Some(Isolated), Some(Isolated)]
    );
    assert_eq!(shapes("\u{0628}\u{062F}"), vec![Some(Initial), Some(Final)]);
    // A vowel mark between letters does not break the join; a space does.
    assert_eq!(
        shapes("\u{0628}\u{064E}\u{0628} \u{0628}"),
        vec![Some(Initial), None, Some(Final), None, Some(Isolated)]
    );
    // Tatweel joins on both sides.
    assert_eq!(shapes("\u{0628}\u{0640}"), vec![Some(Initial), None]);
}

#[test]
fn presentation_forms_and_lam_alef() {
    assert_eq!(
        presentation_form('\u{0628}', JoinForm::Initial),
        Some('\u{FE91}')
    );
    assert_eq!(
        presentation_form('\u{0627}', JoinForm::Final),
        Some('\u{FE8E}')
    );
    assert_eq!(presentation_form('\u{0627}', JoinForm::Initial), None);
    assert_eq!(
        presentation_form('\u{06CC}', JoinForm::Medial),
        Some('\u{FBFF}')
    );
    assert_eq!(presentation_form('a', JoinForm::Final), None);
    assert_eq!(lam_alef('\u{0627}', false), Some('\u{FEFB}'));
    assert_eq!(lam_alef('\u{0627}', true), Some('\u{FEFC}'));
    assert_eq!(lam_alef('\u{0628}', true), None);
}
