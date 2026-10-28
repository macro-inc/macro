use std::sync::Mutex;

use ai_usage::UsageContext;
use jev::domain::JevError;
use serde_json::json;

use super::super::test_support::*;
use super::*;

pub struct Content(pub Result<Value, &'static str>);

impl EventContentReader for Content {
    async fn read(
        &self,
        _: &MacroUserIdStr<'static>,
        _: &AuthorizedEventRun,
    ) -> Result<Value, Report> {
        self.0
            .clone()
            .map_err(|message| rootcause::report!(message).into_dynamic())
    }
}

pub struct Classifier {
    pub answers: Result<Vec<f32>, JevError>,
    pub calls: Mutex<Vec<(UsageContext, Value, Vec<YesNoQuestion>)>>,
}

impl Classifier {
    pub fn answering(answers: &[f32]) -> Arc<Self> {
        Arc::new(Self {
            answers: Ok(answers.to_vec()),
            calls: Mutex::default(),
        })
    }

    pub fn failing(error: JevError) -> Arc<Self> {
        Arc::new(Self {
            answers: Err(error),
            calls: Mutex::default(),
        })
    }
}

impl YesNoClassifier for Classifier {
    async fn classify(
        &self,
        usage: UsageContext,
        input: &Value,
        questions: &[YesNoQuestion],
    ) -> Result<Vec<Probability>, JevError> {
        self.calls
            .lock()
            .unwrap()
            .push((usage, input.clone(), questions.to_vec()));
        self.answers.clone().map(|answers| {
            answers
                .into_iter()
                .map(|value| Probability::new(value).unwrap())
                .collect()
        })
    }
}

fn authorized() -> AuthorizedEventRun {
    let configuration = configuration();
    let pending = pending(&configuration);
    let access = capability(user(), &pending.event);
    AuthorizedEventRun::prepare(pending, &configuration, access).unwrap()
}

fn questions(texts: &[&str]) -> Vec<YesNoQuestion> {
    texts
        .iter()
        .map(|text| YesNoQuestion::try_from(*text).unwrap())
        .collect()
}

#[tokio::test]
async fn any_yes_meets_the_conditions_and_bills_the_owner() {
    let classifier = Classifier::answering(&[0.2, 0.7]);
    let gate = ConditionGate::new(
        Arc::new(Content(Ok(json!({ "title": "Q3 invoice" })))),
        classifier.clone(),
    );
    let run = authorized();

    let verdict = gate
        .check(&user(), &run, &questions(&["Invoice?", "Receipt?"]))
        .await
        .unwrap();

    assert_eq!(
        verdict,
        ConditionVerdict::Met(Probability::new(0.7).unwrap())
    );
    let calls = classifier.calls.lock().unwrap();
    let (usage, input, asked) = &calls[0];
    assert_eq!(usage.feature, AiFeature::Automation);
    assert_eq!(usage.user, user());
    assert_eq!(usage.entity, Some(run.pending.action_id));
    assert_eq!(input, &json!({ "title": "Q3 invoice" }));
    assert_eq!(asked, &questions(&["Invoice?", "Receipt?"]));
}

#[tokio::test]
async fn every_no_leaves_the_conditions_unmet() {
    let gate = ConditionGate::new(
        Arc::new(Content(Ok(json!("newsletter")))),
        Classifier::answering(&[0.1, 0.49]),
    );

    let verdict = gate
        .check(&user(), &authorized(), &questions(&["A?", "B?"]))
        .await
        .unwrap();

    assert_eq!(
        verdict,
        ConditionVerdict::NotMet(Probability::new(0.49).unwrap())
    );
}

#[tokio::test]
async fn the_threshold_itself_counts_as_yes() {
    let gate = ConditionGate::new(
        Arc::new(Content(Ok(json!({})))),
        Classifier::answering(&[CONDITION_THRESHOLD]),
    );

    let verdict = gate
        .check(&user(), &authorized(), &questions(&["A?"]))
        .await
        .unwrap();

    assert!(matches!(verdict, ConditionVerdict::Met(_)));
}

#[tokio::test]
async fn unreadable_content_is_transient_and_skips_the_classifier() {
    let classifier = Classifier::answering(&[1.0]);
    let gate = ConditionGate::new(Arc::new(Content(Err("db down"))), classifier.clone());

    let error = gate
        .check(&user(), &authorized(), &questions(&["A?"]))
        .await
        .unwrap_err();

    assert!(matches!(error, ConditionError::Transient(_)));
    assert!(classifier.calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn classifier_errors_keep_their_retryability() {
    for (error, transient) in [
        (JevError::Unavailable, true),
        (JevError::Rejected, false),
        (JevError::InvalidResponse, false),
    ] {
        let gate = ConditionGate::new(Arc::new(Content(Ok(json!({})))), Classifier::failing(error));

        let result = gate
            .check(&user(), &authorized(), &questions(&["A?"]))
            .await
            .unwrap_err();

        assert_eq!(
            matches!(result, ConditionError::Transient(_)),
            transient,
            "{error:?}"
        );
    }
}
