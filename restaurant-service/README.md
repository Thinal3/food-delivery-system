# Restaurant Service

Restaurant owns restaurant profiles, categories, and menu data. It uses a separate MariaDB database and verifies caller tokens through Auth over HTTP. It never imports Auth source files or connects to Auth's database.

## Responsibilities and Design

- Auth owns user IDs, roles, active/inactive account state, and token verification.
- Restaurant stores `owner_user_id` as an external Auth ID, not a cross-database foreign key.
- `RESTAURANT_ADMIN` can create restaurants and manage only their own. The owner ID comes from Auth's verified identity.
- `ADMIN` can manage any restaurant. When creating one, ADMIN must provide `ownerUserId`; Restaurant checks Auth's protected, paginated admin user listing and requires that user to be an active `RESTAURANT_ADMIN`.
- `CUSTOMER` and `DELIVERY_PERSON` can browse active restaurants but cannot write restaurant data.
- Restaurant `status` (`ACTIVE`/`INACTIVE`) controls whether it is listed publicly. `operating_status` (`OPEN`/`CLOSED`) is independent and manually set. Hours are informational and accept overnight ranges; no automatic schedule is applied.
- Menu prices are accepted as decimal strings, stored as `DECIMAL(10,2)`, and returned as JSON strings such as `"12.50"`. Future Order code should keep them as decimal strings or use a decimal/money library, not convert them to JavaScript floating-point numbers.
- Menu deletion is soft deletion. Deleting a category is blocked while it has any non-deleted items; when allowed, the category is removed and old soft-deleted items retain their history with a null category reference.

## Folder Structure

```text
restaurant-service/
  config/       environment and MariaDB pool
  controllers/  restaurant, category, and menu HTTP handlers
  database/     production schema and isolated test schema
  middleware/   Auth verification, role/owner access, validation, errors
  models/       restaurant, category, and menu contracts/constants
  repositories/ parameterized SQL, always scoped by restaurant ID
  routes/       separate restaurant, category, and menu routes
  services/     business rules and Auth API client
  test/         HTTP integration tests and optional MariaDB repository test
  utils/        safe application error type
  .env.example
  package.json
  package-lock.json
  server.js
```

## Local Setup: XAMPP MariaDB

Start MySQL/MariaDB in the XAMPP control panel. The examples below use `127.0.0.1:3307` as requested. From the repository root, execute `restaurant-service/database/schema.sql` with the XAMPP client. If XAMPP is installed elsewhere, replace the executable path:

```powershell
Get-Content -Raw .\restaurant-service\database\schema.sql | & 'C:\xampp\mysql\bin\mysql.exe' --host=127.0.0.1 --port=3307 --user=root --password
```

The MariaDB client prompts for the local administrator password. The schema only creates the database and tables if absent; it does not drop or reset data. If your XAMPP root account has no password, omit `--password`.

In Workbench or a MariaDB admin session, create the separate application login. Choose a new strong password and use the same value for `DB_PASSWORD` below:

```sql
CREATE USER IF NOT EXISTS 'food_restaurant_app'@'127.0.0.1'
  IDENTIFIED BY 'replace-with-a-strong-password';
GRANT SELECT, INSERT, UPDATE, DELETE ON food_delivery_restaurant.*
  TO 'food_restaurant_app'@'127.0.0.1';
```

From PowerShell in `restaurant-service`:

```powershell
Copy-Item .env.example .env
```

Edit `.env` with the chosen database password. Keep `AUTH_SERVICE_URL=http://localhost:5001` for local Auth. `.env` is ignored by Git. Do not commit or share it.

Install from the lockfile and start the service:

```powershell
npm ci
npm run dev
```

The service binds to `0.0.0.0:5002`. In another terminal, check:

```powershell
Invoke-RestMethod http://localhost:5002/health
Invoke-RestMethod http://localhost:5002/ready
```

`/health` checks the process. `/ready` runs a database query. Startup also refuses to listen if MariaDB is unavailable. A local Node process uses the host address and port `3307`; later, inside Compose, `DB_HOST` must be the Compose database service name and `DB_PORT` the container's internal `3306`.

## Authentication and Access

For protected requests, Restaurant forwards the exact `Authorization: Bearer <token>` header to `GET {AUTH_SERVICE_URL}/api/auth/verify`, with a bounded timeout. Auth returns the current verified `id`, `role`, and `status`. Restaurant does not trust role or user IDs in bodies or custom headers.

- Missing, rejected, expired, or invalid token: `401`.
- Valid identity without the required role or ownership: `403`.
- Auth timeout, network error, or upstream server outage: `503`; Restaurant fails closed.
- Unexpected Auth response: safe `502` error.
- Other services should forward the caller token to Auth's `/api/auth/verify`; they must still enforce ownership of their own resources.

