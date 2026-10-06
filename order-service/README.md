# Order Service

Order stores food-order history and snapshots the data needed to preserve what the customer ordered. It uses its own MariaDB database and communicates with Auth, Restaurant, Customer, and Delivery only through HTTP. It does not import their source or open their databases.

## Structure

```text
order-service/
  config/       environment and MariaDB connection pool
  controllers/  HTTP handlers
  database/     production and isolated test schemas
  middleware/   Auth verification, role checks, and request validation
  models/       order lifecycle and line-item limits
  repositories/ parameterized SQL and transaction operations
  routes/       protected order endpoints
  services/     order rules and upstream HTTP clients
  test/         controlled HTTP fixture tests and optional MariaDB tests
  utils/        safe errors and integer-cent money helpers
```

## Important Decisions

- `customer_id` is the Customer profile ID; `customer_user_id` is the Auth user ID. The Customer API must return both. They are never assumed equal.
- Restaurant status, menu names/prices, and the Customer delivery address are checked through their own services before opening the database transaction. The order and its items are then saved atomically.
- Prices are accepted from Restaurant as decimal strings and converted to integer cents using `BigInt`. Totals are returned and stored as decimal strings, e.g. `"27.50"`; ordinary floating-point arithmetic is not used.
- The configured flat `DELIVERY_FEE` is charged once per order. There is no distance pricing, inventory reservation, or payment processing. Availability is checked when the order is created; it can change immediately afterward.
- Menu item name, unit price, line total, and address are snapshots. Future Restaurant or Customer changes do not rewrite old orders.
- External calls use `SERVICE_REQUEST_TIMEOUT_MS`. Auth/Customer/Restaurant/Delivery outages fail closed; no order is created if a required check fails.

## Local MariaDB Setup

Start XAMPP MariaDB on `127.0.0.1:3307`. From the repository root, execute the schema using the XAMPP client (adjust the path if XAMPP is installed elsewhere):

```powershell
Get-Content -Raw .\order-service\database\schema.sql | & 'C:\xampp\mysql\bin\mysql.exe' --host=127.0.0.1 --port=3307 --user=root --password
```

The client prompts for the MariaDB administrator password. If the local root account has no password, omit `--password`. The schema is non-destructive: it creates the database/tables only when absent and never drops data.

Create the restricted application account in Workbench or a MariaDB admin session. Set your own strong password and use it as `DB_PASSWORD` in the Order `.env` file:

```sql
CREATE USER IF NOT EXISTS 'food_order_app'@'127.0.0.1'
  IDENTIFIED BY 'replace-with-a-strong-password';
GRANT SELECT, INSERT, UPDATE, DELETE ON food_delivery_order.*
  TO 'food_order_app'@'127.0.0.1';
```

From PowerShell in `order-service`:

```powershell
Copy-Item .env.example .env
```

Edit `DB_PASSWORD` and confirm the three local URLs are correct. `.env` is ignored by Git; do not commit or share secrets. Then install and run:

```powershell
npm ci
npm run dev
```

The server binds to `0.0.0.0:5003`, checks MariaDB before listening, and closes the pool on shutdown. Check process and DB readiness in Postman Desktop/Desktop Agent:

```text
GET http://localhost:5003/health
GET http://localhost:5003/ready
```

`/health` checks the process; `/ready` checks the database. In Docker later, `DB_HOST` and service URLs must be Compose service names with internal ports; Docker is intentionally not included now.

## Upstream Contracts

### Auth

Every protected request forwards the caller's exact `Authorization: Bearer <token>` to `GET {AUTH_SERVICE_URL}/api/auth/verify`. The expected response is `{ "user": { "id": 42, "role": "CUSTOMER", "status": "ACTIVE" } }`. Only Auth supplies trusted identity. Invalid/missing tokens yield `401`; Auth outage or timeout yields `503`.

### Customer: required contract, service not present yet

The current `customer-service/` directory is empty. Order therefore includes a client contract and fixture tests but cannot create a real order until Customer implements these protected endpoints:

