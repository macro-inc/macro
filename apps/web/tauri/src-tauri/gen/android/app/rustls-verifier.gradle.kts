import groovy.json.JsonSlurper

// Use the Maven artifact shipped by the resolved Rust crate, so its JNI API
// always matches the Rust verifier. Never substitute a separately versioned AAR.
val metadata = providers.exec {
    workingDir(file("../../.."))
    commandLine("cargo", "metadata", "--format-version", "1", "--locked",
        "--filter-platform", "aarch64-linux-android")
}.standardOutput.asText.get()
val packages = (JsonSlurper().parseText(metadata) as Map<*, *>)["packages"] as List<*>
val verifier = packages.map { it as Map<*, *> }
    .single { it["name"] == "rustls-platform-verifier-android" }
val manifest = File(verifier["manifest_path"] as String)

repositories {
    maven {
        url = uri(File(manifest.parentFile, "maven"))
        metadataSources { artifact() }
        content { includeGroup("rustls") }
    }
}
dependencies {
    add("implementation", "rustls:rustls-platform-verifier:${verifier["version"]}@aar")
}
