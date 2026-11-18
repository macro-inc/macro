import groovy.json.JsonSlurper

// The Kotlin half of rustls-platform-verifier must be the version the resolved
// Rust crate expects, so read it from Cargo rather than pinning it here. Upstream
// publishes the AAR to a Maven repository on a GitHub branch; Gradle checks it
// against the SHA-256 in gradle/verification-metadata.xml, so a version bump must
// pin the new artifact there before the build passes.
val metadata = providers.exec {
    workingDir(file("../../.."))
    commandLine("cargo", "metadata", "--format-version", "1", "--locked",
        "--filter-platform", "aarch64-linux-android")
}.standardOutput.asText.get()
val packages = (JsonSlurper().parseText(metadata) as Map<*, *>)["packages"] as List<*>
val verifierVersion = packages.map { it as Map<*, *> }
    .single { it["name"] == "rustls-platform-verifier-android" }["version"]

// Only upstream's repository may serve org.rustls; the project's other
// repositories are never asked for it.
repositories {
    exclusiveContent {
        forRepository {
            maven {
                url = uri("https://github.com/rustls/rustls-platform-verifier/raw/maven-archive/android-release-support/maven/")
                metadataSources { artifact() }
            }
        }
        filter { includeGroup("org.rustls") }
    }
}
dependencies {
    add("implementation", "org.rustls:rustls-platform-verifier:$verifierVersion@aar")
}
