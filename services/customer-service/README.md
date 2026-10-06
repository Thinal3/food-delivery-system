# Customer Service

Customer owns customer profile records and delivery addresses. It verifies Auth bearer tokens over HTTP and has its own MariaDB database. It does not import Auth/Order code, share their databases, or create cross-service foreign keys.

## Design Decisions

- `customers.user_id` is the verified Auth user ID. `customers.id` is an independent Customer profile ID; they are not assumed to match.
- Only a verified active `CUSTOMER` can create, read, or update their own profile and addresses. Only `ADMIN` can list/inspect profiles or change profile status. Other roles cannot browse customer information.
- Address lookup/update/delete always filters by both Customer profile ID and address ID; another customer's address appears as `404`.
- The first address is automatically default. New defaults, explicit default selection, and deletion of a default lock the parent customer row in a transaction. MariaDB also enforces at most one default per customer with a generated unique key. Deleting the final address leaves none default.
- Address coordinates are optional but must be supplied/cleared as a pair. Historical Order delivery addresses are snapshots and are never changed by later address edits/deletes.
- The profile endpoint returns both `id` and `user_id`; the address endpoint includes `customer_id` plus `line1`, `line2`, and `postalCode` aliases expected by Order.

## Files

```text
services/customer-service/
  config/       validated environment and MariaDB pool
  controllers/  customer and address HTTP handlers
  database/     production schema and isolated test schema
  middleware/   Auth verification, role checks, request validation
  models/       profile and address constants/contracts
  repositories/ parameterized SQL and transactional address defaults
  routes/       self-service, admin, and address routes
  services/     business rules and response mapping
  test/         controlled HTTP and optional MariaDB tests
  utils/        safe application errors
```

## Local MariaDB Setup

Start XAMPP MariaDB on `127.0.0.1:3307`. From the repository root, run the non-destructive schema with the XAMPP MariaDB client (adjust the executable path if needed):

```powershell
Get-Content -Raw .\services\customer-service\database\schema.sql | & 'C:\xampp\mysql\bin\mysql.exe' --host=127.0.0.1 --port=3307 --user=root --password
```

Enter the local administrator password when prompted. If the local root login has no password, omit `--password`. The script uses `CREATE ... IF NOT EXISTS`; it does not drop or reset existing data.

Create the least-privilege application account in Workbench or an administrator session. Use a strong password you choose and place the same value in Customer's `.env`:

```sql
CREATE USER IF NOT EXISTS 'food_customer_app'@'127.0.0.1'
  IDENTIFIED BY 'replace-with-a-strong-password';
GRANT SELECT, INSERT, UPDATE, DELETE ON food_delivery_customer.*
  TO 'food_customer_app'@'127.0.0.1';
```

From PowerShell in `customer-service`:

```powershell
Copy-Item .env.example .env
```

Edit `DB_PASSWORD` with the selected app-user password. Keep `AUTH_SERVICE_URL=http://localhost:5001` for local development. `.env` and `node_modules` are gitignored; never commit or share secrets.

Install and run:

```powershell
npm ci
npm run dev
```

Customer listens on `0.0.0.0:5005`, checks MariaDB before binding, and closes the pool on shutdown. Use Postman Desktop/Desktop Agent to check:

```text
GET http://localhost:5005/health
GET http://localhost:5005/ready
```

`/health` confirms process health; `/ready` tests the database. When Docker is added later, use Compose service DNS names and container port `3306`; Docker is not part of this service task.

## Auth Integration

Every protected request forwards the original `Authorization: Bearer <token>` to `GET {AUTH_SERVICE_URL}/api/auth/verify` with a bounded timeout. The expected Auth response is `{ "user": { "id": 42, "role": "CUSTOMER", "status": "ACTIVE" } }`. A missing/invalid token returns `401`, insufficient role `403`, Auth timeout/outage `503`, and malformed upstream identity `502`. Customer never trusts a body/header-supplied user ID.

## API

All routes are private except process/database health. Responses never contain password hashes or Auth secrets.

| Method and path | Access | Behavior |
| --- | --- | --- |
| `GET /health` | Public | Process health |
| `GET /ready` | Public | MariaDB readiness |
| `POST /api/customers/me` | CUSTOMER | Create exactly one profile for verified Auth user; `201` |
| `GET /api/customers/me` | CUSTOMER | Read own active profile; returns `{ "customer": { "id", "user_id", "status", ... } }` |
| `PATCH /api/customers/me` | CUSTOMER | Update editable profile fields |
| `POST /api/customers/me/addresses` | CUSTOMER | Create address; first address is default |
| `GET /api/customers/me/addresses` | CUSTOMER | List own addresses, default first |
| `GET /api/customers/me/addresses/:addressId` | CUSTOMER | Read own address; Order contract response is `{ "address": ... }` |
| `PATCH /api/customers/me/addresses/:addressId` | CUSTOMER | Update own address |
| `DELETE /api/customers/me/addresses/:addressId` | CUSTOMER | Delete; choose a deterministic replacement if default |
| `PATCH /api/customers/me/addresses/:addressId/default` | CUSTOMER | Atomically select default |
| `GET /api/customers?page=1&limit=20` | ADMIN | Paginated profile list, maximum limit 100 |
| `GET /api/customers/:customerId` | ADMIN | Inspect one profile |
| `PATCH /api/customers/:customerId/status` | ADMIN | Set `ACTIVE`/`INACTIVE` |

