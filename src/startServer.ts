import {UpdateServiceRequest} from 'aws-sdk/clients/ecs';
import S3, {ListObjectsV2Output, ListObjectsV2Request} from 'aws-sdk/clients/s3';
import {Request} from 'aws-sdk/lib/request';
import {AWSError} from 'aws-sdk/lib/error';

const AWS = require('aws-sdk');
const ecs = new AWS.ECS();
const s3 = new AWS.S3();

const bucket = process.env.BUCKET!
const duckDnsDomain = process.env.DUCK_DNS_DOMAIN!
const clusterArn = process.env.MC_CLUSTER!
const serviceArn = process.env.MC_SERVICE!

export const handler = async (event: any = {}) : Promise <any> => {
  try {
    const updateServiceRequest: UpdateServiceRequest = {
      cluster: clusterArn,
      service: serviceArn,
      desiredCount: 1
    }
    await ecs.updateService(updateServiceRequest).promise();
    const listObjectsV2Request: ListObjectsV2Request = {
      Bucket: bucket,
      Prefix: "mods"
    }

    const resposne = await s3.listObjectsV2(listObjectsV2Request).promise();
    const modList = resposne.Contents?.map((x: { Key: any; }) => x.Key).join();

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "text/plain"
      },
      body: "Server started on " + duckDnsDomain + ".duckdns.org with the following mods [" + modList + "]!",
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
