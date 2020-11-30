#!/bin/sh
set -e

echo "Download world"
"$SCRIPTS_DIR"/sync-s3.sh s3://"${BUCKET}" "$MAIN_DIR"/minecraft

echo "Update IP"
#taskMetadata=$(curl -s "${ECS_CONTAINER_METADATA_URI_V4}/task")
#clusterArn=$(echo "$taskMetadata" | jq -r '.Cluster')
#taskArn=$(echo "$taskMetadata" | jq -r '.TaskARN')
#taskDescription=$(aws ecs describe-tasks --cluster "$clusterArn" --tasks "$taskArn")
#networkInterfaceId=$(echo "$taskDescription" | jq -r '.tasks[].attachments[].details[] | select(.name=="networkInterfaceId").value')
#networkInterfaceDescription=$(aws ec2 describe-network-interfaces --network-interface-ids "$networkInterfaceId")
#publicIp=$(echo "$networkInterfaceDescription" | jq -r '.NetworkInterfaces[].Association.PublicIp')
#
#curl "https://www.duckdns.org/update?domains=$DUCK_DNS_DOMAIN&token=$DUCK_DNS_TOKEN&ip=$publicIp"
#
#export PUBLIC_IP=$publicIp
#export CLUSTER_ARN=$clusterArn
