use std::collections::HashSet;

use async_graphql::ID;
use graphql_common::parse_macro_user_id;
use macro_user_id::user_id::MacroUserIdStr;

/// Most accounts one request may name.
const MAX_ACCOUNT_IDS: usize = 50;

/// Validate requested account ids, each once, in the order given.
pub(crate) fn parse_account_ids(
    account_ids: Vec<ID>,
) -> async_graphql::Result<Vec<MacroUserIdStr<'static>>> {
    if account_ids.len() > MAX_ACCOUNT_IDS {
        return Err(async_graphql::Error::new(format!(
            "accountIds is limited to {MAX_ACCOUNT_IDS} accounts"
        )));
    }

    let mut seen = HashSet::new();
    let mut accounts = Vec::with_capacity(account_ids.len());
    for id in account_ids {
        if seen.insert(id.0.clone()) {
            accounts.push(parse_macro_user_id(id.0, "accountIds")?);
        }
    }
    Ok(accounts)
}
