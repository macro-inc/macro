plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}
android {
    namespace = "com.macro.call"
    compileSdk = 36
    defaultConfig {
        minSdk = 24
        targetSdk = 36
        consumerProguardFiles("consumer-rules.pro")
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }
    compileOptions {
        isCoreLibraryDesugaringEnabled = true
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
    kotlinOptions { jvmTarget = "1.8" }
}
dependencies {
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.5")
    implementation(platform("io.opentelemetry:opentelemetry-bom:1.67.0"))
    implementation("io.opentelemetry:opentelemetry-sdk")
    // Supply the SDK's optional interfaces and annotation types for release shrinking.
    implementation("io.opentelemetry:opentelemetry-api-incubator:1.67.0-alpha")
    implementation("io.opentelemetry:opentelemetry-sdk-extension-autoconfigure-spi")
    implementation("com.google.auto.value:auto-value-annotations:1.11.0")
    implementation("com.google.errorprone:error_prone_annotations:2.30.0")
    // Share LiveKit's Android-compatible OkHttp transport instead of pulling in OkHttp 5's newer SDK/Kotlin floor.
    implementation("io.opentelemetry:opentelemetry-exporter-otlp") { exclude(group = "com.squareup.okhttp3") }
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    testImplementation("io.opentelemetry:opentelemetry-sdk-testing")
    androidTestImplementation("io.opentelemetry:opentelemetry-sdk-testing")
    androidTestImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
    implementation(project(":tauri-android"))
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    // The in-app call window listens for user-leave hints (OnUserLeaveHintProvider, activity 1.9+).
    implementation("androidx.activity:activity:1.10.1")
    implementation("io.livekit:livekit-android:2.29.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.6.4")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
    testImplementation("com.fasterxml.jackson.core:jackson-databind:2.15.3")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("com.fasterxml.jackson.core:jackson-databind:2.15.3")
}
