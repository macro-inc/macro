use super::{BundleManifest, Target};

fn manifest(schema: u8, minima: &str) -> BundleManifest {
    serde_json::from_str(&format!(
        r#"{{"schemaVersion":{schema},"bundleBuild":20,"minNativeBuild":0,"minNativeBuilds":{minima},"appVersion":"2.5.0"}}"#
    )).unwrap()
}

#[test]
fn mobile_minima_are_independent_and_never_fall_back_to_legacy_zero() {
    let bundle = manifest(3, r#"{"android":2050001,"ios":184}"#);
    assert_eq!(bundle.minimum_for(Target::Android), Some(2_050_001));
    assert_eq!(bundle.minimum_for(Target::Ios), Some(184));
    assert_eq!(manifest(3, "null").minimum_for(Target::Android), None);
    assert_eq!(manifest(4, "null").minimum_for(Target::Android), None);
    assert_eq!(
        manifest(2, r#"{"android":9,"ios":2}"#).minimum_for(Target::Android),
        None
    );
    assert_eq!(manifest(2, "null").minimum_for(Target::Android), None);
    assert_eq!(manifest(2, "null").minimum_for(Target::Ios), Some(0));
}

#[test]
fn desktop_reads_the_shared_minimum_from_schema_3() {
    let bundle: BundleManifest = serde_json::from_str(
        r#"{"schemaVersion":3,"bundleBuild":20,"minNativeBuild":5,"minNativeBuilds":{"android":2050001,"ios":184},"appVersion":"2.5.0"}"#,
    )
    .unwrap();
    for target in [Target::Darwin, Target::Linux, Target::Windows] {
        assert_eq!(bundle.minimum_for(target), Some(5));
    }
    assert_eq!(manifest(3, "null").minimum_for(Target::Darwin), None);
}
