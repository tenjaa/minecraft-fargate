import {DescribeServicesRequest, UpdateServiceRequest} from 'aws-sdk/clients/ecs';
import {ListObjectsV2Request} from 'aws-sdk/clients/s3';
import {AutoScalingGroupNamesType, SetDesiredCapacityType} from 'aws-sdk/clients/autoscaling';

const AWS = require('aws-sdk');
const autoScaling = new AWS.AutoScaling();
const ecs = new AWS.ECS();
const s3 = new AWS.S3();

const bucket = process.env.BUCKET!
const duckDnsDomain = process.env.DUCK_DNS_DOMAIN!
const asgName = process.env.ASG!
const clusterArn = process.env.MC_CLUSTER!
const serviceArn = process.env.MC_SERVICE!

async function scaleAsg() {
  const updateServiceRequest: SetDesiredCapacityType = {
    AutoScalingGroupName: asgName,
    DesiredCapacity: 1
  }
  await autoScaling.setDesiredCapacity(updateServiceRequest).promise();
}

async function startEcsTask() {
  const updateServiceRequest: UpdateServiceRequest = {
    cluster: clusterArn,
    service: serviceArn,
    desiredCount: 1
  }
  await ecs.updateService(updateServiceRequest).promise();
}

async function listMods() {
  const listObjectsV2Request: ListObjectsV2Request = {
    Bucket: bucket,
    Prefix: "mods"
  }
  const response = await s3.listObjectsV2(listObjectsV2Request).promise();
  return response.Contents
    ?.map((x: { Key: any; }) => x.Key)
    .map((s: string) => s.replace("mods/", ""))
    .filter((s: string) => s !== "")
    .join();
}

async function getEc2State() {
  const request: AutoScalingGroupNamesType = {
    AutoScalingGroupNames: [asgName]
  }
  const response = await autoScaling.describeAutoScalingGroups(request).promise();
  if (response.AutoScalingGroups[0].Instances && response.AutoScalingGroups[0].Instances.length > 0) {
    return response.AutoScalingGroups[0].Instances[0].LifecycleState
  } else {
    return "Waiting for EC2 instance..."
  }
}

async function getServiceState() {
  const request: DescribeServicesRequest = {
    cluster: clusterArn,
    services: [serviceArn]
  }
  const response = await ecs.describeServices(request).promise();
  const pendingCount = response.services[0].pendingCount;
  const runningCount = response.services[0].runningCount;
  return `Pending: ${pendingCount}, Running: ${runningCount}`
}

export const handler = async (event: any = {}): Promise<any> => {
  try {
    await scaleAsg();
    await startEcsTask();
    const modList = await listMods();
    const ec2State = await getEc2State();
    const serviceState = await getServiceState();

    const body =
      `
      ${duckDnsDomain}.duckdns.org
      Mods used: [${modList}]
      EC2 state: ${ec2State} (InService is good)
      MC state: ${serviceState} (Pending: 0, Running: 1 is good and means the server is starting right now, wich can take up to five minutes)
      Refresh this page every 30 seconds until everything works.
      `;

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "text/plain"
      },
      body: body,
    }
  } catch (error) {
    const body = error.stack || JSON.stringify(error, null, 2)
    return {
      statusCode: 500,
      headers: {},
      body: JSON.stringify(body),
    }
  }
};
