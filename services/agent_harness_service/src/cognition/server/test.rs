use import::domain::models::ImportSource;
use strum::IntoEnumIterator;

use super::importable_apps;

/// The connectors listing shows a flagged import under the same key its
/// rollout reads (`ImportSource::rollout_flag`). The web cannot share the
/// constant: its `defineFlag` for the same key is in
/// `apps/web/src/lib/core/constant/featureFlags.ts` (`enableAttioImport`).
#[test]
fn every_flagged_import_is_listed_under_its_rollout_flag() {
    let importable = importable_apps().unwrap();

    for source in ImportSource::iter() {
        let app = source.connector().unwrap();
        assert_eq!(importable.flag(&app), source.rollout_flag(), "{source:?}");
    }
}
