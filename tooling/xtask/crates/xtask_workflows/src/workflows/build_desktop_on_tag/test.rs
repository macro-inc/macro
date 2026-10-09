use super::*;

fn rendered_yaml() -> String {
    build_desktop_on_tag()
        .to_string()
        .expect("desktop workflow should serialize")
}

#[test]
fn installers_publish_without_waiting_on_updater_signing() {
    let yaml = rendered_yaml();
    let installers = yaml
        .find("  publish-installers:")
        .expect("installer publish job");
    let updates = yaml
        .find("  publish-release:")
        .expect("updater publish job");

    // Both builds gate the installer upload, and nothing else does: a Doppler,
    // Apple, or update-feed failure must still leave a downloadable release.
    let installer_job = &yaml[installers..updates];
    assert!(
        installer_job.contains("- build-appimage"),
        "{installer_job}"
    );
    assert!(installer_job.contains("- build-dmg"), "{installer_job}");
    assert!(
        !installer_job.contains("sign_desktop_updates") && !installer_job.contains("DOPPLER_TOKEN"),
        "installer publication must not depend on updater signing:\n{installer_job}"
    );
}

#[test]
fn updater_publish_follows_the_installers() {
    let yaml = rendered_yaml();
    let updates = yaml
        .find("  publish-release:")
        .expect("updater publish job");
    // Serialized behind the installer upload so the two never race to attach
    // the same asset, which `gh release upload` rejects without --clobber.
    assert!(
        yaml[updates..].contains("- publish-installers"),
        "{}",
        &yaml[updates..]
    );
}

#[test]
fn hosted_publish_runner_skips_the_nix_cache_teardown() {
    let yaml = rendered_yaml();
    let updates = yaml
        .find("  publish-release:")
        .expect("updater publish job");
    // `fuser -km /nix` kills the runner itself where /nix is the root
    // filesystem, losing the job and its logs. Only cache-volume jobs tear down.
    assert!(
        !yaml[updates..].contains("teardown-nix"),
        "{}",
        &yaml[updates..]
    );
    assert!(yaml[updates..].contains("timeout-minutes: 20"));
}
