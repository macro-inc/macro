//! A message still queued for sending whose server copy the device already has.

use cache_core::channel_timeline::{ChannelTimelineCommit, TIMELINE_HEAD, TIMELINE_START};
use cache_core::engine::{BeginOptimisticWrite, Engine, InitialClaimOutcome};
use cache_core::meta::bundled_schema;
use cache_core::queue::{MutationClaimRequest, MutationClaimToken};
use cache_core::record_selection::RecordSelection;
use cache_core::store::InMemoryStorage;
use pollster::block_on;
use serde_json::{Value, json};

#[path = "support/channels.rs"]
#[expect(dead_code, reason = "the commit tests use the rest")]
mod channels;
use channels::{
    TestEngine, changes, coverage, key, latest, listed, message, page, saying, with_preview,
    write_page, write_undated,
};

const SENT: &str = "11111111-1111-4111-8111-111111111111";
const EDIT: &str = "22222222-2222-4222-8222-222222222222";
const REPLY: &str = "33333333-3333-4333-8333-333333333333";
/// Past every position the server gives.
const UNPLACED: &str = "90";
const FIELDS: &str = "__typename id channelId sortKey threadId deletedAt content";

fn root(id: &str, sort_key: &str) -> Value {
    message("c1", id, sort_key, None)
}

fn reply(id: &str, sort_key: &str, root: &str) -> Value {
    message("c1", id, sort_key, Some(root))
}

/// A reply as a preview selects it.
fn previewed(mut reply: Value) -> Value {
    reply.as_object_mut().unwrap().remove("thread");
    reply
}

/// The message as this device predicts it: last, with no replies.
fn predicted() -> Value {
    with_preview(saying(root(SENT, UNPLACED), "sent"), &[])
}

/// The server's copy, replied to since.
fn placed() -> Value {
    with_preview(
        saying(root(SENT, "20"), "sent"),
        &[previewed(reply("r1", "~21", SENT))],
    )
}

fn whole(seq: &str) -> ChannelTimelineCommit {
    page(
        "c1",
        seq,
        vec![coverage(None, TIMELINE_START, TIMELINE_HEAD)],
    )
}

/// The channel with one message, m1, read whole at sequence 10.
async fn held() -> TestEngine {
    let mut engine = Engine::new(InMemoryStorage::new());
    push(&mut engine, "10", &[root("m1", "10")], &whole("10")).await;
    engine
}

async fn push(
    engine: &mut TestEngine,
    seq: &str,
    entries: &[Value],
    commit: &ChannelTimelineCommit,
) {
    write_page(engine, "c1", seq, entries, Some(commit))
        .await
        .unwrap();
}

/// The server's copy and m3, sent after it.
async fn push_placed(engine: &mut TestEngine) {
    let entries = [root("m3", "30"), placed(), reply("r1", "~21", SENT)];
    push(engine, "13", &entries, &changes("c1", "10", "13")).await;
}

async fn queue(
    engine: &mut TestEngine,
    uuid: &str,
    field: &str,
    root: Option<&Value>,
    message: &Value,
) -> Option<(u64, MutationClaimToken)> {
    let shape =
        format!("{FIELDS} thread {{ __typename deletedAt replyCount preview {{ {FIELDS} }} }}");
    let query = format!(
        "mutation Write($input: Input!) {{ {field}(input: $input) {{ __typename seq \
         root {{ {shape} }} message {{ {shape} }} }} }}"
    );
    let data = json!({ field: {
        "__typename": "GraphqlChannelMessageWrite",
        "seq": "0", "root": root, "message": message,
    }});
    enqueue(engine, uuid, &query, &data).await
}

async fn enqueue(
    engine: &mut TestEngine,
    uuid: &str,
    query: &str,
    data: &Value,
) -> Option<(u64, MutationClaimToken)> {
    let queued = engine
        .enqueue_optimistic_mutation(
            None,
            BeginOptimisticWrite {
                client_metadata: None,
                uuid,
                query,
                operation_name: None,
                variables: json!({ "input": { "id": uuid } }).as_object().unwrap(),
                data,
                link_patches: &[],
                revalidations: &[],
                created_at_ms: 0,
                identity_bindings: &[],
            },
            MutationClaimRequest {
                owner: "runner".into(),
                now_ms: 0,
                lease_expires_at_ms: 100,
            },
        )
        .await
        .unwrap();
    let InitialClaimOutcome::Claimed(claimed) = queued.initial_claim else {
        return None;
    };
    let generation = claimed.lease_generation;
    Some((
        queued.transaction_id,
        MutationClaimToken {
            owner: "runner".into(),
            generation,
        },
    ))
}

async fn queue_send(engine: &mut TestEngine) -> (u64, MutationClaimToken) {
    queue(engine, SENT, "sendChannelMessage", None, &predicted())
        .await
        .expect("the only queued mutation is claimable")
}

/// A root as the device shows it.
async fn shown(engine: &mut TestEngine, id: &str) -> Value {
    let fragment = format!(
        "fragment Shown on GraphqlChannelMessage {{ {FIELDS} thread {{ __typename deletedAt \
         replyCount preview {{ {FIELDS} }} }} }}"
    );
    let selection = RecordSelection::parse(&bundled_schema(), &fragment, "Shown").unwrap();
    let read = engine.read_records_by_keys(&selection, &[key(id)]).await;
    read.unwrap().value.remove(0).record
}

async fn timeline(engine: &mut TestEngine) -> Vec<String> {
    listed(engine, &latest("c1", 100)).await.unwrap()
}

