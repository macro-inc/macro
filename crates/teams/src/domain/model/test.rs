use super::*;

const CUSTOMER_STORAGE_ERROR: &str = "sentinel customer storage error";

fn customer_storage_error() -> CustomerError {
    CustomerError::StorageLayerError(anyhow::anyhow!(CUSTOMER_STORAGE_ERROR))
}

fn assert_preserves_customer_storage_error(error: impl std::fmt::Display) {
    let message = error.to_string();
    assert!(
        message.contains(CUSTOMER_STORAGE_ERROR),
        "customer storage error was missing from: {message}"
    );
}

#[test]
fn invite_users_to_team_error_preserves_customer_storage_error() {
    let error = InviteUsersToTeamError::from(customer_storage_error());
    assert_preserves_customer_storage_error(error);
}

#[test]
fn remove_user_from_team_error_preserves_customer_storage_error() {
    let error = RemoveUserFromTeamError::from(customer_storage_error());
    assert_preserves_customer_storage_error(error);
}

#[test]
fn remove_team_invite_error_preserves_customer_storage_error() {
    let error = RemoveTeamInviteError::from(customer_storage_error());
    assert_preserves_customer_storage_error(error);
}

#[test]
fn delete_team_error_preserves_customer_storage_error() {
    let error = DeleteTeamError::from(customer_storage_error());
    assert_preserves_customer_storage_error(error);
}

#[test]
fn join_team_error_preserves_customer_storage_error() {
    let error = JoinTeamError::from(customer_storage_error());
    assert_preserves_customer_storage_error(error);
}

#[test]
fn team_checkout_error_preserves_customer_storage_error() {
    let error = TeamCheckoutError::from(customer_storage_error());
    assert_preserves_customer_storage_error(error);
}
