use super::*;

fn rendered() -> String {
    build_cef_codecs()
        .to_string()
        .expect("workflow should serialize")
}

#[test]
fn builds_on_the_large_mac_runner_without_cancelling() {
    let yaml = rendered();
    assert!(yaml.contains("nscloud-macos-sequoia-arm64-12x28"), "{yaml}");
    assert!(yaml.contains("cancel-in-progress: false"), "{yaml}");
    assert!(yaml.contains("contents: write"), "{yaml}");
}

#[test]
fn builds_with_proprietary_codecs() {
    let yaml = rendered();
    assert!(yaml.contains("proprietary_codecs=true"), "{yaml}");
    assert!(yaml.contains("ffmpeg_branding=Chrome"), "{yaml}");
    assert!(yaml.contains("--prerelease --latest=false"), "{yaml}");
}
