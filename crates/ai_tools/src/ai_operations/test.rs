use super::*;
use ai_billing::domain::{DenyReason, admission::AdmissionFuture};
use ai_usage::AiFeature;
use macro_user_id::user_id::MacroUserIdStr;

struct Refuse(AiAdmissionError);
impl AiAdmissionService for Refuse {
    fn admit<'a>(&'a self, _: &'a MacroUserIdStr<'_>, _: AiFeature) -> AdmissionFuture<'a> {
        Box::pin(async move { Err(self.0) })
    }
}

#[tokio::test]
async fn refused_operations_never_construct_provider_work() {
    for error in [
        AiAdmissionError::Denied(DenyReason::AllowanceExhausted),
        AiAdmissionError::Unavailable,
    ] {
        let operations = AiOperations::new(Arc::new(Refuse(error)));
        let usage = UsageContext::new(
            AiFeature::Chat,
            "macro|test@example.com".to_owned().try_into().unwrap(),
        );
        let result = operations
            .run(&usage, || -> std::future::Ready<anyhow::Result<()>> {
                panic!("provider must not be called")
            })
            .await;
        assert!(matches!(result, Err(AiOperationError::Admission(actual)) if actual == error));
    }
}

#[tokio::test]
async fn disabled_admission_preserves_results_and_provider_errors() {
    let operations = AiOperations::new(Arc::new(
        ai_billing::domain::admission::DisabledAiAdmissionService,
    ));
    let usage = UsageContext::system(AiFeature::Chat);
    assert_eq!(
        operations.run(&usage, || async { Ok(42) }).await.unwrap(),
        42
    );
    let error = operations
        .run::<(), _>(&usage, || async { anyhow::bail!("provider failed") })
        .await
        .unwrap_err();
    assert!(matches!(error, AiOperationError::Execution(_)));
}
