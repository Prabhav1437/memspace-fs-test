# memspace-users-demo

A tiny Express users API that uses [`memspace-fs`](https://www.npmjs.com/package/memspace-fs)
as its storage. Each user is a JSON file inside an in-memory filesystem
(`/users/<id>.json`), capped at 5 MiB. Nothing is written to disk, so all data
is gone when the server stops.

## Run

```bash
npm install
npm start          # http://localhost:3000
npm test           # node:test, starts the app on a random port
```

## Routes

| Method | Path | |
|---|---|---|
| POST | `/users` | body `{ "name": "...", "email": "..." }` → 201 with the user |
| GET | `/users` | all users, oldest first |
| GET | `/users/:id` | one user, or 404 |
| DELETE | `/users/:id` | 204, or 404 |
| GET | `/stats` | user count and memory used by the in-memory filesystem |

```bash
curl -X POST localhost:3000/users -H 'content-type: application/json' -d '{"name":"Ada","email":"ada@example.com"}'
curl localhost:3000/users
curl localhost:3000/stats
```
