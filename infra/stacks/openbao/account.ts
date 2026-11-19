// The OpenBao AWS account and the one provider every stack file uses for it.
import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { stack } from '../../packages/shared';

/** `macro-openbao`, the account that holds dev and prod OpenBao. */
export const OPENBAO_ACCOUNT_ID = '169344408001';

/**
 * Pulumi runs with main-account credentials and assumes this environment's
 * deploy role (`openbao:deployRoleArn`, the account bootstrap's
 * `openbao-deploy-<env>`) for everything in the OpenBao account. The deploy
 * roles deny touching anything tagged for the other environment.
 */
export const openbaoAccount = new aws.Provider(`openbao-account-${stack}`, {
  region: aws.config.requireRegion(),
  allowedAccountIds: [OPENBAO_ACCOUNT_ID],
  assumeRoles: [
    {
      roleArn: new pulumi.Config().require('deployRoleArn'),
      sessionName: `pulumi-openbao-${stack}`,
    },
  ],
  defaultTags: { tags: { 'openbao:env': stack } },
});
