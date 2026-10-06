#!/bin/sh
set -eu
max_attempts="${DB_STARTUP_MAX_ATTEMPTS:-30}"
attempt=1
while ! node -e "const mysql=require('mysql2/promise'); mysql.createConnection({host:process.env.DB_HOST,port:Number(process.env.DB_PORT),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME,connectTimeout:2000}).then(c=>c.end()).catch(()=>process.exit(1))"; do
  if [ "$attempt" -ge "$max_attempts" ]; then echo "Database did not become available after $max_attempts attempts." >&2; exit 1; fi
  echo "Waiting for database ($attempt/$max_attempts)..."; attempt=$((attempt + 1)); sleep 2
done
exec npm start
