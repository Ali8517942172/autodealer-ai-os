#!/bin/bash
sudo docker exec -e PGPASSWORD=n8n_local_pw n8n-db pg_dump -U n8n n8n > ~/n8n-pre-import.sql
sudo docker cp /tmp/n8n-workflows-host n8n:/tmp/n8n-workflows
echo "Importing workflows..."
sudo docker exec n8n n8n import:workflow --separate --input=/tmp/n8n-workflows
echo "Publishing workflows to ensure they are active..."
sudo docker exec n8n sh -c 'for id in $(n8n export:workflow --all | grep -o "\"id\": *\"[^\"]*\"" | awk -F"\"" "{print \$4}" | sort -u); do n8n publish:workflow --id=$id; done'
echo "Restarting n8n container..."
sudo docker restart n8n
