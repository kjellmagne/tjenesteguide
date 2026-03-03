#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA_DIR="${APP_DIR}/data"
DATA_FILE="${DATA_DIR}/tjenester.json"
BACKUP_DIR="${DATA_DIR}/backups"
TIMESTAMP="$(date '+%Y%m%d-%H%M%S')"

cd "${APP_DIR}"

mkdir -p "${BACKUP_DIR}"

if [[ -f "${DATA_FILE}" ]]; then
  BACKUP_FILE="${BACKUP_DIR}/tjenester-${TIMESTAMP}.json"
  cp "${DATA_FILE}" "${BACKUP_FILE}"
  echo "[+] Backup created: ${BACKUP_FILE}"
else
  echo "[!] No data file found at ${DATA_FILE}. Skipping backup."
fi

echo "[+] Pull latest image"
docker compose pull

echo "[+] Recreate container"
docker compose down --remove-orphans || true
docker rm -f tjenesteguide >/dev/null 2>&1 || true
docker compose up -d

# Keep only the 30 newest backups.
ls -1t "${BACKUP_DIR}"/tjenester-*.json 2>/dev/null | tail -n +31 | xargs -r rm -f

echo "[+] Deploy complete"
