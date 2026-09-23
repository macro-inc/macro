plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.macro.auth"
    compileSdk = 36
    defaultConfig { minSdk = 24 }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
    kotlinOptions { jvmTarget = "1.8" }
}

dependencies {
    implementation(project(":tauri-android"))
    implementation("androidx.browser:browser:1.9.0")
    implementation("androidx.activity:activity-ktx:1.10.1")
    testImplementation("junit:junit:4.13.2")
}
