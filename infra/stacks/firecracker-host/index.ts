// A GCP host for Firecracker computers. See AGENTS.md.
import * as gcp from '@pulumi/gcp';
import * as pulumi from '@pulumi/pulumi';

// Not `stack` from packages/shared: its module reads the AWS region at load
// and throws without one, and this is the one GCP stack.
const stack = pulumi.getStack();
const config = new pulumi.Config();
const gcpConfig = new pulumi.Config('gcp');
const project = gcpConfig.require('project');
const zone = gcpConfig.require('zone');
const region = zone.split('-').slice(0, 2).join('-');

/** Where KVM comes from: nested virtualization on a VM shape, or bare metal. */
const HOST_KINDS = ['nested', 'metal'] as const;
type HostKind = (typeof HOST_KINDS)[number];

function isHostKind(value: string): value is HostKind {
  return HOST_KINDS.some((kind) => kind === value);
}

/** The one durable disk: the ZFS pool every computer lives on. */
interface DurableDisk {
  /** `pd-ssd` on N2; `hyperdisk-balanced` on C3, N4 and Z3 (and metal). */
  type: 'pd-ssd' | 'hyperdisk-balanced';
  sizeGb: number;
  /** Hyperdisk Balanced only: IOPS and MiB/s, provisioned apart from size. */
  provisionedIops?: number;
  provisionedThroughput?: number;
}

const hostName = config.require('hostName');
const hostKindValue = config.require('hostKind');
if (!isHostKind(hostKindValue)) {
  throw new Error(`hostKind must be one of ${HOST_KINDS.join(', ')}`);
}
const hostKind: HostKind = hostKindValue;
const machineType = config.require('machineType');
if ((hostKind === 'metal') !== machineType.endsWith('-metal')) {
  throw new Error(
    `hostKind ${hostKind} does not match machineType ${machineType}`
  );
}
const durableDisk = config.requireObject<DurableDisk>('durableDisk');
if (hostKind === 'metal' && durableDisk.type !== 'hyperdisk-balanced') {
  throw new Error(
    'metal shapes attach Hyperdisk only: durableDisk.type must be hyperdisk-balanced'
  );
}
const subnetCidr = config.require('subnetCidr');
// The agent API (TCP `agentPort`) on the NIC, for a control plane without a
// tunnel (dev only). Production hosts leave it empty and use the tunnel.
const controlPlaneSources =
  config.getObject<string[]>('controlPlaneSources') ?? [];
// Same default as the NixOS module's `macro.firecrackerHost.port`.
const agentPort = config.getNumber('agentPort') ?? 8444;
// The WireGuard gateway's public addresses: the only sources of UDP 51820.
const tunnelGatewaySources =
  config.getObject<string[]>('tunnelGatewaySources') ?? [];
// Same default as the module's `macro.firecrackerHost.tunnel.listenPort`.
const tunnelPort = config.getNumber('tunnelPort') ?? 51820;
// The installer image; nixos-anywhere replaces it with NixOS on first install.
const installerImage =
  config.get('installerImage') ?? 'ubuntu-os-cloud/ubuntu-2404-lts-amd64';

// IAP's TCP forwarding range: the only SSH source.
const IAP_SOURCE_RANGE = '35.235.240.0/20';
const NETWORK_TAG = 'firecracker-host';
// The label keys every Macro stack tags with.
const labels = {
  project: 'firecracker-host',
  environment: stack,
  tech_lead: 'wolf',
};

// GCP service account ids are 6-30 characters.
const SERVICE_ACCOUNT_ID_MAX_LENGTH = 30;
const serviceAccountId = `firecracker-${hostName}`;
if (serviceAccountId.length > SERVICE_ACCOUNT_ID_MAX_LENGTH) {
  throw new Error(
    `service account id ${serviceAccountId} is longer than ${SERVICE_ACCOUNT_ID_MAX_LENGTH} characters: shorten hostName`
  );
}

// --- Identity: logs and metrics only (S-11) ---------------------------------

const serviceAccount = new gcp.serviceaccount.Account(
  `${hostName}-service-account`,
  {
    accountId: serviceAccountId,
    displayName: `Firecracker host ${hostName}: logs and metrics only`,
  }
);
const ROLES = ['roles/logging.logWriter', 'roles/monitoring.metricWriter'];
for (const role of ROLES) {
  new gcp.projects.IAMMember(`${hostName}-${role.split('/')[1]}`, {
    project,
    role,
    member: pulumi.interpolate`serviceAccount:${serviceAccount.email}`,
  });
}

// --- Network ------------------------------------------------------------------

