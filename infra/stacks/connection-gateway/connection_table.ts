import type * as aws from '@pulumi/aws';
import { DynamoDBTable } from '@resources';

export const getConnectionGatewayTable = (): {
  table: aws.dynamodb.Table;
  policy: aws.iam.Policy;
} => {
  const connectionGatewayTableComponent = new DynamoDBTable(
    'connection-gateway',
    {
      baseName: 'connection-gateway-table',
      attributes: [
        { name: 'PK', type: 'S' },
        { name: 'SK', type: 'S' },
      ] as aws.types.input.dynamodb.TableAttribute[],
      hashKey: 'PK',
      rangeKey: 'SK',
      globalSecondaryIndexes: [
        {
          name: 'ConnectionPkIndex',
          hashKey: 'SK',
          rangeKey: 'PK',
          projectionType: 'ALL',
        },
      ] as aws.types.input.dynamodb.TableGlobalSecondaryIndex[],
    }
  );

  return {
    table: connectionGatewayTableComponent.table,
    policy: connectionGatewayTableComponent.policy,
  };
};
