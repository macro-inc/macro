/** Mount point of the EFS access point; the upstream entrypoint owns `/openbao/file`. */
export const DATA_MOUNT_PATH = '/openbao/file';
export const API_PORT = 8200;
/** Where `image/Dockerfile` puts the AWS KMS seal plugin; outside the volume. */
export const PLUGIN_DIRECTORY = '/usr/lib/openbao/plugins';
const KMS_AWS_PLUGIN_COMMAND = 'openbao-plugin-kms-aws';
// The linux_amd64 binary of the openbao/openbao-plugins `kms-aws-v0.1.1`
// release, which the plugin image in `image/Dockerfile` contains.
const KMS_AWS_PLUGIN_SHA256 =
  '0dffe0a159a5bdbeb147a892595fe517de858f48a99a64f33fabc775af0eec76';

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

# OpenBao 2.7 no longer builds in the AWS KMS seal; it is an external plugin
# baked into our image. No download: the task has no route to a registry.
plugin_directory = "${PLUGIN_DIRECTORY}"

plugin "kms" "awskms" {
  command = "${KMS_AWS_PLUGIN_COMMAND}"
  sha256sum = "${KMS_AWS_PLUGIN_SHA256}"
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
