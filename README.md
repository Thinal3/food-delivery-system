# Food Delivery Management System

A Node.js and Express microservice backend for a food-delivery platform. The project contains five independently deployable APIs, each with its own MariaDB database. Docker Compose runs the complete backend locally with one isolated MariaDB container.

## Project structure

```text
food-delivery-system/
  services/
    auth-service/          user accounts, JWTs, roles, and account status
    restaurant-service/    restaurants, categories, and menu items
    customer-service/      customer profiles and delivery addresses
    order-service/         orders, price snapshots, and order lifecycle
    delivery-service/      delivery assignment, lifecycle, and sync outbox
  docker/mariadb/init/     first-run database-user initialization
  docker-compose.yml       complete local Docker stack
  docker-compose.gui.yml   optional MariaDB GUI port override
  .env.example             Docker configuration template
```

## Services and documentation

| Service | Host port | Database | Main responsibility | Detailed documentation |
| --- | ---: | --- | --- | --- |
| Auth | 5001 | `food_delivery_auth` | Registration, login, JWT verification, users, roles | [Auth README](services/auth-service/README.md) |
| Restaurant | 5002 | `food_delivery_restaurant` | Restaurants, categories, menus, availability | [Restaurant README](services/restaurant-service/README.md) |
| Order | 5003 | `food_delivery_order` | Orders, item/address snapshots, order status | [Order README](services/order-service/README.md) |
| Delivery | 5004 | `food_delivery_delivery` | Delivery assignment and reliable status synchronization | [Delivery README](services/delivery-service/README.md) |
| Customer | 5005 | `food_delivery_customer` | Customer profiles and saved addresses | [Customer README](services/customer-service/README.md) |

Read each service README for its endpoint list, request bodies, authorization rules, local XAMPP setup, database tests, and Postman workflow.

## Architecture

```text
Client / Postman
  |
  +--> Auth (5001) <--- bearer-token verification --- Restaurant, Customer, Order, Delivery
  |
  +--> Restaurant (5002) ---------------------------> Order (5003)
  +--> Customer   (5005) ---------------------------> Order (5003)
  +--> Order      (5003) <--- delivery status sync --- Delivery (5004)
```

- Auth is the authority for identity, role, and account-status verification.
- Every service owns its own database; no database tables are shared.
- Order requests Restaurant menu data and Customer address data while creating an order.
- Delivery writes status events to its outbox table. Its worker sends those events to Order using `ORDER_DELIVERY_SYNC_SECRET`.
- Order and Delivery intentionally have no circular startup dependency. Delivery retries synchronization when Order becomes available.

## Docker prerequisites

- Docker Desktop for Windows, running
- PowerShell
- Ports 5001 through 5005 available for the APIs

XAMPP does not need to be stopped. Docker MariaDB is not published to the host by default, so it does not conflict with XAMPP on ports 3306 or 3307.

Check whether a local Node process is already using an API port:

```powershell
Get-NetTCPConnection -LocalPort 5001,5002,5003,5004,5005 -ErrorAction SilentlyContinue |
  Select-Object LocalPort, OwningProcess
```

Only stop a process after confirming its PID:

```powershell
Stop-Process -Id <PID>
```

## Configure Docker

Create the root Docker configuration file:

```powershell
Copy-Item .env.example .env
```

Generate a strong value with Node.js:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Run it once for each value below, then place the generated values in root `.env`:

- `MARIADB_ROOT_PASSWORD`
- `AUTH_DB_PASSWORD`
- `RESTAURANT_DB_PASSWORD`
- `ORDER_DB_PASSWORD`
- `DELIVERY_DB_PASSWORD`
- `CUSTOMER_DB_PASSWORD`
- `JWT_SECRET`
- `ORDER_DELIVERY_SYNC_SECRET`

Use a different generated value for every setting. The one exception is that the Compose file automatically supplies the same `ORDER_DELIVERY_SYNC_SECRET` to both Order and Delivery.

Do not commit root `.env`, do not put real secrets in `.env.example`, and do not mount the individual service `.env` files into Docker.

## Start the complete system

From the repository root:

```powershell
docker compose config --quiet
docker compose up --build -d
docker compose ps
```

Expected running containers: five backend services plus one MariaDB container. API images use Node `22.14.0-alpine`, install locked production dependencies, and run as the unprivileged `node` user.

MariaDB must become healthy before services start. Each API also performs bounded database connection retries before its production `npm start` command runs.

## API URLs and health checks

| Service | Base URL | Process health | Database readiness |
| --- | --- | --- | --- |
| Auth | `http://localhost:5001` | `/health` | `/ready` |
| Restaurant | `http://localhost:5002` | `/health` | `/ready` |
| Order | `http://localhost:5003` | `/health` | `/ready` |
| Delivery | `http://localhost:5004` | `/health` | `/ready` |
| Customer | `http://localhost:5005` | `/health` | `/ready` |

Verify every container after startup:

