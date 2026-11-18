use std::sync::Mutex;

use jev::domain::{JevError, MAX_QUESTIONS, Probability};

use super::*;

/// Answers every question with the probability its rule maps to, and
/// remembers what it was asked.
struct FakeClassifier {
    answer: std::result::Result<fn(Rule) -> f32, JevError>,
    asked: Mutex<Vec<(UsageContext, Value, Vec<String>)>>,
}

impl FakeClassifier {
    fn new(answer: std::result::Result<fn(Rule) -> f32, JevError>) -> Self {
        Self {
            answer,
            asked: Mutex::new(Vec::new()),
        }
    }
}

impl YesNoClassifier for FakeClassifier {
    async fn classify(
        &self,
        usage: UsageContext,
        input: &Value,
        questions: &[YesNoQuestion],
    ) -> std::result::Result<Vec<Probability>, JevError> {
        self.asked.lock().unwrap().push((
            usage,
            input.clone(),
            questions.iter().map(|q| q.as_str().to_owned()).collect(),
        ));
        let answer = self.answer?;
        Ok(questions
            .iter()
            .map(|question| {
                let rule = Rule::iter()
                    .find(|rule| rule.question() == question.as_str())
                    .unwrap();
                Probability::new(answer(rule)).unwrap()
            })
            .collect())
    }
}

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|owner@example.com").unwrap()
}

#[test]
fn every_question_is_valid_and_fits_one_call() {
    assert!(Rule::iter().count() <= MAX_QUESTIONS);
    for rule in Rule::iter() {
        YesNoQuestion::try_from(rule.question()).unwrap();
        assert!((0.0..=1.0).contains(&rule.threshold()), "{rule:?}");
    }
}

#[test]
fn explicit_memory_is_held_only_to_the_sensitive_information_rules() {
    assert_eq!(
        Rule::for_kind(MemoryKind::Explicit),
        [
            Rule::GovernmentId,
            Rule::Credential,
            Rule::FinancialAccount,
            Rule::Compensation,
            Rule::Health,
            Rule::IntimateOrFamily,
            Rule::OtherSensitive,
        ]
    );
    assert_eq!(
        Rule::for_kind(MemoryKind::Activity),
        Rule::iter().collect::<Vec<_>>()
    );
    assert_eq!(
        Rule::for_kind(MemoryKind::Profile),
        Rule::iter().collect::<Vec<_>>()
    );
}

#[tokio::test]
async fn content_below_every_threshold_passes_and_is_metered_as_memory() {
    let judge = JevMemoryJudge::new(FakeClassifier::new(Ok(|_| 0.1)));
    judge
        .review(user(), MemoryKind::Activity, "No evidenced activity.")
        .await
        .unwrap();
    let asked = judge.classifier.asked.lock().unwrap();
    let (usage, input, questions) = &asked[0];
    assert_eq!(usage.feature, AiFeature::Memory);
    assert_eq!(input["memory"], "No evidenced activity.");
    assert_eq!(input["situation"], situation(MemoryKind::Activity));
    assert_eq!(questions.len(), Rule::iter().count());
}

#[tokio::test]
async fn a_rule_at_its_threshold_rejects_with_its_reason() {
    let judge = JevMemoryJudge::new(FakeClassifier::new(Ok(|rule| match rule {
        Rule::Credential => Rule::Credential.threshold(),
        Rule::Narration => 1.0,
        _ => 0.0,
    })));
    let Err(MemoryError::Rejected(reason)) = judge
        .review(user(), MemoryKind::Profile, "password: hunter2")
        .await
    else {
        panic!("a broken rule must reject");
    };
    assert_eq!(reason, Rule::Credential.reason());
}

#[tokio::test]
async fn explicit_memory_is_never_judged_on_shared_report_rules() {
    let judge = JevMemoryJudge::new(FakeClassifier::new(Ok(|rule| match rule {
        Rule::Narration | Rule::InferredTitle | Rule::Contradiction => 1.0,
        _ => 0.0,
    })));
    judge
        .review(user(), MemoryKind::Explicit, "I lead the payments team.")
        .await
        .unwrap();
}

#[tokio::test]
async fn a_failed_classification_saves_nothing() {
    for error in [
        JevError::Unavailable,
        JevError::Rejected,
        JevError::InvalidResponse,
    ] {
        let judge = JevMemoryJudge::new(FakeClassifier::new(Err(error)));
        assert!(matches!(
            judge
                .review(user(), MemoryKind::Explicit, "Prefers short answers.")
                .await,
            Err(MemoryError::ReviewUnavailable)
        ));
    }
}

#[tokio::test]
async fn an_unconfigured_host_saves_nothing() {
    assert!(matches!(
        UnconfiguredJudge
            .review(user(), MemoryKind::Explicit, "Prefers short answers.")
            .await,
        Err(MemoryError::ReviewUnavailable)
    ));
}

/// Answers all but one question, each with "no".
struct ShortClassifier;

impl YesNoClassifier for ShortClassifier {
    async fn classify(
        &self,
        _: UsageContext,
        _: &Value,
        questions: &[YesNoQuestion],
    ) -> std::result::Result<Vec<Probability>, JevError> {
        Ok(questions
            .iter()
            .skip(1)
            .map(|_| Probability::new(0.0).unwrap())
            .collect())
    }
}

#[tokio::test]
async fn a_rule_left_unanswered_saves_nothing() {
    assert!(matches!(
        JevMemoryJudge::new(ShortClassifier)
            .review(user(), MemoryKind::Activity, "Shipped the search index.")
            .await,
        Err(MemoryError::ReviewUnavailable)
    ));
}
