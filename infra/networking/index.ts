import * as pulumi from '@pulumi/pulumi';
import * as aws from '@pulumi/aws';
import * as awsx from '@pulumi/awsx';

// Ensure AWS region is specified
aws.config.requireRegion();

const stack = pulumi.getStack();

// one vpc per stack
const vpc = new awsx.ec2.Vpc('macro-web-vpc');

export const vpcId = vpc.vpcId;
export const publicSubnetIds = vpc.publicSubnetIds;
export const privateSubnetIds = vpc.privateSubnetIds;