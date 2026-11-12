use super::*;
use contacts::domain::models::page::{ContactCursor, ContactIdPage, ContactPageSize};
use rootcause::Report;
use std::sync::Mutex;

fn id(value: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(value.to_string()).expect("valid user id")
}

/// Graph with one edge per `(viewer, contact)`; records each lookup.
#[derive(Default)]
struct FakeRepository {
    edges: Vec<(String, String)>,
    lookups: Mutex<Vec<(String, Vec<String>)>>,
}

impl ContactsPageRepository for FakeRepository {
    async fn lookup_contact_ids(
        &self,
        viewer: MacroUserIdStr<'_>,
        lookup: &ContactLookup,
    ) -> Result<Vec<MacroUserIdStr<'static>>, Report> {
        let requested: Vec<String> = lookup.ids().iter().map(ToString::to_string).collect();
        self.lookups
            .lock()
            .unwrap()
            .push((viewer.as_ref().to_string(), requested));
        Ok(lookup
            .ids()
            .iter()
            .filter(|candidate| {
                self.edges
                    .iter()
                    .any(|(a, b)| a == viewer.as_ref() && b == candidate.as_ref())
            })
            .cloned()
            .collect())
    }

    async fn contact_id_page(
        &self,
        _viewer: MacroUserIdStr<'_>,
        _after: Option<&ContactCursor>,
        _limit: ContactPageSize,
    ) -> Result<ContactIdPage, Report> {
        panic!("the stream audience must never page contacts");
    }
}

#[tokio::test]
async fn contact_pair_is_found_with_one_exact_lookup() {
    let repository = Arc::new(FakeRepository {
        edges: vec![(
            "macro|changed@example.com".into(),
            "macro|reader@example.com".into(),
        )],
        ..Default::default()
    });
    let checker = ContactsStreamChecker::new(repository.clone());

    assert!(
        checker
            .is_contact(
                id("macro|changed@example.com"),
                id("macro|reader@example.com")
            )
            .await
            .unwrap()
    );
    assert_eq!(
        *repository.lookups.lock().unwrap(),
        vec![(
            "macro|changed@example.com".to_string(),
            vec!["macro|reader@example.com".to_string()]
        )]
    );
}

#[tokio::test]
async fn non_contact_is_rejected() {
    let checker = ContactsStreamChecker::new(Arc::new(FakeRepository::default()));
    assert!(
        !checker
            .is_contact(
                id("macro|changed@example.com"),
                id("macro|reader@example.com")
            )
            .await
            .unwrap()
    );
}
