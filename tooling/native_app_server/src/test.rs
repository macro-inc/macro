use std::io::Write;

use native_app_service::domain::models::{AllTargets, MobileTarget};
use zip::write::SimpleFileOptions;

use super::read_archive_manifest;

fn archive(schema: u64, minima: &str) -> tempfile::NamedTempFile {
    let file = tempfile::NamedTempFile::new().unwrap();
    let mut zip = zip::ZipWriter::new(file.reopen().unwrap());
    zip.start_file("bundle-manifest.json", SimpleFileOptions::default())
        .unwrap();
    write!(zip, r#"{{"schemaVersion":{schema},"bundleBuild":1794870406000,"commitTime":1794870406,"gitSha":"cd95980272a4cfd4d0d5e6d2a3a8a1b0c9f8e7d6","minNativeBuild":7,{minima}"appVersion":"2.5.0"}}"#).unwrap();
    zip.finish().unwrap();
    file
}

#[test]
fn served_metadata_matches_archive_platform_minima_and_build() {
    let file = archive(3, r#""minNativeBuilds":{"android":42,"ios":99},"#);
    let manifest = read_archive_manifest(file.path()).unwrap();
    assert_eq!(manifest.schema_version(), 3);
    assert_eq!(manifest.bundle_build().get(), 1_794_870_406_000);
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
fn schema_2_archive_has_no_android_minimum() {
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
