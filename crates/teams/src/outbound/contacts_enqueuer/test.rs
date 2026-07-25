use std::{
    collections::HashSet,
    sync::{Arc, Mutex},
};

use contacts::domain::{models::messages::ContactConnection, ports::ContactsIngress};
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
