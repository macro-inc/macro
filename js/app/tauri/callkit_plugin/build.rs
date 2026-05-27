use std::{
    env, fs,
    path::{Path, PathBuf},
    process::Command,
};

const PLUGIN_NAME: &str = "tauri-plugin-call-kit";
const COMMANDS: &[&str] = &[
    "get_voip_token",
    "end_active_call",
    "get_pending_answered_call",
    "watch_call_answered",
    "watch_call_ended",
    "get_active_call_state",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).try_build().unwrap();

    if env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("ios") {
        link_ios_swift_package();
    }
}

fn link_ios_swift_package() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let ios_dir = manifest_dir.join("ios");
    let tauri_library_path = PathBuf::from(
        env::var("DEP_TAURI_IOS_LIBRARY_PATH")
            .expect("missing DEP_TAURI_IOS_LIBRARY_PATH; make sure tauri is a plugin dependency"),
    );

    // Tauri's Swift package is exposed to plugin build scripts as an unpacked
    // dependency path, but SwiftPM needs it available from the plugin package's
    // local `.tauri/tauri-api` path. Keep this as a copy so the plugin's
    // Package.swift can use the same layout Tauri's generated Xcode project
    // expects.
    let tauri_api_dir = ios_dir.join(".tauri").join("tauri-api");
    let _ = fs::remove_dir_all(&tauri_api_dir);
    copy_dir_filtered(
        &tauri_library_path,
        &tauri_api_dir,
        &[".build", "Package.resolved", "Tests"],
    );

    let target = env::var("TARGET").unwrap();
    let (sdk, triple, output_triple, clang_rt, xcode_arch) = match target.as_str() {
        "aarch64-apple-ios" => (
            "iphoneos",
            format!("arm64-apple-ios{}", ios_deployment_target()),
            "arm64-apple-ios",
            "ios",
            "arm64",
        ),
        "aarch64-apple-ios-sim" => (
            "iphonesimulator",
            format!("arm64-apple-ios{}-simulator", ios_deployment_target()),
            "arm64-apple-ios-simulator",
            "iossim",
            "arm64",
        ),
        "x86_64-apple-ios" => (
            "iphonesimulator",
            format!("x86_64-apple-ios{}-simulator", ios_deployment_target()),
            "x86_64-apple-ios-simulator",
            "iossim",
            "x86_64",
        ),
        _ => return,
    };

    let sdk_path = command_output("xcrun", &["--sdk", sdk, "--show-sdk-path"]);
    let configuration = if env::var("DEBUG").as_deref() == Ok("true") {
        "debug"
    } else {
        "release"
    };
    // Build SwiftPM inside Cargo OUT_DIR. Building in ios/.build makes Cargo
    // and SwiftPM observe each other's generated files and can cause pointless
    // rebuild loops.
    let build_path = PathBuf::from(env::var("OUT_DIR").unwrap())
        .join("swift-rs")
        .join(PLUGIN_NAME);
    let module_cache_path = build_path.join("module-cache");
    fs::create_dir_all(&module_cache_path).unwrap();

    link_swift_runtime(sdk, clang_rt, &triple);

    // Cargo is cross-compiling Rust for iOS, but SwiftPM defaults to the host
    // macOS destination unless we give it the iOS triple and SDK explicitly.
    // That destination is also how SwiftPM chooses the right XCFramework slice
    // for LiveKitWebRTC/RustLiveKitUniFFI.
    let status = Command::new("swift")
        .current_dir(&ios_dir)
        .arg("build")
        .arg("--disable-sandbox")
        .args(["--triple", &triple])
        .args(["-c", configuration])
        .args(["--build-path", &build_path.display().to_string()])
        .args(["-Xswiftc", "-sdk"])
        .args(["-Xswiftc", sdk_path.trim()])
        .args(["-Xcc", &format!("--target={triple}")])
        .args(["-Xcc", "-isysroot"])
        .args(["-Xcc", sdk_path.trim()])
        .args(["-Xcxx", &format!("--target={triple}")])
        .args(["-Xcxx", "-isysroot"])
        .args(["-Xcxx", sdk_path.trim()])
        .env("CLANG_MODULE_CACHE_PATH", &module_cache_path)
        .env("SWIFTPM_MODULECACHE_OVERRIDE", &module_cache_path)
        // Xcode exports SDKROOT for its own clang/swift invocations. Leaving it
        // in the environment can make SwiftPM compile the package manifest for
        // macOS while using the iPhoneOS sysroot.
        .env_remove("SDKROOT")
        .status()
        .expect("failed to run swift build for callkit plugin");
    assert!(status.success(), "failed to compile Swift callkit plugin");

    let search_path = build_path.join(output_triple).join(configuration);
    stage_xcode_frameworks(&manifest_dir, &search_path, xcode_arch, configuration);

    // Watch only hand-written Swift package inputs. The copied Tauri API,
    // SwiftPM build directory, and staged frameworks are generated during this
    // build script and should not themselves retrigger Cargo.
    emit_ios_source_rerun_inputs(&ios_dir);
    println!(
        "cargo:rustc-link-search=framework={}",
        search_path.display()
    );
    println!("cargo:rustc-link-search=native={}", search_path.display());
    println!("cargo:rustc-link-lib=static={PLUGIN_NAME}");
}

