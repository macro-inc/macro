use super::*;
mod search;
use crate::domain::models::{
    contact::ContactName,
    list::ContactList,
    listed::ListedContact,
    page::{ContactIdEntry, ContactIdPage},
};
use std::sync::Mutex;

struct Pages(ContactIdPage);
impl ContactsPageService for Pages {
    async fn lookup_contact_ids(
        &self,
        _viewer: MacroUserIdStr<'_>,
        lookup: &ContactLookup,
    ) -> Result<Vec<MacroUserIdStr<'static>>, Report> {
        Ok(lookup
            .ids()
            .iter()
            .filter(|id| self.0.contacts.iter().any(|row| &row.user_id == *id))
            .cloned()
            .collect())
    }
    async fn contact_id_page(
        &self,
        _viewer: MacroUserIdStr<'_>,
        _after: Option<&ContactCursor>,
        _limit: ContactPageSize,
    ) -> Result<ContactIdPage, Report> {
        Ok(self.0.clone())
    }
}

/// The list-aware directory's lists, by contact; only `contact_lists` is read.
#[derive(Default)]
struct Lists {
    by_contact: HashMap<String, Vec<ContactList>>,
    requests: Mutex<Vec<Vec<String>>>,
}
impl ContactListReader for Lists {
    async fn list_directory_page(
        &self,
        _viewer: MacroUserIdStr<'_>,
        _after: Option<&ContactCursor>,
        _limit: ContactPageSize,
    ) -> Result<ContactIdPage, Report> {
        Err(rootcause::report!(
            "the directory service never pages lists"
        ))
    }
    async fn lookup_listed_contacts(
        &self,
        _viewer: MacroUserIdStr<'_>,
        _lookup: &ContactLookup,
    ) -> Result<Vec<MacroUserIdStr<'static>>, Report> {
        Err(rootcause::report!(
            "the directory service never looks up lists"
        ))
    }
    async fn contact_lists(
        &self,
        _viewer: MacroUserIdStr<'_>,
        lookup: &ContactLookup,
    ) -> Result<Vec<ListedContact>, Report> {
        self.requests
            .lock()
            .unwrap()
            .push(lookup.ids().iter().map(ToString::to_string).collect());
        Ok(lookup
            .ids()
            .iter()
            .filter_map(|id| {
                Some(ListedContact {
                    user_id: id.clone(),
                    lists: self.by_contact.get(id.as_ref())?.clone(),
                })
            })
            .collect())
    }
    async fn audience_page(
        &self,
        _subject: MacroUserIdStr<'_>,
        _after: Option<&ContactCursor>,
        _limit: ContactPageSize,
    ) -> Result<ContactIdPage, Report> {
        Err(rootcause::report!(
            "the directory service never reads audiences"
        ))
    }
    async fn search_listed_people(
        &self,
        _viewer: MacroUserIdStr<'_>,
        _needle: &str,
        _limit: crate::domain::models::people::PeopleSearchLimit,
    ) -> Result<Vec<crate::domain::models::people::PersonMatch>, Report> {
        Err(rootcause::report!(
            "the directory service never searches people"
        ))
    }
    async fn name_listed_people(
        &self,
        _viewer: MacroUserIdStr<'_>,
        _query: &crate::domain::models::people::NamedPeopleQuery,
        _limit: crate::domain::models::people::PeopleSearchLimit,
    ) -> Result<Vec<crate::domain::models::people::PersonMatch>, Report> {
        Err(rootcause::report!(
            "the directory service never names people"
        ))
    }
    async fn inbox_contacts(
        &self,
        _viewer: MacroUserIdStr<'_>,
    ) -> Result<Vec<MacroUserIdStr<'static>>, Report> {
        Err(rootcause::report!(
            "the directory service never reads inbox contacts"
        ))
    }
}

