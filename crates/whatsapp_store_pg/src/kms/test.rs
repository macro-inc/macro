use std::collections::HashMap;

use uuid::Uuid;

use super::*;

const ACCOUNT: Uuid = Uuid::from_u128(1);

#[test]
fn the_encryption_context_names_the_purpose_user_account_and_version() {
    assert_eq!(
        encryption_context("macro|alice", ACCOUNT),
        HashMap::from([
            ("macro:purpose".to_owned(), "whatsapp-session".to_owned()),
            ("macro:user-id".to_owned(), "macro|alice".to_owned()),
            (
                "macro:account-id".to_owned(),
                "00000000-0000-0000-0000-000000000001".to_owned()
            ),
            ("macro:encryption-version".to_owned(), "1".to_owned()),
        ])
    );
}
