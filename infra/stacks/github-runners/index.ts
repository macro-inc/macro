import * as pulumi from '@pulumi/pulumi';
import { config, stack } from '../../packages/shared';
import { get_coparse_api_vpc } from '../../packages/vpc';
import { DbMigratorRunner } from './runner';

const tags = {
  environment: stack,
  tech_lead: 'teo',
  project: 'github-runners',
};

// One runner for every environment: it migrates dev and prod alike, so this
// stack exists only in dev (see docs/runbooks/db-migrator-runner.md).
const dbMigrator = new DbMigratorRunner(
  `${pulumi.getProject()}-db-migrator-${stack}`,
  {
    vpc: get_coparse_api_vpc(),
    tags,
    runnerUrl: config.require('runnerUrl'),
    instanceType: config.require('dbMigratorInstanceType'),
    databaseSecretNames: ['macro-db-dev', 'macro-db-prod'],
  }
);

export const dbMigratorInstanceId = dbMigrator.instance.id;
export const dbMigratorPrivateIp = dbMigrator.instance.privateIp;
