use super::*;
use ai_billing::domain::{
    DenyReason,
    admission::{AdmissionFuture, AiAdmissionError, AiAdmissionService},
};
use ai_usage::{AiFeature, SYSTEM_USER_ID, UsageContext};
use macro_user_id::user_id::MacroUserIdStr;
use std::sync::{Arc, Mutex};

#[derive(Default)]
struct Admission(Mutex<Vec<(String, AiFeature)>>);
impl AiAdmissionService for Admission {
    fn admit<'a>(
        &'a self,
        user: &'a MacroUserIdStr<'_>,
        feature: AiFeature,
    ) -> AdmissionFuture<'a> {
        Box::pin(async move {
            self.0.lock().unwrap().push((user.to_string(), feature));
            if feature == AiFeature::Memory {
                return Ok(());
            }
            Err(AiAdmissionError::Denied(DenyReason::AllowanceExhausted))
        })
    }
}

#[tokio::test]
async fn concurrent_callers_are_admitted_as_themselves_with_inherited_feature() {
    let admission = Arc::new(Admission::default());
    let operations = AiOperations::new(admission.clone());
    let first = RequestContext::new("macro|first@example.com".to_owned().try_into().unwrap());
    let second = RequestContext::new("macro|second@example.com".to_owned().try_into().unwrap());
    for feature in [AiFeature::Automation, AiFeature::Memory] {
        let inherited = UsageContext::system(feature);
        let a = usage_for_request(&inherited, &first);
        let b = usage_for_request(&inherited, &second);
        let execute = || async {
            assert_eq!(feature, AiFeature::Memory, "billable work was refused");
            Ok(())
        };
        let (a, b) = tokio::join!(operations.run(&a, execute), operations.run(&b, execute));
        assert_eq!(a.is_ok(), feature == AiFeature::Memory);
        assert_eq!(b.is_ok(), feature == AiFeature::Memory);
    }
    let calls = admission.0.lock().unwrap();
    for feature in [AiFeature::Automation, AiFeature::Memory] {
        assert!(calls.contains(&(first.user_id.to_string(), feature)));
        assert!(calls.contains(&(second.user_id.to_string(), feature)));
    }
}

#[tokio::test]
async fn direct_subagent_call_is_gated_and_cancellation_remains_available() {
    let admission = Arc::new(Admission::default());
    let context = SubagentContext {
        operations: AiOperations::new(admission.clone()),
        recorder: Arc::new(ai_usage::NoOpUsageRecorder),
        usage_context: UsageContext::system(AiFeature::Automation),
    };
    let request = RequestContext::new("macro|direct@example.com".to_owned().try_into().unwrap());
    let tool = Subagent {
        task: "test".into(),
    };
    let error = tool
        .call(ServiceContext(context.clone()), request.clone())
        .await
        .unwrap_err();
    assert!(
        error
            .description
            .starts_with(DenyReason::AllowanceExhausted.code())
    );
    assert_eq!(
        *admission.0.lock().unwrap(),
        vec![(request.user_id.to_string(), AiFeature::Automation)]
    );
    request.cancel.cancel();
    let response = tool.call(ServiceContext(context), request).await.unwrap();
    assert_eq!(response.result, "cancelled");
    assert_eq!(admission.0.lock().unwrap().len(), 1);
}

#[test]
fn admission_output_has_a_public_code_not_internal_diagnostics() {
    let error = operation_error(AiAdmissionError::Unavailable.into());
    assert_eq!(
        error.description,
        "ai_billing_unavailable: AI usage validation is temporarily unavailable. Please try again."
    );
}

#[tokio::test]
async fn shared_system_context_does_not_become_subagent_attribution() {
    let entity = uuid::Uuid::now_v7();
    let inherited = UsageContext::system(AiFeature::Automation).with_entity(Some(entity));
    let first = RequestContext::new("macro|first@example.com".to_owned().try_into().unwrap());
    let second = RequestContext::new("macro|second@example.com".to_owned().try_into().unwrap());
    let (a, b) = tokio::join!(async { usage_for_request(&inherited, &first) }, async {
        usage_for_request(&inherited, &second)
    },);
    assert_eq!(a.user, first.user_id);
    assert_eq!(b.user, second.user_id);
    assert_eq!(a.feature, AiFeature::Automation);
    assert_eq!(b.feature, AiFeature::Automation);
    assert_eq!(a.entity, Some(entity));
    assert_eq!(b.entity, Some(entity));
    assert_eq!(inherited.user, *SYSTEM_USER_ID);
}
