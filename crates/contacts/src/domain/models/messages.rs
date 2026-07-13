use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

/// A contacts SQS message carrying the list of user IDs to connect.
#[derive(Serialize, Deserialize, Debug)]
pub struct ContactsNodes {
    /// User IDs whose pairwise connections should be upserted.
    pub users: HashSet<MacroUserIdStr<'static>>,
}
