use std::{
    env, fs,
    path::{Path, PathBuf},
};

const COMMANDS: &[&str] = &[
    "get_voip_token",
    "end_active_call",
    "get_pending_answered_call",
    "watch_call_answered",
    "watch_call_ended",
    "watch_connection_state",
    "watch_drawer_opened",
    "watch_participant_identities",
    "get_active_call_state",
    "start_outgoing_call",
    "set_video_enabled",
    "set_video_overlay_mode",
    "set_call_drawer_channel_title",
    "set_call_drawer_theme",
    "set_participant_display_name",
    "switch_camera",
];

struct BuildEnv {
    target_os: String,
    manifest_dir: PathBuf,
    tauri_ios_library_path: Option<PathBuf>,
    out_dir: Option<PathBuf>,
}

impl BuildEnv {
    fn from_env() -> Self {
        Self {
            target_os: env::var("CARGO_CFG_TARGET_OS").unwrap_or_default(),
            manifest_dir: PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap()),
            tauri_ios_library_path: env::var("DEP_TAURI_IOS_LIBRARY_PATH")
                .ok()
                .map(PathBuf::from),
            out_dir: env::var_os("OUT_DIR").map(PathBuf::from),
        }
    }

    fn is_ios_target(&self) -> bool {
        self.target_os == "ios"
    }

    fn tauri_ios_library_path(&self) -> &Path {
        self.tauri_ios_library_path
            .as_deref()
            .expect("missing DEP_TAURI_IOS_LIBRARY_PATH; make sure tauri is a plugin dependency")
    }
}

fn main() {
    tauri_plugin::Builder::new(COMMANDS).try_build().unwrap();

    let build_env = BuildEnv::from_env();
    if build_env.is_ios_target() {
        prepare_ios_swift_package(&build_env);
    }
}

fn prepare_ios_swift_package(build_env: &BuildEnv) {
    let manifest_dir = &build_env.manifest_dir;
    let ios_dir = manifest_dir.join("ios");
    let tauri_library_path = build_env.tauri_ios_library_path();

    // Tauri's Swift package is exposed to plugin build scripts as an unpacked
    // dependency path, but SwiftPM needs it available from the plugin package's
    // local `../.tauri/tauri-api` path. Keep this as a copy so the plugin's
    // Package.swift can use the same layout Tauri's generated Xcode project
    // expects.
    let tauri_api_dir = manifest_dir.join(".tauri").join("tauri-api");
    let _ = fs::remove_dir_all(&tauri_api_dir);
    copy_dir_filtered(
        tauri_library_path,
        &tauri_api_dir,
        &[".build", "Package.resolved", "Tests"],
        build_env,
    );

    // Xcode links the final iOS app. Keep LiveKit and this plugin in Xcode's
    // SwiftPM graph so package resolution, binary-framework slice selection,
    // embedding, signing, and Swift runtime linkage all happen in one build
    // system. Cargo only prepares the local Tauri API dependency above.
    emit_ios_source_rerun_inputs(&ios_dir);
}

fn emit_ios_source_rerun_inputs(ios_dir: &Path) {
    emit_rerun_if_changed(&ios_dir.join("Package.swift"));
    let sources_dir = ios_dir.join("Sources");
    emit_rerun_if_changed(&sources_dir);
    emit_dir_rerun_inputs(&sources_dir);
}

fn emit_dir_rerun_inputs(dir: &Path) {
    if !dir.exists() {
        return;
    }

    for entry in fs::read_dir(dir).unwrap_or_else(|e| {
        panic!("failed to read {}: {e}", dir.display());
    }) {
        let entry = entry.unwrap();
        let path = entry.path();
        if path.is_dir() {
            emit_dir_rerun_inputs(&path);
        } else {
            emit_rerun_if_changed(&path);
        }
    }
}

fn emit_rerun_if_changed(path: &Path) {
    println!("cargo:rerun-if-changed={}", path.display());
}

fn copy_dir_filtered(source: &Path, target: &Path, ignore_paths: &[&str], build_env: &BuildEnv) {
    copy_dir_filtered_inner(source, target, ignore_paths, build_env, true);
}

fn copy_dir_filtered_inner(
    source: &Path,
    target: &Path,
    ignore_paths: &[&str],
    build_env: &BuildEnv,
    emit_rerun: bool,
) {
    fs::create_dir_all(target).unwrap_or_else(|e| {
        panic!("failed to create {}: {e}", target.display());
    });

    for entry in fs::read_dir(source).unwrap_or_else(|e| {
        panic!("failed to read {}: {e}", source.display());
    }) {
        let entry = entry.unwrap();
        let source_path = entry.path();
        let rel_path = source_path.strip_prefix(source).unwrap();
        let rel_path_str = rel_path.to_string_lossy();
        if ignore_paths
            .iter()
            .any(|ignore| rel_path_str.starts_with(ignore))
        {
            continue;
        }

        let target_path = target.join(rel_path);
        if source_path.is_dir() {
            copy_dir_filtered_inner(
                &source_path,
                &target_path,
                ignore_paths,
                build_env,
                emit_rerun,
            );
        } else {
            if let Some(parent) = target_path.parent() {
                fs::create_dir_all(parent).unwrap();
            }
            fs::copy(&source_path, &target_path).unwrap_or_else(|e| {
                panic!(
                    "failed to copy {} to {}: {e}",
                    source_path.display(),
                    target_path.display()
                )
            });
            if emit_rerun && should_emit_rerun_for_source(&source_path, build_env) {
                emit_rerun_if_changed(&source_path);
            }
        }
    }
}

fn should_emit_rerun_for_source(source_path: &Path, build_env: &BuildEnv) -> bool {
    if build_env
        .out_dir
        .as_deref()
        .is_some_and(|out_dir| source_path.starts_with(out_dir))
    {
        return false;
    }

    !source_path.components().any(|component| {
        let name = component.as_os_str();
        name == ".build" || name == ".tauri"
    })
}
