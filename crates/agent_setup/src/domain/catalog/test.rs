use super::*;

#[test]
fn names_resolve_to_one_canonical_app() {
    for name in ["Notion", "notion", " NOTION "] {
        assert_eq!(
            resolve(name).map(|app| app.id().to_owned()).as_deref(),
            Some("notion")
        );
    }
    for name in ["Gmail", "Google Mail", "google-workspace"] {
        assert_eq!(
            resolve(name).map(|app| app.id().to_owned()).as_deref(),
            Some("gmail")
        );
    }
    assert_eq!(
        resolve("slack_v2")
            .map(|app| app.id().to_owned())
            .as_deref(),
        Some("slack")
    );
    assert_eq!(
        resolve("HubSpot").map(|app| app.id().to_owned()).as_deref(),
        Some("hubspot")
    );
}

#[test]
fn unknown_tools_keep_a_normalized_slug_and_a_readable_name() {
    let app = resolve("Basecamp Classic").expect("resolves");
    assert_eq!(app, App::Other("basecamp_classic".to_owned()));
    assert_eq!(app.name(), "Basecamp Classic");
    assert_eq!(app.import_source(), None);
    assert_eq!(app.connect_slug(), Some("basecamp_classic"));
}

#[test]
fn tools_people_leave_are_imported_or_imported_later_and_tools_they_keep_stay_connected() {
    let support = |name: &str| resolve(name).and_then(|app| app.support());
    assert_eq!(
        support("Notion"),
        Some(Support::Import(ImportSource::Notion))
    );
    assert_eq!(support("Jira"), Some(Support::ImportLater(Kind::Tasks)));
    assert_eq!(
        support("Confluence"),
        Some(Support::ImportLater(Kind::Docs))
    );
    assert_eq!(support("Salesforce"), Some(Support::ImportLater(Kind::Crm)));
    assert_eq!(support("Google Docs"), Some(Support::Keep));
    assert_eq!(support("Dropbox"), Some(Support::Keep));
    assert_eq!(support("Google Calendar"), Some(Support::KeepWithGoogle));
    assert_eq!(support("Gmail"), Some(Support::Inbox));
    assert_eq!(support("Basecamp"), None);
}

#[test]
fn connections_use_the_pipedream_slug() {
    let slug = |name: &str| resolve(name).and_then(|app| app.connect_slug().map(str::to_owned));
    assert_eq!(slug("Salesforce").as_deref(), Some("salesforce_rest_api"));
    assert_eq!(slug("OneDrive").as_deref(), Some("microsoft_onedrive"));
    assert_eq!(slug("slack").as_deref(), Some("slack_v2"));
    assert_eq!(slug("gmail"), None);
}

#[test]
fn what_is_importable_comes_from_the_import_service() {
    let importable: Vec<&str> = importable().iter().map(|app| app.id).collect();
    let sources: Vec<String> = ImportSource::all()
        .iter()
        .map(|source| source.as_ref().to_owned())
        .collect();
    assert_eq!(importable, sources);
}

#[test]
fn only_import_apps_have_an_import_source() {
    assert_eq!(
        resolve("linear").and_then(|app| app.import_source()),
        Some(ImportSource::Linear)
    );
    assert_eq!(resolve("gmail").and_then(|app| app.import_source()), None);
    assert_eq!(resolve("hubspot").and_then(|app| app.import_source()), None);
    assert_eq!(resolve("jira").and_then(|app| app.import_source()), None);
}

#[test]
fn every_import_source_maps_back_to_its_app() {
    for source in ImportSource::all() {
        assert_eq!(for_source(source).support, Support::Import(source));
    }
}

#[test]
fn resolving_a_list_drops_blanks_and_duplicates() {
    let apps = resolve_all(&[
        "Notion".to_owned(),
        "".to_owned(),
        "notion".to_owned(),
        "Linear".to_owned(),
    ]);
    let ids: Vec<&str> = apps.iter().map(App::id).collect();
    assert_eq!(ids, ["notion", "linear"]);
}

#[test]
fn normalize_collapses_separators() {
    assert_eq!(normalize("  Zoho -- CRM "), "zoho_crm");
    assert_eq!(normalize("!!!"), "");
}
