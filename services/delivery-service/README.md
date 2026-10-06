# Delivery Service

Delivery assigns delivery people to eligible orders, stores immutable pickup/drop-off snapshots, manages the delivery lifecycle, and synchronizes pickup/progress/delivery events to Order through a recoverable outbox. It uses its own MariaDB database and only calls other services over HTTP.

## Key Decisions

- `delivery_person_id` is the verified Auth user ID. `customer_id` is the Customer profile ID; `customer_user_id` is its separate Auth ID.
- A delivery can be created only for an Order in `READY_FOR_PICKUP`. A restaurant owner is checked against Restaurant's current `owner_user_id`; ADMIN can manage all.
- Creation copies Order's delivery address snapshot and Restaurant's current pickup address. Later source changes do not alter the delivery record.
- One delivery per order is enforced by a unique database key.
- Only ADMIN can assign/reassign an active Auth `DELIVERY_PERSON`. Reassignment is permitted only before pickup (`ASSIGNED` or `PICKUP_PENDING`).
- Order status updates use a durable outbox inserted in the same MariaDB transaction as a Delivery transition. The worker retries with bounded exponential delays, leases recover after restart, and event ordering is preserved per order.
- `FAILED` and `CANCELLED` are Delivery-only terminal states. They do not make up Order statuses or cancel an Order after pickup. Order may remain at its last supported state; support staff can inspect the delivery outbox to see that no Order transition was emitted.

## Local Database Setup

Start XAMPP MariaDB at `127.0.0.1:3307`. From the repository root, execute the schema using the XAMPP client (change the path if needed):

```powershell
Get-Content -Raw .\services\delivery-service\database\schema.sql | & 'C:\xampp\mysql\bin\mysql.exe' --host=127.0.0.1 --port=3307 --user=root --password
```

Enter the local MariaDB administrator password when prompted. If local root has no password, omit `--password`. The script only creates missing objects; it never drops/reset data.

Create the limited application account in Workbench/admin session:

```sql
CREATE USER IF NOT EXISTS 'food_delivery_app'@'127.0.0.1'
  IDENTIFIED BY 'replace-with-a-strong-password';
GRANT SELECT, INSERT, UPDATE, DELETE ON food_delivery_delivery.*
  TO 'food_delivery_app'@'127.0.0.1';
```

In `delivery-service`, create `.env` and install/run:

```powershell
Copy-Item .env.example .env
```

Set `DB_PASSWORD` to the chosen database-user password. Generate one random secret of at least 32 characters for `ORDER_DELIVERY_SYNC_SECRET` and put the same value in `services/order-service/.env`. Do not put that secret in source or chat; both `.env` files are ignored by Git.

```powershell
npm ci
npm run dev
```

The API binds to `0.0.0.0:5004`. Check `GET http://localhost:5004/health` and `GET http://localhost:5004/ready` with Postman Desktop/Desktop Agent. `/health` tests the process; `/ready` tests MariaDB.

## Upstream Contracts and Sync Safety

Auth: Delivery forwards the caller's bearer token to `GET {AUTH_SERVICE_URL}/api/auth/verify`, expecting `{ "user": { "id", "role", "status": "ACTIVE" } }`. Admin assignment verifies the selected ID through Auth's protected paginated `GET /api/auth/users?page=N&limit=100` and requires an active `DELIVERY_PERSON`.

Order: delivery creation requests `GET {ORDER_SERVICE_URL}/api/orders/:orderId` with the caller token and expects `{ "order": { "id", "status", "restaurant_id", "restaurant_owner_user_id", "customer_id", "customer_user_id", "delivery_address" } }`. It requires `READY_FOR_PICKUP`.

Restaurant: Delivery requests `GET {RESTAURANT_SERVICE_URL}/api/restaurants/:restaurantId` with the caller token and expects `{ "restaurant": { "id", "owner_user_id", "address", ... } }`. The restaurant service allows its current owner/ADMIN to inspect inactive restaurant records, so historical ownership checks can still be made.

### No recursive Order/Delivery callback

Order verifies an assignment with `GET {DELIVERY_SERVICE_URL}/api/deliveries/me/orders/:orderId/assignment` using the caller's user bearer token. Delivery serves this directly from its local DB and does **not** call Order.

For status synchronization, Delivery's outbox worker calls `POST {ORDER_SERVICE_URL}/api/orders/internal/delivery-sync` with a dedicated `ORDER_DELIVERY_SYNC_SECRET`, not a user's token. Before Order advances, it calls Delivery's secret-protected `GET /api/deliveries/internal/orders/:orderId/status`. That endpoint only reads Delivery's local DB and never calls Order. Configure the same random secret in Order and Delivery. It grants access only to this specific delivery-sync route, not ADMIN access.

Outbox states are `PENDING`, `PROCESSING`, `SYNCED`, and `FAILED`. A worker claim has a lease and returns to pending after a process crash. Failures retry with exponential delays capped at five minutes and stop at `SYNC_MAX_ATTEMPTS`; a failed event blocks later events for that order to preserve order. Inspect `delivery_order_sync` for `last_error`, attempts, and state; after fixing the dependency/configuration, an operator may reset only the specific failed task to `PENDING` and clear its completion timestamp. Never remove the order/delivery records to resolve a sync issue.

PICKED_UP, ON_THE_WAY, and DELIVERED are synchronized. FAILED and CANCELLED are not synchronized because Order has no corresponding supported lifecycle edge.

## Endpoints and Permissions

All delivery endpoints are authenticated except health/readiness. IDs, ownership, snapshots, and assigned user IDs are never trusted from request bodies.

