use super::*;

#[test]
fn every_app_toml_parses() {
    let apps = all_apps().expect("embedded registry must parse");
    assert_eq!(apps.len(), 36);
    assert!(apps.iter().all(|app| !app.name.is_empty()));
}

#[test]
fn only_first_slice_apps_are_live() {
    let live: HashSet<_> = all_apps()
        .expect("embedded registry must parse")
        .iter()
        .filter(|app| app.status == Status::Live)
        .map(|app| app.id.as_str())
        .collect();
    assert_eq!(
        live,
        HashSet::from(["linear", "notion", "posthog", "sentry"])
    );
}

#[test]
fn app_ids_are_unique_and_match_directories() {
    let apps = all_apps().expect("embedded registry must parse");
    let ids: HashSet<_> = apps.iter().map(|app| app.id.as_str()).collect();
    assert_eq!(ids.len(), apps.len());

    let root = format!("{}/../../registry/apps", env!("CARGO_MANIFEST_DIR"));
    let directories: HashSet<_> = std::fs::read_dir(root)
        .expect("registry directory exists")
        .map(|entry| {
            entry
                .expect("registry directory entry")
                .file_name()
                .into_string()
                .expect("app directory is UTF-8")
        })
        .collect();
    assert_eq!(ids, directories.iter().map(String::as_str).collect());
}

#[test]
fn pipedream_slugs_belong_to_at_most_one_app() {
    let apps = all_apps().expect("embedded registry must parse");
    let mut slugs = HashSet::new();
    for app in apps {
        for slug in &app.pipedream_app_slugs {
            assert!(slugs.insert(slug), "duplicate Pipedream slug: {slug}");
        }
    }
}

#[test]
fn mcp_urls_are_https_without_trailing_slashes() {
    let apps = all_apps().expect("embedded registry must parse");
    for app in apps {
        assert!(!app.mcp_url.ends_with('/'), "{}", app.id);
        assert_eq!(
            Url::parse(&app.mcp_url).expect("valid URL").scheme(),
            "https"
        );
    }
}

#[test]
fn live_apps_have_an_icon_or_a_known_official_svg_gap() {
    let apps = all_apps().expect("embedded registry must parse");
    for app in apps {
        if app.status == Status::Live && app.icon_svg.is_none() {
            assert!(
                NO_OFFICIAL_SVG_ICON.contains(&app.id.as_str()),
                "{}",
                app.id
            );
        }
        if let Some(icon) = app.icon_svg {
            assert!(icon.starts_with("<svg"), "{}", app.id);
            assert!(icon.len() < 10_000, "{}", app.id);
        }
    }
    let absent: HashSet<_> = apps
        .iter()
        .filter(|app| app.icon_svg.is_none())
        .map(|app| app.id.as_str())
        .collect();
    assert_eq!(absent, NO_OFFICIAL_SVG_ICON.iter().copied().collect());
}

#[test]
fn app_ids_reject_invalid_shapes() {
    for invalid in ["", "GitHub", "-github", "github/path", "github space"] {
        assert!(AppId::parse(invalid).is_err(), "{invalid}");
    }
    assert_eq!(
        AppId::parse("github_2").expect("valid id").as_str(),
        "github_2"
    );
}
