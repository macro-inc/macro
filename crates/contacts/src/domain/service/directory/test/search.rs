use super::*;

struct ScanPages(Vec<ContactIdEntry>);
impl ContactsPageService for ScanPages {
    async fn lookup_contact_ids(
        &self,
        _viewer: MacroUserIdStr<'_>,
        lookup: &ContactLookup,
    ) -> Result<Vec<MacroUserIdStr<'static>>, Report> {
        Ok(lookup
            .ids()
            .iter()
            .filter(|id| self.0.iter().any(|row| &row.user_id == *id))
            .cloned()
            .collect())
    }
    async fn contact_id_page(
        &self,
        _viewer: MacroUserIdStr<'_>,
        after: Option<&ContactCursor>,
        limit: ContactPageSize,
    ) -> Result<ContactIdPage, Report> {
        let mut rows: Vec<_> = self
            .0
            .iter()
            .filter(|row| after.is_none_or(|cursor| row.cursor.position() > cursor.position()))
            .take(usize::from(limit.get()) + 1)
            .cloned()
            .collect();
        let more = rows.len() > usize::from(limit.get());
        rows.truncate(usize::from(limit.get()));
        let next_cursor = rows.last().filter(|_| more).map(|row| row.cursor.clone());
        Ok(ContactIdPage {
            contacts: rows,
            next_cursor,
        })
    }
}

#[tokio::test]
async fn search_matches_names_and_resumes_using_original_storage_positions() {
    let names = Arc::new(Names::default());
    let service = ContactsDirectoryService::new(
        Arc::new(ScanPages(vec![
            ContactIdEntry::parse("macro|KNOWN@example.com".into()).unwrap(),
            ContactIdEntry::parse("macro|LATER@example.com".into()).unwrap(),
        ])),
        names,
    );
    let viewer = MacroUserIdStr::try_from_email("viewer@example.com").unwrap();
    let named = service
        .search_contacts(
            viewer.clone(),
            &ContactSearch::new("second").unwrap(),
            None,
            ContactPageSize::DEFAULT,
        )
        .await
        .unwrap();
    assert_eq!(named.contacts.len(), 1);
    assert_eq!(named.contacts[0].name.as_deref(), Some("Second"));
    let query = ContactSearch::new("example").unwrap();
    let first = service
        .search_contacts(
            viewer.clone(),
            &query,
            None,
            ContactPageSize::new(1).unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(first.contacts[0].user_id.email_str(), "known@example.com");
    assert_eq!(
        first.next_cursor.as_ref().unwrap().position(),
        "macro|KNOWN@example.com"
    );
    let next = service
        .search_contacts(
            viewer,
            &query,
            first.next_cursor.as_ref(),
            ContactPageSize::new(1).unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(next.contacts[0].user_id.email_str(), "later@example.com");
    assert!(next.next_cursor.is_none());
}

#[tokio::test]
async fn scan_budget_returns_progress_instead_of_false_exhaustion() {
    let mut rows: Vec<_> = (0..CONTACT_SEARCH_SCAN_BUDGET)
        .map(|i| ContactIdEntry::parse(format!("macro|a{i:04}@example.com")).unwrap())
        .collect();
    rows.push(ContactIdEntry::parse("macro|winner@example.com".into()).unwrap());
    let names = Arc::new(Names::default());
    let service = ContactsDirectoryService::new(Arc::new(ScanPages(rows)), names.clone());
    let viewer = MacroUserIdStr::try_from_email("viewer@example.com").unwrap();
    let query = ContactSearch::new("winner").unwrap();
    let first = service
        .search_contacts(viewer.clone(), &query, None, ContactPageSize::DEFAULT)
        .await
        .unwrap();
    assert!(first.contacts.is_empty());
    assert!(first.next_cursor.is_some());
    let requests = names.requests.lock().unwrap();
    assert_eq!(requests.len(), 4);
    assert!(requests.iter().all(|(_, ids)| ids.len() == 500));
    drop(requests);
    let next = service
        .search_contacts(
            viewer,
            &query,
            first.next_cursor.as_ref(),
            ContactPageSize::DEFAULT,
        )
        .await
        .unwrap();
    assert_eq!(next.contacts[0].user_id.email_str(), "winner@example.com");
    assert!(next.next_cursor.is_none());
}

#[tokio::test]
async fn lookup_never_enriches_unknown_members_and_keeps_requested_order() {
    let names = Arc::new(Names::default());
    let service = ContactsDirectoryService::new(
        Arc::new(ScanPages(
            ["macro|known@example.com", "macro|unknown@example.com"]
                .map(|id| ContactIdEntry::parse(id.into()).unwrap())
                .to_vec(),
        )),
        names.clone(),
    );
    let viewer = MacroUserIdStr::try_from_email("viewer@example.com").unwrap();
    let lookup = ContactLookup::new(
        [
            "outside@example.com",
            "unknown@example.com",
            "known@example.com",
            "known@example.com",
        ]
        .map(|email| MacroUserIdStr::try_from_email(email).unwrap())
        .to_vec(),
    )
    .unwrap();
    let contacts = service
        .lookup_contacts(viewer.clone(), &lookup)
        .await
        .unwrap();
    assert_eq!(
        contacts
            .iter()
            .map(|contact| contact.user_id.email_str())
            .collect::<Vec<_>>(),
        ["unknown@example.com", "known@example.com"]
    );
    assert_eq!(
        names.requests.lock().unwrap()[0].1,
        ["macro|unknown@example.com", "macro|known@example.com"]
    );
    let missing = ContactLookup::new(vec![
        MacroUserIdStr::try_from_email("outside@example.com").unwrap(),
    ])
    .unwrap();
    assert!(
        service
            .lookup_contacts(viewer.clone(), &missing)
            .await
            .unwrap()
            .is_empty()
    );
    assert!(
        service
            .lookup_contacts(viewer, &ContactLookup::new(vec![]).unwrap())
            .await
            .unwrap()
            .is_empty()
    );
    assert_eq!(names.requests.lock().unwrap().len(), 1);
}