## Endpoints

All restaurant/category/menu IDs are nested and scoped. Collection endpoints use `page` and `limit`; default limit is 20, maximum 100, maximum page is 1,000,000.

| Method and path | Access | Behavior |
| --- | --- | --- |
| `GET /health` | Public | Process health |
| `GET /ready` | Public | Database readiness |
| `GET /api/restaurants?page=1&limit=20&cuisine=Italian&operatingStatus=OPEN` | Public | Active restaurants only, including CLOSED; filterable |
| `GET /api/restaurants/mine?page=1&limit=20` | `RESTAURANT_ADMIN`, `ADMIN` | Owner's restaurants including inactive; ADMIN sees all |
| `GET /api/restaurants/:restaurantId` | Public for active; owner/ADMIN for inactive | Restaurant details |
| `POST /api/restaurants` | `RESTAURANT_ADMIN`, `ADMIN` | Create restaurant; owner derived for RESTAURANT_ADMIN, verified `ownerUserId` required for ADMIN |
| `PATCH /api/restaurants/:restaurantId` | Owner/ADMIN | Edit profile, contact, cuisine, and paired opening/closing times; cannot transfer ownership |
| `PATCH /api/restaurants/:restaurantId/status` | Owner/ADMIN | Set `ACTIVE` or `INACTIVE` |
| `PATCH /api/restaurants/:restaurantId/operating-status` | Owner/ADMIN | Set `OPEN` or `CLOSED` |
| `DELETE /api/restaurants/:restaurantId` | Owner/ADMIN | Deactivate; returns `204`, never deletes the row |
| `GET /api/restaurants/:restaurantId/categories` | Public for active; owner/ADMIN for inactive | List categories |
| `POST /api/restaurants/:restaurantId/categories` | Owner/ADMIN | Create restaurant-specific category |
| `PATCH /api/restaurants/:restaurantId/categories/:categoryId` | Owner/ADMIN | Rename category |
| `DELETE /api/restaurants/:restaurantId/categories/:categoryId` | Owner/ADMIN | Delete if no non-deleted menu items; otherwise `409` |
| `GET /api/restaurants/:restaurantId/menu?page=1&limit=20&categoryId=1&availability=true` | Public for active; owner/ADMIN for inactive | List non-deleted items |
| `GET /api/restaurants/:restaurantId/menu/:itemId` | Public for active; owner/ADMIN for inactive | View a non-deleted item |
| `POST /api/restaurants/:restaurantId/menu` | Owner/ADMIN | Create item in a category of the same restaurant |
| `PATCH /api/restaurants/:restaurantId/menu/:itemId` | Owner/ADMIN | Update name, description, category, price, image URL |
| `PATCH /api/restaurants/:restaurantId/menu/:itemId/availability` | Owner/ADMIN | Set boolean availability |
| `DELETE /api/restaurants/:restaurantId/menu/:itemId` | Owner/ADMIN | Soft-delete item; returns `204` |

Invalid input returns `400`; missing record `404`; duplicate category `409`; wrong owner/role `403`. Unknown body fields, including IDs, ownership, timestamps, and deletion metadata, are rejected. Image URLs may be omitted or must be HTTP/HTTPS; the service does not fetch them.

## Postman Examples

In Postman Desktop or Desktop Agent, set `baseUrl` to `http://localhost:5002`. Ensure Auth is running at `http://localhost:5001`.

### Obtain a restaurant-admin token

First use the Auth service's one-time admin bootstrap as described in `auth-service/README.md`, then log in as that ADMIN:

- Method: `POST`
- URL: `http://localhost:5001/api/auth/login`
- Header: `Content-Type: application/json`
- Body (raw JSON):

```json
{
  "email": "your-admin-email@example.com",
  "password": "your-admin-password"
}
```

Expected: `200`; copy the `token` from the response. In Postman choose **Authorization > Bearer Token** and paste it. Use that admin token to create a RESTAURANT_ADMIN in Auth:

- Method: `POST`
- URL: `http://localhost:5001/api/auth/users`
- Authorization: `Bearer <admin token>`
- Body:

```json
{
  "name": "Restaurant Manager",
  "email": "manager@example.com",
  "password": "another-strong-password",
  "role": "RESTAURANT_ADMIN",
  "status": "ACTIVE"
}
```

Expected: `201`. Log in at `POST http://localhost:5001/api/auth/login` with the new manager credentials and save its response `token` as `restaurantToken`. Never store tokens in source files or share them.

### Create a restaurant

