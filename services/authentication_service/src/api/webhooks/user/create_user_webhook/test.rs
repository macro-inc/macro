use macro_user_id::email::Email;

use super::support_channel_name;

#[test]
fn support_channel_name_uses_email_local_part() {
    let email = Email::parse_from_str("new.user+trial@example.com").expect("valid email");

    assert_eq!(
        support_channel_name(&email),
        "Macro Support x new.user+trial"
    );
}
