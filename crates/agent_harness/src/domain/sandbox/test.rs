use super::*;

#[test]
fn disk_is_96_gib_for_every_tier() {
    for size in [SandboxSize::Small, SandboxSize::Default, SandboxSize::Large] {
        assert_eq!(resources(size).disk_gib, 96);
    }
}

#[test]
fn default_is_eight_cpu_sixteen_gib() {
    assert_eq!(
        resources(SandboxSize::Default),
        SandboxResources {
            cpu: 8,
            memory_gib: 16,
            disk_gib: 96,
        }
    );
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
    let snapshot = SandboxResources {
        cpu: 4,
        memory_gib: 8,
        disk_gib: 10,
    };
    assert_eq!(
        resize_effect_from_resources(snapshot, resources(SandboxSize::Default)),
        SandboxResizeEffect::InPlace
    );
    assert_eq!(
        resize_effect_from_resources(resources(SandboxSize::Default), snapshot),
        SandboxResizeEffect::Restart
    );
    assert_eq!(
        resize_effect_from_resources(snapshot, snapshot),
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
