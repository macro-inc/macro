use macro_user_id::user_id::MacroUserIdStr;

#[cfg(test)]
mod test;

/// Most contact ids one invalidation names. A client re-reads them with one
/// exact lookup, which takes at most this many ids.
pub const MAX_CHANGED_CONTACTS: usize = 500;

/// Tells one user's clients that their directory changed.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ContactsInvalidation {
    user: MacroUserIdStr<'static>,
    changed: Option<Vec<MacroUserIdStr<'static>>>,
}

impl ContactsInvalidation {
    /// Name the contacts to re-read. An empty list, or one over
    /// [`MAX_CHANGED_CONTACTS`], leaves the change unknown.
    pub fn new(user: MacroUserIdStr<'static>, changed: Vec<MacroUserIdStr<'static>>) -> Self {
        let named = !changed.is_empty() && changed.len() <= MAX_CHANGED_CONTACTS;
        Self {
            user,
            changed: named.then_some(changed),
        }
    }

    /// A change the clients cannot narrow down, such as a removal: they fall
    /// back to their periodic directory scan.
    pub fn unknown(user: MacroUserIdStr<'static>) -> Self {
        Self {
            user,
            changed: None,
        }
    }

    /// The user whose directory changed.
    pub fn user(&self) -> &MacroUserIdStr<'static> {
        &self.user
    }

    /// The contacts to re-read, or `None` when the change is unknown.
    pub fn changed(&self) -> Option<&[MacroUserIdStr<'static>]> {
        self.changed.as_deref()
    }
}
