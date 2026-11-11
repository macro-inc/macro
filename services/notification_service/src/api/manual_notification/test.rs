use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;

use super::{RECEIVES_PER_WINDOW, per_recipient_config, per_recipient_limit};

fn user(id: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(id).unwrap().into_owned()
}

#[test]
fn every_other_sender_shares_one_limit_per_recipient() {
    let (alice, bob, carol) = (
        user("macro|alice@example.com"),
        user("macro|bob@example.com"),
        user("macro|carol@example.com"),
    );
    let key = |sender, recipient| format!("{:?}", per_recipient_limit(sender, Some(recipient)));

    assert_eq!(key(&bob, &alice), key(&carol, &alice));
    assert_ne!(key(&bob, &alice), key(&bob, &carol));
    assert_eq!(per_recipient_config().max_count, RECEIVES_PER_WINDOW);
}

#[test]
fn notes_to_oneself_never_use_up_the_recipient_limit() {
    let alice = user("macro|alice@example.com");

    assert!(per_recipient_limit(&alice, None).is_none());
    assert!(per_recipient_limit(&alice, Some(&alice)).is_none());
}
