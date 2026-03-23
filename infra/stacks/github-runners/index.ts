import { config, stack } from '../../packages/shared';
import { get_coparse_api_vpc } from '../../packages/vpc';
import { SmokeTestRunner } from './runner';

const tags = {
  environment: stack,
  tech_lead: 'hutch',
  project: 'github-runners',
};

const vpc = get_coparse_api_vpc();

const runnerUrl = config.require('runnerUrl');
const runnerToken = config.requireSecret('runnerToken');

const smokeRunner = new SmokeTestRunner('macro-smoke-runner', {
  vpc,
  tags,
  runnerUrl,
  runnerToken,
  instanceType: config.get('instanceType') || 't3.large',
  keyPairName: config.get('keyPairName'),
});

export const instanceId = smokeRunner.instance.id;
export const privateIp = smokeRunner.instance.privateIp;
