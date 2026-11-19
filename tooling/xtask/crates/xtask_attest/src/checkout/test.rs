use std::ffi::OsStr;

use super::*;

/// The variables a command built by `in_repository` does not pass on.
fn removed(command: &Command) -> Vec<&OsStr> {
    command
        .get_envs()
        .filter(|(_, value)| value.is_none())
        .map(|(name, _)| name)
        .collect()
}

#[test]
fn a_command_drops_every_variable_that_names_another_repository() {
    let command = in_repository("git", Path::new("."));

    for variable in GIT_LOCATION {
        assert!(
            removed(&command).contains(&OsStr::new(variable)),
            "{variable} is passed on"
        );
    }
}

/// A git hook exports `GIT_DIR` and `GIT_WORK_TREE`. The test can't set its
/// own environment, so `env` sets them, and drops what the command drops.
#[test]
fn git_acts_on_its_own_directory_when_a_hook_names_another() {
    let own = tempfile::tempdir().expect("a directory");
    let elsewhere = tempfile::tempdir().expect("a directory");
    for dir in [own.path(), elsewhere.path()] {
        git(dir, &["init", "--quiet"]).expect("git init");
    }
    let top_level = |drop: &[&OsStr]| {
        let output = Command::new("env")
            .arg(format!(
                "GIT_DIR={}",
                elsewhere.path().join(".git").display()
            ))
            .arg(format!("GIT_WORK_TREE={}", elsewhere.path().display()))
            .arg("env")
            .args(drop.iter().flat_map(|name| [OsStr::new("-u"), name]))
            .args(["git", "rev-parse", "--show-toplevel"])
            .current_dir(own.path())
            .output()
            .expect("env runs git");
        PathBuf::from(String::from_utf8_lossy(&output.stdout).trim())
            .canonicalize()
            .expect("a path")
    };

    let hooked = top_level(&[]);
    let shielded = top_level(&removed(&in_repository("git", own.path())));

    assert_eq!(hooked, elsewhere.path().canonicalize().expect("a path"));
    assert_eq!(shielded, own.path().canonicalize().expect("a path"));
}

#[test]
fn reads_the_repository_from_either_remote_form() {
    assert_eq!(
        repository_of("https://github.com/acme/widgets.git").expect("an HTTPS remote"),
        "acme/widgets"
    );
    assert_eq!(
        repository_of("host:acme/widgets").expect("an SSH remote"),
        "acme/widgets"
    );
    assert!(repository_of("widgets").is_err());
}

#[test]
fn reads_changed_paths_as_git_wrote_them() {
    let listing = "crates/example/café.rs\0docs/a b.md\0".as_bytes();

    assert_eq!(
        paths_of(listing).expect("UTF-8 paths"),
        vec!["crates/example/café.rs", "docs/a b.md"]
    );
    assert_eq!(paths_of(b"").expect("no paths"), Vec::<String>::new());
}

#[test]
fn refuses_a_changed_path_it_cannot_read() {
    assert!(paths_of(b"docs/\xff.md\0").is_err());
}

#[test]
fn finishes_an_initialization_that_stopped_halfway() {
    let source = tempfile::tempdir().expect("a directory");
    let checkout = tempfile::tempdir().expect("a directory");
    git(source.path(), &["init", "--quiet"]).expect("git init");
    let common_dir = source.path().join(".git");
    // A run that stopped after `git init`: no alternates, no remote.
    git(checkout.path(), &["init", "--quiet"]).expect("git init");

    for _ in 0..2 {
        initialize(checkout.path(), &common_dir, "host:acme/widgets.git").expect("initializes");
    }

    let alternates = std::fs::read_to_string(checkout.path().join(".git/objects/info/alternates"))
        .expect("alternates are written");
    assert_eq!(
        alternates.trim(),
        common_dir.join("objects").display().to_string()
    );
    assert_eq!(
        git(checkout.path(), &["remote", "get-url", "origin"]).expect("a remote"),
        "host:acme/widgets.git"
    );
}
