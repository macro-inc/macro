use super::*;

#[test]
fn every_question_fits_jev_limits() {
    for text in FOCUS_QUESTIONS {
        assert!(!text.trim().is_empty());
        assert!(
            text.chars().count() <= 500,
            "question over Jev's 500-character limit: {text}"
        );
    }
    // Jev accepts at most 32 questions in one request.
    assert!(FOCUS_QUESTIONS.len() <= 32);
}

#[test]
fn questions_name_no_particular_person_or_company() {
    for text in FOCUS_QUESTIONS {
        for word in ["Teo", "Macro", " him", " his ", " her ", " she ", " he "] {
            assert!(!text.contains(word), "question mentions {word:?}: {text}");
        }
    }
}

#[test]
fn texts_follow_the_answer_order() {
    for (index, question) in FocusQuestion::ALL.into_iter().enumerate() {
        assert_eq!(FOCUS_QUESTIONS[index], question.text());
    }
}
