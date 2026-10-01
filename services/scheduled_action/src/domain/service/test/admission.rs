use super::*;
use ai_billing::{AiAdmissionError, DenyReason};

#[tokio::test]
async fn manual_admission_keeps_error_type_and_uses_stored_owner_without_gating_management() {
    for error in [
        AiAdmissionError::Denied(DenyReason::AllowanceExhausted),
        AiAdmissionError::Unavailable,
    ] {
        let service = service(true);
        set_admission_error(&service, error);
        let action = service
            .create_action(
                &user_principal(),
                CreateScheduledAction::Canonical(configuration(false)),
            )
            .await
            .unwrap();
        let id = action.id.unwrap();
        let stored_owner = MacroUserIdStr::parse_from_str(FOREIGN_USER).unwrap();
        set_stored_owner(&service, id, Owner::User(stored_owner.clone()));
        let returned = service
            .execute_action_now(owner_receipt(id))
            .await
            .unwrap_err();
        assert_eq!(returned.downcast_ref::<AiAdmissionError>(), Some(&error));
        assert_eq!(
            service.executor.calls.lock().unwrap()[0]
                .owner_user()
                .unwrap(),
            &stored_owner
        );
        assert_eq!(service.get_actions(user(), true).await.unwrap().len(), 1);
        service
            .update_action(edit_receipt(id), update(configuration(false)))
            .await
            .unwrap();
        service.set_enabled(edit_receipt(id), false).await.unwrap();
        service
            .get_execution_records(view_receipt(id))
            .await
            .unwrap();
        service.delete_action(owner_receipt(id)).await.unwrap();
        assert!(service.get_actions(user(), true).await.unwrap().is_empty());
        assert_eq!(service.executor.calls.lock().unwrap().len(), 1);
    }
}
