import { AutoScalingClient } from "@aws-sdk/client-auto-scaling";
import { ECSClient } from "@aws-sdk/client-ecs";
import { S3Client } from "@aws-sdk/client-s3";
import { loadStrict } from "./env";
import { StartServer } from "./start-server";

const autoScalingClient = new AutoScalingClient();
const ecsClient = new ECSClient();
const s3Client = new S3Client();

const props = {
  bucket: loadStrict("BUCKET"),
  duckDnsDomain: loadStrict("DUCK_DNS_DOMAIN"),
  asgName: loadStrict("ASG"),
  clusterArn: loadStrict("MC_CLUSTER"),
  serviceArn: loadStrict("MC_SERVICE"),
};

export const handler = new StartServer(
  autoScalingClient,
  ecsClient,
  s3Client,
  props,
).handler;
