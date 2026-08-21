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
fn upgrades_are_hot_and_downgrades_are_cold() {
    assert_eq!(
        resize_kind(SandboxSize::Small, SandboxSize::Default),
        SandboxResizeKind::Hot
    );
    assert_eq!(
        resize_kind(SandboxSize::Default, SandboxSize::Large),
        SandboxResizeKind::Hot
    );
    assert_eq!(
        resize_kind(SandboxSize::Small, SandboxSize::Large),
        SandboxResizeKind::Hot
    );
    assert_eq!(
        resize_kind(SandboxSize::Large, SandboxSize::Default),
        SandboxResizeKind::Cold
    );
    assert_eq!(
        resize_kind(SandboxSize::Default, SandboxSize::Small),
        SandboxResizeKind::Cold
    );
    assert_eq!(
        resize_kind(SandboxSize::Default, SandboxSize::Default),
        SandboxResizeKind::NoOp
    );
}
