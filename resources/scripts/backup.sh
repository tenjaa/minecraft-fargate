#!/bin/sh
set -e

echo "Start backup"
echo "/say starting-backup" > /tmp/srv-input &

# Disable auto-save for reliable backup
echo "Disable auto-save"
echo "/save-off" > /tmp/srv-input &
echo "/save-all" > /tmp/srv-input &
sleep 30s

cp -r minecraft minecraft-backup
./scripts/sync-s3.sh minecraft-backup s3://"${BUCKET}"
rm -rf minecraft-backup

echo "/save-on" > /tmp/srv-input &
echo "Backup done"
echo "/say backup-done" > /tmp/srv-input &
echo "/stop" > /tmp/srv-input &
