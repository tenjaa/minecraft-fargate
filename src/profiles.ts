import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import {
  DeleteItemCommand,
  Entity,
  GetItemCommand,
  item,
  number,
  PutItemCommand,
  QueryCommand,
  string,
  Table,
} from "dynamodb-toolbox";
import { loadStrict } from "./env.ts";
import type { MinecraftProfile } from "./minecraft-profile.ts";

const table = new Table({
  name: loadStrict("PROFILE_TABLE"),
  partitionKey: { name: "pk", type: "string" },
  sortKey: { name: "sk", type: "string" },
  documentClient: DynamoDBDocumentClient.from(new DynamoDBClient()),
});

const profile = new Entity({
  name: "Profile",
  table,
  timestamps: false,
  schema: item({
    pk: string().key(),
    sk: string().key(),
    cognitoUsername: string(),
    uuid: string(),
    name: string(),
    updatedAt: number(),
  }),
});

const synchronization = new Entity({
  name: "Synchronization",
  table,
  timestamps: false,
  schema: item({
    pk: string().key(),
    sk: string().key(),
    revision: string().optional(),
    appliedAt: number().optional(),
    failedAt: number().optional(),
  }),
});

const syncKey = { pk: "SYNC", sk: "SERVER" };

export async function getProfile(sub: string) {
  const { Item } = await profile
    .build(GetItemCommand)
    .key({ pk: "PROFILES", sk: sub })
    .options({ consistent: true })
    .send();
  return Item;
}

export async function saveProfile(
  sub: string,
  cognitoUsername: string,
  minecraft: MinecraftProfile,
) {
  await profile
    .build(PutItemCommand)
    .item({
      pk: "PROFILES",
      sk: sub,
      cognitoUsername,
      ...minecraft,
      updatedAt: Date.now(),
    })
    .send();
}

export async function removeProfile(sub: string) {
  await profile
    .build(DeleteItemCommand)
    .key({ pk: "PROFILES", sk: sub })
    .send();
}

export async function listProfiles() {
  const { Items } = await table
    .build(QueryCommand)
    .entities(profile)
    .query({ partition: "PROFILES" })
    .options({ consistent: true, maxPages: Infinity })
    .send();
  return Items ?? [];
}

export async function getSynchronization() {
  const { Item } = await synchronization
    .build(GetItemCommand)
    .key(syncKey)
    .options({ consistent: true })
    .send();
  return Item;
}

export async function acknowledgeSynchronization(revision: string) {
  await synchronization
    .build(PutItemCommand)
    .item({ ...syncKey, revision, appliedAt: Date.now() })
    .send();
}

export async function pendingSynchronization() {
  await synchronization.build(PutItemCommand).item(syncKey).send();
}

export async function failSynchronization() {
  await synchronization
    .build(PutItemCommand)
    .item({ ...syncKey, failedAt: Date.now() })
    .send();
}
