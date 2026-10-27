import { RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import {
  AttributeType,
  Billing,
  Capacity,
  StreamViewType,
  TableV2,
} from "aws-cdk-lib/aws-dynamodb";
import type { Construct } from "constructs";

export const TABLE_NAME = "minecraft";

export class DatabaseStack extends Stack {
  readonly table: TableV2;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    this.table = new TableV2(this, "Table", {
      tableName: TABLE_NAME,
      partitionKey: { name: "pk", type: AttributeType.STRING },
      sortKey: { name: "sk", type: AttributeType.STRING },
      dynamoStream: StreamViewType.KEYS_ONLY,
      // only provisioned capacity can use free tier
      billing: Billing.provisioned({
        readCapacity: Capacity.autoscaled({
          maxCapacity: 5,
        }),
        writeCapacity: Capacity.autoscaled({ maxCapacity: 5 }),
      }),
      removalPolicy: RemovalPolicy.RETAIN,
      globalSecondaryIndexes: [
        {
          indexName: "gsi_type",
          partitionKey: { name: "_et", type: AttributeType.STRING },
        },
      ],
    });
  }
}
