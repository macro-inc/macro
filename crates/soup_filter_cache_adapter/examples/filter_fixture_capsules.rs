//! Generates server-only document capsules for native filter-selection fixtures.
//! Reads JSON fixture descriptors from stdin; never writes to a cache/database.
use serde::Deserialize;
use soup_filter_projection::{SoupCacheProjectionSupplement, encode_cache_projection_supplement};
use std::io::Read;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fixture {
    id: String,
    is_email_attachment: bool,
    status_option_ids: Vec<uuid::Uuid>,
}
fn main() {
    let mut input = String::new();
    std::io::stdin()
        .read_to_string(&mut input)
        .expect("read fixture descriptions");
    let fixtures: Vec<Fixture> = serde_json::from_str(&input).expect("valid fixture descriptions");
    let capsules: std::collections::BTreeMap<_, _> = fixtures
        .into_iter()
        .map(|fixture| {
            let key =
                predicate_index::RecordKey::new(format!("GraphqlSoupDocument:{}", fixture.id))
                    .expect("fixture key");
            let encoded =
                encode_cache_projection_supplement(&SoupCacheProjectionSupplement::document(
                    key,
                    fixture.is_email_attachment,
                    true,
                    fixture.status_option_ids,
                ))
                .expect("encode canonical document capsule");
            (fixture.id, encoded)
        })
        .collect();
    println!(
        "{}",
        serde_json::to_string_pretty(&capsules).expect("serialize capsules")
    );
}
