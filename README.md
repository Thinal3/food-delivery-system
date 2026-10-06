# food-delivery-system

Design and dockerize a small food-delivery management system using a microservice architecture.

## Services

- `auth-service`: authentication and user roles, local port `5001`.
- `restaurant-service`: restaurant profiles, categories, and menus, local port `5002`.
- `customer-service`: planned local port `5005`.
- `order-service` and `delivery-service`: planned services.

The current development plan is to build and test Auth, Restaurant, and Customer locally, then add Docker/Compose once the three services work together. See [restaurant-service/README.md](restaurant-service/README.md) for Restaurant database setup, endpoints, Postman examples, and test instructions.
