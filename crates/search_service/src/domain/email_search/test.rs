use super::*;
use item_filters::{EmailLabelMatch, NotificationFilters};
use std::collections::HashMap;
use std::sync::Mutex;

#[derive(Clone, Copy, Default)]
struct Thread {
    read: bool,
    done: bool,
    calendar: bool,
    sent: bool,
    draft: bool,
    attachment: bool,
}

#[derive(Default)]
struct Source {
    shared: Vec<SharedThread>,
    own_calendar: Vec<Uuid>,
    own_sent: Vec<Uuid>,
    own_drafts: Vec<Uuid>,
    /// Threads the folder rule admits, with whether each is the viewer's own
    /// and whether only a thread grant shares it.
    in_projects: Vec<(SharedThread, bool, bool)>,
    /// Threads outside the viewer's inboxes in folders granted to them.
    project_shared: Vec<SharedThread>,
    threads: HashMap<Uuid, Thread>,
    favorites: Vec<Uuid>,
    tags: Vec<TagOption>,
    labels: Vec<String>,
    shared_requests: Mutex<Vec<Vec<Uuid>>>,
    project_requests: Mutex<Vec<(Vec<String>, Vec<Uuid>, bool, bool)>>,
}

impl EmailSearchSource for Source {
    async fn shared_threads(
        &self,
        _: &MacroUserId<Lowercase<'_>>,
        own_link_ids: &[Uuid],
        requested: &[Uuid],
        limit: usize,
    ) -> Result<Vec<SharedThread>, Report> {
        self.shared_requests
            .lock()
            .unwrap()
            .push(requested.to_vec());
        Ok(self
            .shared
            .iter()
            .filter(|thread| !own_link_ids.contains(&thread.link_id))
            .filter(|thread| requested.is_empty() || requested.contains(&thread.thread_id))
            .take(limit)
            .copied()
            .collect())
    }

    async fn project_threads(
        &self,
        _: &MacroUserId<Lowercase<'_>>,
        _: &[Uuid],
        project_ids: &[String],
        requested: &[Uuid],
        include_own: bool,
        include_thread_shares: bool,
        limit: usize,
    ) -> Result<Vec<SharedThread>, Report> {
        self.project_requests.lock().unwrap().push((
            project_ids.to_vec(),
            requested.to_vec(),
            include_own,
            include_thread_shares,
        ));
        Ok(self
            .in_projects
            .iter()
            .filter(|(thread, _, _)| requested.is_empty() || requested.contains(&thread.thread_id))
            .filter(|(_, own, _)| include_own || !own)
            .filter(|(_, _, thread_share)| include_thread_shares || !thread_share)
            .map(|(thread, _, _)| *thread)
            .take(limit)
            .collect())
    }

    async fn project_shared_threads(
        &self,
        _: &MacroUserId<Lowercase<'_>>,
        _: &[Uuid],
        thread_ids: &[Uuid],
    ) -> Result<Vec<SharedThread>, Report> {
        Ok(self
            .project_shared
            .iter()
            .filter(|thread| thread_ids.contains(&thread.thread_id))
            .copied()
            .collect())
    }

    async fn threads_in_set(
        &self,
        _: &[Uuid],
        set: ThreadSet,
        limit: usize,
    ) -> Result<Vec<Uuid>, Report> {
        let own = match set {
            ThreadSet::Calendar => &self.own_calendar,
            ThreadSet::Sent => &self.own_sent,
            ThreadSet::Drafts => &self.own_drafts,
        };
        Ok(own.iter().take(limit).copied().collect())
    }

    async fn threads_in_states(
        &self,
        _: &MacroUserId<Lowercase<'_>>,
        thread_ids: &[Uuid],
        states: &ThreadStates,
    ) -> Result<HashSet<Uuid>, Report> {
        Ok(thread_ids
            .iter()
            .filter(|id| {
                let thread = self.threads.get(id).copied().unwrap_or_default();
                states.is_read.is_none_or(|read| read == thread.read)
                    && states.done.is_none_or(|done| done == thread.done)
                    && (!states.calendar_only || thread.calendar)
                    && (!states.sent || thread.sent)
                    && (!states.has_draft || thread.draft)
                    && (!states.has_attachment || thread.attachment)
            })
            .copied()
            .collect())
    }

