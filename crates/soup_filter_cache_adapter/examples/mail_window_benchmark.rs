//! Measures the shared Mail page owner over real Turso storage and emits browser fixtures.
use cache_core::engine::{Engine, NetworkWrite};
use predicate_index::RecordKey;
use serde_json::{Value, json};
use soup_filter_cache_adapter::mail::{PageRequest, PageResult, page_current};
use soup_filter_projection::{
    MailCacheProjectionFacts, SoupCacheProjectionSupplement, encode_cache_projection_supplement,
};
use std::time::Instant;

const VIEWER: &str = "benchmark-viewer";
const QUERY: &str = include_str!("mail_window_benchmark.graphql");
const ROWS: u128 = 2_000;
fn id(value: u128) -> String {
    uuid::Uuid::from_u128(value).to_string()
}
fn main() -> Result<(), Box<dyn std::error::Error>> {
    pollster::block_on(run())
}
async fn run() -> Result<(), Box<dyn std::error::Error>> {
    let items = (1..=ROWS).map(|n| {
        let key = RecordKey::new(format!("GraphqlSoupEmailThread:{}", id(n)))?;
        let capsule = encode_cache_projection_supplement(&SoupCacheProjectionSupplement::mail(
            key, MailCacheProjectionFacts::new(Some(1_735_862_400_000_000 + n as i64), None, false, false),
        ))?;
        Ok(json!({
            "__typename":"GraphqlSoupEmailThread", "id":id(n), "name":format!("Row {n}"),
            "cacheProjection":capsule, "ownerId":VIEWER, "linkId":id(100_000),
            "isRead":false,"inboxVisible":true,"isSignal":true,"isFavorited":false,
            "latestInboundMessageTs":"2025-01-03T00:00:00Z", "reminderReturnedAt":null,
            "updatedAt":"2025-01-03T00:00:00Z", "properties":[],
            "mailAllPreview":{"id":id(200_000+n), "subject":format!("Row {n}"),
              "snippet":"Benchmark preview", "isDraft":false, "senderEmail":null,
              "senderName":null,"senderPhotoUrl":null}, "mailDraftPreview":null,"mailSentPreview":null
        }))
    }).collect::<Result<Vec<Value>, Box<dyn std::error::Error>>>()?;
    let data =
        json!({"user":{"id":VIEWER,"emailLinks":[{"id":id(100_000)}],"soup":{"items":items}}});
    let nil = id(0);
    let filters = json!({"documentFilter":{"literal":{"id":nil}},"projectFilter":{"literal":{"projectIdSelf":nil}},"chatFilter":{"literal":{"chatId":nil}},"calendarEventFilter":{"literal":{"id":nil}},"channelFilter":{"literal":{"channelId":nil}},"channelThreadFilter":{"literal":{"threadId":nil}},"callFilter":{"literal":{"callId":nil}},"crmCompanyFilter":{"literal":{"id":nil}},"foreignEntityFilter":{"literal":{"id":nil}}});
    if let Some(path) = std::env::var_os("SOUP_BENCHMARK_FIXTURE") {
        std::fs::write(
            path,
            serde_json::to_vec(&json!({"query":QUERY,"data":data,"filters":filters}))?,
        )?;
    }
    let mut engine = Engine::new(cache_turso::TursoStorage::open_in_memory(
        "mail-window-benchmark",
    )?);
    let variables = serde_json::Map::new();
    let projections = soup_filter_cache_adapter::mail::projection_updates(
        cache_core::meta::bundled_schema_ref(),
        engine.storage(),
        QUERY,
        None,
        &variables,
        &data,
    )
    .await?;
    let projections = soup_filter_cache_adapter::properties::augment_authoritative(
        cache_core::meta::bundled_schema_ref(),
        engine.storage(),
        QUERY,
        None,
        &variables,
        &data,
        true,
        projections,
    )
    .await?;
    engine
        .write_query_with_registration_and_projections(
            None,
            None,
            NetworkWrite {
                query: QUERY,
                operation_name: None,
                variables: &variables,
                data: &data,
                identity: Some(VIEWER),
            },
            projections,
        )
        .await?;
    for size in [20, 100, 499] {
        let first = page_current(
            &mut engine,
            "benchmark",
            filters.clone(),
            "UPDATED_AT",
            "DESC",
            size,
            PageRequest {
                view: "ALL".into(),
                cursor: None,
                through: None,
            },
            &[],
        )
        .await?;
        let PageResult::MailPage {
            end_cursor: Some(edge),
            ..
        } = first
        else {
            return Err("missing first page".into());
        };
        let mut timings = Vec::new();
        for _ in 0..21 {
            let started = Instant::now();
            let result = page_current(
                &mut engine,
                "benchmark",
                filters.clone(),
                "UPDATED_AT",
                "DESC",
                size,
                PageRequest {
                    view: "ALL".into(),
                    cursor: None,
                    through: Some(edge.clone()),
                },
                &[],
            )
            .await?;
            let PageResult::MailPage { keys, .. } = result else {
                return Err("missing window".into());
            };
            if keys.len() != usize::from(size) {
                return Err("incorrect window size".into());
            }
            timings.push(started.elapsed().as_secs_f64() * 1000.0);
        }
        timings.remove(0);
        timings.sort_by(f64::total_cmp);
        println!(
            "{}",
            json!({"rows":ROWS,"window":size,"median_ms":timings[10],"p95_ms":timings[18]})
        );
    }
    Ok(())
}
