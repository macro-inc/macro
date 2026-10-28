use std::io::Write;

use native_app_service::domain::models::{AllTargets, MobileTarget};
use zip::write::SimpleFileOptions;

use super::read_archive_manifest;

fn archive(schema: u64, minima: &str) -> tempfile::NamedTempFile {
    let file = tempfile::NamedTempFile::new().unwrap();
    let mut zip = zip::ZipWriter::new(file.reopen().unwrap());
    zip.start_file("bundle-manifest.json", SimpleFileOptions::default())
        .unwrap();
    write!(zip, r#"{{"schemaVersion":{schema},"bundleBuild":123,"minNativeBuild":7,{minima}"appVersion":"2.5.0"}}"#).unwrap();
    zip.finish().unwrap();
    file
}

#[test]
fn served_metadata_matches_archive_platform_minima_and_build() {
    let file = archive(3, r#""minNativeBuilds":{"android":42,"ios":99},"#);
    let manifest = read_archive_manifest(file.path()).unwrap();
    assert_eq!(manifest.schema_version, 3);
    assert_eq!(manifest.bundle_build, 123);
    assert_eq!(
        manifest.minimum_for(AllTargets::Mobile(MobileTarget::Android)),
        Some(42)
    );
    assert_eq!(
        manifest.minimum_for(AllTargets::Mobile(MobileTarget::Ios)),
        Some(99)
    );
}

#[test]
fn legacy_archive_remains_legacy_and_android_rejects_it() {
    let file = archive(2, "");
    let manifest = read_archive_manifest(file.path()).unwrap();
    assert_eq!(
        manifest.minimum_for(AllTargets::Mobile(MobileTarget::Android)),
        None
    );
    assert_eq!(
        manifest.minimum_for(AllTargets::Mobile(MobileTarget::Ios)),
        Some(7)
    );
}
