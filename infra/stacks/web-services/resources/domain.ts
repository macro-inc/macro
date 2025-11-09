import * as aws from '@pulumi/aws';
import type { ApplicationLoadBalancer } from '@pulumi/awsx/lb';

export function domainResources(stack: string) {
  const domain = 'macro.com';
  const pdfServiceDomain =
    stack === 'dev' ? `pdf-service-dev.${domain}` : `pdf-service.${domain}`;
  const docxServiceDomain =
    stack === 'dev' ? `docx-service-dev.${domain}` : `docx-service.${domain}`;

  const certificate = new aws.acm.Certificate(
    `macro-services-certificate-${stack}`,
    {
      domainName: pdfServiceDomain,
      subjectAlternativeNames: [docxServiceDomain],
      validationMethod: 'DNS',
    }
  );

  const hostedZoneId = aws.route53
    .getZone({ name: domain })
    .then((zone) => zone.zoneId);

  const pdfServiceValidationRecord = new aws.route53.Record(
    `pdf-service-validation-record-${stack}`,
    {
      name: certificate.domainValidationOptions[0].resourceRecordName,
      type: certificate.domainValidationOptions[0].resourceRecordType,
      records: [certificate.domainValidationOptions[0].resourceRecordValue],
      zoneId: hostedZoneId,
      ttl: 60,
    }
  );

  const docxServiceValidationRecord = new aws.route53.Record(
    `docx-service-validation-record-${stack}`,
    {
      name: certificate.domainValidationOptions[1].resourceRecordName,
      type: certificate.domainValidationOptions[1].resourceRecordType,
      records: [certificate.domainValidationOptions[1].resourceRecordValue],
      zoneId: hostedZoneId,
      ttl: 60,
    }
  );

  const certificateValidation = new aws.acm.CertificateValidation(
    `macro-services-certificate-validation-${stack}`,
    {
      certificateArn: certificate.arn,
      validationRecordFqdns: [
        pdfServiceValidationRecord.fqdn,
        docxServiceValidationRecord.fqdn,
      ],
    },
    { dependsOn: [pdfServiceValidationRecord, docxServiceValidationRecord] }
  );
  return {
    pdfServiceDomain,
    docxServiceDomain,
    hostedZoneId,
    certificateValidation,
  };
}

type Route53RecordArgs = {
  stack: string;
  serviceName: string;
  hostedZoneId: Promise<string>;
  serviceDomain: string;
  serviceLB: ApplicationLoadBalancer;
};

export function route53Record({
  stack,
  serviceName,
  hostedZoneId,
  serviceDomain,
  serviceLB,
}: Route53RecordArgs) {
  return new aws.route53.Record(`${serviceName}-alias-record-${stack}`, {
    name: serviceDomain,
    type: 'A',
    zoneId: hostedZoneId,
    aliases: [
      {
        name: serviceLB.loadBalancer.dnsName,
        zoneId: serviceLB.loadBalancer.zoneId,
        evaluateTargetHealth: true,
      },
    ],
  });
}