fn stage_xcode_frameworks(
    manifest_dir: &Path,
    swift_build_dir: &Path,
    xcode_arch: &str,
    configuration: &str,
) {
    let Some(tauri_dir) = manifest_dir.parent() else {
        return;
    };
    let externals_dir = tauri_dir
        .join("src-tauri")
        .join("gen")
        .join("apple")
        .join("Externals")
        .join(xcode_arch)
        .join(configuration);

    for framework in ["LiveKitWebRTC.framework", "RustLiveKitUniFFI.framework"] {
        let source = swift_build_dir.join(framework);
        if !source.exists() {
            continue;
        }

        let target = externals_dir.join(framework);
        let _ = fs::remove_dir_all(&target);
        // Xcode links the final app, not Cargo. Stage SwiftPM's binary
        // frameworks into the generated Xcode Externals directory so the app
        // link step can find the symbols referenced by the Swift static lib.
        copy_dir_filtered_without_rerun(&source, &target, &[]);
    }
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

fn ios_deployment_target() -> String {
    env::var("IPHONEOS_DEPLOYMENT_TARGET").unwrap_or_else(|_| "14.0".into())
}

fn link_swift_runtime(sdk: &str, clang_rt: &str, triple: &str) {
    let swiftc = command_output("xcrun", &["--sdk", sdk, "--find", "swiftc"]);
    let swift_lib_dir = Path::new(swiftc.trim())
        .ancestors()
        .nth(2)
        .expect("unexpected swiftc path")
        .join("lib")
        .join("swift")
        .join(sdk);
    println!("cargo:rustc-link-search=native={}", swift_lib_dir.display());
    println!("cargo:rustc-link-search=native=/usr/lib/swift");
    println!("cargo:rustc-link-lib=clang_rt.{clang_rt}");
    // swift build produces a static archive, but the Rust crate still needs
    // linker search paths for Swift runtime and compiler-rt support libraries.
    println!("cargo:rustc-link-search={}", clang_link_search_path(triple));
}

fn clang_link_search_path(triple: &str) -> String {
    let output =
        Command::new(env::var("SWIFT_RS_CLANG").unwrap_or_else(|_| "/usr/bin/clang".into()))
            .arg(format!("--target={triple}"))
            .arg("--print-search-dirs")
            .output()
            .expect("failed to get clang search paths");
    assert!(output.status.success(), "clang --print-search-dirs failed");

    let stdout = String::from_utf8_lossy(&output.stdout);
    for line in stdout.lines() {
        if let Some(path) = line.strip_prefix("libraries: =") {
            return format!("{path}/lib/darwin");
        }
    }
    panic!("clang is missing library search paths");
}

fn command_output(command: &str, args: &[&str]) -> String {
    let output = Command::new(command)
        .args(args)
        .output()
        .unwrap_or_else(|e| panic!("failed to run {command}: {e}"));
    assert!(
        output.status.success(),
        "{} {} failed",
        command,
        args.join(" ")
    );
    String::from_utf8(output.stdout).expect("command output was not utf-8")
}

fn copy_dir_filtered(source: &Path, target: &Path, ignore_paths: &[&str]) {
    copy_dir_filtered_inner(source, target, ignore_paths, true);
}

fn copy_dir_filtered_without_rerun(source: &Path, target: &Path, ignore_paths: &[&str]) {
    copy_dir_filtered_inner(source, target, ignore_paths, false);
}

fn copy_dir_filtered_inner(source: &Path, target: &Path, ignore_paths: &[&str], emit_rerun: bool) {
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
            copy_dir_filtered_inner(&source_path, &target_path, ignore_paths, emit_rerun);
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
            if emit_rerun && should_emit_rerun_for_source(&source_path) {
                emit_rerun_if_changed(&source_path);
            }
        }
    }
}

fn should_emit_rerun_for_source(source_path: &Path) -> bool {
    if env::var_os("OUT_DIR")
        .map(PathBuf::from)
        .is_some_and(|out_dir| source_path.starts_with(out_dir))
    {
        return false;
    }

    !source_path.components().any(|component| {
        let name = component.as_os_str();
        name == ".build" || name == ".tauri"
    })
}
