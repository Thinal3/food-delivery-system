# food-delivery-system

Design and dockerize a small food-delivery management system using a microservice architecture.

## Services

- `auth-service`: authentication and user roles, local port `5001`.
- `restaurant-service`: restaurant profiles, categories, and menus, local port `5002`.
- `customer-service`: customer profiles and addresses, local port `5005`.
- `order-service`: order history and lifecycle, local port `5003`.
- `delivery-service`: delivery assignment, lifecycle, and Order sync outbox, local port `5004`.

The current development plan is to build and test Auth, Restaurant, and Customer locally, then add Docker/Compose once the first three services work together. See [customer-service/README.md](customer-service/README.md), [restaurant-service/README.md](restaurant-service/README.md), [order-service/README.md](order-service/README.md), and [delivery-service/README.md](delivery-service/README.md) for setup, API contracts, Postman workflows, and test instructions.
