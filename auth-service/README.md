# Food Delivery Auth Service

This is the authentication service for the Food Delivery Management System. It owns user credentials and account roles/status; other backend services should call its HTTP API instead of importing its source or connecting to its database.

## Stage 1: Authentication Flow

1. Registration accepts a name, email, and password. The service will normalize and validate the email, hash the password with bcrypt, and persist a `CUSTOMER` with `ACTIVE` status. The unique database index is the final guard against duplicate email addresses.
2. Login looks up the normalized email, checks the password against the bcrypt hash, and refuses inactive accounts. On success, it returns a short-lived signed HS256 JWT with subject, issuer, audience, and expiry claims, plus safe user details.
3. A protected request sends `Authorization: Bearer <token>`. Auth checks signature, algorithm, issuer, audience, and expiry, then reloads the user from MySQL and uses the current database status and role. This means disabling an account or changing its role takes effect without waiting for the token to expire.
4. An administrator-only operation checks the reloaded role before allowing privileged account changes. Admin creation is a separate, explicitly invoked bootstrap step; public registration never grants privileged roles.
5. Other services forward the caller's bearer token to Auth's `/api/auth/verify` endpoint over HTTP. They still enforce their own resource ownership rules, such as whether a customer owns an order.

The demo will use short-lived access tokens only. Refresh tokens, social login, and password reset are intentionally out of scope for this assignment.

## Stage 2: Structure and Dependencies

```text
auth-service/
  config/       environment and MySQL pool configuration
  controllers/  HTTP request/response handlers
  database/     SQL schema
  middleware/   authentication, authorization, validation, and error handling
  models/       allowed user roles and statuses
  repositories/ parameterized MySQL queries
  routes/       endpoint definitions and middleware wiring
  services/     authentication and account business rules
  utils/        shared error helpers
  .env.example  safe configuration template
  package.json  dependency and command manifest
  package-lock.json
  server.js     service startup
```

The service uses Express for HTTP, `mysql2/promise` for pooled parameterized database access, `bcryptjs` for password hashing, `jsonwebtoken` for signed tokens, `dotenv` for local environment loading, `helmet` for security headers, `express-rate-limit` for login/registration throttling, and Zod for strict request validation.

## Stage 3: MySQL Schema and Configuration

### Configure local MySQL

Install/run MySQL Server locally and open MySQL Workbench. As a local database administrator, open and run `database/schema.sql`. The script creates the `food_delivery_auth` database and `users` table if absent. The table has a database-enforced unique email, allowed role/status values, and timestamps; it does not insert a default admin.

In Workbench, create a separate application login with only the operations this service needs. Replace the example password with a unique password you choose, then use that same value for `DB_PASSWORD` in `.env`:

```sql
CREATE USER IF NOT EXISTS 'food_auth_app'@'localhost'
  IDENTIFIED BY 'choose-a-unique-local-password';
GRANT SELECT, INSERT, UPDATE ON food_delivery_auth.*
  TO 'food_auth_app'@'localhost';
```

From PowerShell in this `auth-service` directory, create your local environment file and generate a JWT secret:

