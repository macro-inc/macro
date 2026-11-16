import * as pulumi from '@pulumi/pulumi';
import { stack } from '../../packages/shared';

export const BASE_NAME = pulumi.getProject();
// The `openbao` user in the upstream image `image/Dockerfile` builds on.
export const OPENBAO_UID = 100;
export const OPENBAO_GID = 1000;
export const HOSTNAME = 'openbao-dev.macro-internal.com';
export const API_ADDRESS = `https://${HOSTNAME}`;
export const HTTPS_PORT = 443;
export const NFS_PORT = 2049;
export const TAGS = {
  project: BASE_NAME,
  environment: stack,
  tech_lead: 'wolf',
};
/** For the seal key, the Raft volume and the backup vault. */
export const DURABLE = { protect: true, retainOnDelete: true };
