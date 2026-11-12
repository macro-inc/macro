use std::os::unix::fs::PermissionsExt as _;
use std::path::{Path, PathBuf};

use super::*;

#[test]
fn windows_lookup_takes_the_cmd_shim_over_npms_shell_script() {
    // Node's Windows installer and every global npm package put an
    // extensionless shell script beside the `.cmd` shim. Windows cannot launch
    // the script.
    let directory = tempfile::tempdir().expect("temp dir");
    for name in ["npm", "npm.cmd", "npm.ps1"] {
        let path = directory.path().join(name);
        std::fs::write(&path, "").expect("write stand-in");
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755))
            .expect("mark executable");
    }

    let found = find_named(
        &[directory.path().to_owned()],
        &windows_launcher_names("npm"),
    );

    assert_eq!(found, Some(directory.path().join("npm.cmd")));
}

#[test]
fn windows_lookup_keeps_a_name_that_carries_its_extension() {
    let directory = tempfile::tempdir().expect("temp dir");
    let path = directory.path().join("claude.exe");
    std::fs::write(&path, "").expect("write stand-in");
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755))
        .expect("mark executable");

    let found = find_named(
        &[directory.path().to_owned()],
        &windows_launcher_names("claude.exe"),
    );

    assert_eq!(found, Some(path));
}

#[test]
fn an_npm_shim_for_a_native_binary_names_the_binary() {
    // What npm writes to `%APPDATA%\npm\claude.cmd` for `@anthropic-ai/claude-code`.
    let script = "@ECHO off\r\n\
GOTO start\r\n\
:find_dp0\r\n\
SET dp0=%~dp0\r\n\
EXIT /b\r\n\
:start\r\n\
SETLOCAL\r\n\
CALL :find_dp0\r\n\
\"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe\"   %*\r\n";

    assert_eq!(
        npm_shim_target(Path::new("/npm/claude.cmd"), script),
        Some(PathBuf::from(
            "/npm/node_modules/@anthropic-ai/claude-code/bin/claude.exe"
        ))
    );
}

#[test]
fn an_npm_shim_for_a_node_script_names_the_script() {
    let script = "@ECHO off\r\n\
GOTO start\r\n\
:find_dp0\r\n\
SET dp0=%~dp0\r\n\
EXIT /b\r\n\
:start\r\n\
SETLOCAL\r\n\
CALL :find_dp0\r\n\
\r\n\
IF EXIST \"%dp0%\\node.exe\" (\r\n\
  SET \"_prog=%dp0%\\node.exe\"\r\n\
) ELSE (\r\n\
  SET \"_prog=node\"\r\n\
  SET PATHEXT=%PATHEXT:;.JS;=;%\r\n\
)\r\n\
\r\n\
endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & \"%_prog%\"  \"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\cli.js\" %*\r\n";

    assert_eq!(
        npm_shim_target(Path::new("/npm/claude.cmd"), script),
        Some(PathBuf::from(
            "/npm/node_modules/@anthropic-ai/claude-code/cli.js"
        ))
    );
}

#[test]
fn a_hand_written_cmd_file_has_no_npm_target() {
    assert_eq!(
        npm_shim_target(
            Path::new("/tools/claude.cmd"),
            "@echo off\r\nclaude.exe %*\r\n"
        ),
        None
    );
}
