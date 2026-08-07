#!/bin/bash
for file in /tmp/n8n-workflows/*.json; do
  echo "Importing $file..."
  sudo docker exec n8n n8n import:workflow --input="$file"
done
echo "Publishing..."
for id in $(sudo docker exec n8n n8n export:workflow --all | grep -o "\"id\": *\"[^\"]*\"" | awk -F"\"" "{print \$4}" | sort -u); do
  sudo docker exec n8n n8n publish:workflow --id="$id"
done