    async fn favorite_threads(
        &self,
        _: &MacroUserId<Lowercase<'_>>,
        limit: usize,
    ) -> Result<Vec<Uuid>, Report> {
        Ok(self.favorites.iter().take(limit).copied().collect())
    }

    async fn tag_options(&self, _: &MacroUserId<Lowercase<'_>>) -> Result<Vec<TagOption>, Report> {
        Ok(self.tags.clone())
    }

    async fn inbox_labels(&self, _: &[Uuid]) -> Result<Vec<String>, Report> {
        Ok(self.labels.clone())
    }
}

fn viewer() -> MacroUserId<Lowercase<'static>> {
    MacroUserId::parse_from_str("macro|viewer@example.com")
        .unwrap()
        .lowercase()
}

const OWN_LINK: Uuid = Uuid::from_u128(1);
const OTHER_LINK: Uuid = Uuid::from_u128(2);

fn inboxes() -> ViewerInboxes {
    ViewerInboxes {
        link_ids: vec![OWN_LINK],
        user_ids: vec!["macro|viewer@example.com".into()],
    }
}

fn shared(id: u128) -> SharedThread {
    SharedThread {
        thread_id: Uuid::from_u128(id),
        link_id: OTHER_LINK,
    }
}

fn threads(scope: EmailScope) -> EmailThreads {
    match scope {
        EmailScope::Threads(threads) => threads,
        EmailScope::Nothing => panic!("expected threads to search"),
    }
}

fn filters(shared: SharedEmailFilter) -> EmailFilters {
    EmailFilters {
        shared,
        ..Default::default()
    }
}

#[tokio::test]
async fn exclude_searches_only_the_viewers_inboxes() {
    let service = EmailSearchService(Source {
        shared: vec![shared(10)],
        ..Default::default()
    });

    let scope = threads(
        service
            .scope(&viewer(), &filters(SharedEmailFilter::Exclude), &inboxes())
            .await
            .unwrap(),
    );

    assert_eq!(scope.user_ids, vec!["macro|viewer@example.com".to_string()]);
    assert!(scope.thread_ids.is_empty());
    assert!(!scope.ids_only);
    assert!(service.0.shared_requests.lock().unwrap().is_empty());
}

#[tokio::test]
async fn only_searches_shared_threads_and_never_the_viewers_inboxes() {
    let service = EmailSearchService(Source {
        shared: vec![shared(10), shared(11)],
        ..Default::default()
    });

    let scope = threads(
        service
            .scope(&viewer(), &filters(SharedEmailFilter::Only), &inboxes())
            .await
            .unwrap(),
    );

    assert!(scope.ids_only);
    assert!(scope.user_ids.is_empty());
    assert_eq!(
        scope.thread_ids,
        vec![Uuid::from_u128(10), Uuid::from_u128(11)]
    );
}

#[tokio::test]
async fn only_without_shares_searches_no_email() {
    let service = EmailSearchService(Source::default());

    let scope = service
        .scope(&viewer(), &filters(SharedEmailFilter::Only), &inboxes())
        .await
        .unwrap();

    assert_eq!(scope, EmailScope::Nothing);
}

#[tokio::test]
async fn include_adds_shared_threads_to_the_viewers_inboxes() {
    let service = EmailSearchService(Source {
        shared: vec![shared(10)],
        ..Default::default()
    });

    let scope = threads(
        service
            .scope(&viewer(), &filters(SharedEmailFilter::Include), &inboxes())
            .await
            .unwrap(),
    );

    assert!(!scope.ids_only);
    assert_eq!(scope.user_ids, vec!["macro|viewer@example.com".to_string()]);
    assert_eq!(scope.thread_ids, vec![Uuid::from_u128(10)]);
}