```powershell
Copy-Item .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Put the generated value in `JWT_SECRET`. Replace `DB_PASSWORD` with the application-login password you chose above. `.env` is ignored by Git; do not commit it or paste secrets into source files.

Install exactly the locked dependencies and start the service:

```powershell
npm ci
npm run dev
```

Run the API integration tests (they use an isolated in-memory repository fixture and do not write to MySQL):

```powershell
npm test
```

The service binds to `0.0.0.0:5001`. At startup it checks the MySQL connection, so a missing database or invalid credentials stop startup with a connection error rather than leaving the service apparently healthy.

### Hostname rule

- When Node runs directly on your computer and MySQL also runs on your computer, use `DB_HOST=localhost` and the actual local MySQL port. This workstation currently uses `DB_PORT=3307`.
- When Node runs inside Docker Compose, `localhost` means the Auth container itself. Set `DB_HOST=mysql` (the Compose service name) and `DB_PORT=3306` (the MySQL container port).
- From a database GUI on your computer, connect to `localhost:3307` if Compose publishes host port 3307 to container port 3306. The GUI uses the host port; Auth in Compose uses the service name and container port.

The example file contains placeholders, not usable credentials. Configuration validation rejects an unset/placeholder JWT secret and missing database settings.

## Authentication and Admin Endpoints

All responses use JSON. Request bodies reject unknown properties, so public callers cannot set `role` or `status`. Passwords must be 8–72 UTF-8 bytes. Login and registration have per-IP rate limits; JSON bodies are limited to 10 KB.

| Method and path | Access | Result |
| --- | --- | --- |
| `GET /health` | Public | Process is running; does not check MySQL |
| `GET /ready` | Public | `200` when MySQL responds; otherwise `500` |
| `POST /api/auth/register` | Public | Creates active `CUSTOMER`; returns `201` and user plus token |
| `POST /api/auth/login` | Public | Returns `200` and user plus token; invalid credentials/inactive account return generic `401` |
| `GET /api/auth/me` | Bearer token | Returns current active user identity |
| `GET /api/auth/verify` | Bearer token | Returns the same current identity for other services |
| `POST /api/auth/users` | `ADMIN` | Creates a user with an allowed role; returns `201` and safe user data |
| `GET /api/auth/users?page=1&limit=20` | `ADMIN` | Paginated user list without password hashes; maximum page size is 100 |
| `PATCH /api/auth/users/:userId/role` | `ADMIN` | Changes role; cannot demote the final active admin |
| `PATCH /api/auth/users/:userId/status` | `ADMIN` | Changes status; cannot deactivate the final active admin |

Registration example:

```json
{
  "name": "Alex Example",
  "email": "alex@example.com",
  "password": "a-long-password"
}
```

Login has the same shape without `name`. A successful login or registration returns:

```json
{
  "user": {
    "id": 1,
    "name": "Alex Example",
    "email": "alex@example.com",
    "role": "CUSTOMER",
    "status": "ACTIVE",
    "createdAt": "..."
  },
  "token": "..."
}
```

Send the token in Postman as `Authorization: Bearer <token>`. Other services should forward the caller's bearer token to `GET http://auth-service:5001/api/auth/verify` over HTTP and trust only a successful response. They must still check ownership of their own orders, restaurant records, or deliveries; a valid identity does not grant access to every resource.

### Postman Test Cases

Create a Postman environment variable named `baseUrl` with value `http://localhost:5001`. For JSON requests, add the header `Content-Type: application/json`. Use the following requests in order where noted:

| Test | Method and URL | Body | Expected result |
| --- | --- | --- | --- |
| Process health | `GET {{baseUrl}}/health` | None | `200`, `{ "status": "ok" }` |
| Database readiness | `GET {{baseUrl}}/ready` | None | `200`, `{ "status": "ready" }` |
| Register customer | `POST {{baseUrl}}/api/auth/register` | `{ "name": "Taylor User", "email": "taylor@example.com", "password": "CorrectHorse7!" }` | `201`; safe user with role `CUSTOMER`, status `ACTIVE`, and a JWT in `token` |
| Duplicate registration | Repeat the exact registration request | Same body as above | `409`, duplicate-email error |
| Invalid registration | `POST {{baseUrl}}/api/auth/register` | `{ "name": "T", "email": "not-an-email", "password": "short" }` | `400`, validation error |
| Attempt privileged public registration | `POST {{baseUrl}}/api/auth/register` | `{ "name": "Bad Admin", "email": "bad-admin@example.com", "password": "CorrectHorse7!", "role": "ADMIN" }` | `400`; unexpected `role` field is rejected |
| Login customer | `POST {{baseUrl}}/api/auth/login` | `{ "email": "taylor@example.com", "password": "CorrectHorse7!" }` | `200`; safe user and JWT in `token` |
| Wrong password | `POST {{baseUrl}}/api/auth/login` | `{ "email": "taylor@example.com", "password": "wrong-password" }` | `401`, generic `Invalid email or password.` |
| Current identity | `GET {{baseUrl}}/api/auth/me` | None; send customer bearer token | `200`, current safe identity |
| Service identity check | `GET {{baseUrl}}/api/auth/verify` | None; send customer bearer token | `200`, current safe identity |
| Missing token | `GET {{baseUrl}}/api/auth/me` | None; no Authorization header | `401` |
| Admin list as customer | `GET {{baseUrl}}/api/auth/users` | None; send customer bearer token | `403` |
| Admin list as admin | `GET {{baseUrl}}/api/auth/users?page=1&limit=20` | None; send admin bearer token | `200`; paginated safe users without `password_hash` |
| Create privileged account | `POST {{baseUrl}}/api/auth/users` | `{ "name": "Restaurant Manager", "email": "manager@example.com", "password": "AnotherHorse8!", "role": "RESTAURANT_ADMIN", "status": "ACTIVE" }`; send admin bearer token | `201`; safe user, no token or password hash |
| Change role | `PATCH {{baseUrl}}/api/auth/users/2/role` | `{ "role": "DELIVERY_PERSON" }`; send admin bearer token | `200`; response user has the new role |
| Change status | `PATCH {{baseUrl}}/api/auth/users/2/status` | `{ "status": "INACTIVE" }`; send admin bearer token | `200`; next request with that user's token receives `401` |

