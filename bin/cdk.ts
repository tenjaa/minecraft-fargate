#!/usr/bin/env node
import { AppStagingSynthesizer } from "@aws-cdk/app-staging-synthesizer-alpha";
import * as cdk from "aws-cdk-lib";
import { BucketEncryption } from "aws-cdk-lib/aws-s3";
import { DatabaseStack } from "../lib/database-stack.ts";
import { MinecraftStack } from "../lib/minecraft-stack.ts";

const app = new cdk.App({
  defaultStackSynthesizer: AppStagingSynthesizer.defaultResources({
    appId: "minecraft",
    stagingBucketEncryption: BucketEncryption.S3_MANAGED,
    imageAssetVersionCount: 2,
  }),
});
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: "eu-central-1",
};
const databaseStack = new DatabaseStack(app, "DatabaseStack", { env });
new MinecraftStack(app, "MinecraftStack", {
  env,
  table: databaseStack.table,
});
