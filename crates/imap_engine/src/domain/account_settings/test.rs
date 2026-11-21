use super::*;
fn folder(id: &str, role: FolderRole) -> Folder {
    Folder {
        sync_enabled: true,
        id: id.into(),
        parent_id: None,
        name: id.into(),
        role,
        has_children: false,
        total_items: None,
    }
}
#[test]
fn cannot_remap_hide_or_use_another_accounts_inbox() {
    let f = [
        folder("inbox", FolderRole::Inbox),
        folder("client", FolderRole::Other),
    ];
    for excluded in ["inbox", "unknown"] {
        let change = UpdateFolderSettings {
            expected_revision: 0,
            role_overrides: BTreeMap::new(),
            watched_folder_ids: BTreeSet::new(),
            excluded_folder_ids: BTreeSet::from([excluded.into()]),
        };
        assert_eq!(change.validate(&f), Err(Error::Invalid));
    }
    let change = UpdateFolderSettings {
        expected_revision: 0,
        role_overrides: BTreeMap::from([("client".into(), FolderRole::Inbox)]),
        watched_folder_ids: BTreeSet::new(),
        excluded_folder_ids: BTreeSet::new(),
    };
    assert_eq!(change.validate(&f), Err(Error::Invalid));
}
#[test]
fn routing_override_displaces_default_and_leaves_inbox_active() {
    let prefs = FolderPreferences {
        role_overrides: BTreeMap::from([("sent-2026".into(), FolderRole::Sent)]),
        ..Default::default()
    };
    assert_eq!(
        prefs.role(&folder("sent", FolderRole::Sent)),
        FolderRole::Other
    );
    assert_eq!(
        prefs.role(&folder("sent-2026", FolderRole::Other)),
        FolderRole::Sent
    );
    assert_eq!(
        prefs.role(&folder("inbox", FolderRole::Inbox)),
        FolderRole::Inbox
    );
}

#[test]
fn extra_watch_requires_one_known_included_non_inbox_folder() {
    let folders = [
        folder("inbox", FolderRole::Inbox),
        folder("archive", FolderRole::Archive),
        folder("custom", FolderRole::Other),
        folder("drafts", FolderRole::Drafts),
    ];
    let mut change = UpdateFolderSettings {
        expected_revision: 3,
        role_overrides: BTreeMap::new(),
        excluded_folder_ids: BTreeSet::new(),
        watched_folder_ids: BTreeSet::from(["archive".into()]),
    };
    assert!(change.validate(&folders).is_ok());
    change.watched_folder_ids.insert("custom".into());
    assert_eq!(change.validate(&folders), Err(Error::Invalid));
    for rejected in ["inbox", "unknown", "custom", "drafts"] {
        change.excluded_folder_ids.insert("custom".into());
        change.watched_folder_ids = BTreeSet::from([rejected.into()]);
        assert_eq!(change.validate(&folders), Err(Error::Invalid));
    }
}

#[test]
fn owner_response_contains_only_endpoints_and_never_the_secret_payload() {
    use crate::domain::models::{Login, Secret, TlsMode};
    let endpoint = Endpoint {
        host: "imap.example.net".into(),
        port: 993,
        tls: TlsMode::Implicit,
        username: "user".into(),
    };
    let credentials = Credentials {
        features: None,
        binding: None,
        user_id: "private-owner-id".into(),
        email: "user@example.net".into(),
        imap: Login {
            endpoint: endpoint.clone(),
            password: Secret("incoming-private-value".into()),
        },
        smtp: Login {
            endpoint: Endpoint {
                host: "smtp.example.net".into(),
                port: 587,
                tls: TlsMode::StartTls,
                ..endpoint
            },
            password: Secret("outgoing-private-value".into()),
        },
    };
    let mut legacy = serde_json::to_value(&credentials).unwrap();
    legacy.as_object_mut().unwrap().remove("features");
    let legacy: Credentials = serde_json::from_value(legacy).unwrap();
    assert!(legacy.features.is_none());

    let result =
        AccountMailSettings::new(&credentials, vec![], &FolderPreferences::default()).unwrap();
    let json = serde_json::to_value(result).unwrap();
    assert_eq!(json["imap"]["username"], "user");
    assert_eq!(json["smtp"]["tls"], "start_tls");
    for excluded in [
        "password",
        "private-value",
        "private-owner-id",
        "credentialCiphertext",
    ] {
        assert!(!json.to_string().contains(excluded));
    }
}

#[test]
fn deleting_a_manual_destination_restores_the_detected_role() {
    let mut prefs = FolderPreferences {
        role_overrides: BTreeMap::from([("disappeared".into(), FolderRole::Sent)]),
        ..Default::default()
    };
    prefs.retain_listed(["system-sent", "inbox"]);
    assert_eq!(
        prefs.role(&folder("system-sent", FolderRole::Sent)),
        FolderRole::Sent
    );
}

#[test]
fn legacy_folder_settings_default_to_monitored() {
    let old = serde_json::json!(
    {
        "id": "folder",
        "name": "Folder",
        "detectedRole": "other",
        "effectiveRole": "other",
        "roleOverride": null,
        "excluded": false,
        "watched": false
    }
    );
    assert!(
        serde_json::from_value::<FolderSetting>(old)
            .unwrap()
            .monitored
    );
}
