use macro_user_id::user_id::MacroUserIdStr;

use super::*;

#[test]
fn serializes_user_mention() {
    let user_id = MacroUserIdStr::try_from_email("new.user@example.com").unwrap();

    assert_eq!(
        user_mention(&user_id).unwrap(),
        "<m-user-mention>{\"userId\":\"macro|new.user@example.com\",\"email\":\"new.user@example.com\"}</m-user-mention>"
    );
}
