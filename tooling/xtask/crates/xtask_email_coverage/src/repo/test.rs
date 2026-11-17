use super::is_test_only;
use std::path::Path;

pub(crate) fn workspace(root: &Path, packages: &[(&str, &str, Option<&str>)]) {
    let members: Vec<_> = packages.iter().map(|(dir, _, _)| *dir).collect();
    std::fs::write(
        root.join("Cargo.toml"),
        format!(
            "[workspace]\nresolver = \"3\"\nmembers = {}\n",
            serde_json::to_string(&members).unwrap()
        ),
    )
    .unwrap();
    let mut names = Vec::new();
    for (dir, name, library) in packages {
        let dir = root.join(dir);
        std::fs::create_dir_all(dir.join("src")).unwrap();
        let mut manifest =
            format!("[package]\nname = {name:?}\nversion = \"0.0.0\"\nedition = \"2024\"\n");
        if let Some(library) = library {
            manifest.push_str(&format!("[lib]\nname = {library:?}\n"));
        }
        std::fs::write(dir.join("Cargo.toml"), manifest).unwrap();
        if !dir.join("src/lib.rs").exists() {
            std::fs::write(dir.join("src/lib.rs"), "").unwrap();
        }
        names.push(*name);
    }
    names.sort_unstable();
    let mut lock = String::from("version = 4\n");
    for name in names {
        lock.push_str(&format!(
            "\n[[package]]\nname = {name:?}\nversion = \"0.0.0\"\n"
        ));
    }
    std::fs::write(root.join("Cargo.lock"), lock).unwrap();
}

#[test]
fn resolves_email_label_routes_from_workspace_library_targets() {
    for (directory, package, library, rust_name) in [
        ("crates/email", "email", None, "email"),
        ("crates/email/email", "email", None, "email"),
        (
            "crates/email/provider/inbound",
            "email-inbound",
            None,
            "email_inbound",
        ),
        (
            "crates/adapters/unrelated",
            "renamed-email",
            None,
            "renamed_email",
        ),
        (
            "crates/adapters/custom",
            "provider",
            Some("email_alias"),
            "email_alias",
        ),
    ] {
        let root = tempfile::tempdir().unwrap();
        workspace(
            root.path(),
            &[
                ("services/email_service", "email_service", None),
                (directory, package, library),
            ],
        );
        let caller = "services/email_service/src/api/email/labels.rs";
        std::fs::create_dir_all(root.path().join(caller).parent().unwrap()).unwrap();
        std::fs::write(
            root.path().join(caller),
            format!(
                "pub use {rust_name}::inbound::axum::list_labels_router::list_labels_router;\n"
            ),
        )
        .unwrap();
        let target = format!("{directory}/src/inbound/axum/list_labels_router.rs");
        std::fs::create_dir_all(root.path().join(&target).parent().unwrap()).unwrap();
        std::fs::write(
            root.path().join(&target),
            "pub fn list_labels_router() {}\n",
        )
        .unwrap();
        let library_file = if library.is_some() {
            let manifest = root.path().join(directory).join("Cargo.toml");
            let text = std::fs::read_to_string(&manifest).unwrap();
            std::fs::write(manifest, text + "path = \"src/custom_lib.rs\"\n").unwrap();
            format!("{directory}/src/custom_lib.rs")
        } else {
            format!("{directory}/src/lib.rs")
        };
        std::fs::write(
            root.path().join(&library_file),
            "pub mod inbound;\npub fn root_label() {}\n",
        )
        .unwrap();
        std::fs::write(
            root.path().join(directory).join("src/inbound.rs"),
            "pub mod axum;\n",
        )
        .unwrap();
        std::fs::write(
            root.path().join(directory).join("src/inbound/axum.rs"),
            "pub mod list_labels_router;\n",
        )
        .unwrap();
        let repo = super::Repo::new(root.path());
        let from = repo.module_of(caller).unwrap();
        let loc = super::Loc {
            file: caller.to_owned(),
            line: 10,
        };
        let (module, item) = repo
            .resolve(
                &from,
                &format!("{rust_name}::inbound::axum::list_labels_router::list_labels_router")
                    .split("::")
                    .map(str::to_owned)
                    .collect::<Vec<_>>(),
                &loc,
            )
            .unwrap();
        assert_eq!(module.file, target);
        assert_eq!(item, "list_labels_router");
        let (module, item) = repo
            .resolve(
                &from,
                &[rust_name.to_owned(), "root_label".to_owned()],
                &loc,
            )
            .unwrap();
        assert_eq!(module.file, library_file);
        assert_eq!(item, "root_label");
    }
}

#[test]
fn ambiguous_workspace_library_names_are_reported() {
    let root = tempfile::tempdir().unwrap();
    workspace(
        root.path(),
        &[
            ("crates/one", "one", Some("email")),
            ("crates/two", "two", Some("email")),
        ],
    );
    let repo = super::Repo::new(root.path());
    let error = repo.crate_src("email").unwrap_err();
    assert!(
        error
            .to_string()
            .contains("ambiguous workspace library `email`"),
        "{error}"
    );
}

fn test_only(attribute: &str) -> bool {
    let item: syn::ItemMod = syn::parse_str(&format!("{attribute} mod m;")).unwrap();
    is_test_only(&item.attrs)
}

/// A module is left out only when nothing but a test build compiles it.
#[test]
fn a_module_is_test_only_when_its_cfg_needs_test() {
    assert!(test_only("#[cfg(test)]"));
    assert!(test_only(r#"#[cfg(all(test, feature = "x"))]"#));
    assert!(test_only(r#"#[cfg(all(test, not(feature = "x")))]"#));
    assert!(test_only("#[cfg(any(test, all(test, unix)))]"));

    assert!(!test_only(r#"#[cfg(any(test, feature = "x"))]"#));
    assert!(!test_only("#[cfg(not(test))]"));
    assert!(!test_only(r#"#[cfg(feature = "x")]"#));
    assert!(!test_only("#[allow(dead_code)]"));
}
