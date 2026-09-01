use authentication_service::service::signup_policy::SignupOrigin;

use super::*;
use crate::api::signup_policy::signup_origin_from_fusionauth_user_data;

fn assert_shared_mailbox_marker(data: &serde_json::Value) {
    let origin = signup_origin_from_fusionauth_user_data("mailbox@example.test", Some(data));
    assert!(matches!(origin, SignupOrigin::SharedMailbox));
}

#[test]
fn generated_id_user_creation_carries_shared_mailbox_marker() {
    let SharedMailboxUserCreation::GeneratedId { data } = shared_mailbox_user_creation(None) else {
        panic!("expected generated-id creation branch");
    };

    assert_shared_mailbox_marker(&data);
}

#[test]
fn desired_id_user_creation_carries_shared_mailbox_marker() {
    let SharedMailboxUserCreation::WithDesiredId { id, data } =
        shared_mailbox_user_creation(Some("shared-user-id"))
    else {
        panic!("expected desired-id creation branch");
    };

    assert_eq!(id, "shared-user-id");
    assert_shared_mailbox_marker(&data);
}
