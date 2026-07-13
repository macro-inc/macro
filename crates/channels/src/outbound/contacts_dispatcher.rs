//! Contacts adapter for channel side effects.

use crate::domain::ports::ChannelContactsDispatcher;
use contacts::domain::ports::ContactsIngress;
use macro_user_id::user_id::MacroUserIdStr;
use std::{collections::HashSet, sync::Arc};

/// Contacts ingress adapter.
pub struct ContactsChannelDispatcher<I> {
    ingress: Arc<I>,
}

impl<I> Clone for ContactsChannelDispatcher<I> {
    fn clone(&self) -> Self {
        Self {
            ingress: self.ingress.clone(),
        }
    }
}

impl<I> ContactsChannelDispatcher<I> {
    /// Create a contacts adapter.
    pub fn new(ingress: Arc<I>) -> Self {
        Self { ingress }
    }
}

impl<I> ChannelContactsDispatcher for ContactsChannelDispatcher<I>
where
    I: ContactsIngress,
{
    type Err = anyhow::Error;

    async fn enqueue_contacts(
        &self,
        users: HashSet<MacroUserIdStr<'static>>,
    ) -> Result<(), Self::Err> {
        self.ingress
            .enqueue_contacts(users)
            .await
            .map_err(|e| anyhow::anyhow!("{e:?}"))
    }
}
