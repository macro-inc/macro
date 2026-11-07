use super::*;
use crate::domain::TaskSuggestions;
use std::sync::Arc;
use tokio::sync::Barrier;

struct Fields(Arc<Barrier>);
impl FieldExtractor for Fields {
    async fn extract(
        &self,
        _: &ExtractInputRequest,
        _: UsageContext,
    ) -> Result<InputSuggestions, InputError> {
        self.0.wait().await;
        Ok(InputSuggestions::Task(TaskSuggestions {
            title: Some("Finish report".into()),
            ..Default::default()
        }))
    }
}
struct Temporal(Arc<Barrier>);
impl TemporalExtractor for Temporal {
    async fn extract_temporal(
        &self,
        _: &ExtractInputRequest,
        _: UsageContext,
    ) -> Result<TemporalExpressions, InputError> {
        self.0.wait().await;
        Ok(TemporalExpressions::Task(TaskTemporalExpressions {
            due: Some(StartExpression::Local {
                date: Some(DateExpression::RelativeDay {
                    span: "tomorrow".into(),
                    offset_days: 1,
                }),
                clock: None,
            }),
        }))
    }
}
#[tokio::test]
async fn field_and_temporal_ports_run_concurrently_before_domain_resolution() {
    let barrier = Arc::new(Barrier::new(2));
    let extractor = WithTemporalExtraction::new(Fields(barrier.clone()), Temporal(barrier));
    let input = ExtractInputRequest {
        text: "Finish report tomorrow".into(),
        intent: InputIntent::Task,
        revision: 1,
        reference_time: "2026-10-26T18:00:00Z".parse().unwrap(),
        time_zone: "America/New_York".into(),
        search_type: None,
        property_definitions: vec![],
    };
    let fields = tokio::time::timeout(
        std::time::Duration::from_secs(1),
        extractor.extract(
            &input,
            UsageContext::system(ai_usage::AiFeature::DynamicCompletionsApi),
        ),
    )
    .await
    .unwrap()
    .unwrap();
    let InputSuggestions::Task(fields) = fields else {
        panic!("wrong intent")
    };
    assert_eq!(fields.title.as_deref(), Some("Finish report"));
    assert_eq!(fields.due_date.as_deref(), Some("2026-10-27"));
}
