use super::consumers;
use crate::deploy::dockerfile_selections;

#[test]
fn actual_non_pulumi_generic_docker_consumers_have_complete_build_selections() {
    let root = xtask_paths::workspace_root();
    let dockerfile = std::fs::read_to_string(root.join("docker/Dockerfile")).unwrap();
    let mut problems = Vec::new();
    for path in [
        "docker/docker-compose.yml",
        "services/unfurl_service/justfile",
    ] {
        let text = std::fs::read_to_string(root.join(path)).unwrap();
        let found = consumers(path, &text).unwrap();
        assert!(!found.is_empty(), "{path} consumer was omitted");
        let refs = found.iter().collect::<Vec<_>>();
        let (bound, errors) = dockerfile_selections("docker/Dockerfile", &dockerfile, &refs);
        problems.extend(errors);
        if bound.is_empty() {
            problems.push(format!("{path}: no actual selection"));
        }
    }
    assert!(problems.is_empty(), "{problems:?}");
}

#[test]
fn unrelated_or_prebuilt_dockerfile_references_are_not_generic_consumers() {
    for text in [
        "docker build -f docker/Dockerfile.prebuilt .",
        "docker build -f docker/Dockerfile.dev .",
        "mkdir $TEMP/docker; echo FROM busybox > $TEMP/docker/Dockerfile",
    ] {
        assert!(consumers("tooling/script.sh", text).unwrap().is_empty());
    }
}

#[test]
fn unsupported_generic_docker_entrypoint_fails_instead_of_being_omitted() {
    assert!(consumers("tooling/script.sh", "docker build -f docker/Dockerfile .").is_err());
}

#[test]
fn a_safe_compose_sibling_cannot_cover_a_relative_generic_build() {
    let dockerfile =
        std::fs::read_to_string(xtask_paths::workspace_root().join("docker/Dockerfile")).unwrap();
    let mut omitted = Vec::new();
    for (path, safe_context) in [
        ("docker/docker-compose.yml", "."),
        ("docker/compose.yml", ".."),
    ] {
        let text = format!(
            "services:\n  safe:\n    build:\n      context: {safe_context}\n      dockerfile: docker/Dockerfile\n      args: {{ SERVICE_NAME: slack_import_worker, PACKAGE_NAME: slack_import_worker }}\n  hidden:\n    build:\n      context: ../services\n      dockerfile: ../docker/Dockerfile\n      args: {{ SERVICE_NAME: slack_import_worker }}\n"
        );
        let caught = match consumers(path, &text) {
            Err(_) => true,
            Ok(found) => {
                let refs = found.iter().collect::<Vec<_>>();
                let (_, errors) = dockerfile_selections("docker/Dockerfile", &dockerfile, &refs);
                !errors.is_empty()
            }
        };
        if !caught {
            omitted.push(path);
        }
    }
    assert!(
        omitted.is_empty(),
        "relative generic consumers omitted in {omitted:?}"
    );
}

#[test]
fn compose_context_and_dockerfile_paths_normalize_to_the_same_generic_file() {
    let text = "services:\n  worker:\n    build:\n      context: ./services/../services\n      dockerfile: ../docker/./Dockerfile\n      args: { SERVICE_NAME: slack_import_worker, PACKAGE_NAME: slack_import_worker }\n";
    let found = consumers("compose.yml", text).unwrap();
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].dockerfile, "docker/Dockerfile");
    assert_eq!(found[0].args["PACKAGE_NAME"], "slack_import_worker");
}

#[test]
fn compose_discovery_uses_structure_before_filename_or_path_spelling() {
    let dockerfile =
        std::fs::read_to_string(xtask_paths::workspace_root().join("docker/Dockerfile")).unwrap();
    let text = "services:\n  safe:\n    build:\n      context: ..\n      dockerfile: docker/./Dockerfile\n      args: { SERVICE_NAME: slack_import_worker, PACKAGE_NAME: slack_import_worker }\n  hidden:\n    build:\n      context: ../services\n      dockerfile: ../docker/./Dockerfile\n      args: { SERVICE_NAME: slack_import_worker }\n";
    let mut omitted = Vec::new();
    for path in [
        "docker/build.yml",
        "docker/build.yaml",
        "docker/build-config.yml",
    ] {
        let caught = match consumers(path, text) {
            Err(_) => true,
            Ok(found) if found.len() < 2 => false,
            Ok(found) => {
                let refs = found.iter().collect::<Vec<_>>();
                !dockerfile_selections("docker/Dockerfile", &dockerfile, &refs)
                    .1
                    .is_empty()
            }
        };
        if !caught {
            omitted.push(path);
        }
    }
    assert!(omitted.is_empty(), "Compose documents omitted: {omitted:?}");
}

#[test]
fn yaml_document_discovery_is_independent_of_filename_and_non_compose_siblings() {
    let text = "description: unrelated\n---\nservices:\n  worker:\n    build:\n      context: ..\n      dockerfile: docker/./Dockerfile\n      args: { SERVICE_NAME: slack_import_worker, PACKAGE_NAME: slack_import_worker }\n";
    let found = consumers("docker/build.yaml", text).unwrap();
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].dockerfile, "docker/Dockerfile");
    assert_eq!(found[0].args["PACKAGE_NAME"], "slack_import_worker");
    assert!(
        consumers("settings.yaml", "services: [one, two]\n")
            .unwrap()
            .is_empty()
    );
}

#[test]
fn every_current_tracked_yaml_document_is_classified_without_discovery_errors() {
    let root = xtask_paths::workspace_root();
    let output = std::process::Command::new("git")
        .args(["ls-files", "*.yml", "*.yaml"])
        .current_dir(&root)
        .output()
        .unwrap();
    assert!(output.status.success());
    let mut errors = Vec::new();
    for path in std::str::from_utf8(&output.stdout).unwrap().lines() {
        let text = std::fs::read_to_string(root.join(path)).unwrap();
        if let Err(error) = consumers(path, &text) {
            errors.push(error);
        }
    }
    assert!(errors.is_empty(), "{errors:?}");
}
