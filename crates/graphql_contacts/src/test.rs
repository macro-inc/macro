use super::*;
use async_graphql::{Context, EmptyMutation, EmptySubscription, Object, Request, Schema};
use contacts::domain::{
    models::{
        contact::{Contact, ContactId, ContactPage},
        page::{ContactCursor, ContactPageSize},
        query::{ContactLookup, ContactSearch},
    },
    ports::ContactDirectory,
};
use macro_user_id::user_id::MacroUserIdStr;
use models_pagination::Base64Str;
use rootcause::Report;
use std::sync::{Arc, Mutex};

struct Query;
#[Object]
impl Query {
    async fn user(&self, ctx: &Context<'_>) -> async_graphql::Result<GraphqlContactsQuery> {
        Ok(GraphqlContactsQuery::new(
            graphql_common::require_authenticated_user(ctx)?,
        ))
    }
}

#[derive(Default)]
struct Reader {
    requests: Mutex<Vec<(String, Option<String>, u16)>>,
    fail: bool,
    empty: bool,
    searches: Mutex<Vec<String>>,
    lookups: Mutex<Vec<Vec<String>>>,
}
impl ContactDirectory for Reader {
    async fn search_contacts(
        &self,
        viewer: MacroUserIdStr<'_>,
        search: &ContactSearch,
        after: Option<&ContactCursor>,
        limit: ContactPageSize,
    ) -> Result<ContactPage, Report> {
        self.searches
            .lock()
            .unwrap()
            .push(search.as_str().to_owned());
        self.contact_page(viewer, after, limit).await
    }
    async fn lookup_contacts(
        &self,
        viewer: MacroUserIdStr<'_>,
        lookup: &ContactLookup,
    ) -> Result<Vec<Contact>, Report> {
        self.lookups
            .lock()
            .unwrap()
            .push(lookup.ids().iter().map(ToString::to_string).collect());
        if lookup.ids().is_empty() {
            return Ok(vec![]);
        }
        Ok(self
            .contact_page(viewer, None, ContactPageSize::DEFAULT)
            .await?
            .contacts)
    }
    async fn contact_page(
        &self,
        viewer: MacroUserIdStr<'_>,
        after: Option<&ContactCursor>,
        limit: ContactPageSize,
    ) -> Result<ContactPage, Report> {
        self.requests.lock().unwrap().push((
            viewer.to_string(),
            after.map(|c| c.position().to_owned()),
            limit.get(),
        ));
        if self.fail {
            return Err(rootcause::report!("private implementation detail"));
        }
        let user_id = MacroUserIdStr::try_from_email("person@example.com").unwrap();
        Ok(ContactPage {
            contacts: if self.empty {
                vec![]
            } else {
                vec![Contact {
                    id: ContactId::for_viewer(&viewer, &user_id),
                    user_id,
                    name: Some("Person".into()),
                }]
            },
            next_cursor: ContactCursor::from_position("legacy-position".into()),
        })
    }
}

#[tokio::test]
async fn search_and_exact_lookups_are_validated_and_scoped_to_the_root_viewer() {
    let reader = Arc::new(Reader::default());
    let schema = Schema::build(Query, EmptyMutation, EmptySubscription)
        .data(ContactsGraphqlContext::new(reader.clone()))
        .finish();
    let viewer = MacroUserIdStr::try_from_email("viewer@example.com").unwrap();
    let response = schema.execute(Request::new(r#"{ user {
        contacts(search: "  CAFÉ   PLN ") { nextCursor }
        contactsByUserIds(userIds: ["macro|PERSON@example.com", "macro|person@example.com"]) { userId }
        contactsByEmails(emails: ["PERSON@example.com", "person@example.com"]) { userId }
        empty: contactsByEmails(emails: []) { id }
    } }"#).data(viewer.clone())).await;
    assert!(response.errors.is_empty(), "{:?}", response.errors);
    assert_eq!(
        response.data.into_json().unwrap()["user"]["empty"],
        serde_json::json!([])
    );
    assert_eq!(*reader.searches.lock().unwrap(), ["café pln"]);
    {
        let lookups = reader.lookups.lock().unwrap();
        assert_eq!(lookups.len(), 3);
        assert_eq!(
            lookups
                .iter()
                .filter(|ids| ids.as_slice() == ["macro|person@example.com"])
                .count(),
            2
        );
        assert_eq!(lookups.iter().filter(|ids| ids.is_empty()).count(), 1);
    }
    let before = reader.requests.lock().unwrap().len();
    for query in [
        "{ user { contactsByUserIds(userIds: [\"not-an-id\"]) { id } } }",
        "{ user { contactsByEmails(emails: [\"not-an-email\"]) { id } } }",
    ] {
        assert_eq!(
            schema
                .execute(Request::new(query).data(viewer.clone()))
                .await
                .errors
                .len(),
            1
        );
    }
    for (query, variables) in [
        (
            "query($q:String){user{contacts(search:$q){nextCursor}}}",
            serde_json::json!({"q": "x".repeat(513)}),
        ),
        (
            "query($ids:[ID!]!){user{contactsByUserIds(userIds:$ids){id}}}",
            serde_json::json!({"ids": vec!["macro|person@example.com"; 501]}),
        ),
        (
            "query($emails:[String!]!){user{contactsByEmails(emails:$emails){id}}}",
            serde_json::json!({"emails": vec!["person@example.com"; 501]}),
        ),
    ] {
        let response = schema
            .execute(
                Request::new(query)
                    .variables(async_graphql::Variables::from_json(variables))
                    .data(viewer.clone()),
            )
            .await;
        assert_eq!(
            response.errors[0].extensions.as_ref().unwrap().get("code"),
            Some(&async_graphql::Value::from("BAD_USER_INPUT"))
        );
    }
    assert_eq!(reader.requests.lock().unwrap().len(), before);
}

