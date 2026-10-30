use super::*;
use ::contacts::domain::{
    models::{
        contact::{Contact, ContactId, ContactPage},
        page::{ContactCursor, ContactPageSize},
    },
    ports::ContactDirectory,
};
use graphql_contacts::ContactsGraphqlContext;

#[derive(Default)]
struct Directory(Mutex<Vec<String>>);
impl ContactDirectory for Directory {
    async fn contact_page(
        &self,
        viewer: MacroUserIdStr<'_>,
        _after: Option<&ContactCursor>,
        _limit: ContactPageSize,
    ) -> Result<ContactPage, Report> {
        self.0.lock().unwrap().push(viewer.to_string());
        let user_id = MacroUserIdStr::try_from_email("person@example.com").unwrap();
        Ok(ContactPage {
            contacts: vec![Contact {
                id: ContactId::for_viewer(&viewer, &user_id),
                user_id,
                name: Some("Person".into()),
            }],
            next_cursor: None,
        })
    }
}

#[tokio::test]
async fn contacts_are_read_from_request_data_only_for_the_authenticated_viewer() {
    let harness = harness();
    let directory = Arc::new(Directory::default());
    let context = ContactsGraphqlContext::new(directory.clone());
    let query = "{ user { id contacts(limit: 2) { nodes { id userId email name } nextCursor } } }";
    // The enclosing user authentication gate runs before the directory resolver.
    let response = harness
        .schema
        .execute(async_graphql::Request::new(query).data(context.clone()))
        .await;
    assert!(!response.errors.is_empty());
    assert!(directory.0.lock().unwrap().is_empty());

    let id_only = harness
        .schema
        .execute(harness.request("{ user { id } }", authenticated_parts()))
        .await;
    assert!(id_only.errors.is_empty(), "{:?}", id_only.errors);
    let response = harness
        .schema
        .execute(harness.request(query, authenticated_parts()).data(context))
        .await;
    assert!(response.errors.is_empty(), "{:?}", response.errors);
    let data = response.data.into_json().unwrap();
    assert_eq!(data["user"]["id"], VALID_USER_ID);
    assert_eq!(
        data["user"]["contacts"]["nodes"][0]["userId"],
        "macro|person@example.com"
    );
    assert_eq!(*directory.0.lock().unwrap(), [VALID_USER_ID.to_owned()]);
}