| Method and path | Access | Behavior |
| --- | --- | --- |
| `GET /health` | Public | Process health |
| `GET /ready` | Public | DB readiness |
| `POST /api/deliveries` | ADMIN or current restaurant owner | Create from a READY_FOR_PICKUP Order |
| `GET /api/deliveries/mine?page=1&limit=20&status=ASSIGNED` | ADMIN, CUSTOMER, DELIVERY_PERSON | ADMIN sees all; others see only their assigned/customer deliveries |
| `GET /api/deliveries/order/:orderId` | Authorized customer, current owner, assigned person, ADMIN | Delivery for one Order |
| `GET /api/deliveries/restaurant/:restaurantId?page=1&limit=20` | Current restaurant owner or ADMIN | Restaurant deliveries |
| `GET /api/deliveries?page=1&limit=20` | ADMIN | All deliveries |
| `GET /api/deliveries/:deliveryId` | Authorized customer, current owner, assigned person, ADMIN | One delivery |
| `PATCH /api/deliveries/:deliveryId/assign` | ADMIN | Assign/reassign verified active delivery person before pickup |
| `PATCH /api/deliveries/:deliveryId/status` | Assigned delivery person or ADMIN; owner for allowed cancellation | One valid lifecycle step |
| `POST /api/deliveries/:deliveryId/cancel` | ADMIN or current restaurant owner, before pickup | Cancel; Order status is not changed |
| `GET /api/deliveries/me/orders/:orderId/assignment` | DELIVERY_PERSON | Assignment proof consumed by Order; local read only |
| `GET /api/deliveries/internal/orders/:orderId/status` | Order sync secret | Persisted state consumed by Order; local read only |

Pagination defaults to page 1 / limit 20, maximum limit 100. Status filters must be valid Delivery statuses. Customer and delivery address snapshots are private and only returned to authorized callers.

### Transition table

| Current | Next state | Allowed caller |
| --- | --- | --- |
| PENDING | ASSIGNED | ADMIN assignment endpoint only |
| PENDING | CANCELLED | ADMIN or current restaurant owner |
| ASSIGNED | PICKUP_PENDING | Assigned delivery person or ADMIN |
| ASSIGNED | FAILED | Assigned delivery person or ADMIN; reason required |
| ASSIGNED | CANCELLED | ADMIN or current restaurant owner |
| PICKUP_PENDING | PICKED_UP | Assigned delivery person or ADMIN |
| PICKUP_PENDING | FAILED | Assigned delivery person or ADMIN; reason required |
| PICKUP_PENDING | CANCELLED | ADMIN or current restaurant owner |
| PICKED_UP | ON_THE_WAY | Assigned delivery person or ADMIN |
| PICKED_UP | FAILED | Assigned delivery person or ADMIN; reason required |
| ON_THE_WAY | DELIVERED | Assigned delivery person or ADMIN |
| ON_THE_WAY | FAILED | Assigned delivery person or ADMIN; reason required |
| DELIVERED, FAILED, CANCELLED | None | Terminal |

Reassignment is allowed while `ASSIGNED` or `PICKUP_PENDING`, never once PICKED_UP. Conditional row-locked updates prevent concurrent transitions from both succeeding; conflicts return `409`.

## Postman Workflow

Set `deliveryBaseUrl=http://localhost:5004`. Use Postman Desktop/Desktop Agent for localhost and choose Authorization → Bearer Token.

1. Log in through Auth `POST http://localhost:5001/api/auth/login` as an ADMIN and save its response `token` as `adminToken`.
2. Create/log in a RESTAURANT_ADMIN and CUSTOMER through Auth's admin user endpoint; save their tokens. Create the Customer profile/address and an OPEN restaurant/menu via their respective README steps.
3. As customer, place an Order at `POST http://localhost:5003/api/orders` with `{ "restaurantId": 5, "deliveryAddressId": <id>, "items": [{ "menuItemId": 101, "quantity": 1 }] }`. Progress that Order through CONFIRMED → PREPARING → READY_FOR_PICKUP as restaurant owner.
4. Create Delivery using owner/ADMIN bearer token: `POST {{deliveryBaseUrl}}/api/deliveries`, JSON `{ "orderId": 123 }`. Expected `201`, status PENDING, Restaurant pickup snapshot, and copied Order delivery-address snapshot.
5. Assign as ADMIN: `PATCH {{deliveryBaseUrl}}/api/deliveries/1/assign`, ADMIN bearer token, JSON `{ "deliveryPersonId": 77 }`. Expected `200`, ASSIGNED and assignment timestamp. Inactive/non-delivery Auth IDs return `400`.
6. Log in as that DELIVERY_PERSON. PATCH `{{deliveryBaseUrl}}/api/deliveries/1/status` with driver bearer token and JSON `{ "status": "PICKUP_PENDING" }`, then `{ "status": "PICKED_UP" }`, `{ "status": "ON_THE_WAY" }`, and `{ "status": "DELIVERED" }`. Each returns `200`; Order synchronization runs asynchronously through the outbox.
7. Try another driver's token to read/update: `403`. Try an invalid jump such as ASSIGNED → DELIVERED or cancel after PICKED_UP: `409`.

## Testing

Run fixture HTTP tests using controlled Auth/Order/Restaurant responses and isolated repository data:

```powershell
npm test
```

Optional MariaDB tests require a separate database ending in `_test`. Execute `database/test-schema.sql`, grant a test DB account access only to `food_delivery_delivery_test`, then run:

```powershell
$env:DELIVERY_TEST_DB_NAME = 'food_delivery_delivery_test'
npm run test:db
```

Only unique test records are created and cleaned; do not point this at development/production data.

## Docker Deferred

No Dockerfile, `.dockerignore`, or Compose configuration was created. Docker remains deferred until Auth, Restaurant, and Customer are tested locally. Suggested commit: `feat(delivery): add assignment lifecycle and order sync outbox`.
