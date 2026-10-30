use super::*;
use async_graphql::{Context, EmptyMutation, EmptySubscription, Object, Request, Schema};
use contacts::domain::{
    models::{
        contact::{Contact, ContactId, ContactPage},
        page::{ContactCursor, ContactPageSize},
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
}
impl ContactDirectory for Reader {
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
