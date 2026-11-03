use std::sync::{Arc, Mutex};

use ::contacts::domain::{
    ports::{ContactsNotifier, ContactsRepository},
    service::ContactsDomainService,
};
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;

use super::*;
use crate::ContactsGraphqlContext;

#[derive(Clone, Default)]
struct RecordingContactsRepository {
    viewers: Arc<Mutex<Vec<String>>>,
    fail: bool,
}

impl ContactsRepository for RecordingContactsRepository {
    async fn get_contacts(
        &self,
        viewer: MacroUserIdStr<'_>,
    ) -> Result<Vec<MacroUserIdStr<'static>>, Report> {
        self.viewers.lock().unwrap().push(viewer.to_string());
        if self.fail {
            return Err(rootcause::report!("private storage failure"));
        }
        Ok(vec![
            MacroUserIdStr::parse_from_str("macro|contact@example.com").unwrap(),
        ])
    }

    async fn create_connections(
        &self,
        _: Vec<(MacroUserIdStr<'_>, MacroUserIdStr<'_>)>,
    ) -> Result<(), Report> {
        unreachable!("contact listing does not write connections")
    }
}

struct NoopContactsNotifier;

impl ContactsNotifier for NoopContactsNotifier {
    async fn invalidate_contacts_for_users(
        &self,
        _: Vec<MacroUserIdStr<'_>>,
    ) -> Result<(), Report> {
        unreachable!("contact listing does not notify")
    }
}

fn context(repository: RecordingContactsRepository) -> ContactsGraphqlContext {
    ContactsGraphqlContext::new(Arc::new(ContactsDomainService {
        repository,
        notifier: NoopContactsNotifier,
    }))
}

#[tokio::test]
async fn contacts_read_the_authenticated_viewer_graph_and_include_self() {
    let harness = harness();
    let repository = RecordingContactsRepository::default();
    let context = context(repository.clone());
    let id_only = harness
        .schema
        .execute(
            harness
                .request("{ user { id } }", authenticated_parts())
                .data(context.clone()),
        )
        .await;
    assert!(id_only.errors.is_empty(), "{:?}", id_only.errors);
    assert!(repository.viewers.lock().unwrap().is_empty());

    let response = harness
        .schema
        .execute(
            harness
                .request("{ user { id contacts } }", authenticated_parts())
                .data(context),
        )
        .await;
    assert!(response.errors.is_empty(), "{:?}", response.errors);
    assert_eq!(
        response.data.into_json().unwrap(),
        serde_json::json!({"user": {
            "id": VALID_USER_ID,
            "contacts": ["macro|contact@example.com", VALID_USER_ID]
        }})
    );
    assert_eq!(*repository.viewers.lock().unwrap(), vec![VALID_USER_ID]);
}

#[tokio::test]
async fn contacts_use_the_authenticated_internal_acting_viewer() {
    let harness = harness();
    let repository = RecordingContactsRepository::default();
    let response = harness
        .schema
        .execute(
            harness
                .request("{ user { id contacts } }", internal_parts(INTERNAL_USER_ID))
                .data(context(repository.clone())),
        )
        .await;
    assert!(response.errors.is_empty(), "{:?}", response.errors);
    let data = response.data.into_json().unwrap();
    assert_eq!(data["user"]["id"], INTERNAL_USER_ID);
    assert_eq!(data["user"]["contacts"][1], INTERNAL_USER_ID);
    assert_eq!(*repository.viewers.lock().unwrap(), vec![INTERNAL_USER_ID]);
}

#[tokio::test]
async fn contacts_reject_unauthenticated_reads_before_querying_the_domain() {
    let harness = harness();
    let repository = RecordingContactsRepository::default();
    let response = harness
        .schema
        .execute(
            harness
                .request(
                    "{ user { id contacts } }",
                    HttpRequest::new(()).into_parts().0,
                )
                .data(context(repository.clone())),
        )
        .await;
    assert!(!response.errors.is_empty());
    assert!(repository.viewers.lock().unwrap().is_empty());
}

#[tokio::test]
async fn contacts_failures_do_not_expose_storage_details_or_return_an_empty_catalog() {
    let harness = harness();
    let repository = RecordingContactsRepository {
        fail: true,
        ..Default::default()
    };
    let response = harness
        .schema
        .execute(
            harness
                .request("{ user { id contacts } }", authenticated_parts())
                .data(context(repository)),
        )
        .await;
    assert_eq!(response.errors.len(), 1);
    assert_eq!(response.errors[0].message, "Contacts are unavailable");
    assert_eq!(
        response.errors[0].extensions.as_ref().unwrap().get("code"),
        Some(&async_graphql::Value::from("INTERNAL"))
    );
    assert!(
        response.data.into_json().unwrap()["user"]
            .get("contacts")
            .is_none()
    );
}
