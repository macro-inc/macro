use std::{
    collections::HashSet,
    sync::{Arc, Mutex},
};

use contacts::domain::{
    models::{list::InboxSource, messages::ContactConnection},
    ports::{ContactListIngress, ContactsIngress},
};
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;

use super::*;

#[derive(Default)]
struct FakeContactsIngress {
    connection_batches: Mutex<Vec<Vec<ContactConnection>>>,
}

impl ContactsIngress for FakeContactsIngress {
    async fn enqueue_contacts(
        &self,
        _users: HashSet<MacroUserIdStr<'static>>,
    ) -> Result<(), Report> {
        panic!("unexpected complete-graph contacts enqueue")
    }

    async fn enqueue_contact_connections(
        &self,
        connections: Vec<ContactConnection>,
    ) -> Result<(), Report> {
        self.connection_batches
            .lock()
            .expect("connection batches lock should not be poisoned")
            .push(connections);
        Ok(())
    }
}

impl ContactListIngress for FakeContactsIngress {
    async fn record_interactions(
        &self,
        _users: Vec<MacroUserIdStr<'static>>,
        _peers: Vec<MacroUserIdStr<'static>>,
    ) -> Result<(), Report> {
        panic!("unexpected interactions enqueue")
    }

    async fn record_inbox_contacts(
        &self,
        _inbox: InboxSource,
        _contacts: Vec<MacroUserIdStr<'static>>,
    ) -> Result<(), Report> {
        panic!("unexpected inbox contacts enqueue")
    }

    async fn directory_changed(
        &self,
        _users: Vec<MacroUserIdStr<'static>>,
        _changed: Vec<MacroUserIdStr<'static>>,
    ) -> Result<(), Report> {
        panic!("unexpected directory change enqueue")
    }

    async fn user_deleted(&self, _user: MacroUserIdStr<'static>) -> Result<(), Report> {
        panic!("unexpected user deletion enqueue")
    }
}

fn macro_user_id(value: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(value.to_string()).expect("valid macro user id")
}

#[tokio::test]
async fn contacts_ingress_enqueuer_maps_pairs() {
    let ingress = Arc::new(FakeContactsIngress::default());
    let enqueuer = ContactsIngressEnqueuer::new(ingress.clone()).clone();
    let first = macro_user_id("macro|first@example.com");
    let second = macro_user_id("macro|second@example.com");
    let third = macro_user_id("macro|third@example.com");

    enqueuer
        .enqueue_contact_connections(vec![
            (first.clone(), second.clone()),
            (third.clone(), first.clone()),
        ])
        .await
        .expect("contacts enqueue should succeed");

    let batches = ingress
        .connection_batches
        .lock()
        .expect("connection batches lock should not be poisoned");
    assert_eq!(
        *batches,
        vec![vec![
            ContactConnection::new(first.clone(), second),
            ContactConnection::new(third, first),
        ]]
    );
}
