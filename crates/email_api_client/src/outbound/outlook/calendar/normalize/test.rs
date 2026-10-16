use super::*;
use crate::outbound::outlook::calendar::test::{event, target};

fn exception() -> Value {
    let mut value = event("exception");
    value["type"] = json!("exception");
    value["originalStart"] = json!("2026-11-02T17:00:00Z");
    value
}

#[test]
fn sensitivity_maps_consistently_for_series_and_exceptions() {
    for (sensitivity, expected) in [
        ("normal", EventVisibility::Default),
        ("personal", EventVisibility::Private),
        ("private", EventVisibility::Private),
        ("confidential", EventVisibility::Confidential),
    ] {
        let mut master = event("series");
        master["sensitivity"] = json!(sensitivity);
        let series = projection(&target(), master.clone(), vec![]).unwrap();
        assert_eq!(series.event.visibility, expected);

        // Explicit normal must replace a private series; private exceptions
        // must retain their privacy even when the series is not private.
        master["sensitivity"] = if expected == EventVisibility::Default {
            json!("private")
        } else {
            json!("normal")
        };
        let mut instance = exception();
        instance["sensitivity"] = json!(sensitivity);
        let mut upsert = projection(&target(), master, vec![instance]).unwrap();
        assert_eq!(upsert.overrides[0].visibility, Some(expected));
        upsert.overrides[0].apply_to(&mut upsert.event);
        assert_eq!(upsert.event.visibility, expected);
    }
}

#[test]
fn show_as_maps_consistently_for_series_and_exceptions() {
    for (show_as, expected) in [
        ("free", EventTransparency::Transparent),
        ("busy", EventTransparency::Opaque),
        ("tentative", EventTransparency::Opaque),
        ("oof", EventTransparency::Opaque),
        ("workingElsewhere", EventTransparency::Opaque),
        ("unknown", EventTransparency::Opaque),
    ] {
        let mut master = event("series");
        master["showAs"] = json!(show_as);
        let series = projection(&target(), master.clone(), vec![]).unwrap();
        assert_eq!(series.event.transparency, expected);

        master["showAs"] = if expected == EventTransparency::Opaque {
            json!("free")
        } else {
            json!("busy")
        };
        let mut instance = exception();
        instance["showAs"] = json!(show_as);
        let mut upsert = projection(&target(), master, vec![instance]).unwrap();
        assert_eq!(upsert.overrides[0].transparency, Some(expected));
        upsert.overrides[0].apply_to(&mut upsert.event);
        assert_eq!(upsert.event.transparency, expected);
    }
}

#[test]
fn omitted_exception_fields_inherit_series_privacy_and_availability() {
    for privacy in ["private", "confidential"] {
        for show_as in ["free", "busy"] {
            let mut master = event("series");
            master["sensitivity"] = json!(privacy);
            master["showAs"] = json!(show_as);
            let mut upsert = projection(&target(), master, vec![exception()]).unwrap();
            let visibility = upsert.event.visibility;
            let transparency = upsert.event.transparency;
            assert_eq!(upsert.overrides[0].visibility, None);
            assert_eq!(upsert.overrides[0].transparency, None);
            upsert.overrides[0].apply_to(&mut upsert.event);
            assert_eq!(upsert.event.visibility, visibility);
            assert_eq!(upsert.event.transparency, transparency);
        }
    }
}

#[test]
fn source_retains_the_observed_role_without_inferring_it_from_editability() {
    for role in [None, Some("owner"), Some("reader"), Some("freeBusyReader")] {
        for is_read_only in [false, true] {
            let mut target = target();
            target.observed_access_role = role.map(str::to_owned);
            target.is_read_only = is_read_only;
            let upsert = projection(&target, event("event"), vec![]).unwrap();
            assert_eq!(
                upsert.source.details().observed_access_role,
                target.observed_access_role
            );
        }
    }
}
