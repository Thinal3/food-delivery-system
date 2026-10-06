# Food Delivery System

Five Node.js/Express APIs are available on localhost ports 5001–5005. The Docker deployment creates a new MariaDB database in a Docker named volume; it does not use, stop, modify, or import the XAMPP databases on port 3307.

## Docker quick start

Install Docker Desktop for Windows and ensure that `docker compose version` works in PowerShell. Stop only local Node processes that already occupy ports 5001–5005; XAMPP can stay running because MariaDB is internal to Docker by default.

```powershell
Get-NetTCPConnection -LocalPort 5001,5002,5003,5004,5005 -ErrorAction SilentlyContinue |
  Select-Object LocalPort, OwningProcess
# Stop a listed local Node process only after checking its PID:
Stop-Process -Id <PID>
```

Copy the root template, then replace every placeholder before starting. Do not copy or mount the five service `.env` files into Docker.

```powershell
Copy-Item .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Run the Node command once for each database password, `JWT_SECRET`, and `ORDER_DELIVERY_SYNC_SECRET`. It creates safe hexadecimal values. `ORDER_DELIVERY_SYNC_SECRET` must be the same single value for Order and Delivery; the Compose file passes it to both. Keep JWT issuer/audience, timeouts, delivery fee, and worker defaults unless intentionally changing the application behavior.

Build and start:

```powershell
docker compose up --build -d
docker compose ps
```

There should be six containers: MariaDB plus Auth, Restaurant, Customer, Order, and Delivery. API containers run as the unprivileged `node` user. They wait for a successful application-database connection for up to `DB_STARTUP_MAX_ATTEMPTS` (30 attempts, two seconds apart), then exit so Compose can restart them if the database remains unavailable.

## URLs, health, and Postman

| Service | URL |
| --- | --- |
| Auth | `http://localhost:5001` |
| Restaurant | `http://localhost:5002` |
| Order | `http://localhost:5003` |
| Delivery | `http://localhost:5004` |
| Customer | `http://localhost:5005` |

After `docker compose ps` reports healthy services, verify process and database readiness:

```powershell
Invoke-RestMethod http://localhost:5001/health; Invoke-RestMethod http://localhost:5001/ready
Invoke-RestMethod http://localhost:5002/health; Invoke-RestMethod http://localhost:5002/ready
Invoke-RestMethod http://localhost:5003/health; Invoke-RestMethod http://localhost:5003/ready
Invoke-RestMethod http://localhost:5004/health; Invoke-RestMethod http://localhost:5004/ready
Invoke-RestMethod http://localhost:5005/health; Invoke-RestMethod http://localhost:5005/ready
```

In Postman, use the five localhost base URLs above. Create/login users through Auth, create the customer profile/address and restaurant/menu, then create an order. Create and assign its delivery, and progress it through `PICKUP_PENDING`, `PICKED_UP`, `ON_THE_WAY`, and `DELIVERED`. Delivery writes status events to `delivery_order_sync`; its worker retries them to Order using the shared sync secret. Review `docker compose logs delivery-service order-service` if the eventual order status does not advance.

## Initial administrator

Fresh Docker data has no XAMPP users, profiles, menus, or orders. The administrator is deliberately not created on startup. After Auth is healthy, supply credentials only in your current PowerShell session and run the explicit one-shot bootstrap:

```powershell
$env:ADMIN_NAME = 'Your Name'
$env:ADMIN_EMAIL = 'admin@example.test'
$env:ADMIN_PASSWORD = Read-Host 'Admin password'
docker compose run --rm --no-deps -e ADMIN_NAME -e ADMIN_EMAIL -e ADMIN_PASSWORD auth-service npm run bootstrap:admin
Remove-Item Env:ADMIN_NAME,Env:ADMIN_EMAIL,Env:ADMIN_PASSWORD
```

The command never resets an existing account; it fails safely if that email already exists.

## Database behavior and schema updates

MariaDB initialization scripts run only when the `mariadb_data` named volume is first created. They create five databases and separate application accounts, each granted only `SELECT`, `INSERT`, `UPDATE`, and `DELETE` on its own database. Application containers never use the root account. The schemas include Delivery's outbox/synchronization tables and constraints. Auth's collation is `utf8mb4_unicode_ci`, which is compatible with MariaDB (instead of MySQL-only `utf8mb4_0900_ai_ci`).

For a later non-destructive schema update, back up first, apply a reviewed, additive migration manually, then restart only the affected API. Do not use `docker compose down -v` as a routine fix—it removes the database volume.

```powershell
docker compose exec mariadb mariadb-dump -uroot -p food_delivery_order > food_delivery_order-backup.sql
# Review and apply a new migration, for example:
Get-Content .\path\to\migration.sql | docker compose exec -T mariadb mariadb -uroot -p food_delivery_order
docker compose restart order-service
```

Both commands prompt for the root password without printing it. Importing existing XAMPP data is intentionally separate: first export each XAMPP database, review compatibility and sensitive data, then import deliberately into this Docker database. The standard Compose command never does this automatically.

## Operations and optional GUI access

```powershell
docker compose logs -f
docker compose logs -f auth-service
docker compose logs -f delivery-service
docker compose stop                 # safe stop; keeps the named volume
docker compose up -d                # safe restart; retains data
docker compose down                 # removes containers/network only; retains data volume
```

MariaDB has no published host port by default. For an optional database GUI on `127.0.0.1:3308` (not XAMPP's 3306/3307), start with:

```powershell
docker compose -f docker-compose.yml -f docker-compose.gui.yml up -d
```

Use host `127.0.0.1`, port `3308`, and an application database user/password from root `.env`; prefer that restricted user over root.

## Validation and submission evidence

Run these commands from the project root after creating `.env`:

```powershell
docker compose config --quiet
docker compose up --build -d
docker compose ps
docker image ls
docker compose logs --tail=100
docker compose logs auth-service
```

For submission screenshots, show: the five service folders (each has a Dockerfile), `docker image ls` showing five `food-delivery-*-service` images, `docker compose ps` showing six running/healthy containers, the successful Compose startup/log output, and the five health/readiness responses in Postman or PowerShell.

## Local (non-Docker) development

The original XAMPP workflow remains available in the service READMEs. Each service `.env` is ignored by Git. Root `.env` is exclusively for Compose and is also ignored; `.env.example` templates remain tracked.
