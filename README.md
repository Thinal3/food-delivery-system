# Food Delivery System

A Node.js microservice backend for a food-delivery platform. Each service is an Express 5 application with its own MySQL/MariaDB database and communicates with other services over HTTP.

## Included services

| Service | Port | Responsibility |
| --- | ---: | --- |
| [Auth](auth-service/README.md) | 5001 | User accounts, JWT authentication, roles, and account status |
| [Restaurant](restaurant-service/README.md) | 5002 | Restaurants, categories, menu items, availability, and operating status |
| [Order](order-service/README.md) | 5003 | Order creation, immutable menu/address snapshots, totals, and order lifecycle |
| [Delivery](delivery-service/README.md) | 5004 | Delivery assignment, delivery lifecycle, and reliable order-status synchronization |
| [Customer](customer-service/README.md) | 5005 | Customer profiles and delivery addresses |

All services expose `GET /health` for process health and `GET /ready` for database readiness.

## Architecture

```text
Client
  |
  +--> Auth (5001) <--- bearer-token verification --- Restaurant, Customer, Order, Delivery
  |
  +--> Restaurant (5002) ---- menu/restaurant data ----> Order (5003)
  +--> Customer   (5005) ---- profile/address data -----> Order (5003)
  +--> Order      (5003) <--- delivery status sync -----> Delivery (5004)
```

Auth is the authority for user identity, roles, and active status. The other services forward bearer tokens to Auth's verification endpoint and enforce ownership rules for the resources they own. Database tables are not shared between services.

## Prerequisites

- Node.js 20 or newer
- MySQL or MariaDB (the example configuration uses `127.0.0.1:3307` for Restaurant, Customer, Order, and Delivery)
- PowerShell, Postman, or another HTTP client for local testing

Docker and Docker Compose are not included in the current codebase; services run directly on the host.

## Local setup

1. Create each service database by running its `database/schema.sql` file with a database administrator account. The scripts create missing databases/tables and do not reset existing data.
2. Create the limited database users described in each service README.
3. In every service directory, copy `.env.example` to `.env` and fill in the database credentials.
4. Generate a strong `JWT_SECRET` for Auth. Configure all dependent services with `AUTH_SERVICE_URL=http://localhost:5001`.
5. Generate one strong `ORDER_DELIVERY_SYNC_SECRET` and use the exact same value in `order-service/.env` and `delivery-service/.env`.
6. Install locked dependencies and start services in the order below.

```powershell
Set-Location auth-service
Copy-Item .env.example .env
npm ci
npm run dev
```

Open a separate terminal for each remaining service:

```powershell
Set-Location restaurant-service  # then customer-service, order-service, or delivery-service
Copy-Item .env.example .env
npm ci
npm run dev
```

Start order: **Auth → Restaurant → Customer → Order → Delivery**. Auth must be available before any authenticated request to the other services. Order depends on Auth, Restaurant, Customer, and Delivery; Delivery depends on Auth, Restaurant, and Order.

To create the first administrator, set `ADMIN_NAME`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD` in `auth-service/.env`, then run this once from `auth-service`:

```powershell
npm run bootstrap:admin
```

Do not commit `.env` files or share database passwords, JWT secrets, or the order-delivery sync secret.

## Main API areas

| Service | Base path | Highlights |
| --- | --- | --- |
| Auth | `/api/auth` | Register, login, current user, verification, and ADMIN user management |
| Restaurant | `/api/restaurants` | Browse/manage restaurants, nested categories, and nested menu items |
| Customer | `/api/customers` | Customer profile and `/me/addresses` management |
| Order | `/api/orders` | Create orders, customer/restaurant/admin history, lifecycle updates, and cancellation |
| Delivery | `/api/deliveries` | Create, assign, track, cancel, and synchronize deliveries |

Public registration creates only `CUSTOMER` accounts. Administrators can create `RESTAURANT_ADMIN` and `DELIVERY_PERSON` users. Protected APIs use `Authorization: Bearer <token>`.

Order creation snapshots menu prices/items and the chosen delivery address. Delivery uses a database outbox to retry and preserve the order of supported delivery events (`PICKED_UP`, `ON_THE_WAY`, and `DELIVERED`) sent to Order.

## Tests and checks

Run commands from the relevant service directory:

```powershell
npm test       # fixture-based integration tests; does not modify the development database
npm run check  # syntax checks for the service entry points
```

Restaurant, Customer, Order, and Delivery also provide `npm run test:db` for optional database repository tests. These require the corresponding `database/test-schema.sql` and a separately configured database whose name ends in `_test`; see that service's README before running them.

## Further documentation

Each service README is the source of truth for its environment variables, database account grants, endpoint contracts, authorization rules, lifecycle transitions, Postman workflows, and test-database setup:

- [Auth service](auth-service/README.md)
- [Restaurant service](restaurant-service/README.md)
- [Customer service](customer-service/README.md)
- [Order service](order-service/README.md)
- [Delivery service](delivery-service/README.md)
