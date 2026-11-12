/** Mount point of the EFS access point; the upstream entrypoint owns `/openbao/file`. */
export const DATA_MOUNT_PATH = '/openbao/file';
export const API_PORT = 8200;
// The AWS KMS seal plugin (openbao-plugins `kms-aws`), pinned by digest.
const AWS_KMS_PLUGIN_VERSION = 'v0.1.1';
const AWS_KMS_PLUGIN_IMAGE = `ghcr.io/openbao/openbao-plugin-kms-aws:${AWS_KMS_PLUGIN_VERSION}@sha256:24a0a1294385a34224848d0d6ff2c9287f9c9b0ded1de953cc539dc76ced160c`;

/**
 * The server HCL. The upstream image's entrypoint writes `BAO_LOCAL_CONFIG` to
 * `/openbao/config/local.json`, which the HCL parser reads as HCL.
 *
 * Request duration, Raft layout and the redacted `passwords` audit device match
 * the Passwords local stack config (landing with Passwords); its hosted
 * provisioning will refuse a vault without that audit device. The seal is AWS
 * KMS, never the local static seal.
 */
export function renderServerConfig(args: {
  apiAddress: string;
  region: string;
  sealKeyArn: string;
}): string {
  return `ui = false
disable_mlock = true
log_format = "json"
default_max_request_duration = "90s"
api_addr = "${args.apiAddress}"
cluster_addr = "https://127.0.0.1:8201"

# TLS terminates at the internal ALB; only its security group reaches this port.
listener "tcp" {
  address = "0.0.0.0:${API_PORT}"
  tls_disable = true
}

storage "raft" {
  path = "${DATA_MOUNT_PATH}/data"
  node_id = "macro-dev"
}

# OpenBao 2.7 no longer builds in the AWS KMS seal; it is an external plugin,
# downloaded (digest-pinned) into the data volume at startup.
plugin_directory = "${DATA_MOUNT_PATH}/plugins"
plugin_auto_download = true

plugin "kms" "awskms" {
  image = "${AWS_KMS_PLUGIN_IMAGE}"
  version = "${AWS_KMS_PLUGIN_VERSION}"
}

seal "awskms" {
  region = "${args.region}"
  kms_key_id = "${args.sealKeyArn}"
}

audit "file" "passwords" {
  options {
    file_path = "stdout"
    log_raw = "false"
  }
}
`;
}
