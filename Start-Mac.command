#!/bin/bash
set -e
cd "$(dirname "$0")"
PORT=8765
URL="http://127.0.0.1:${PORT}"
if ! command -v python3 >/dev/null 2>&1; then
  echo "Python 3 پیدا نشد. برای اجرای برنامه، Python 3 را نصب کن."
  read -r -p "برای خروج Enter را بزن..."
  exit 1
fi
(
  sleep 1
  open "$URL" >/dev/null 2>&1 || true
) &
echo "برنامه روی ${URL} اجرا شد. برای بستن سرور، این پنجره را ببند یا Ctrl+C بزن."
python3 -m http.server "$PORT" --bind 127.0.0.1
