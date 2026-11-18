//! Steps shared by the signed Android release builds:
//! [`super::android_play_release`] (the Play App Bundle) and
//! [`super::android_apk_on_release`] (the sideloadable APK). Both build the
//! same production web bundle, so its `VITE_*` environment lives here once.

use gh_workflow::{Expression, Run, Step, Use};

use crate::workflows::vars;

/// The package format a release build produces.
#[derive(Clone, Copy)]
pub enum Artifact {
    /// App Bundle, uploaded to Google Play.
    Aab,
    /// ARM64 APK, attached to the production GitHub release for sideloading.
    Apk,
}

pub fn install_android_sdk() -> Step<Run> {
    Step::new("Install Android SDK components")
        .run(indoc::indoc! {r#"
            set -euo pipefail
            export JAVA_HOME="$JAVA_HOME_21_X64"
            export PATH="$JAVA_HOME/bin:$PATH"
            "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" \
              'platforms;android-36' 'build-tools;36.0.0' 'ndk;30.0.16248370'
            echo "JAVA_HOME=$JAVA_HOME" >> "$GITHUB_ENV"
            echo "NDK_HOME=$ANDROID_HOME/ndk/30.0.16248370" >> "$GITHUB_ENV"
        "#})
        .shell("bash")
}

/// Build the signed release `artifact` with the production web environment.
/// Expects the signing, Firebase, and release config files that the calling
/// workflow's "Prepare version and signing" step provisions.
pub fn build(artifact: Artifact) -> Step<Run> {
    let (name, args) = match artifact {
        Artifact::Aab => (
            "Build production App Bundle",
            ("--aab", "--apk false --aab true"),
        ),
        Artifact::Apk => ("Build production APK", ("--apk", "--apk true --aab false")),
    };
    let script = indoc::indoc! {r#"
        set -euo pipefail
        # Without the key the app silently skips PostHog, so every feature flag
        # reads false. An unset or empty secret must fail the build instead.
        if [[ -z "${VITE_POSTHOG_API_KEY:-}" ]]; then
          echo "VITE_POSTHOG_API_KEY is empty: the POSTHOG_API_KEY secret is unavailable to this run." >&2
          exit 1
        fi
        # The Nix environment is already loaded. Do not reload it in nested
        # bash processes and re-enable its local-development sccache wrapper.
        # This ephemeral runner has no compiler cache/server to reuse.
        unset BASH_ENV
        export RUSTC_WRAPPER=""
        cargo tauri --version
        # Tauri has shipped both switch-only and value-taking APK/AAB flags.
        # Nix and local installations can differ; build only one format with either CLI.
        android_help=$(cargo tauri android build --help)
        artifact_args=(SWITCH_ARGS)
        if [[ "$android_help" == *'--apk <APK>'* ]]; then
          artifact_args=(VALUE_ARGS)
        fi
        just android-build --firebase-config "$RUNNER_TEMP/android-google-services.json" \
          "${artifact_args[@]}" --ci --config "$RUNNER_TEMP/android-release.json" \
          2>&1 | tee "$RUNNER_TEMP/android-build.log"
    "#}
    .replace("SWITCH_ARGS", args.0)
    .replace("VALUE_ARGS", args.1);
    Step::new(name)
        .run(script)
        .shell("bash")
        .working_directory(xtask_paths::repo_dir!("apps/web"))
        .add_env((
            "VITE_SEGMENT_WRITE_KEY",
            "${{ secrets.SEGMENT_WRITE_KEY_PRODUCTION }}",
        ))
        .add_env(("VITE_POSTHOG_API_KEY", vars::POSTHOG_API_KEY))
        .add_env((
            "VITE_OTEL_EXPORTER_URL",
            "https://macro-prox-prod.macroverse.workers.dev/i/otlp/v1/traces",
        ))
        .add_env(("VITE_OTEL_ENV", "prod"))
}

pub fn preserve_build_log() -> Step<Use> {
    Step::new("Preserve Android build log")
        .uses(
            "actions",
            "upload-artifact",
            "ea165f8d65b6e75b540449e92b4886f43607fa02",
        ) // v4
        .if_condition(Expression::new("always()"))
        .add_with(("name", "android-build-log"))
        .add_with(("path", "${{ runner.temp }}/android-build.log"))
        .add_with(("if-no-files-found", "ignore"))
        .add_with(("retention-days", 7))
}

pub fn remove_signing_material() -> Step<Run> {
    Step::new("Remove signing material")
        .run(indoc::indoc! {r#"
            rm -rf "$RUNNER_TEMP/android-signing" "$RUNNER_TEMP/android-release.json" \
              "$RUNNER_TEMP/android-google-services.json" || true
            rm -f apps/web/tauri/src-tauri/gen/android/keystore.properties || true
        "#})
        .if_condition(Expression::new("always()"))
        .shell("bash")
}