#[tokio::test]
async fn calendar_only_becomes_an_allowlist_of_threads_with_an_invitation() {
    let mut source = Source {
        shared: vec![shared(10), shared(11)],
        own_calendar: vec![Uuid::from_u128(20)],
        ..Default::default()
    };
    source.threads.insert(
        Uuid::from_u128(11),
        Thread {
            calendar: true,
            ..Default::default()
        },
    );
    let service = EmailSearchService(source);
    let filters = EmailFilters {
        calendar_only: Some(true),
        shared: SharedEmailFilter::Include,
        is_read: Some(false),
        ..Default::default()
    };

    let scope = threads(
        service
            .scope(&viewer(), &filters, &inboxes())
            .await
            .unwrap(),
    );

    assert!(scope.ids_only);
    assert_eq!(
        scope.thread_ids,
        vec![Uuid::from_u128(20), Uuid::from_u128(11)]
    );
    assert!(!scope.hit_states.calendar_only);
    assert_eq!(scope.hit_states.is_read, Some(false));
}

#[tokio::test]
async fn calendar_only_without_invitations_searches_no_email() {
    let service = EmailSearchService(Source::default());
    let filters = EmailFilters {
        calendar_only: Some(true),
        ..Default::default()
    };

    let scope = service
        .scope(&viewer(), &filters, &inboxes())
        .await
        .unwrap();

    assert_eq!(scope, EmailScope::Nothing);
}

#[tokio::test]
async fn calendar_only_past_the_allowlist_limit_is_checked_hit_by_hit() {
    let service = EmailSearchService(Source {
        own_calendar: (0..=MAX_THREAD_SET_ALLOWLIST as u128)
            .map(|n| Uuid::from_u128(1_000 + n))
            .collect(),
        ..Default::default()
    });
    let filters = EmailFilters {
        calendar_only: Some(true),
        ..Default::default()
    };

    let scope = threads(
        service
            .scope(&viewer(), &filters, &inboxes())
            .await
            .unwrap(),
    );

    assert!(!scope.ids_only);
    assert!(scope.thread_ids.is_empty());
    assert!(scope.hit_states.calendar_only);
}

#[tokio::test]
async fn requested_threads_narrow_the_viewers_inboxes() {
    let service = EmailSearchService(Source::default());
    let filters = EmailFilters {
        email_thread_ids: vec![Uuid::from_u128(30).to_string()],
        ..Default::default()
    };

    let scope = threads(
        service
            .scope(&viewer(), &filters, &inboxes())
            .await
            .unwrap(),
    );

    assert_eq!(scope.required_thread_ids, vec![Uuid::from_u128(30)]);
    assert!(!scope.ids_only);
}

#[tokio::test]
async fn requested_threads_narrow_shared_threads_and_never_add_to_them() {
    let service = EmailSearchService(Source {
        shared: vec![shared(10), shared(11)],
        ..Default::default()
    });
    let filters = EmailFilters {
        shared: SharedEmailFilter::Only,
        email_thread_ids: vec![
            Uuid::from_u128(11).to_string(),
            Uuid::from_u128(99).to_string(),
        ],
        ..Default::default()
    };

    let scope = threads(
        service
            .scope(&viewer(), &filters, &inboxes())
            .await
            .unwrap(),
    );

    assert_eq!(scope.thread_ids, vec![Uuid::from_u128(11)]);
}

#[tokio::test]
async fn malformed_requested_threads_match_nothing() {
    let service = EmailSearchService(Source::default());
    let filters = EmailFilters {
        email_thread_ids: vec!["not-a-thread".into()],
        ..Default::default()
    };

    let scope = service
        .scope(&viewer(), &filters, &inboxes())
        .await
        .unwrap();

    assert_eq!(scope, EmailScope::Nothing);
}

#[test]
fn thread_states_carry_every_thread_level_filter() {
    let states = ThreadStates::from_filters(&EmailFilters {
        is_read: Some(false),
        done: Some(true),
        calendar_only: Some(false),
        notification_filters: NotificationFilters {
            states: vec![
                NotificationState::Unseen,
                NotificationState::Seen,
                NotificationState::Unseen,
            ],
        },
        ..Default::default()
    });

    assert_eq!(
        states,
        ThreadStates {
            is_read: Some(false),
            done: Some(true),
            calendar_only: false,
            notification_states: vec![NotificationState::Unseen, NotificationState::Seen],
            ..Default::default()
        }
    );
    assert!(!states.is_empty());
    assert!(ThreadStates::from_filters(&EmailFilters::default()).is_empty());
}

