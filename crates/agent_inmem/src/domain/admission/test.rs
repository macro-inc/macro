use super::*;
use crate::testing::TestAdmission;
use ai_billing::domain::{DenyReason, DisabledAiAdmissionService};
use macro_user_id::user_id::MacroUserIdStr;

#[tokio::test]
async fn turns_use_the_trusted_owner_and_agent_session_feature() {
    let owner = Owner::User(MacroUserIdStr::try_from_email("owner@macro.com").unwrap());
    for result in [
        Ok(()),
        Err(AiAdmissionError::Denied(DenyReason::AllowanceExhausted)),
        Err(AiAdmissionError::Unavailable),
    ] {
        let admission = TestAdmission::new(result);
        assert_eq!(admit_turn(&admission, &owner).await, result);
        assert_eq!(
            *admission.calls.lock().unwrap(),
            vec![("macro|owner@macro.com".to_owned(), AiFeature::AgentSession)]
        );
    }
    assert_eq!(
        admit_turn(&DisabledAiAdmissionService, &owner).await,
        Ok(())
    );
}

#[tokio::test]
async fn unsupported_owners_are_not_substituted_with_system_identity() {
    let admission = TestAdmission::new(Ok(()));
    for owner in [
        Owner::Bot(bot_id::BotId::TEST_A),
        Owner::Team(macro_uuid::generate_uuid_v7()),
    ] {
        assert_eq!(
            admit_turn(&admission, &owner).await,
            Err(AiAdmissionError::Unavailable)
        );
    }
    assert!(admission.calls.lock().unwrap().is_empty());
}