Unknown body properties, IDs, user IDs, status on self-service, timestamps, and address default metadata are rejected. Latitude/longitude may both be omitted, both supplied, or both set to `null`; latitude range is `-90..90`, longitude `-180..180`. Profile images must be optional HTTP/HTTPS URLs and are not fetched.

An inactive Auth account cannot pass Auth verification. An inactive Customer profile can be inspected by ADMIN, but its owner cannot use address mutations or profile self-service. Setting it active again is an ADMIN operation.

## Postman: Auth → Profile → Address → Order

Set a Postman environment variable `customerBaseUrl=http://localhost:5005`. Use Postman Desktop/Desktop Agent for localhost calls, choose **Authorization → Bearer Token**, and set `Content-Type: application/json` for JSON requests.

### 1. Create and log in as a Customer

An ADMIN creates a Customer through Auth's protected account endpoint:

- Method: `POST`
- URL: `http://localhost:5001/api/auth/users`
- Authorization: ADMIN bearer token
- Body:

```json
{
  "name": "Jamie Customer",
  "email": "jamie@example.com",
  "password": "a-strong-customer-password",
  "role": "CUSTOMER",
  "status": "ACTIVE"
}
```

Expected: `201`. Then log in:

- Method: `POST`
- URL: `http://localhost:5001/api/auth/login`
- Body: `{ "email": "jamie@example.com", "password": "a-strong-customer-password" }`
- Expected: `200`; save `token` as `customerToken`.

### 2. Create the Customer profile

- Method: `POST`
- URL: `{{customerBaseUrl}}/api/customers/me`
- Authorization: `Bearer {{customerToken}}`
- Body:

```json
{
  "firstName": "Jamie",
  "lastName": "Customer",
  "phoneNumber": "+1 555 0100",
  "profileImage": "https://example.com/jamie.jpg"
}
```

Expected: `201` and a profile with distinct `id` and `user_id`. Save `customer.id` if useful; do not substitute it for the Auth ID.

### 3. Add a delivery address

- Method: `POST`
- URL: `{{customerBaseUrl}}/api/customers/me/addresses`
- Authorization: `Bearer {{customerToken}}`
- Body:

```json
{
  "addressName": "Home",
  "addressLine1": "14 Main Street",
  "addressLine2": null,
  "city": "Sample City",
  "postalCode": "90210",
  "latitude": 34.1,
  "longitude": -118.2
}
```

Expected: `201`, address has `customer_id` matching the profile ID and `is_default: true`. Save `address.id` as `deliveryAddressId`.

### 4. Verify Order-compatible lookup

- Method: `GET`
- URL: `{{customerBaseUrl}}/api/customers/me`
- Authorization: `Bearer {{customerToken}}`
- Expected: `200`, `{ "customer": { "id": <profile ID>, "user_id": <Auth ID>, "status": "ACTIVE" } }`.

Then fetch the address:

- Method: `GET`
- URL: `{{customerBaseUrl}}/api/customers/me/addresses/{{deliveryAddressId}}`
- Authorization: `Bearer {{customerToken}}`
- Expected: `200`, `{ "address": { "id", "customer_id", "address_line1", "line1", "city", ... } }`.

### 5. Place an Order

Ensure Auth, Customer, Restaurant, and Order are running; the chosen Restaurant must be `ACTIVE` and `OPEN`, and each menu item available. Then send:

- Method: `POST`
- URL: `http://localhost:5003/api/orders`
- Authorization: `Bearer {{customerToken}}`
- Body:

```json
{
  "restaurantId": 5,
  "deliveryAddressId": {{deliveryAddressId}},
  "items": [
    { "menuItemId": 101, "quantity": 2 },
    { "menuItemId": 102, "quantity": 1 }
  ]
}
```

Expected: `201`, `status: "PENDING"`, snapshots of verified prices/names/address, and exact string money totals. Do not send customer IDs, owner IDs, prices, item names, totals, address objects, or status.

Other examples:

- Own profile: `GET {{customerBaseUrl}}/api/customers/me`, expected `200`.
- Update profile: `PATCH {{customerBaseUrl}}/api/customers/me`, body `{ "phoneNumber": "+1 555 0101" }`, expected `200`.
- Select default: `PATCH {{customerBaseUrl}}/api/customers/me/addresses/{{deliveryAddressId}}/default`, body `{}`, expected `200`.
- List addresses: `GET {{customerBaseUrl}}/api/customers/me/addresses`, expected `200`.
- Delete address: `DELETE {{customerBaseUrl}}/api/customers/me/addresses/{{deliveryAddressId}}`, expected `204`.
- Customer trying ADMIN list: `GET {{customerBaseUrl}}/api/customers`, expected `403`.
- Another customer trying the address ID: `GET {{customerBaseUrl}}/api/customers/me/addresses/{{deliveryAddressId}}`, expected `404`.

## Tests

Run controlled HTTP tests; they use a local Auth fixture and in-memory repository, never MariaDB development data:

```powershell
npm test
```

The optional MariaDB test is restricted to a separate database ending in `_test`. Execute `database/test-schema.sql` with the XAMPP client, grant a test login access only to `food_delivery_customer_test`, then run:

```powershell
$env:CUSTOMER_TEST_DB_NAME = 'food_delivery_customer_test'
npm run test:db
```

The test only cleans up rows it creates. Never point it at development or production data.

## Docker Deferred

Docker is deferred until the planned local services work together. No Dockerfile, `.dockerignore`, or Compose file was created or modified. Suggested commit: `feat(customer): add profiles and transactional address management`.
