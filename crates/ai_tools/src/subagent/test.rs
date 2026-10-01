use super::*;
use ai_usage::{AiFeature, SYSTEM_USER_ID, UsageContext};

#[tokio::test]
async fn shared_system_context_does_not_become_subagent_attribution() {
    let inherited = UsageContext::system(AiFeature::Automation);
    let first = RequestContext::new("macro|first@example.com".to_owned().try_into().unwrap());
    let second = RequestContext::new("macro|second@example.com".to_owned().try_into().unwrap());
    let (a, b) = tokio::join!(async { usage_for_request(&inherited, &first) }, async {
        usage_for_request(&inherited, &second)
    },);
    assert_eq!(a.user, first.user_id);
    assert_eq!(b.user, second.user_id);
    assert_eq!(a.feature, AiFeature::Automation);
    assert_eq!(b.feature, AiFeature::Automation);
    assert_eq!(inherited.user, *SYSTEM_USER_ID);
}
