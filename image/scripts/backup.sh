#!/bin/sh
set -e

echo "Start backup"
echo "/say starting-backup" > /tmp/srv-input &
echo "/save-all flush" > /tmp/srv-input &
sleep 10s
echo "Start backup"
./scripts/sync-s3.sh minecraft s3://"${BUCKET}"
echo "Backup done"
echo "/say backup-done" > /tmp/srv-input &