#[test]
fn a_queued_send_shows_as_the_server_has_it_once_the_device_does() {
    block_on(async {
        let mut engine = held().await;
        let (transaction, claim) = queue_send(&mut engine).await;
        assert_eq!(timeline(&mut engine).await, [SENT, "m1"]);

        push_placed(&mut engine).await;
        assert_eq!(shown(&mut engine, SENT).await, placed());
        assert_eq!(timeline(&mut engine).await, ["m3", SENT, "m1"]);

        // As a device that opens the queue again has it.
        engine.refresh_optimistic_queue().await.unwrap();
        assert_eq!(shown(&mut engine, SENT).await, placed());

        engine
            .rollback_optimistic_write(transaction, claim)
            .await
            .unwrap();
        assert_eq!(shown(&mut engine, SENT).await, placed());
    });
}

#[test]
fn what_is_queued_after_the_send_still_shows_over_the_servers_copy() {
    block_on(async {
        let mut engine = held().await;
        queue_send(&mut engine).await;
        let edited = saying(predicted(), "edited");
        queue(&mut engine, EDIT, "editChannelMessage", None, &edited).await;

        push_placed(&mut engine).await;
        assert_eq!(shown(&mut engine, SENT).await, saying(placed(), "edited"));
        assert_eq!(timeline(&mut engine).await, ["m3", SENT, "m1"]);
    });
}

#[test]
fn a_queued_reply_still_shows_on_a_queued_root() {
    block_on(async {
        let mut engine = held().await;
        queue_send(&mut engine).await;
        let own = reply(REPLY, "~91", SENT);
        let replied = with_preview(
            saying(root(SENT, UNPLACED), "sent"),
            &[previewed(own.clone())],
        );
        queue(
            &mut engine,
            REPLY,
            "sendChannelMessage",
            Some(&replied),
            &own,
        )
        .await;

        let unanswered = with_preview(saying(root(SENT, "20"), "sent"), &[]);
        push(&mut engine, "11", &[unanswered], &changes("c1", "10", "11")).await;
        let shown = shown(&mut engine, SENT).await;
        assert_eq!(shown["sortKey"], "20");
        assert_eq!(shown["thread"], replied["thread"]);
    });
}

#[test]
fn a_copy_that_lacks_fields_leaves_the_queued_send_shown() {
    block_on(async {
        let mut engine = held().await;
        queue_send(&mut engine).await;
        write_undated(&mut engine, &root(SENT, "20")).await;
        assert_eq!(timeline(&mut engine).await, [SENT, "m1"]);
    });
}

#[test]
fn a_copy_without_a_sequence_leaves_the_queued_send_listed() {
    block_on(async {
        let mut engine = held().await;
        // Predicts no more than the undated read selects.
        let copy = |sort_key| {
            let mut copy = saying(root(SENT, sort_key), "sent");
            copy.as_object_mut().unwrap().remove("thread");
            copy
        };
        let query = format!(
            "mutation Write($input: Input!) {{ sendChannelMessage(input: $input) {{ __typename \
             seq message {{ {FIELDS} }} }} }}"
        );
        enqueue(
            &mut engine,
            SENT,
            &query,
            &json!({ "sendChannelMessage": {
                "__typename": "GraphqlChannelMessageWrite",
                "seq": "0", "message": copy(UNPLACED),
            }}),
        )
        .await;
        write_undated(&mut engine, &copy("20")).await;
        assert_eq!(timeline(&mut engine).await, [SENT, "m1"]);

        // Dated, it takes its place.
        push_placed(&mut engine).await;
        assert_eq!(timeline(&mut engine).await, ["m3", SENT, "m1"]);
        engine.refresh_optimistic_queue().await.unwrap();
        assert_eq!(timeline(&mut engine).await, ["m3", SENT, "m1"]);
    });
}

#[test]
fn a_root_shows_the_servers_replies_once_the_device_has_a_queued_one() {
    block_on(async {
        let mut engine = held().await;
        let replied = |replies: &[Value]| {
            let previews = replies.iter().cloned().map(previewed).collect::<Vec<_>>();
            with_preview(root("m1", "10"), &previews)
        };
        push(
            &mut engine,
            "11",
            &[replied(&[])],
            &changes("c1", "10", "11"),
        )
        .await;
        let own = reply(REPLY, "~91", "m1");
        let predicted = replied(std::slice::from_ref(&own));
        queue(
            &mut engine,
            REPLY,
            "sendChannelMessage",
            Some(&predicted),
            &own,
        )
        .await;

        // Somebody else's, while this one is still on its way.
        let other = reply("r2", "~21", "m1");
        let answered = replied(std::slice::from_ref(&other));
        let entries = [answered, other.clone()];
        push(&mut engine, "12", &entries, &changes("c1", "11", "12")).await;
        assert_eq!(
            shown(&mut engine, "m1").await["thread"],
            predicted["thread"]
        );

        // The reply itself, before its root: no copy counts both yet.
        let placed = reply(REPLY, "~22", "m1");
        let entries = std::slice::from_ref(&placed);
        push(&mut engine, "13", entries, &changes("c1", "12", "13")).await;
        let thread = &shown(&mut engine, "m1").await["thread"];
        assert_eq!(thread["replyCount"], 1);
        assert_eq!(thread["preview"][0]["id"], REPLY);

        let both = replied(&[other, placed]);
        let entries = std::slice::from_ref(&both);
        push(&mut engine, "14", entries, &changes("c1", "13", "14")).await;
        assert_eq!(shown(&mut engine, "m1").await["thread"], both["thread"]);
        engine.refresh_optimistic_queue().await.unwrap();
        assert_eq!(shown(&mut engine, "m1").await["thread"], both["thread"]);
    });
}
