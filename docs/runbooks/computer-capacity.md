# Computer capacity

Macro computers are sold in units (8 GiB or 4 vCPUs, whichever needs more) on
bare-metal Incus hosts. A host sells `awake capacity × oversell factor` units,
and every computer holds its units from reservation until payment is refused or
it is destroyed, whether it is running or stopped. A purchase that no host can
fit is refused ("No capacity for <size> right now") and the size shows Sold out
with Notify me.

agent_harness_service gauges this every reconcile pass as
`computer.capacity.allocated` and `computer.capacity.total`
(`scope:host|fleet`, `resource:sold_units|vcpus|memory_gib|disk_gib`).
The monitors in `infra/stacks/monitoring/monitors/computers.ts` warn at 70% and
alert at 85% of sold units, per host and across the fleet.

## Order another box

1. Open the Computer capacity alerts dashboard linked from the alert and check
   whether one host or the whole fleet is filling. A full host with room
   elsewhere still sells every size that fits another host.
2. Order another bare-metal host and bring it up as a runtime host
   (`nix/hosts/README.md`). It registers its capacity when its operator starts.
3. Released and payment-failed computers free their units at once; nothing
   else needs to be cleaned up to make room.

Disk is reported (`resource:disk_gib`) but hosts record no storage-pool size,
so it has no total and no alert. Check pool usage on the host by hand
(`incus storage info <pool>`) when ordering.
