#!/bin/sh
set -e

echo "/say starting-backup" > /tmp/mc-stdin &

# Disable auto-save for reliable backup
echo "Disable auto-save"
echo "/save-off" > /tmp/mc-stdin &
echo "/save-all" > /tmp/mc-stdin &
sleep 30s

./scripts/backup.sh

echo "/save-on" > /tmp/mc-stdin &
echo "/say backup-done" > /tmp/mc-stdin &