```powershell
Invoke-RestMethod http://localhost:5001/health; Invoke-RestMethod http://localhost:5001/ready
Invoke-RestMethod http://localhost:5002/health; Invoke-RestMethod http://localhost:5002/ready
Invoke-RestMethod http://localhost:5003/health; Invoke-RestMethod http://localhost:5003/ready
Invoke-RestMethod http://localhost:5004/health; Invoke-RestMethod http://localhost:5004/ready
Invoke-RestMethod http://localhost:5005/health; Invoke-RestMethod http://localhost:5005/ready
```

`/health` confirms the API process is running. `/ready` also confirms the service can query its own database.

## Create the first administrator

A fresh Docker database does not contain XAMPP users, profiles, menus, or orders. Admin creation is intentionally a separate one-time command and never runs automatically.

After Auth is healthy, run:

```powershell
$env:ADMIN_NAME = 'Your Name'
$env:ADMIN_EMAIL = 'admin@example.test'
$env:ADMIN_PASSWORD = Read-Host 'Admin password'
docker compose run --rm --no-deps -e ADMIN_NAME -e ADMIN_EMAIL -e ADMIN_PASSWORD auth-service npm run bootstrap:admin
Remove-Item Env:ADMIN_NAME,Env:ADMIN_EMAIL,Env:ADMIN_PASSWORD
```

The command creates one active `ADMIN`. It does not reset accounts and safely fails if that email already exists. See the [Auth README](services/auth-service/README.md) for account-management endpoints.

## Suggested Postman workflow

1. Bootstrap and log in as an `ADMIN` through Auth.
2. Create a `RESTAURANT_ADMIN`, a `DELIVERY_PERSON`, and a `CUSTOMER` using Auth.
3. As the customer, create a profile and address using the [Customer README](services/customer-service/README.md).
4. As the restaurant admin, create an active/open restaurant, category, and available menu item using the [Restaurant README](services/restaurant-service/README.md).
5. As the customer, create an order using the [Order README](services/order-service/README.md).
6. Move the order to `READY_FOR_PICKUP`, create and assign a delivery, then progress its delivery status through `PICKUP_PENDING`, `PICKED_UP`, `ON_THE_WAY`, and `DELIVERED` using the [Delivery README](services/delivery-service/README.md).
7. Confirm the Delivery outbox synchronizes the supported statuses back to Order.

## Logs and troubleshooting

```powershell
docker compose ps
docker compose logs --tail=100
docker compose logs -f auth-service
docker compose logs -f order-service
docker compose logs -f delivery-service
```

If an API is unhealthy:

1. Check `docker compose ps` and that MariaDB is healthy.
2. Check the failing service logs.
3. Confirm the root `.env` has all required, non-placeholder values.
4. Confirm no host process occupies ports 5001 through 5005.
5. For status-sync issues, inspect both Delivery and Order logs; the Delivery worker retries its outbox events.

## Database persistence and schema updates

MariaDB uses the named `mariadb_data` volume. It remains when you run `docker compose stop` or `docker compose down`.

The initialization scripts run only the first time that volume is created. They create the five databases and separate application users. Each user has only `SELECT`, `INSERT`, `UPDATE`, and `DELETE` access to its own database; application containers never connect as the database root user.

For a non-destructive schema update:

1. Back up the affected database.
2. Review and apply an additive migration manually.
3. Restart only the affected service.

```powershell
docker compose exec mariadb mariadb-dump -uroot -p food_delivery_order > food_delivery_order-backup.sql
Get-Content .\path\to\migration.sql | docker compose exec -T mariadb mariadb -uroot -p food_delivery_order
docker compose restart order-service
```

Never use `docker compose down -v` as a routine troubleshooting command because it deletes the database volume. Existing XAMPP data is not imported automatically; export and import it separately only after reviewing compatibility and sensitive data.

## Optional MariaDB GUI access

MariaDB is private by default. To expose it only on your own computer at `127.0.0.1:3308`, use:

```powershell
docker compose -f docker-compose.yml -f docker-compose.gui.yml up -d
```

Connect your GUI with host `127.0.0.1`, port `3308`, and a restricted application database user from root `.env`.

## Stop and restart safely

```powershell
docker compose stop       # stop containers, keep data
docker compose up -d      # start existing containers again
docker compose down       # remove containers/network, keep named volume
```

## Local XAMPP development

Docker is optional. Each service can still run directly against the existing XAMPP MariaDB setup. Go to the relevant service folder under `services/`, copy its `.env.example` to `.env`, configure the local database connection, then run `npm ci` and `npm run dev`.

Use the detailed service README for the exact schema command, least-privilege user grant, local environment variables, and tests:

- [Auth](services/auth-service/README.md)
- [Restaurant](services/restaurant-service/README.md)
- [Customer](services/customer-service/README.md)
- [Order](services/order-service/README.md)
- [Delivery](services/delivery-service/README.md)

## Submission evidence checklist

- `services/` showing all five service directories and Dockerfiles
- `docker image ls` showing five `food-delivery-*-service` images
- `docker compose ps` showing six running containers
- Successful `docker compose up --build` output
- Working `/health` and `/ready` responses for all five APIs
- Postman screenshots of the Auth-to-Order-to-Delivery workflow
