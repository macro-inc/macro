use super::*;

#[test]
fn opencode_only_list_rejects_codex_unknown_and_cloud_presets() {
    let allowlist = RuntimePresetAllowlist {
        preset_ids: vec![RuntimePreset::Opencode],
    };

    assert!(allowlist.permits("opencode"));
    assert!(!allowlist.permits("codex"));
    assert!(!allowlist.permits("codex-cloud"));
    assert!(!allowlist.permits("unknown"));
}

#[test]
fn newly_written_list_defaults_to_all_four_local_presets() {
    let allowlist = RuntimePresetAllowlist::default();

    for preset in ["opencode", "claude-code", "codex", "omp"] {
        assert!(allowlist.permits(preset));
    }
    assert!(!allowlist.permits("cursor"));
    assert!(!allowlist.permits("codex-cloud"));
}
