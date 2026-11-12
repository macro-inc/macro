use super::*;

#[test]
fn capacity_uses_recorded_memory_and_cpu_rounding_up() {
    assert_eq!(
        ComputerResources {
            vcpus: Vcpus::new(4),
            memory_gib: MemoryGib::new(8),
            disk_gib: DiskGib::new(100)
        }
        .units(),
        1
    );
    assert_eq!(
        ComputerResources {
            vcpus: Vcpus::new(4),
            memory_gib: MemoryGib::new(9),
            disk_gib: DiskGib::new(100)
        }
        .units(),
        2
    );
    assert_eq!(
        ComputerResources {
            vcpus: Vcpus::new(9),
            memory_gib: MemoryGib::new(8),
            disk_gib: DiskGib::new(100)
        }
        .units(),
        3
    );
}
