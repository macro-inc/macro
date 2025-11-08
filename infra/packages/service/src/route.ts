import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { BASE_DOMAIN, stack } from '@shared';
import type { ServiceLoadBalancer } from './load_balancer';
export class ServiceRoute extends pulumi.ComponentResource {
  public readonly domainName: string;
  public readonly url: string;

  constructor(
    serviceName: string,
    args: { loadBalancer: ServiceLoadBalancer },
    opts?: pulumi.ComponentResourceOptions
  ) {
    super(
      `macro:cloud_storage:ServiceRoute`,
      `${serviceName}-service-route-${stack}`,
      {},
      {
        ...opts,
      }
    );
    const zone = aws.route53.getZoneOutput({ name: BASE_DOMAIN });
    const {
      loadBalancer: { loadBalancer },
    } = args;

    this.domainName = `${serviceName}${stack === 'prod' ? '' : `-${stack}`}`;

    new aws.route53.Record(
      `${serviceName}-domain-record`,
      {
        name: this.domainName,
        type: 'A',
        zoneId: zone.zoneId,
        aliases: [
          {
            evaluateTargetHealth: false,
            name: loadBalancer.dnsName,
            zoneId: loadBalancer.zoneId,
          },
        ],
      },
      { parent: this, dependsOn: [loadBalancer] }
    );

    this.url = `https://${this.domainName}.${BASE_DOMAIN}`;
  }
}
