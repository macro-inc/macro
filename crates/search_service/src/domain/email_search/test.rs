use super::*;
use item_filters::NotificationFilters;
use std::collections::HashMap;
use std::sync::Mutex;

#[derive(Clone, Copy, Default)]
struct Thread {
    read: bool,
    done: bool,
    calendar: bool,
}

#[derive(Default)]
struct Source {
    shared: Vec<SharedThread>,
    own_calendar: Vec<Uuid>,
    threads: HashMap<Uuid, Thread>,
    shared_requests: Mutex<Vec<Vec<Uuid>>>,
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

    async fn calendar_threads(&self, _: &[Uuid], limit: usize) -> Result<Vec<Uuid>, Report> {
        Ok(self.own_calendar.iter().take(limit).copied().collect())
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
            })
            .copied()
            .collect())
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
        own_calendar: (0..=MAX_CALENDAR_ALLOWLIST as u128)
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
        }
    );
    assert!(!states.is_empty());
    assert!(ThreadStates::from_filters(&EmailFilters::default()).is_empty());
}