`GET /api/customers/me` with the forwarded caller token returns:

```json
{
  "customer": {
    "id": 901,
    "user_id": 42,
    "status": "ACTIVE"
  }
}
```

`id` is the Customer profile ID; `user_id` must match the Auth-verified user ID. `GET /api/customers/me/addresses/:addressId` returns the selected caller-owned address:

```json
{
  "address": {
    "id": 22,
    "customer_id": 901,
    "line1": "10 Main Street",
    "line2": null,
    "city": "Sample City",
    "region": "CA",
    "postal_code": "90210",
    "country": "US"
  }
}
```

Order checks `customer_id` against the resolved Customer profile before snapshotting the address. Until Customer serves this contract, order creation safely returns `503`; it never invents a profile ID or substitutes the Auth ID.

### Restaurant

Order uses `GET /api/restaurants/:restaurantId` and expects `{ "restaurant": { "id", "owner_user_id", "status", "operating_status" } }`. It uses `GET /api/restaurants/:restaurantId/menu/:itemId` and expects `{ "item": { "id", "restaurant_id", "name", "price", "availability" } }`. Restaurant returns prices as decimal strings; MySQL `TINYINT(1)` availability may appear as `0/1` or boolean. Restaurant must be `ACTIVE` and `OPEN`; each item must match the selected restaurant and be available.

Restaurant admins are authorized by fetching the current Restaurant record with their forwarded token and comparing `owner_user_id` to the Auth identity. A client-supplied restaurant ID or stored owner snapshot is not sufficient authorization.

### Delivery: not implemented yet

Delivery-person order reads/updates require the future protected endpoint `GET {DELIVERY_SERVICE_URL}/api/deliveries/me/orders/:orderId/assignment`, returning `{ "assignment": { "order_id": 123, "delivery_person_user_id": 11, "status": "ACTIVE" } }`. Until Delivery implements and confirms that assignment, the service does not grant delivery users access. Never trust a custom role/assignment header.

## API and Permissions

Every endpoint requires a valid bearer token except `/health` and `/ready`. Responses containing orders include their item snapshots and delivery address only for an authorized customer, current restaurant owner, assigned driver, or ADMIN.

| Method and path | Access | Result |
| --- | --- | --- |
| `GET /health` | Public | Process health |
| `GET /ready` | Public | DB readiness |
| `POST /api/orders` | CUSTOMER | Create own order; `201` |
| `GET /api/orders/mine?page=1&limit=20&status=PENDING` | CUSTOMER | Own history |
| `GET /api/orders/restaurant/:restaurantId?page=1&limit=20&status=CONFIRMED` | Current restaurant owner or ADMIN | Restaurant orders |
| `GET /api/orders?page=1&limit=20&status=PENDING` | ADMIN | All orders |
| `GET /api/orders/:orderId` | Owning CUSTOMER, current restaurant owner, assigned driver, ADMIN | One order |
| `PATCH /api/orders/:orderId/status` | Current restaurant owner, assigned driver, ADMIN | Apply one valid transition |
| `POST /api/orders/:orderId/cancel` | Owning CUSTOMER, current restaurant owner before pickup, ADMIN before pickup | Cancel under the transition rules |

Pagination defaults to page 1 and limit 20, caps limit at 100, and accepts pages through 1,000,000. The `status` filter must be one of the lifecycle statuses. Request bodies reject unknown/protected fields. Order creation supports 1–20 distinct menu item IDs, each quantity 1–99.

### Lifecycle transition rules

| Current | Allowed next state | Who may perform it |
| --- | --- | --- |
| PENDING | CONFIRMED | Current restaurant owner or ADMIN |
| PENDING | CANCELLED | Owning CUSTOMER, current restaurant owner, or ADMIN |
| CONFIRMED | PREPARING | Current restaurant owner or ADMIN |
| CONFIRMED | CANCELLED | Current restaurant owner or ADMIN |
| PREPARING | READY_FOR_PICKUP | Current restaurant owner or ADMIN |
| PREPARING | CANCELLED | Current restaurant owner or ADMIN |
| READY_FOR_PICKUP | PICKED_UP | Assigned delivery person or ADMIN |
| PICKED_UP | ON_THE_WAY | Assigned delivery person or ADMIN |
| ON_THE_WAY | DELIVERED | Assigned delivery person or ADMIN |
| DELIVERED, CANCELLED | None | Terminal states |

