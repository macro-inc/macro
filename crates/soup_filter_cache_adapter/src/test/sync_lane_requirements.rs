//! The streamed sync's server declares what this cache requires of each lane
//! query's pages (`soup_sync_stream::LANE_QUERIES`), and the cache chooses
//! those requirements by operation name. A renamed lane operation, or a change
//! to [`backfill_requirements`], must change both sides together.

use super::*;

#[test]
fn every_lane_query_gets_the_requirements_it_declares() {
    for query in soup_sync_stream::LANE_QUERIES {
        assert_eq!(
            backfill_requirements(Some(query.operation)),
            BackfillRequirements {
                complete_projections: query.complete_projections,
                complete_properties: query.complete_properties,
            },
            "{}",
            query.operation
        );
    }
}
