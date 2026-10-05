import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
    id("com.google.gms.google-services") apply false
}

// Debug auth/navigation work can run before a Firebase project is provisioned.
// Release artifacts must be built with the real application configuration.
val firebaseConfigured = file("google-services.json").isFile
val keystorePropertiesFile = rootProject.file("keystore.properties")
// Defer signing failures until release work is requested so debug builds remain usable.
val releaseSigningProperties = runCatching {
    if (!keystorePropertiesFile.isFile) {
        throw GradleException("Release builds require keystore.properties; see docs/ANDROID_DEVELOPMENT.md")
    }
    val properties = Properties().apply {
        keystorePropertiesFile.inputStream().use { load(it) }
    }
    for (name in listOf("keyAlias", "keyPassword", "storePassword", "storeFile")) {
        if (properties.getProperty(name).isNullOrBlank()) {
            throw GradleException("Missing $name in keystore.properties; see docs/ANDROID_DEVELOPMENT.md")
        }
    }
    if (!rootProject.file(properties.getProperty("storeFile")).isFile) {
        throw GradleException("Signing keystore does not exist")
    }
    properties
}

if (firebaseConfigured) {
    apply(plugin = "com.google.gms.google-services")
}
gradle.taskGraph.whenReady {
    if (!firebaseConfigured && allTasks.any { it.name.contains("Release") }) {
        throw GradleException("Release builds require app/google-services.json for com.macro.app.prod; see docs/ANDROID_DEVELOPMENT.md")
    }
    if (allTasks.any { it.name.contains("Release") }) {
        releaseSigningProperties.getOrThrow()
    }
}

val tauriProperties = Properties().apply {
    val propFile = file("tauri.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

android {
    compileSdk = 36
    namespace = "com.macro.app.prod"
    defaultConfig {
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        applicationId = "com.macro.app.prod"
        minSdk = 24
        targetSdk = 36
        versionCode = tauriProperties.getProperty("tauri.android.versionCode", "1").toInt()
        versionName = tauriProperties.getProperty("tauri.android.versionName", "1.0")
    }
    signingConfigs {
        releaseSigningProperties.getOrNull()?.let { properties ->
            create("release") {
                keyAlias = properties.getProperty("keyAlias")
                keyPassword = properties.getProperty("keyPassword")
                storePassword = properties.getProperty("storePassword")
                storeFile = rootProject.file(properties.getProperty("storeFile"))
            }
        }
    }
    buildTypes {
        getByName("debug") {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
            isJniDebuggable = true
            isMinifyEnabled = false
            packaging {
                jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")
                jniLibs.keepDebugSymbols.add("*/armeabi-v7a/*.so")
                jniLibs.keepDebugSymbols.add("*/x86/*.so")
                jniLibs.keepDebugSymbols.add("*/x86_64/*.so")
            }
        }
        getByName("release") {
            signingConfig = signingConfigs.findByName("release")
            isMinifyEnabled = true
            proguardFiles(
                *fileTree(".") { include("**/*.pro") }
                    .plus(getDefaultProguardFile("proguard-android-optimize.txt"))
                    .toList().toTypedArray()
            )
        }
    }
    kotlinOptions {
        jvmTarget = "1.8"
    }
    buildFeatures {
        buildConfig = true
    }
}

rust {
    rootDirRel = "../../../"
}

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("com.google.android.material:material:1.12.0")
    implementation("com.google.firebase:firebase-messaging:24.0.0")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.4")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")
}

apply(from = "tauri.build.gradle.kts")
apply(from = "rustls-verifier.gradle.kts")
