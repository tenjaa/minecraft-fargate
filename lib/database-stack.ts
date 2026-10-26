import { RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import {
  AttributeType,
  Billing,
  Capacity,
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
      // only provisioned capacity can use free tier
      billing: Billing.provisioned({
        readCapacity: Capacity.autoscaled({
          maxCapacity: 5,
        }),
        writeCapacity: Capacity.autoscaled({ maxCapacity: 5 }),
      }),
      removalPolicy: RemovalPolicy.RETAIN,
    });
  }
}
