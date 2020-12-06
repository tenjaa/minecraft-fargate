#!/bin/sh
set -e

serviceArn=$(aws ecs list-services --cluster "$CLUSTER_ARN" | jq -r '.serviceArns[]')
aws ecs update-service --cluster "$CLUSTER_ARN" --service "$serviceArn" --desired-count 0
aws autoscaling set-desired-capacity --auto-scaling-group-name $ASG --desired-capacity 0