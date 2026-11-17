use bundle_identity::BundleManifest;

use super::Target;

fn manifest(schema: u8, minima: &str) -> BundleManifest {
    serde_json::from_str(&format!(
        r#"{{"schemaVersion":{schema},"bundleBuild":1794870406000,"commitTime":1794870406,"gitSha":"cd95980272cd95980272cd95980272cd95980272","minNativeBuild":5,{minima}"appVersion":"2.5.0"}}"#
    ))
    .unwrap()
}

#[test]
fn mobile_targets_read_their_own_minimum() {
    let bundle = manifest(3, r#""minNativeBuilds":{"android":2050001,"ios":184},"#);

    assert_eq!(
        bundle.minimum_for(Target::Android.native_platform()),
        Some(2_050_001)
    );
    assert_eq!(bundle.minimum_for(Target::Ios.native_platform()), Some(184));
}

#[test]
fn android_reads_no_minimum_from_the_shared_schema() {
    let bundle = manifest(2, "");

    assert_eq!(bundle.minimum_for(Target::Android.native_platform()), None);
    assert_eq!(bundle.minimum_for(Target::Ios.native_platform()), Some(5));
}

#[test]
fn desktop_targets_read_the_shared_minimum() {
    let bundle = manifest(3, r#""minNativeBuilds":{"android":2050001,"ios":184},"#);

    for target in [Target::Darwin, Target::Linux, Target::Windows] {
        assert_eq!(bundle.minimum_for(target.native_platform()), Some(5));
    }
}