const network = new gcp.compute.Network(`${hostName}-network`, {
  name: `${hostName}-network`,
  autoCreateSubnetworks: false,
  description: 'Firecracker computer hosts',
});
const subnet = new gcp.compute.Subnetwork(`${hostName}-${region}`, {
  name: `${hostName}-${region}`,
  network: network.id,
  region,
  ipCidrRange: subnetCidr,
  privateIpGoogleAccess: true,
});

// Ingress is denied unless a rule below admits it; egress stays open
// (guests reach the internet through the host's masquerade).
new gcp.compute.Firewall(`${hostName}-iap-ssh`, {
  network: network.id,
  direction: 'INGRESS',
  sourceRanges: [IAP_SOURCE_RANGE],
  targetTags: [NETWORK_TAG],
  allows: [{ protocol: 'tcp', ports: ['22'] }],
});
if (controlPlaneSources.length > 0) {
  new gcp.compute.Firewall(`${hostName}-agent-api`, {
    network: network.id,
    direction: 'INGRESS',
    sourceRanges: controlPlaneSources,
    targetTags: [NETWORK_TAG],
    allows: [{ protocol: 'tcp', ports: [String(agentPort)] }],
  });
}
if (tunnelGatewaySources.length > 0) {
  new gcp.compute.Firewall(`${hostName}-wireguard`, {
    network: network.id,
    direction: 'INGRESS',
    sourceRanges: tunnelGatewaySources,
    targetTags: [NETWORK_TAG],
    allows: [{ protocol: 'udp', ports: [String(tunnelPort)] }],
  });
}

// Static, so the gateway's peer endpoint and the control plane's allowlist
// survive a stop.
const address = new gcp.compute.Address(`${hostName}-address`, {
  name: `${hostName}-address`,
  region,
  addressType: 'EXTERNAL',
  networkTier: 'PREMIUM',
});

// --- Durable disk -------------------------------------------------------------

// Every computer's disks, goldens and hibernation files: never deleted with
// the stack.
const disk = new gcp.compute.Disk(
  `${hostName}-durable`,
  {
    name: `${hostName}-durable`,
    zone,
    type: durableDisk.type,
    size: durableDisk.sizeGb,
    provisionedIops:
      durableDisk.type === 'hyperdisk-balanced'
        ? durableDisk.provisionedIops
        : undefined,
    provisionedThroughput:
      durableDisk.type === 'hyperdisk-balanced'
        ? durableDisk.provisionedThroughput
        : undefined,
    labels,
  },
  { protect: true }
);

// --- Instance -----------------------------------------------------------------

const instance = new gcp.compute.Instance(
  hostName,
  {
    name: hostName,
    zone,
    machineType,
    deletionProtection: true,
    allowStoppingForUpdate: false,
    advancedMachineFeatures:
      hostKind === 'nested' ? { enableNestedVirtualization: true } : undefined,
    // Bare metal cannot live-migrate; nested VMs can.
    scheduling: {
      onHostMaintenance: hostKind === 'metal' ? 'TERMINATE' : 'MIGRATE',
      automaticRestart: true,
    },
    bootDisk: {
      autoDelete: true,
      // Metal shapes (C3, C4) attach Hyperdisk only.
      initializeParams: {
        image: installerImage,
        size: 100,
        type: hostKind === 'metal' ? 'hyperdisk-balanced' : 'pd-ssd',
      },
    },
    // /dev/disk/by-id/google-durable on the host (its disko layout).
    attachedDisks: [{ source: disk.id, deviceName: 'durable' }],
    networkInterfaces: [
      {
        subnetwork: subnet.id,
        // Metal shapes have only IDPF NICs; VM shapes use gVNIC.
        nicType: hostKind === 'metal' ? 'IDPF' : 'GVNIC',
        accessConfigs: [{ natIp: address.address, networkTier: 'PREMIUM' }],
      },
    ],
    serviceAccount: {
      email: serviceAccount.email,
      scopes: [
        'https://www.googleapis.com/auth/logging.write',
        'https://www.googleapis.com/auth/monitoring.write',
      ],
    },
    metadata: {
      'enable-oslogin': 'TRUE',
      'block-project-ssh-keys': 'TRUE',
    },
    tags: [NETWORK_TAG],
    labels,
  },
  // nixos-anywhere replaces the installer image in place.
  { ignoreChanges: ['bootDisk.initializeParams.image'] }
);

export const instanceName = instance.name;
export const externalAddress = address.address;
export const internalAddress = instance.networkInterfaces.apply(
  (interfaces) => interfaces[0]?.networkIp
);
export const serviceAccountEmail = serviceAccount.email;
