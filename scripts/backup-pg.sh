#!/usr/bin/env bash
set -euo pipefail
BACKUP_DIR="${BACKUP_DIR:-./backups}"
mkdir -p "$BACKUP_DIR"
STAMP=$(date +%F)
docker compose exec -T postgres pg_dump -U mool -d mool | gzip > "${BACKUP_DIR}/mool-${STAMP}.sql.gz"
# Retain 7 days
find "$BACKUP_DIR" -name 'mool-*.sql.gz' -mtime +7 -delete
echo "Backup written to ${BACKUP_DIR}/mool-${STAMP}.sql.gz"
