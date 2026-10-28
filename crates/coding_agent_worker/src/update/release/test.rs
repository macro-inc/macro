use super::*;

#[test]
fn release_tags_order_by_calendar_then_build() {
    let older = ReleaseVersion::parse("v2026.10.27.1").unwrap();
    let newer = ReleaseVersion::parse("v2026.10.27.2").unwrap();
    assert!(newer > older);

    // Numeric, not lexical: day 9 is before day 10, September before October.
    assert!(ReleaseVersion::parse("v2026.10.10.0") > ReleaseVersion::parse("v2026.10.9.5"));
    assert!(ReleaseVersion::parse("v2026.10.1.0") > ReleaseVersion::parse("v2026.9.30.9"));
    assert!(ReleaseVersion::parse("v2027.1.1.0") > ReleaseVersion::parse("v2026.12.31.9"));
}

#[test]
fn a_tag_without_a_build_number_is_build_zero() {
    assert_eq!(
        ReleaseVersion::parse("v2026.10.7"),
        ReleaseVersion::parse("v2026.10.7.0")
    );
    assert!(ReleaseVersion::parse("v2026.10.7.1") > ReleaseVersion::parse("v2026.10.7"));
}

#[test]
fn refs_that_are_not_release_tags_have_no_version() {
    for tag in [
        "2026.10.27.0",
        "v2026.10.27.0-rc1",
        "v2026.10",
        "wolf/macrod-self-update",
        "untagged",
        "",
    ] {
        assert_eq!(ReleaseVersion::parse(tag), None, "{tag}");
    }
}

#[test]
fn the_platform_asset_is_the_tagged_archive_with_its_checksum() {
    let release: Release = serde_json::from_str(
        r#"{
            "tag_name": "v2026.10.27.2",
            "assets": [
                {"name": "macrod-linux-x86_64.tar.gz", "browser_download_url": "https://example.test/latest.tar.gz"},
                {"name": "macrod-linux-x86_64.tar.gz.sha256", "browser_download_url": "https://example.test/latest.tar.gz.sha256"},
                {"name": "macrod-v2026.10.27.2-linux-x86_64.tar.gz", "browser_download_url": "https://example.test/tagged.tar.gz"},
                {"name": "macrod-v2026.10.27.2-linux-x86_64.tar.gz.sha256", "browser_download_url": "https://example.test/tagged.tar.gz.sha256"},
                {"name": "macrod-v2026.10.27.2-windows-x86_64.zip", "browser_download_url": "https://example.test/tagged.zip"}
            ]
        }"#,
    )
    .unwrap();

    assert_eq!(
        release.asset_for("linux", "x86_64", "tar.gz"),
        Some(PlatformAsset {
            archive_name: "macrod-v2026.10.27.2-linux-x86_64.tar.gz".to_owned(),
            archive_url: "https://example.test/tagged.tar.gz".to_owned(),
            checksum_url: "https://example.test/tagged.tar.gz.sha256".to_owned(),
        })
    );
    // An archive without its checksum is not installable.
    assert_eq!(release.asset_for("windows", "x86_64", "zip"), None);
    assert_eq!(release.asset_for("macos", "aarch64", "tar.gz"), None);
}
