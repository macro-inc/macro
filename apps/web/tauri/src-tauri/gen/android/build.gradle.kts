buildscript {
    repositories {
        google()
        mavenCentral()
    }
    dependencies {
        classpath("com.android.tools.build:gradle:8.11.0")
        classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:1.9.25")
        classpath("com.google.gms:google-services:4.4.0")
    }
}

allprojects {
    listOf("com.android.application", "com.android.library").forEach { androidPlugin ->
        plugins.withId(androidPlugin) {
            extensions.configure<com.android.build.gradle.BaseExtension> {
                buildToolsVersion = "36.0.0"
                ndkVersion = "30.0.16248370"
            }
        }
    }
    repositories {
        google()
        mavenCentral()
        maven { url = uri("https://jitpack.io") }
    }
}

tasks.register("clean").configure {
    delete("build")
}