#[tokio::test]
async fn bounds_and_cursor_validation_precede_domain_reads() {
    let reader = Arc::new(Reader::default());
    let schema = Schema::build(Query, EmptyMutation, EmptySubscription)
        .data(ContactsGraphqlContext::new(reader.clone()))
        .finish();
    let viewer = MacroUserIdStr::try_from_email("viewer@example.com").unwrap();
    for arguments in [
        "limit: 0",
        "limit: -1",
        "limit: 501",
        "limit: 65537",
        "after: \"not-base64\"",
        "after: \"MQ==\"",
    ] {
        let result = schema
            .execute(
                Request::new(format!(
                    "{{ user {{ contacts({arguments}) {{ nodes {{ id }} }} }} }}"
                ))
                .data(viewer.clone()),
            )
            .await;
        assert_eq!(result.errors.len(), 1);
        assert_eq!(
            result.errors[0].extensions.as_ref().unwrap().get("code"),
            Some(&async_graphql::Value::from("BAD_USER_INPUT"))
        );
    }
    let nul = Base64Str::encode_json("bad\0position").type_erase();
    let result = schema
        .execute(
            Request::new(format!(
                "{{ user {{ contacts(after: \"{nul}\") {{ nextCursor }} }} }}"
            ))
            .data(viewer),
        )
        .await;
    assert_eq!(result.errors.len(), 1);
    assert!(reader.requests.lock().unwrap().is_empty());
}

#[tokio::test]
async fn enriched_rows_and_empty_pages_preserve_opaque_continuations() {
    for empty in [false, true] {
        let reader = Arc::new(Reader {
            empty,
            ..Default::default()
        });
        let schema = Schema::build(Query, EmptyMutation, EmptySubscription)
            .data(ContactsGraphqlContext::new(reader.clone()))
            .finish();
        let viewer = MacroUserIdStr::try_from_email("viewer@example.com").unwrap();
        let result = schema
            .execute(
                Request::new("{ user { contacts { nodes { id userId email name } nextCursor } } }")
                    .data(viewer.clone()),
            )
            .await;
        assert!(result.errors.is_empty(), "{:?}", result.errors);
        let data = result.data.into_json().unwrap();
        let page = &data["user"]["contacts"];
        assert_eq!(page["nodes"].as_array().unwrap().len(), usize::from(!empty));
        if !empty {
            assert_eq!(page["nodes"][0]["email"], "person@example.com");
            assert_eq!(page["nodes"][0]["userId"], "macro|person@example.com");
            assert_eq!(page["nodes"][0]["name"], "Person");
            assert_ne!(page["nodes"][0]["id"], page["nodes"][0]["userId"]);
        }
        let cursor = page["nextCursor"].as_str().unwrap();
        assert_ne!(cursor, "legacy-position");
        let next = schema
            .execute(
                Request::new(format!(
                    "{{ user {{ contacts(limit: 500, after: \"{cursor}\") {{ nextCursor }} }} }}"
                ))
                .data(viewer),
            )
            .await;
        assert!(next.errors.is_empty(), "{:?}", next.errors);
        assert_eq!(
            *reader.requests.lock().unwrap(),
            [
                ("macro|viewer@example.com".into(), None, 100),
                (
                    "macro|viewer@example.com".into(),
                    Some("legacy-position".into()),
                    500
                ),
            ]
        );
    }
}

#[tokio::test]
async fn unauthenticated_reads_do_not_reach_the_domain_and_errors_are_sanitized() {
    let reader = Arc::new(Reader {
        fail: true,
        ..Default::default()
    });
    let schema = Schema::build(Query, EmptyMutation, EmptySubscription)
        .data(ContactsGraphqlContext::new(reader.clone()))
        .finish();
    let query = "{ user { contacts { nodes { id } } } }";
    assert_eq!(schema.execute(query).await.errors.len(), 1);
    assert!(reader.requests.lock().unwrap().is_empty());
    let response = schema
        .execute(
            Request::new(query).data(MacroUserIdStr::try_from_email("viewer@example.com").unwrap()),
        )
        .await;
    assert_eq!(response.errors[0].message, "contact directory unavailable");
    assert_eq!(
        response.errors[0].extensions.as_ref().unwrap().get("code"),
        Some(&async_graphql::Value::from("INTERNAL_SERVER_ERROR"))
    );
}
