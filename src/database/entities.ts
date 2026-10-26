import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import {
  DeleteItemCommand,
  Entity,
  GetItemCommand,
  item,
  PutItemCommand,
  prefix,
  QueryCommand,
  string,
  Table,
} from "dynamodb-toolbox";
import { TABLE_NAME } from "../../lib/database-stack.ts";

const table = new Table({
  name: TABLE_NAME,
  partitionKey: { name: "pk", type: "string" },
  sortKey: { name: "sk", type: "string" },
  indexes: {
    gsi_type: {
      type: "global",
      partitionKey: { name: "_et", type: "string" },
    },
  },
  documentClient: DynamoDBDocumentClient.from(new DynamoDBClient()),
});

const profile = new Entity({
  name: "profile",
  table,
  schema: item({
    cognitoSubject: string().key().savedAs("cognito_subject"),
    minecraftId: string().required().savedAs("minecraft_id"),
    minecraftName: string().required().savedAs("minecraft_name"),
  }).and((_prevSchema) => ({
    pk: string()
      .key()
      .hidden()
      .link<typeof _prevSchema>(({ cognitoSubject }) => cognitoSubject)
      .transform(prefix("profile")),
    sk: string()
      .key()
      .hidden()
      .link<typeof _prevSchema>(({ cognitoSubject }) => cognitoSubject)
      .transform(prefix("profile")),
  })),
});

export async function getProfile(sub: string) {
  const { Item } = await profile
    .build(GetItemCommand)
    .key({ cognitoSubject: sub })
    .send();
  return Item;
}

export async function saveProfile(
  sub: string,
  minecraft: { id: string; name: string },
) {
  await profile
    .build(PutItemCommand)
    .item({
      cognitoSubject: sub,
      minecraftId: minecraft.id,
      minecraftName: minecraft.name,
    })
    .send();
}

export async function removeProfile(sub: string) {
  await profile.build(DeleteItemCommand).key({ cognitoSubject: sub }).send();
}

export async function listProfiles() {
  const { Items } = await table
    .build(QueryCommand)
    .entities(profile)
    .query({ partition: "profile", index: "gsi_type" })
    .options({ maxPages: Infinity })
    .send();
  return Items ?? [];
}