#[test]
fn thread_states_carry_the_view_and_attachment_kinds() {
    let states = ThreadStates::from_filters(&EmailFilters {
        view: Some(EmailSearchView::Drafts),
        attachments: vec![
            AttachmentKind::Pdf,
            AttachmentKind::Image,
            AttachmentKind::Pdf,
        ],
        ..Default::default()
    });

    assert!(states.has_draft);
    assert!(!states.sent);
    assert_eq!(
        states.attachments,
        vec![AttachmentKind::Pdf, AttachmentKind::Image]
    );
    assert!(!states.is_empty());
    assert!(
        ThreadStates::from_filters(&EmailFilters {
            view: Some(EmailSearchView::Sent),
            ..Default::default()
        })
        .sent
    );
}

#[tokio::test]
async fn sent_becomes_an_allowlist_of_threads_with_a_sent_message() {
    let mut source = Source {
        shared: vec![shared(10), shared(11)],
        own_sent: vec![Uuid::from_u128(20), Uuid::from_u128(21)],
        ..Default::default()
    };
    source.threads.insert(
        Uuid::from_u128(11),
        Thread {
            sent: true,
            ..Default::default()
        },
    );
    let service = EmailSearchService(source);
    let filters = EmailFilters {
        view: Some(EmailSearchView::Sent),
        shared: SharedEmailFilter::Include,
        ..Default::default()
    };

    let scope = threads(
        service
            .scope(&viewer(), &filters, &inboxes())
            .await
            .unwrap(),
    );

    assert!(scope.ids_only);
    assert_eq!(
        scope.thread_ids,
        vec![
            Uuid::from_u128(20),
            Uuid::from_u128(21),
            Uuid::from_u128(11)
        ]
    );
    assert!(scope.hit_states.is_empty());
}

#[tokio::test]
async fn drafts_without_drafts_search_no_email() {
    let service = EmailSearchService(Source {
        own_sent: vec![Uuid::from_u128(20)],
        ..Default::default()
    });
    let filters = EmailFilters {
        view: Some(EmailSearchView::Drafts),
        ..Default::default()
    };

    let scope = service
        .scope(&viewer(), &filters, &inboxes())
        .await
        .unwrap();

    assert_eq!(scope, EmailScope::Nothing);
}

#[tokio::test]
async fn two_thread_sets_search_only_the_threads_in_both() {
    let service = EmailSearchService(Source {
        own_calendar: vec![Uuid::from_u128(20), Uuid::from_u128(21)],
        own_drafts: vec![Uuid::from_u128(21), Uuid::from_u128(22)],
        ..Default::default()
    });
    let filters = EmailFilters {
        calendar_only: Some(true),
        view: Some(EmailSearchView::Drafts),
        ..Default::default()
    };

    let scope = threads(
        service
            .scope(&viewer(), &filters, &inboxes())
            .await
            .unwrap(),
    );

    assert!(scope.ids_only);
    assert_eq!(scope.thread_ids, vec![Uuid::from_u128(21)]);
    assert!(scope.hit_states.is_empty());
}

#[tokio::test]
async fn sent_past_the_allowlist_limit_is_checked_hit_by_hit() {
    let service = EmailSearchService(Source {
        own_sent: (0..=MAX_THREAD_SET_ALLOWLIST as u128)
            .map(|n| Uuid::from_u128(1_000 + n))
            .collect(),
        own_drafts: vec![Uuid::from_u128(5)],
        ..Default::default()
    });
    let filters = EmailFilters {
        view: Some(EmailSearchView::Sent),
        ..Default::default()
    };

    let scope = threads(
        service
            .scope(&viewer(), &filters, &inboxes())
            .await
            .unwrap(),
    );

    assert!(!scope.ids_only);
    assert!(scope.thread_ids.is_empty());
    assert!(scope.hit_states.sent);
}

#[tokio::test]
async fn attachment_kinds_are_checked_hit_by_hit() {
    let service = EmailSearchService(Source::default());
    let filters = EmailFilters {
        attachments: vec![AttachmentKind::Document],
        ..Default::default()
    };

    let scope = threads(
        service
            .scope(&viewer(), &filters, &inboxes())
            .await
            .unwrap(),
    );

    assert!(!scope.ids_only);
    assert_eq!(scope.user_ids, inboxes().user_ids);
    assert_eq!(scope.hit_states.attachments, vec![AttachmentKind::Document]);
}

