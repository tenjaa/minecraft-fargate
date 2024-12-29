#!/bin/sh
set -e

echo "Start backup.sh"
cp -r minecraft minecraft-backup
tar -C minecraft-backup -c config defaultconfigs world ops.json whitelist.json server.properties | aws s3 cp - s3://"${BUCKET}"/backup.tar --no-progress
rm -rf minecraft-backup
echo "End backup.sh"