#[derive(Default)]
struct Names {
    requests: Mutex<Vec<(String, Vec<String>)>>,
}
impl ContactNameReader for Arc<Names> {
    async fn contact_names(
        &self,
        viewer: MacroUserIdStr<'_>,
        contacts: &[MacroUserIdStr<'static>],
    ) -> Result<Vec<ContactName>, Report> {
        self.requests.lock().unwrap().push((
            viewer.to_string(),
            contacts.iter().map(ToString::to_string).collect(),
        ));
        Ok(vec![
            ContactName {
                user_id: MacroUserIdStr::try_from_email("known@example.com").unwrap(),
                first_name: Some(
                    if viewer.email_str() == "first@example.com" {
                        "First"
                    } else {
                        "Second"
                    }
                    .into(),
                ),
                last_name: Some("N/A".into()),
            },
            ContactName {
                user_id: MacroUserIdStr::try_from_email("outside@example.com").unwrap(),
                first_name: Some("Not in the directory".into()),
                last_name: None,
            },
        ])
    }
}

#[tokio::test]
async fn enriches_only_members_and_scopes_names_and_identity_to_the_viewer() {
    let names = Arc::new(Names::default());
    let known = MacroUserIdStr::try_from_email("known@example.com").unwrap();
    let unknown = MacroUserIdStr::try_from_email("unknown@example.com").unwrap();
    let cursor = ContactCursor::from_position("legacy-position".into()).unwrap();
    let service = ContactsDirectoryService::new(
        Arc::new(Pages(ContactIdPage {
            contacts: [known.clone(), unknown.clone()]
                .map(|id| ContactIdEntry::parse(id.to_string()).unwrap())
                .to_vec(),
            next_cursor: Some(cursor.clone()),
        })),
        Arc::new(Lists::default()),
        names.clone(),
    );
    let first_viewer = MacroUserIdStr::try_from_email("first@example.com").unwrap();
    let first = service
        .contact_page(first_viewer.clone(), None, ContactPageSize::DEFAULT)
        .await
        .unwrap();
    let again = service
        .contact_page(first_viewer, None, ContactPageSize::DEFAULT)
        .await
        .unwrap();
    let second = service
        .contact_page(
            MacroUserIdStr::try_from_email("second@example.com").unwrap(),
            None,
            ContactPageSize::DEFAULT,
        )
        .await
        .unwrap();
    assert_eq!(first, again);
    assert_eq!(first.contacts.len(), 2);
    assert_eq!(first.contacts[0].user_id, known);
    assert_eq!(first.contacts[0].name.as_deref(), Some("First"));
    assert_eq!(first.contacts[1].user_id, unknown);
    assert_eq!(first.contacts[1].name, None);
    assert_eq!(first.next_cursor, Some(cursor));
    assert_eq!(second.contacts[0].name.as_deref(), Some("Second"));
    assert_ne!(first.contacts[0].id, second.contacts[0].id);
    assert_eq!(
        names.requests.lock().unwrap()[0],
        (
            "macro|first@example.com".into(),
            vec![
                "macro|known@example.com".into(),
                "macro|unknown@example.com".into()
            ]
        )
    );
}

#[tokio::test]
async fn empty_page_keeps_progress_and_does_not_request_names() {
    let names = Arc::new(Names::default());
    let cursor = ContactCursor::from_position("legacy-position".into()).unwrap();
    let service = ContactsDirectoryService::new(
        Arc::new(Pages(ContactIdPage {
            contacts: vec![],
            next_cursor: Some(cursor.clone()),
        })),
        Arc::new(Lists::default()),
        names.clone(),
    );
    let result = service
        .contact_page(
            MacroUserIdStr::try_from_email("viewer@example.com").unwrap(),
            None,
            ContactPageSize::DEFAULT,
        )
        .await
        .unwrap();
    assert!(result.contacts.is_empty());
    assert_eq!(result.next_cursor, Some(cursor));
    assert!(names.requests.lock().unwrap().is_empty());
}

#[tokio::test]
async fn oversized_source_page_is_rejected_before_enrichment() {
    let names = Arc::new(Names::default());
    let service = ContactsDirectoryService::new(
        Arc::new(Pages(ContactIdPage {
            contacts: ["macro|first@example.com", "macro|second@example.com"]
                .map(|id| ContactIdEntry::parse(id.into()).unwrap())
                .to_vec(),
            next_cursor: None,
        })),
        Arc::new(Lists::default()),
        names.clone(),
    );
    assert!(
        service
            .contact_page(
                MacroUserIdStr::try_from_email("viewer@example.com").unwrap(),
                None,
                ContactPageSize::new(1).unwrap()
            )
            .await
            .is_err()
    );
    assert!(names.requests.lock().unwrap().is_empty());
}

#[tokio::test]
async fn pages_and_lookups_carry_lists_from_the_list_aware_directory() {
    let names = Arc::new(Names::default());
    let known = MacroUserIdStr::try_from_email("known@example.com").unwrap();
    let unknown = MacroUserIdStr::try_from_email("unknown@example.com").unwrap();
    let lists = Arc::new(Lists {
        by_contact: HashMap::from([(
            known.to_string(),
            vec![ContactList::Teammates, ContactList::Gmail],
        )]),
        ..Lists::default()
    });
    let service = ContactsDirectoryService::new(
        Arc::new(Pages(ContactIdPage {
            contacts: [known.clone(), unknown.clone()]
                .map(|id| ContactIdEntry::parse(id.to_string()).unwrap())
                .to_vec(),
            next_cursor: None,
        })),
        lists.clone(),
        names,
    );
    let viewer = MacroUserIdStr::try_from_email("viewer@example.com").unwrap();
    let page = service
        .contact_page(viewer.clone(), None, ContactPageSize::DEFAULT)
        .await
        .unwrap();
    assert_eq!(
        page.contacts[0].lists,
        [ContactList::Teammates, ContactList::Gmail]
    );
    assert!(
        page.contacts[1].lists.is_empty(),
        "a contact only the page source knows has no lists"
    );
    let found = service
        .lookup_contacts(
            viewer,
            &ContactLookup::new(vec![unknown.clone(), known.clone()]).unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(found[0].user_id, unknown);
    assert!(found[0].lists.is_empty());
    assert_eq!(found[1].lists, [ContactList::Teammates, ContactList::Gmail]);
    assert_eq!(lists.requests.lock().unwrap().len(), 2);
}

#[tokio::test]
async fn an_empty_page_reads_no_lists() {
    let lists = Arc::new(Lists::default());
    let service = ContactsDirectoryService::new(
        Arc::new(Pages(ContactIdPage {
            contacts: vec![],
            next_cursor: None,
        })),
        lists.clone(),
        Arc::new(Names::default()),
    );
    service
        .contact_page(
            MacroUserIdStr::try_from_email("viewer@example.com").unwrap(),
            None,
            ContactPageSize::DEFAULT,
        )
        .await
        .unwrap();
    assert!(lists.requests.lock().unwrap().is_empty());
}
