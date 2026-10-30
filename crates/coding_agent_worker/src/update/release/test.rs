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
        release.asset_for(&ReleaseSource::GitHub, "linux", "x86_64", "tar.gz"),
        Some(PlatformAsset {
            archive_name: "macrod-v2026.10.27.2-linux-x86_64.tar.gz".to_owned(),
            archive_url: "https://example.test/tagged.tar.gz".to_owned(),
            checksum_url: "https://example.test/tagged.tar.gz.sha256".to_owned(),
        })
    );
    // An archive without its checksum is not installable.
    assert_eq!(
        release.asset_for(&ReleaseSource::GitHub, "windows", "x86_64", "zip"),
        None
    );
    assert_eq!(
        release.asset_for(&ReleaseSource::GitHub, "macos", "aarch64", "tar.gz"),
        None
    );
}

#[test]
fn an_update_source_override_replaces_github() {
    assert_eq!(ReleaseSource::new(None), ReleaseSource::GitHub);
    assert_eq!(ReleaseSource::new(Some("  ")), ReleaseSource::GitHub);
    assert_eq!(
        ReleaseSource::new(Some("http://127.0.0.1:8000/releases/")),
        ReleaseSource::Mirror("http://127.0.0.1:8000/releases".to_owned())
    );
}

#[test]
fn a_mirror_serves_the_tagged_archive_beside_its_manifest() {
    // A mirror's manifest is GitHub's release object; only the tag is needed.
    let release: Release = serde_json::from_str(r#"{"tag_name": "v2026.10.28.2"}"#).unwrap();
    let mirror = ReleaseSource::new(Some("/srv/macrod"));

    assert_eq!(
        release.asset_for(&mirror, "linux", "x86_64", "tar.gz"),
        Some(PlatformAsset {
            archive_name: "macrod-v2026.10.28.2-linux-x86_64.tar.gz".to_owned(),
            archive_url: "/srv/macrod/macrod-v2026.10.28.2-linux-x86_64.tar.gz".to_owned(),
            checksum_url: "/srv/macrod/macrod-v2026.10.28.2-linux-x86_64.tar.gz.sha256".to_owned(),
        })
    );
}

#[tokio::test]
async fn a_directory_mirror_is_read_from_disk() {
    let mirror = tempfile::tempdir().unwrap();
    std::fs::write(
        mirror.path().join("latest.json"),
        r#"{"tag_name": "v2026.10.28.2", "assets": []}"#,
    )
    .unwrap();
    std::fs::write(
        mirror
            .path()
            .join("macrod-v2026.10.28.2-linux-x86_64.tar.gz"),
        b"archive",
    )
    .unwrap();
    std::fs::write(
        mirror
            .path()
            .join("macrod-v2026.10.28.2-linux-x86_64.tar.gz.sha256"),
        b"digest  name\n",
    )
    .unwrap();
    let source = ReleaseSource::new(mirror.path().to_str());
    let client = ReleaseClient::new(source.clone()).unwrap();

    let release = client.latest().await.unwrap();
    let asset = release
        .asset_for(&source, "linux", "x86_64", "tar.gz")
        .unwrap();
    let downloaded = client.download(&asset).await.unwrap();

    assert_eq!(release.tag, "v2026.10.28.2");
    assert_eq!(downloaded.archive, b"archive");
    assert_eq!(downloaded.checksum, "digest  name\n");
}