fn in_folder(id: u128, link: Uuid) -> SharedThread {
    SharedThread {
        thread_id: Uuid::from_u128(id),
        link_id: link,
    }
}

fn folder_source() -> Source {
    Source {
        in_projects: vec![
            (in_folder(30, OWN_LINK), true, false),
            (in_folder(31, OTHER_LINK), false, false),
            (in_folder(32, OTHER_LINK), false, true),
        ],
        own_calendar: vec![Uuid::from_u128(30)],
        ..Default::default()
    }
}

fn folder_filters(shared: SharedEmailFilter) -> EmailFilters {
    EmailFilters {
        project_ids: vec!["folder".into(), "folder".into(), String::new()],
        shared,
        ..Default::default()
    }
}

#[tokio::test]
async fn folders_search_the_threads_the_folder_list_shows() {
    let service = EmailSearchService(folder_source());

    let scope = threads(
        service
            .scope(
                &viewer(),
                &folder_filters(SharedEmailFilter::Exclude),
                &inboxes(),
            )
            .await
            .unwrap(),
    );

    assert!(scope.ids_only);
    assert_eq!(
        scope.thread_ids,
        vec![Uuid::from_u128(30), Uuid::from_u128(31)]
    );
    assert!(scope.user_ids.is_empty());
    assert_eq!(
        service.0.project_requests.lock().unwrap().as_slice(),
        &[(vec!["folder".to_string()], vec![], true, false)]
    );
}

#[tokio::test]
async fn shared_only_folders_leave_out_the_viewers_own_threads() {
    let service = EmailSearchService(folder_source());

    let scope = threads(
        service
            .scope(
                &viewer(),
                &folder_filters(SharedEmailFilter::Only),
                &inboxes(),
            )
            .await
            .unwrap(),
    );

    assert_eq!(
        scope.thread_ids,
        vec![Uuid::from_u128(31), Uuid::from_u128(32)]
    );
    assert_eq!(
        service.0.project_requests.lock().unwrap().as_slice(),
        &[(vec!["folder".to_string()], vec![], false, true)]
    );
}

#[tokio::test]
async fn folders_check_the_other_thread_sets_hit_by_hit() {
    let service = EmailSearchService(folder_source());
    let filters = EmailFilters {
        calendar_only: Some(true),
        view: Some(EmailSearchView::Sent),
        email_thread_ids: vec![Uuid::from_u128(31).to_string()],
        ..folder_filters(SharedEmailFilter::Exclude)
    };

    let scope = threads(
        service
            .scope(&viewer(), &filters, &inboxes())
            .await
            .unwrap(),
    );

    assert_eq!(scope.thread_ids, vec![Uuid::from_u128(31)]);
    assert!(scope.hit_states.calendar_only);
    assert!(scope.hit_states.sent);
}

#[tokio::test]
async fn a_requested_thread_past_the_folder_cap_is_still_searched() {
    let last = (MAX_PROJECT_THREADS + 1) as u128;
    let service = EmailSearchService(Source {
        in_projects: (1..=last)
            .map(|n| (in_folder(n, OTHER_LINK), false, false))
            .collect(),
        ..Default::default()
    });
    let filters = EmailFilters {
        email_thread_ids: vec![Uuid::from_u128(last).to_string()],
        ..folder_filters(SharedEmailFilter::Exclude)
    };

    let scope = threads(
        service
            .scope(&viewer(), &filters, &inboxes())
            .await
            .unwrap(),
    );

    assert_eq!(scope.thread_ids, vec![Uuid::from_u128(last)]);
    assert_eq!(
        service.0.project_requests.lock().unwrap().as_slice(),
        &[(
            vec!["folder".to_string()],
            vec![Uuid::from_u128(last)],
            true,
            false
        )]
    );
}

#[tokio::test]
async fn a_folder_the_viewer_reaches_nothing_in_searches_no_email() {
    let service = EmailSearchService(Source::default());

    let scope = service
        .scope(
            &viewer(),
            &folder_filters(SharedEmailFilter::Exclude),
            &inboxes(),
        )
        .await
        .unwrap();

    assert_eq!(scope, EmailScope::Nothing);
}

