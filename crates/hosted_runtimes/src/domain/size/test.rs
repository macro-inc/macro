use super::*;

#[test]
fn literal_size_specs() {
    assert_eq!(
        ComputerSize::Standard.spec(),
        ComputerSpec {
            units: 1,
            vcpus: 4,
            memory_gb: 8,
            disk_gb: 100,
            incus_cpu: "4",
            incus_memory: "8GiB",
            incus_root_size: "100GiB",
            incus_state_size: "9GiB",
        }
    );
    assert_eq!(
        ComputerSize::Large.spec(),
        ComputerSpec {
            units: 2,
            vcpus: 8,
            memory_gb: 16,
            disk_gb: 200,
            incus_cpu: "8",
            incus_memory: "16GiB",
            incus_root_size: "200GiB",
            incus_state_size: "17GiB",
        }
    );
    assert_eq!(
        ComputerSize::Xl.spec(),
        ComputerSpec {
            units: 4,
            vcpus: 16,
            memory_gb: 32,
            disk_gb: 400,
            incus_cpu: "16",
            incus_memory: "32GiB",
            incus_root_size: "400GiB",
            incus_state_size: "33GiB",
        }
    );
}
