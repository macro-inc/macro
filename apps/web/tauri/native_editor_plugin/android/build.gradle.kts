plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
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

dependencies {
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("net.java.dev.jna:jna:5.14.0@aar")
    testImplementation("junit:junit:4.13.2")
    testImplementation("net.java.dev.jna:jna:5.14.0")
    testImplementation("org.robolectric:robolectric:4.14.1")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test.uiautomator:uiautomator:2.3.0")
}

// Without a target, tests compile the native API without packaging a device library.
// Device runs select their Rust target explicitly, including emulator x86_64.
providers.gradleProperty("nativeSessionTarget").orNull?.let { target ->
    val abi = when (target) {
        "aarch64-linux-android" -> "arm64-v8a"
        "x86_64-linux-android" -> "x86_64"
        "armv7-linux-androideabi" -> "armeabi-v7a"
        "i686-linux-android" -> "x86"
        else -> throw GradleException("Unsupported native session target")
    }
    val repository = projectDir.resolve("../../../../..").canonicalFile
    val buildNativeSession = tasks.register<Exec>("buildNativeSession") {
        workingDir(repository)
        commandLine("bun", "crates/client/document_session_ffi/scripts/build-android.ts", target)
    }
    val packageNativeSession = tasks.register<Copy>("packageNativeSession") {
        dependsOn(buildNativeSession)
        from(repository.resolve("target/$target/debug/libdocument_session_ffi.so"))
        into(layout.buildDirectory.dir("generated/nativeSession/$abi"))
    }
    android.sourceSets["main"].jniLibs.srcDir(layout.buildDirectory.dir("generated/nativeSession"))
    tasks.named("preBuild").configure { dependsOn(packageNativeSession) }
}