#[tokio::test]
async fn folders_past_the_limit_are_marked_capped() {
    let service = EmailSearchService(Source {
        in_projects: (0..MAX_PROJECT_THREADS as u128)
            .map(|n| (in_folder(1_000 + n, OTHER_LINK), false, false))
            .collect(),
        ..Default::default()
    });

    let scope = threads(
        service
            .scope(
                &viewer(),
                &folder_filters(SharedEmailFilter::Exclude),
                &inboxes(),
            )
            .await
            .unwrap(),
    );

    assert!(scope.project_capped);
    assert_eq!(scope.thread_ids.len(), MAX_PROJECT_THREADS);
}

#[tokio::test]
async fn shared_among_reads_threads_shared_through_their_folder() {
    let service = EmailSearchService(Source {
        shared: vec![shared(10)],
        project_shared: vec![in_folder(31, OTHER_LINK)],
        ..Default::default()
    });

    let shared = service
        .shared_among(
            &viewer(),
            &[OWN_LINK],
            &[
                Uuid::from_u128(10),
                Uuid::from_u128(31),
                Uuid::from_u128(99),
            ],
        )
        .await
        .unwrap();

    assert_eq!(
        shared
            .iter()
            .map(|thread| thread.thread_id)
            .collect::<Vec<_>>(),
        vec![Uuid::from_u128(10), Uuid::from_u128(31)]
    );
}

#[tokio::test]
async fn favorites_narrow_the_search_by_id() {
    let favorite = Uuid::from_u128(30);
    let named = Uuid::from_u128(31);
    let source = Source {
        favorites: vec![favorite, named],
        ..Source::default()
    };
    let service = EmailSearchService(source);

    let starred = EmailFilters {
        favorite: Some(true),
        ..EmailFilters::default()
    };
    let scope = threads(
        service
            .scope(&viewer(), &starred, &inboxes())
            .await
            .unwrap(),
    );
    assert_eq!(scope.required_thread_ids, vec![favorite, named]);
    assert_eq!(scope.user_ids, inboxes().user_ids);

    let starred_and_named = EmailFilters {
        favorite: Some(true),
        email_thread_ids: vec![named.to_string(), Uuid::from_u128(32).to_string()],
        ..EmailFilters::default()
    };
    let scope = threads(
        service
            .scope(&viewer(), &starred_and_named, &inboxes())
            .await
            .unwrap(),
    );
    assert_eq!(scope.required_thread_ids, vec![named]);
}

#[tokio::test]
async fn no_favorites_match_nothing_and_leaving_them_out_excludes_them() {
    let service = EmailSearchService(Source::default());
    let starred = EmailFilters {
        favorite: Some(true),
        ..EmailFilters::default()
    };
    assert_eq!(
        service
            .scope(&viewer(), &starred, &inboxes())
            .await
            .unwrap(),
        EmailScope::Nothing
    );

    let favorite = Uuid::from_u128(33);
    let service = EmailSearchService(Source {
        favorites: vec![favorite],
        ..Source::default()
    });
    let not_starred = EmailFilters {
        favorite: Some(false),
        ..EmailFilters::default()
    };
    let scope = threads(
        service
            .scope(&viewer(), &not_starred, &inboxes())
            .await
            .unwrap(),
    );
    assert_eq!(scope.excluded_thread_ids, vec![favorite]);
    assert!(scope.required_thread_ids.is_empty());
}

