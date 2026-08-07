#!/bin/bash
sudo docker exec -e PGPASSWORD=n8n_local_pw n8n-db pg_dump -U n8n n8n > ~/n8n-pre-import.sql
sudo docker cp /tmp/n8n-workflows-host n8n:/tmp/n8n-workflows
sudo docker exec n8n n8n import:workflow --separate --input=/tmp/n8n-workflows
sudo docker restart n8n
