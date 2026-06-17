import * as pulumi from '@pulumi/pulumi';
import * as doppler from '@pulumiverse/doppler';
import {
  DOPPLER_SECRETS_MANAGER_INTEGRATION_ID,
  SECRETS_MANAGER_REGION,
} from './consts';

type Args = {};

export class DopplerProject extends pulumi.ComponentResource {
  public project: doppler.Project;

  constructor(
    name: string,
    _args: Args,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super(`my:components:DopplerProject:${name}`, name, {}, opts);

    this.project = new doppler.Project(
      `${name}-project`,
      {
        name,
        description: `${name.replaceAll('-', ' ')} config`,
      },
      { parent: this }
    );

    new doppler.Environment(
      'local-environment',
      {
        project: this.project.name,
        slug: 'lcl',
        name: 'local',
        personalConfigs: true,
      },
      { parent: this }
    );

    const devEnvironment = new doppler.Environment(
      'dev-environment',
      {
        project: this.project.name,
        slug: 'dev',
        name: 'dev',
        personalConfigs: false,
      },
      { parent: this }
    );

    new doppler.secretssync.AwsSecretsManager(
      'dev-sync',
      {
        integration: DOPPLER_SECRETS_MANAGER_INTEGRATION_ID,
        project: this.project.name,
        config: devEnvironment.slug,
        region: SECRETS_MANAGER_REGION,
        path: `/doppler-sync/${name}/dev`,
        tags: {
          env: 'dev',
        },
      },
      { parent: this }
    );

    const prodEnvironment = new doppler.Environment(
      'prod-environment',
      {
        project: this.project.name,
        slug: 'prd',
        name: 'prod',
        personalConfigs: false,
      },
      { parent: this }
    );

    new doppler.secretssync.AwsSecretsManager(
      'prod-sync',
      {
        integration: DOPPLER_SECRETS_MANAGER_INTEGRATION_ID,
        project: this.project.name,
        config: prodEnvironment.slug,
        region: SECRETS_MANAGER_REGION,
        path: `/doppler-sync/${name}/prod`,
        tags: {
          env: 'prod',
        },
      },
      { parent: this }
    );
  }
}