- Method: `POST`
- URL: `{{baseUrl}}/api/restaurants`
- Authorization: `Bearer {{restaurantToken}}`
- Body:

```json
{
  "name": "Harbor Kitchen",
  "description": "Seasonal local food",
  "address": "14 Main Street",
  "contactNumber": "+1 555 0100",
  "email": "hello@harbor.example",
  "cuisineType": "Italian",
  "openingTime": "18:00",
  "closingTime": "02:00"
}
```

Expected: `201` and a restaurant object. Save `restaurant.id` as `restaurantId`. Overnight opening hours are allowed. For ADMIN creation, also supply a numeric `ownerUserId` for an active `RESTAURANT_ADMIN`; the caller's ADMIN token is used for the Auth lookup.

### Create a category

- Method: `POST`
- URL: `{{baseUrl}}/api/restaurants/{{restaurantId}}/categories`
- Authorization: `Bearer {{restaurantToken}}`
- Body: `{ "name": "Main courses" }`
- Expected: `201`; save `category.id` as `categoryId`. Repeating the same name for that restaurant returns `409`.

### Create a menu item

- Method: `POST`
- URL: `{{baseUrl}}/api/restaurants/{{restaurantId}}/menu`
- Authorization: `Bearer {{restaurantToken}}`
- Body:

```json
{
  "categoryId": 1,
  "name": "Roasted vegetable pasta",
  "description": "Fresh vegetables and herbs",
  "price": "12.50",
  "availability": true,
  "imageUrl": "https://example.com/pasta.jpg"
}
```

Expected: `201`, with `price` returned as the JSON string `"12.50"`. Use the actual saved category ID and save the response `item.id` as `itemId`.

### Update price/item details

- Method: `PATCH`
- URL: `{{baseUrl}}/api/restaurants/{{restaurantId}}/menu/{{itemId}}`
- Authorization: `Bearer {{restaurantToken}}`
- Body: `{ "price": "13.00", "description": "Updated description" }`
- Expected: `200`; response keeps price as a decimal string. A numeric JSON price is rejected to avoid floating-point ambiguity.

### Change item availability

- Method: `PATCH`
- URL: `{{baseUrl}}/api/restaurants/{{restaurantId}}/menu/{{itemId}}/availability`
- Authorization: `Bearer {{restaurantToken}}`
- Body: `{ "availability": false }`
- Expected: `200`, with `availability: false`.

### Open or close the restaurant

- Method: `PATCH`
- URL: `{{baseUrl}}/api/restaurants/{{restaurantId}}/operating-status`
- Authorization: `Bearer {{restaurantToken}}`
- Body to open: `{ "operatingStatus": "OPEN" }`; to close: `{ "operatingStatus": "CLOSED" }`.
- Expected: `200`. CLOSED restaurants remain publicly visible but are marked CLOSED.

### Test rejected access

- Try `POST {{baseUrl}}/api/restaurants` with no token: expected `401`.
- Try the same request with a CUSTOMER token: expected `403`.
- Use another RESTAURANT_ADMIN token to `PATCH {{baseUrl}}/api/restaurants/{{restaurantId}}`: expected `403`.
- Stop Auth temporarily and send a protected request: expected `503`; Restaurant never bypasses Auth.

### Deactivate a restaurant

- Method: `DELETE`
- URL: `{{baseUrl}}/api/restaurants/{{restaurantId}}`
- Authorization: `Bearer {{restaurantToken}}`
- Body: none
- Expected: `204` with no response body. Public list/detail no longer includes it; owner can still inspect it using `/mine` or an authenticated detail request.

## Tests

Run the Auth-controlled HTTP integration tests (repositories are isolated fixtures; the development database is untouched):

```powershell
npm test
```

The suite covers roles/ownership, public visibility, categories/menu, price validation, soft deletion, scoped IDs, and Auth timeout/outage behavior. The real MariaDB repository integration test is separate and only runs when `RESTAURANT_TEST_DB_NAME` names a dedicated database ending in `_test`.

Create the separate test database using `database/test-schema.sql`, grant the test DB user permissions only on `food_delivery_restaurant_test`, then run from PowerShell:

```powershell
$env:RESTAURANT_TEST_DB_NAME = 'food_delivery_restaurant_test'
npm run test:db
```

That test creates a uniquely named test restaurant and removes only rows it created. It refuses to use the development database name. Do not point it at production data.

## Docker Later

Docker is intentionally deferred until Auth, Restaurant, and Customer work locally. No Dockerfile, `.dockerignore`, or Compose file was added. When the first three services are ready, Compose will use service DNS names for Auth/MariaDB and a named volume for persistent database storage. MariaDB is supporting infrastructure, not one of the five backend services.