#[tokio::test]
async fn a_label_name_matches_tags_and_inbox_labels_ignoring_case() {
    let travel = Uuid::from_u128(40);
    let source = Source {
        tags: vec![
            TagOption {
                label: "Travel".to_string(),
                option_id: travel,
            },
            TagOption {
                label: "Work".to_string(),
                option_id: Uuid::from_u128(41),
            },
        ],
        labels: vec!["TRAVEL".to_string(), "Receipts".to_string()],
        ..Source::default()
    };
    let service = EmailSearchService(source);
    let filters = EmailFilters {
        label_names: vec![
            EmailLabelMatch {
                name: "travel".to_string(),
                exclude: false,
            },
            EmailLabelMatch {
                name: "receipts".to_string(),
                exclude: true,
            },
            EmailLabelMatch {
                name: "nothing by this name".to_string(),
                exclude: true,
            },
        ],
        ..EmailFilters::default()
    };

    let scope = threads(
        service
            .scope(&viewer(), &filters, &inboxes())
            .await
            .unwrap(),
    );

    assert_eq!(
        scope.label_conditions,
        vec![
            LabelCondition {
                labels: vec!["TRAVEL".to_string()],
                tag_option_ids: vec![travel],
                exclude: false,
            },
            LabelCondition {
                labels: vec!["Receipts".to_string()],
                tag_option_ids: Vec::new(),
                exclude: true,
            },
        ]
    );
}

#[tokio::test]
async fn a_label_that_names_nothing_matches_nothing() {
    let service = EmailSearchService(Source::default());
    let filters = EmailFilters {
        label_names: vec![EmailLabelMatch {
            name: "travel".to_string(),
            exclude: false,
        }],
        ..EmailFilters::default()
    };

    assert_eq!(
        service
            .scope(&viewer(), &filters, &inboxes())
            .await
            .unwrap(),
        EmailScope::Nothing
    );
}

#[tokio::test]
async fn a_left_out_view_excludes_its_threads_or_checks_each_page() {
    let sent = Uuid::from_u128(50);
    let source = Source {
        own_sent: vec![sent],
        own_drafts: (0..=MAX_THREAD_SET_ALLOWLIST as u128)
            .map(|id| Uuid::from_u128(1_000 + id))
            .collect(),
        ..Source::default()
    };
    let service = EmailSearchService(source);
    let filters = EmailFilters {
        exclude_views: vec![EmailSearchView::Sent, EmailSearchView::Drafts],
        ..EmailFilters::default()
    };

    let scope = threads(
        service
            .scope(&viewer(), &filters, &inboxes())
            .await
            .unwrap(),
    );

    assert_eq!(scope.excluded_thread_ids, vec![sent]);
    assert_eq!(
        scope.hit_states.excluded,
        vec![ThreadStates {
            has_draft: true,
            ..ThreadStates::default()
        }]
    );
}

#[tokio::test]
async fn page_checks_drop_threads_that_meet_an_exclusion() {
    let with_attachment = Uuid::from_u128(60);
    let unread_with_attachment = Uuid::from_u128(61);
    let unread = Uuid::from_u128(62);
    let source = Source {
        threads: HashMap::from([
            (
                with_attachment,
                Thread {
                    read: true,
                    attachment: true,
                    ..Thread::default()
                },
            ),
            (
                unread_with_attachment,
                Thread {
                    attachment: true,
                    ..Thread::default()
                },
            ),
            (unread, Thread::default()),
        ]),
        ..Source::default()
    };
    let service = EmailSearchService(source);
    let page = [with_attachment, unread_with_attachment, unread];

    let without_attachment = ThreadStates::from_filters(&EmailFilters {
        has_attachment: Some(false),
        ..EmailFilters::default()
    });
    assert_eq!(
        service
            .matching_threads(&viewer(), &page, &without_attachment)
            .await
            .unwrap(),
        HashSet::from([unread])
    );

    let unread_with = ThreadStates::from_filters(&EmailFilters {
        is_read: Some(false),
        has_attachment: Some(true),
        ..EmailFilters::default()
    });
    assert_eq!(
        service
            .matching_threads(&viewer(), &page, &unread_with)
            .await
            .unwrap(),
        HashSet::from([unread_with_attachment])
    );
}

#[test]
fn an_attachment_kind_already_means_an_attachment() {
    let states = ThreadStates::from_filters(&EmailFilters {
        has_attachment: Some(true),
        attachments: vec![AttachmentKind::Pdf],
        ..EmailFilters::default()
    });

    assert!(!states.has_attachment);
    assert_eq!(states.attachments, vec![AttachmentKind::Pdf]);
}

#[test]
fn the_calendar_view_is_the_calendar_only_filter() {
    let states = ThreadStates::from_filters(&EmailFilters {
        view: Some(EmailSearchView::Calendar),
        ..EmailFilters::default()
    });

    assert!(states.calendar_only);
}