Each request advances exactly one edge; no backwards jumps or cancellation after pickup. A conditional database update ensures only one concurrent status change wins; the other receives `409`. ADMIN also follows one edge at a time.

## Postman Workflow

Set a Postman environment variable `orderBaseUrl=http://localhost:5003`. Use Postman Desktop/Desktop Agent for `localhost`, and set `Content-Type: application/json` on JSON requests.

1. Bootstrap/login the ADMIN using `auth-service/README.md`. Log in with `POST http://localhost:5001/api/auth/login`, body `{"email":"admin@example.com","password":"your-password"}`, and copy the response `token`.
2. With the ADMIN bearer token, create a restaurant admin using `POST http://localhost:5001/api/auth/users`, body `{"name":"Restaurant Manager","email":"manager@example.com","password":"another-strong-password","role":"RESTAURANT_ADMIN","status":"ACTIVE"}`. Log in as that account to get the restaurant-owner token.
3. Use the Auth ADMIN token to create an active CUSTOMER through the same Auth admin-users endpoint, then log in as the customer and copy its token. Order creation requires the corresponding Customer profile and address APIs described above; until Customer exists, expect `503` from `POST /api/orders`.

Once Customer is implemented, create an order:

- Method: `POST`
- URL: `{{orderBaseUrl}}/api/orders`
- Authorization: customer **Bearer Token**
- Body:

```json
{
  "restaurantId": 5,
  "deliveryAddressId": 22,
  "items": [
    { "menuItemId": 101, "quantity": 2 },
    { "menuItemId": 102, "quantity": 1 }
  ]
}
```

Expected: `201`, `status: "PENDING"`, safe snapshots, and exact totals from Restaurant menu prices plus `DELIVERY_FEE`. Do not include price, item name, customer ID, totals, address, or status in the request.

Further examples:

- Customer history: `GET {{orderBaseUrl}}/api/orders/mine`; customer token; expect `200` with only that Auth user's orders.
- Restaurant history: `GET {{orderBaseUrl}}/api/orders/restaurant/5`; owner or ADMIN token; expect `200` only if the caller currently owns/manages Restaurant 5.
- Confirm: `PATCH {{orderBaseUrl}}/api/orders/123/status`; owner bearer token; body `{ "status": "CONFIRMED" }`; expected `200`.
- Cancel: `POST {{orderBaseUrl}}/api/orders/123/cancel`; customer bearer token for own PENDING order; no body; expected `200` and `CANCELLED`.
- Reject wrong role: try `POST /api/orders` with owner token; expected `403`.
- Reject access to another customer's order: use their order ID with a different CUSTOMER token; expected `403`.
- ADMIN history: `GET {{orderBaseUrl}}/api/orders?page=1&limit=20`; ADMIN token; expected `200`.

## Testing

Fixture-based HTTP tests use controlled Auth/Restaurant/Customer/Delivery servers and an isolated in-memory repository. They do not modify MariaDB and can exercise creation even while the real Customer service is pending:

```powershell
npm test
```

Optional real database repository tests are guarded to a separately initialized database whose name ends in `_test`. Execute `database/test-schema.sql` with the XAMPP client, grant the test credentials only on `food_delivery_order_test`, then set and run:

```powershell
$env:ORDER_TEST_DB_NAME = 'food_delivery_order_test'
npm run test:db
```

That test creates unique rows and cleans up only its own records. Never point it at development or production data. `npm run check` parses the application entry points; `npm test` also runs all controlled service-level checks.

## Docker Deferred

Order is currently local-only. Dockerfiles and Compose remain deferred until Auth, Restaurant, and Customer work together locally. No Docker files were added here. Suggested commit: `feat(order): add snapshot-based order lifecycle service`.