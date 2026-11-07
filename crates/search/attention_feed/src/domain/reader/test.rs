use item_filters::ast::EntityFilterAst;

use super::*;
use crate::{domain::models::FeedNotification, test_support::*};

const CHANNEL: u128 = 0xC0;
const THREAD: u128 = 0x70;

type Reader = FeedReader<FakeSource<u32>, FakeNotifications>;

fn reader(candidates: Vec<Candidate<u32>>, notifications: Vec<FeedNotification>) -> Reader {
    FeedReader::new(
        FakeSource::with(candidates),
        FakeNotifications::with(notifications),
    )
}

fn request(keying: CandidateKeying, limit: u16) -> CandidateRequest {
    CandidateRequest {
        viewer: viewer(),
        keying,
        own_work: true,
        types: Vec::new(),
        filter: EntityFilterAst::default(),
        limit,
        after: None,
        only: None,
    }
}

/// Documents labelled by their id, newest first: document `n` sorts at
/// minute `n`.
fn documents(ids: impl IntoIterator<Item = u32>) -> Vec<Candidate<u32>> {
    ids.into_iter()
        .map(|n| {
            candidate(
                n,
                entity(EntityType::Document, u128::from(n)),
                Some(n),
                None,
            )
        })
        .collect()
}

#[tokio::test]
async fn a_page_refills_after_dropped_candidates() {
    let reader = reader(documents((1..=9).rev()), Vec::new());
    // Keep even documents only, two per page of candidates.
    let page = reader
        .page(request(CandidateKeying::FiledEntity, 2), |loaded| {
            (loaded.candidate.entity % 2 == 0).then_some(loaded.candidate.entity)
        })
        .await
        .unwrap();
    assert_eq!(page.entries, vec![8, 6]);
    // The cursor sits just past the last candidate walked, kept or dropped.
    let next = page.next.unwrap();
    assert_eq!(next.entity_id, uuid(6).to_string());

    let mut second = request(CandidateKeying::FiledEntity, 2);
    second.after = Some(next);
    let page = reader
        .page(second, |loaded| {
            (loaded.candidate.entity % 2 == 0).then_some(loaded.candidate.entity)
        })
        .await
        .unwrap();
    assert_eq!(page.entries, vec![4, 2]);
}

#[tokio::test]
async fn a_full_page_stops_mid_candidate_page() {
    let reader = reader(documents((1..=6).rev()), Vec::new());
    let page = reader
        .page(request(CandidateKeying::FiledEntity, 4), |loaded| {
            (loaded.candidate.entity != 5).then_some(loaded.candidate.entity)
        })
        .await
        .unwrap();
    assert_eq!(page.entries, vec![6, 4, 3, 2]);
    assert_eq!(page.next.unwrap().entity_id, uuid(2).to_string());
}

#[tokio::test]
async fn refilling_is_bounded() {
    let candidates = documents((1..=20).rev());
    let reader = reader(candidates, Vec::new());
    let page = reader
        .page(request(CandidateKeying::FiledEntity, 2), |_| None::<u32>)
        .await
        .unwrap();
    assert!(page.entries.is_empty());
    assert_eq!(
        reader.source.requests.lock().unwrap().len(),
        MAX_FILL_ROUNDS
    );
    // The next page resumes after everything walked.
    assert_eq!(page.next.unwrap().entity_id, uuid(13).to_string());
}

#[tokio::test]
async fn an_exhausted_feed_has_no_cursor() {
    let reader = reader(documents([3, 2, 1]), Vec::new());
    let page = reader
        .page(request(CandidateKeying::FiledEntity, 5), |loaded| {
            Some(loaded.candidate.entity)
        })
        .await
        .unwrap();
    assert_eq!(page.entries, vec![3, 2, 1]);
    assert!(page.next.is_none());
}

fn thread_candidate() -> Candidate<u32> {
    let mut thread = candidate(1, entity(EntityType::ChannelMessage, THREAD), Some(6), None);
    thread.facts.thread_channel = Some(uuid(CHANNEL));
    thread
}

#[tokio::test]
async fn thread_scoped_threads_read_their_channel_once() {
    let reader = reader(
        vec![
            thread_candidate(),
            candidate(2, entity(EntityType::Channel, CHANNEL), Some(5), None),
        ],
        vec![
            channel_reply(1, CHANNEL, THREAD, 0x71, 6),
            channel_send(2, CHANNEL, 0x72, 5),
        ],
    );
    let page = reader
        .page(request(CandidateKeying::ThreadScoped, 10), |loaded| {
            Some(ids(&loaded.notifications))
        })
        .await
        .unwrap();
    // Both read the channel's notifications, newest first; each feed scopes
    // them itself.
    assert_eq!(
        page.entries,
        vec![vec![uuid(1), uuid(2)], vec![uuid(1), uuid(2)]]
    );
    let loads = reader.notifications.loads.lock().unwrap();
    assert_eq!(
        *loads,
        vec![vec![entity(EntityType::Channel, CHANNEL)]],
        "one load, one source"
    );
}

#[tokio::test]
async fn filed_entity_candidates_read_their_own_notifications() {
    let reader = reader(
        vec![thread_candidate()],
        vec![channel_reply(1, CHANNEL, THREAD, 0x71, 6)],
    );
    let page = reader
        .page(request(CandidateKeying::FiledEntity, 10), |loaded| {
            Some(ids(&loaded.notifications))
        })
        .await
        .unwrap();
    assert_eq!(page.entries, vec![Vec::<uuid::Uuid>::new()]);
    assert_eq!(
        *reader.notifications.loads.lock().unwrap(),
        vec![vec![entity(EntityType::ChannelMessage, THREAD)]]
    );
}

#[tokio::test]
async fn current_returns_only_admitted_keys() {
    let reader = reader(documents([3, 2]), vec![doc_comment(1, 3, 0xA0, 0xA0, 3)]);
    let keys = [
        FeedKey::new(entity(EntityType::Document, 3)),
        FeedKey::new(entity(EntityType::Document, 9)),
    ];
    let current = reader
        .current(request(CandidateKeying::FiledEntity, 50), &keys)
        .await
        .unwrap();
    assert_eq!(current.len(), 1);
    assert_eq!(ids(&current[&keys[0]].notifications), vec![uuid(1)]);
    let requests = reader.source.requests.lock().unwrap();
    assert_eq!(
        requests[0].only.as_deref(),
        Some(&[keys[0].entity().clone(), keys[1].entity().clone()][..])
    );
    assert_eq!(requests[0].limit, 2);
    assert!(requests[0].after.is_none());
}

#[tokio::test]
async fn current_reads_large_key_sets_in_chunks() {
    let reader = reader(Vec::new(), Vec::new());
    let keys: Vec<_> = (0..450u128)
        .map(|n| FeedKey::new(entity(EntityType::Document, n)))
        .collect();
    reader
        .current(request(CandidateKeying::FiledEntity, 50), &keys)
        .await
        .unwrap();
    let sizes: Vec<_> = reader
        .source
        .requests
        .lock()
        .unwrap()
        .iter()
        .map(|request| request.only.as_ref().unwrap().len())
        .collect();
    assert_eq!(sizes, vec![200, 200, 50]);
}
