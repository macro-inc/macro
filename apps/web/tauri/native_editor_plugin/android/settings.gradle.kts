// Standalone native host checks, before Tauri generates its app plugin includes.
pluginManagement {
    repositories { google(); mavenCentral(); gradlePluginPortal() }
    plugins {
        id("com.android.library") version "8.11.0"
        id("org.jetbrains.kotlin.android") version "1.9.25"
    }
}
dependencyResolutionManagement {
    repositories { google(); mavenCentral() }
}
rootProject.name = "macro-native-editor"
val tauriAndroidPath = providers.gradleProperty("tauriAndroidPath")
    .orElse(providers.environmentVariable("TAURI_ANDROID_PROJECT_PATH")).orNull
    ?: throw GradleException("Use scripts/android-check.ts to locate the pinned Tauri Android project")
include(":tauri-android")
project(":tauri-android").projectDir = file(tauriAndroidPath)
