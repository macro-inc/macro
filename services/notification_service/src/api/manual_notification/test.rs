use macro_user_id::user_id::MacroUserIdStr;

use super::{RECEIVES_PER_WINDOW, per_recipient_config, per_recipient_key};

#[test]
fn every_sender_shares_one_limit_per_recipient() {
    let alice = MacroUserIdStr::parse_from_str("macro|alice@example.com").unwrap();
    let bob = MacroUserIdStr::parse_from_str("macro|bob@example.com").unwrap();

    let key = |user| format!("{:?}", per_recipient_key(user));
    assert_eq!(key(&alice), key(&alice));
    assert_ne!(key(&alice), key(&bob));
    assert_eq!(per_recipient_config().max_count, RECEIVES_PER_WINDOW);
}
