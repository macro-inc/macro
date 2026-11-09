plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

// Standalone checks include the pinned Tauri project under the same SDK floor.
if (rootProject == project) {
    subprojects {
        plugins.withId("com.android.library") {
            extensions.configure<com.android.build.gradle.LibraryExtension> {
                buildToolsVersion = "36.0.0"
                ndkVersion = "30.0.16248370"
            }
        }
    }
}

val rustHostVersion = providers.exec { commandLine("cargo", "-vV") }.standardOutput.asText
val rustHost = rustHostVersion.map { text ->
    text.lineSequence().first { it.startsWith("host: ") }.removePrefix("host: ")
}

android {
    namespace = "com.macro.editor"
    compileSdk = 36
    buildToolsVersion = "36.0.0"
    ndkVersion = "30.0.16248370"
    defaultConfig {
        minSdk = 24
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        consumerProguardFiles("consumer-rules.pro")
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
    kotlinOptions { jvmTarget = "1.8" }
    testOptions {
        unitTests.isIncludeAndroidResources = true
        unitTests.all {
            it.systemProperty("jna.library.path", file("../../../../../target/${rustHost.get()}/debug").absolutePath)
            it.systemProperty("jna.tmpdir", "/home/wolf/tmp")
            it.systemProperty("native.editor.probe.classpath", layout.buildDirectory.dir(
                "intermediates/javac/debugUnitTest/compileDebugUnitTestJavaWithJavac/classes"
            ).get().asFile.absolutePath)
        }
    }
    sourceSets["test"].java.srcDir("src/sharedTest/java")
    sourceSets["androidTest"].java.srcDir("src/sharedTest/java")
    sourceSets["main"].java.srcDir(
        "../../../../../crates/client/document_session_ffi/bindings"
    )
}

val jnaVersion = "5.19.1"

dependencies {
    implementation(project(":tauri-android"))
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("net.java.dev.jna:jna:$jnaVersion@aar")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("com.fasterxml.jackson.module:jackson-module-kotlin:2.15.3")
    testImplementation("junit:junit:4.13.2")
    testImplementation("net.java.dev.jna:jna:$jnaVersion")
    testImplementation("org.robolectric:robolectric:4.14.1")
    testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test.uiautomator:uiautomator:2.3.0")
}

// Standalone tests compile without device libraries unless a target is selected.
// App builds inherit the same target set that the generated Tauri Rust tasks use.
val nativeTargets = providers.gradleProperty("nativeSessionTarget").orNull?.split(',')
    ?: if (rootProject != project) {
        providers.gradleProperty("targetList").orElse("aarch64,armv7,i686,x86_64").get().split(',').map {
            when (it) {
                "aarch64" -> "aarch64-linux-android"
                "armv7" -> "armv7-linux-androideabi"
                "i686" -> "i686-linux-android"
                "x86_64" -> "x86_64-linux-android"
                else -> throw GradleException("Unsupported Tauri native session target")
            }
        }
    } else emptyList()
if (nativeTargets.isNotEmpty()) {
    android.defaultConfig.ndk.abiFilters.addAll(nativeTargets.map {
        when (it) {
            "aarch64-linux-android" -> "arm64-v8a"
            "x86_64-linux-android" -> "x86_64"
            "armv7-linux-androideabi" -> "armeabi-v7a"
            "i686-linux-android" -> "x86"
            else -> throw GradleException("Unsupported native session target")
        }
    })
}
val repository = projectDir.resolve("../../../../..").canonicalFile
for (profile in listOf("debug", "release")) {
    val profileName = profile.replaceFirstChar { it.uppercase() }
    if (nativeTargets.isNotEmpty()) {
        android.sourceSets[profile].jniLibs.srcDir(layout.buildDirectory.dir("generated/nativeSession/$profile"))
    }
    var previousBuild: org.gradle.api.tasks.TaskProvider<Exec>? = null
    for (target in nativeTargets) {
        val abi = when (target) {
            "aarch64-linux-android" -> "arm64-v8a"
            "x86_64-linux-android" -> "x86_64"
            "armv7-linux-androideabi" -> "armeabi-v7a"
            "i686-linux-android" -> "x86"
            else -> throw GradleException("Unsupported native session target")
        }
        val suffix = target.replace('-', '_')
        val preceding = previousBuild
        val buildNativeSession = tasks.register<Exec>("buildNativeSession$profileName$suffix") {
            preceding?.let { mustRunAfter(it) }
            workingDir(repository)
            commandLine(listOf("bun", "crates/client/document_session_ffi/scripts/build-android.ts", target) +
                if (profile == "release") listOf("--release") else emptyList())
        }
        previousBuild = buildNativeSession
        val packageNativeSession = tasks.register<Copy>("packageNativeSession$profileName$suffix") {
            dependsOn(buildNativeSession)
            from(repository.resolve("target/$target/$profile/libdocument_session_ffi.so"))
            into(layout.buildDirectory.dir("generated/nativeSession/$profile/$abi"))
        }
        tasks.matching { it.name == "merge${profileName}JniLibFolders" }.configureEach {
            dependsOn(packageNativeSession)
        }
    }
}
