use std::collections::BTreeMap;
use std::sync::Mutex;
use std::time::Duration;

use serde_json::json;

use super::*;

#[tokio::test(start_paused = true)]
async fn seventy_questions_answer_in_order_across_three_calls_and_a_late_or_failed_call_loses_only_its_own()
 {
    let sizes = Mutex::new(Vec::new());
    let questions: Vec<String> = (0..70).map(|index| format!("Question {index}?")).collect();

    let decision = decide_in_batches(
        &json!({ "request": "anything" }),
        &questions,
        Duration::from_secs(1),
        |request: DecisionRequest| {
            request.validate().unwrap();
            sizes.lock().unwrap().push(request.questions.len());
            async move {
                // Questions 32 to 63 never answer; 64 to 69 fail.
                if request
                    .questions
                    .values()
                    .any(|question| question == "Question 40?")
                {
                    std::future::pending::<()>().await;
                }
                if request
                    .questions
                    .values()
                    .any(|question| question == "Question 69?")
                {
                    return Err("unavailable");
                }
                let probabilities: BTreeMap<String, f32> = request
                    .questions
                    .into_iter()
                    .map(|(key, question)| {
                        let index: f32 = question
                            .trim_start_matches("Question ")
                            .trim_end_matches('?')
                            .parse()
                            .unwrap();
                        (key, index / 100.0)
                    })
                    .collect();
                Ok(DecisionResponse { probabilities })
            }
        },
    )
    .await;

    assert_eq!(*sizes.lock().unwrap(), [32, 32, 6]);
    assert_eq!(decision.batches, 3);
    assert_eq!(decision.outcome(), BatchedOutcome::Answered);
    assert_eq!(decision.answers.len(), 70);
    assert_eq!(decision.answers[0], Answer::Probability(0.0));
    assert_eq!(decision.answers[10], Answer::Probability(0.1));
    assert_eq!(decision.answers[31], Answer::Probability(0.31));
    assert_eq!(decision.answers[32], Answer::TimedOut);
    assert_eq!(decision.answers[63], Answer::TimedOut);
    assert_eq!(decision.answers[64], Answer::Failed);
    assert_eq!(decision.answers[69], Answer::Failed);
}

#[tokio::test(start_paused = true)]
async fn no_answering_call_reports_why() {
    let questions = vec!["Is it relevant?".to_owned()];

    let late = decide_in_batches(
        &json!({}),
        &questions,
        Duration::from_secs(1),
        |_: DecisionRequest| async {
            std::future::pending::<()>().await;
            Ok::<_, &str>(DecisionResponse {
                probabilities: BTreeMap::new(),
            })
        },
    )
    .await;
    assert_eq!(late.outcome(), BatchedOutcome::TimedOut);

    let failed = decide_in_batches(
        &json!({}),
        &questions,
        Duration::from_secs(1),
        |_: DecisionRequest| async { Err::<DecisionResponse, _>("unavailable") },
    )
    .await;
    assert_eq!(failed.outcome(), BatchedOutcome::Failed);
}
