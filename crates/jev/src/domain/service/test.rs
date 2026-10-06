use std::sync::{Arc, Mutex};

use ai_usage::{AiFeature, UsageAmount, UsageEvent};
use macro_user_id::user_id::MacroUserIdStr;
use serde_json::json;

use super::*;
use crate::domain::models::Evaluation;

struct FakeProvider {
    answers: Result<Vec<f32>, JevError>,
    seen: Mutex<Vec<(Value, Vec<String>)>>,
}

impl FakeProvider {
    fn answering(answers: &[f32]) -> Arc<Self> {
        Arc::new(Self {
            answers: Ok(answers.to_vec()),
            seen: Mutex::default(),
        })
    }

    fn failing(error: JevError) -> Arc<Self> {
        Arc::new(Self {
            answers: Err(error),
            seen: Mutex::default(),
        })
    }
}

impl JevProvider for Arc<FakeProvider> {
    fn model_id(&self) -> &'static str {
        "jev-test"
    }

    async fn evaluate(
        &self,
        input: &Value,
        questions: &[YesNoQuestion],
    ) -> Result<Evaluation, JevError> {
        self.seen.lock().unwrap().push((
            input.clone(),
            questions.iter().map(|q| q.as_str().to_owned()).collect(),
        ));
        let answers = self.answers.clone()?;
        Ok(Evaluation {
            probabilities: answers
                .iter()
                .map(|value| Probability::new(*value).unwrap())
                .collect(),
            input_tokens: 120,
            output_tokens: 4,
        })
    }
}

#[derive(Default)]
struct FakeRecorder(Mutex<Vec<UsageEvent>>);

impl UsageRecorder for FakeRecorder {
    fn record(&self, event: UsageEvent) {
        self.0.lock().unwrap().push(event);
    }
}

fn usage() -> UsageContext {
    UsageContext::new(
        AiFeature::Automation,
        MacroUserIdStr::try_from("macro|jev-test@example.com".to_owned()).unwrap(),
    )
}

fn questions(texts: &[&str]) -> Vec<YesNoQuestion> {
    texts
        .iter()
        .map(|text| YesNoQuestion::try_from(*text).unwrap())
        .collect()
}

#[tokio::test]
async fn returns_answers_in_question_order_and_records_tokens() {
    let provider = FakeProvider::answering(&[0.9, 0.1]);
    let recorder = Arc::new(FakeRecorder::default());
    let classifier = JevClassifier::new(provider.clone(), recorder.clone());
    let input = json!({ "subject": "Invoice #42" });

    let answers = classifier
        .classify(usage(), &input, &questions(&["Invoice?", "Spam?"]))
        .await
        .unwrap();

    assert_eq!(
        answers.iter().map(|p| p.get()).collect::<Vec<_>>(),
        [0.9, 0.1]
    );
    assert_eq!(
        provider.seen.lock().unwrap().as_slice(),
        [(input, vec!["Invoice?".to_owned(), "Spam?".to_owned()])]
    );
    let events = recorder.0.lock().unwrap();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].feature, AiFeature::Automation);
    assert_eq!(events[0].model, "jev-test");
    assert!(matches!(
        events[0].amount,
        UsageAmount::Tokens {
            input: 120,
            output: 4
        }
    ));
}

#[tokio::test]
async fn rejects_empty_and_oversized_question_lists_without_calling_the_provider() {
    let provider = FakeProvider::answering(&[]);
    let recorder = Arc::new(FakeRecorder::default());
    let classifier = JevClassifier::new(provider.clone(), recorder.clone());

    assert_eq!(
        classifier.classify(usage(), &json!({}), &[]).await,
        Err(JevError::NoQuestions)
    );
    let too_many = vec![YesNoQuestion::try_from("Yes?").unwrap(); MAX_QUESTIONS + 1];
    assert_eq!(
        classifier.classify(usage(), &json!({}), &too_many).await,
        Err(JevError::TooManyQuestions)
    );
    assert!(provider.seen.lock().unwrap().is_empty());
    assert!(recorder.0.lock().unwrap().is_empty());
}

#[tokio::test]
async fn provider_errors_record_no_usage() {
    let recorder = Arc::new(FakeRecorder::default());
    let classifier = JevClassifier::new(
        FakeProvider::failing(JevError::Unavailable),
        recorder.clone(),
    );

    assert_eq!(
        classifier
            .classify(usage(), &json!("text"), &questions(&["Urgent?"]))
            .await,
        Err(JevError::Unavailable)
    );
    assert!(recorder.0.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_missing_answer_is_invalid_but_still_metered() {
    let recorder = Arc::new(FakeRecorder::default());
    let classifier = JevClassifier::new(FakeProvider::answering(&[0.4]), recorder.clone());

    assert_eq!(
        classifier
            .classify(usage(), &json!({}), &questions(&["A?", "B?"]))
            .await,
        Err(JevError::InvalidResponse)
    );
    assert_eq!(recorder.0.lock().unwrap().len(), 1);
}