Use test email addresses that are not already in your database, or change them between runs. For the role/status examples, replace `2` with the target user's `id` returned by registration or admin account creation. Do not include `password_hash` in expected or saved response data.

#### Find and reuse a bearer token

1. Send the **Register customer** request or a successful **Login customer** request.
2. In the response body, open the JSON `token` property and copy its value. It is the long string next to `"token"`; do not copy the surrounding quotes.
3. For `/me`, `/verify`, and admin requests, open the request's **Authorization** tab, choose **Bearer Token**, and paste the value into the **Token** field. Postman will send `Authorization: Bearer <token>` automatically.
4. For repeated requests, save the token as an environment variable. In the request's **Scripts > Post-response** area, use this for a customer login/register request:

```javascript
pm.environment.set("customerToken", pm.response.json().token);
```

For an admin login request, use:

```javascript
pm.environment.set("adminToken", pm.response.json().token);
```

Then set Authorization to **Bearer Token** with `{{customerToken}}` or `{{adminToken}}`. Bootstrap the admin once using the instructions below, then log in with that admin's credentials to obtain `adminToken`. Tokens expire; log in again to get a fresh one.

### One-time admin bootstrap

Set `ADMIN_NAME`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD` in the local environment, then run this explicit command from `auth-service`:

```powershell
npm run bootstrap:admin
```

It creates one active `ADMIN` and exits. It does not run on service startup and deliberately fails if that email already exists; it never resets an existing account. The bootstrap password must meet the same 8–72 UTF-8 byte constraints. Remove the three `ADMIN_*` values from the environment after creation. Public registration cannot create privileged users, and all later role/status changes require an active administrator.

Admin-created user example (`POST /api/auth/users`):

```json
{
  "name": "Restaurant Manager",
  "email": "manager@example.com",
  "password": "another-long-password",
  "role": "RESTAURANT_ADMIN",
  "status": "ACTIVE"
}
```

Role update body: `{ "role": "DELIVERY_PERSON" }`. Status update body: `{ "status": "INACTIVE" }`. Unauthenticated requests receive `401`; authenticated non-admin requests receive `403`; invalid inputs return `400`; duplicate email returns `409`.

## Completed Stages and Suggested Commits

- Stage 1: authentication flow and trust boundaries. Suggested commit: `docs(auth): explain authentication flow`
- Stage 2: service structure and dependency set. Suggested commit: `chore(auth): define service dependencies and layout`
- Stage 3: MySQL schema, connection pool, environment config, and parameterized repository queries. Suggested commit: `feat(auth): configure MySQL user persistence`

The current demo uses short-lived access tokens and database-backed role checks. It is not a complete production identity platform: refresh tokens, password reset, email verification, lockout policy, and multi-factor authentication are intentionally omitted. Never expose the MySQL port publicly or commit `.env` credentials.