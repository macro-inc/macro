//! A contacts ingress that records what producers publish.

use contacts::domain::{
    models::{list::InboxSource, messages::ContactConnection},
    ports::{ContactListIngress, ContactsIngress},
};
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use std::collections::HashSet;
use std::sync::Mutex;

/// One call a producer made.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum Recorded {
    Nodes(HashSet<MacroUserIdStr<'static>>),
    Connections(Vec<ContactConnection>),
    InboxContacts(InboxSource, Vec<MacroUserIdStr<'static>>),
    DirectoryChanged(Vec<MacroUserIdStr<'static>>, Vec<MacroUserIdStr<'static>>),
}

/// Records every call; `fail` makes each one fail instead.
#[derive(Default)]
pub(crate) struct RecordingContactLists {
    pub(crate) calls: Mutex<Vec<Recorded>>,
    pub(crate) fail: bool,
}

impl RecordingContactLists {
    pub(crate) fn failing() -> Self {
        Self {
            fail: true,
            ..Self::default()
        }
    }

    pub(crate) fn calls(&self) -> Vec<Recorded> {
        self.calls.lock().unwrap().clone()
    }

    fn record(&self, call: Recorded) -> Result<(), Report> {
        if self.fail {
            return Err(rootcause::report!("contacts queue unavailable"));
        }
        self.calls.lock().unwrap().push(call);
        Ok(())
    }
}

impl ContactsIngress for RecordingContactLists {
    async fn enqueue_contacts(
        &self,
        users: HashSet<MacroUserIdStr<'static>>,
    ) -> Result<(), Report> {
        self.record(Recorded::Nodes(users))
    }

    async fn enqueue_contact_connections(
        &self,
        connections: Vec<ContactConnection>,
    ) -> Result<(), Report> {
        self.record(Recorded::Connections(connections))
    }
}

impl ContactListIngress for RecordingContactLists {
    async fn record_interactions(
        &self,
        _: Vec<MacroUserIdStr<'static>>,
        _: Vec<MacroUserIdStr<'static>>,
    ) -> Result<(), Report> {
        Err(rootcause::report!("email never records interactions"))
    }

    async fn record_inbox_contacts(
        &self,
        inbox: InboxSource,
        contacts: Vec<MacroUserIdStr<'static>>,
    ) -> Result<(), Report> {
        self.record(Recorded::InboxContacts(inbox, contacts))
    }

    async fn directory_changed(
        &self,
        users: Vec<MacroUserIdStr<'static>>,
        changed: Vec<MacroUserIdStr<'static>>,
    ) -> Result<(), Report> {
        self.record(Recorded::DirectoryChanged(users, changed))
    }

    async fn user_deleted(&self, _: MacroUserIdStr<'static>) -> Result<(), Report> {
        Err(rootcause::report!("email never deletes users"))
    }
}
