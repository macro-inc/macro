use super::*;

#[test]
fn resources_come_from_sandbox_sizes_json() {
    let table: serde_json::Value =
        serde_json::from_str(SANDBOX_SIZES_JSON).expect("sandbox_sizes.json should parse");
    for (size, key) in [
        (SandboxSize::Small, "small"),
        (SandboxSize::Default, "default"),
        (SandboxSize::Large, "large"),
    ] {
        let row = &table[key];
        assert_eq!(
            resources(size),
            SandboxResources {
                cpu: row["cpu"].as_u64().unwrap() as u32,
                memory_gib: row["memoryGib"].as_u64().unwrap() as u32,
                disk_gib: row["diskGib"].as_u64().unwrap() as u32,
            }
        );
    }
}

#[test]
fn snapshot_matches_default_cpu_and_ram() {
    let snapshot = snapshot();
    let default = resources(SandboxSize::Default);
    assert_eq!(snapshot.cpu, default.cpu);
    assert_eq!(snapshot.memory_gib, default.memory_gib);
}

#[test]
fn cpu_ram_increases_are_in_place_and_decreases_need_a_restart() {
    assert_eq!(
        resize_effect(SandboxSize::Small, SandboxSize::Default),
        SandboxResizeEffect::InPlace
    );
    assert_eq!(
        resize_effect(SandboxSize::Default, SandboxSize::Large),
        SandboxResizeEffect::InPlace
    );
    assert_eq!(
        resize_effect(SandboxSize::Small, SandboxSize::Large),
        SandboxResizeEffect::InPlace
    );
    assert_eq!(
        resize_effect(SandboxSize::Large, SandboxSize::Default),
        SandboxResizeEffect::Restart
    );
    assert_eq!(
        resize_effect(SandboxSize::Default, SandboxSize::Small),
        SandboxResizeEffect::Restart
    );
    assert_eq!(
        resize_effect(SandboxSize::Default, SandboxSize::Default),
        SandboxResizeEffect::NoOp
    );
}

#[test]
fn live_quotas_that_are_not_named_tiers_still_pick_in_place_or_restart() {
    let smaller = SandboxResources {
        cpu: resources(SandboxSize::Small).cpu,
        memory_gib: resources(SandboxSize::Small).memory_gib,
        disk_gib: snapshot().disk_gib,
    };
    assert_eq!(
        resize_effect_from_resources(smaller, resources(SandboxSize::Default)),
        SandboxResizeEffect::InPlace
    );
    assert_eq!(
        resize_effect_from_resources(resources(SandboxSize::Default), smaller),
        SandboxResizeEffect::Restart
    );
    assert_eq!(
        resize_effect_from_resources(smaller, smaller),
        SandboxResizeEffect::NoOp
    );
}

#[test]
fn default_is_a_cpu_ram_noop_against_the_snapshot() {
    assert_eq!(
        resize_effect_from_resources(snapshot(), resources(SandboxSize::Default)),
        SandboxResizeEffect::NoOp
    );
}

#[test]
fn create_only_managers_cannot_change_size() {
    assert_eq!(
        create_only_resize_effect(SandboxSize::Default, SandboxSize::Default),
        SandboxResizeEffect::NoOp
    );
    assert_eq!(
        create_only_resize_effect(SandboxSize::Default, SandboxSize::Large),
        SandboxResizeEffect::Unsupported
    );
}
