use super::*;

#[test]
fn detects_localized_decorated_and_encoded_names_without_assigning_personal_folders() {
    for (path, role) in [
        ("a/Envoyés", FolderRole::Sent),
        ("Ａｒｃｈｉｖｅ", FolderRole::Archive),
        ("Gelöschte Elemente", FolderRole::Trash),
        ("a/Envoy&AOk-s", FolderRole::Sent),
        ("Sent to clients", FolderRole::Other),
    ] {
        assert_eq!(detect(path, Some("/"), &[]).0, role);
    }
    assert_eq!(
        detect("Trash", None, &[NameAttribute::Sent]).0,
        FolderRole::Sent
    );
    assert_eq!(display_path("A&-B"), "A&B");
    for name in ["Sent", "a/Envoyés", "A&B", "🗄️/归档"] {
        assert_eq!(display_path(&wire_path(name)), name);
    }
    assert_eq!(wire_path("Envoyés"), "Envoy&AOk-s");
    assert_eq!(display_path("A&bad!-/C"), "A&bad!-/C");
}

#[test]
fn extension_then_depth_then_path_choose_one_destination() {
    let mut folders = Vec::new();
    let mut priorities = Vec::new();
    for (path, attrs) in [
        ("customer/Sent", vec![]),
        ("Sent", vec![]),
        ("Z", vec![NameAttribute::Sent]),
        ("A", vec![NameAttribute::Sent]),
    ] {
        let (role, p) = detect(path, Some("/"), &attrs);
        folders.push((
            Folder {
                sync_enabled: true,
                id: path.into(),
                parent_id: None,
                name: path.into(),
                role,
                has_children: false,
                total_items: None,
            },
            path.into(),
        ));
        priorities.push(p);
    }
    unique_roles(&mut folders, &priorities);
    assert_eq!(
        folders
            .iter()
            .find(|(f, _)| f.role == FolderRole::Sent)
            .unwrap()
            .0
            .name,
        "A"
    );
}

#[test]
fn cap_preserves_roles_and_owner_priority_regardless_of_server_listing_order() {
    let mut catalog: Vec<_> = (0..240)
        .map(|i| {
            let id = format!("{i:03}");
            (
                Folder {
                    sync_enabled: true,
                    id: id.clone(),
                    name: id.clone(),
                    role: FolderRole::Other,
                    parent_id: None,
                    has_children: false,
                    total_items: None,
                },
                id,
            )
        })
        .collect();
    catalog[239].0.role = FolderRole::Inbox;
    catalog[238].0.role = FolderRole::Trash;
    catalog[237].0.role = FolderRole::Drafts;
    let mut prefs = FolderPreferences::default();
    prefs.watched_folder_ids.insert("236".into());
    prefs
        .role_overrides
        .insert("235".into(), FolderRole::Archive);
    prefs.excluded_folder_ids.insert("001".into());
    let selected = monitored_ids(&catalog, &prefs);
    assert_eq!(selected.len(), MAX_MONITORED_FOLDERS);
    for id in ["239", "238", "236", "235", "000"] {
        assert!(selected.contains(id));
    }
    for id in ["237", "001", "234"] {
        assert!(!selected.contains(id));
    }
    catalog.reverse();
    assert_eq!(monitored_ids(&catalog, &prefs), selected);
}
