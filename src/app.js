import express from "express";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createFs, expressMiddleware } from "memspace-fs/express";

const PUBLIC_DIR = fileURLToPath(new URL("../public", import.meta.url));

/**
 * Builds the Express app. Users are stored as JSON files inside an in-memory
 * filesystem (/users/<id>.json): nothing is ever written to disk.
 *
 * Because the demo is public, it is bounded: 5 MiB of storage, at most
 * `maxUsers` users, and every user expires after `userTtlMs` (memspace TTL).
 */
export function createApp({ maxUsers = 200, userTtlMs = 60 * 60 * 1000 } = {}) {
  const fs = createFs({ name: "users", maxMemory: 5 * 1024 * 1024 }); // 5 MiB cap
  fs.mkdirSync("/users", { recursive: true });

  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json({ limit: "10kb" }));
  app.use(expressMiddleware(fs, { attachToRequest: true })); // req.memspace
  app.use(express.static(PUBLIC_DIR));

  const readUser = (memspace, file) => {
    const user = JSON.parse(memspace.readFileSync(`/users/${file}`, "utf8"));
    return { ...user, expiresInMs: memspace.getTtl(`/users/${file}`) };
  };
  const validId = (id) => /^[\w-]+$/.test(id);

  // Create a user
  app.post("/users", (req, res) => {
    const { name, email } = req.body ?? {};
    if (
      typeof name !== "string" || !name.trim() || name.length > 100 ||
      typeof email !== "string" || !/^[^\s@]+@[^\s@]+$/.test(email) || email.length > 200
    ) {
      return res.status(400).json({ error: "name (max 100 chars) and a valid email are required" });
    }
    if (req.memspace.readdirSync("/users").length >= maxUsers) {
      return res.status(507).json({ error: `demo is full (${maxUsers} users); users expire after an hour` });
    }
    const user = { id: randomUUID(), name: name.trim(), email: email.trim(), createdAt: new Date().toISOString() };
    // ttl is a memspace-fs extension: the file disappears on its own when it expires
    req.memspace.writeFileSync(`/users/${user.id}.json`, JSON.stringify(user), { ttl: userTtlMs });
    res.status(201).json(readUser(req.memspace, `${user.id}.json`));
  });

  // List users
  app.get("/users", (req, res) => {
    const users = req.memspace.readdirSync("/users").map((file) => readUser(req.memspace, file));
    res.json(users.sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
  });

  // Get one user
  app.get("/users/:id", (req, res) => {
    const file = `${req.params.id}.json`;
    if (!validId(req.params.id) || !req.memspace.existsSync(`/users/${file}`)) {
      return res.status(404).json({ error: "user not found" });
    }
    res.json(readUser(req.memspace, file));
  });

  // Delete a user
  app.delete("/users/:id", (req, res) => {
    if (!validId(req.params.id)) return res.status(404).json({ error: "user not found" });
    try {
      req.memspace.unlinkSync(`/users/${req.params.id}.json`);
      res.status(204).end();
    } catch (error) {
      if (error.code === "ENOENT") return res.status(404).json({ error: "user not found" });
      throw error;
    }
  });

  // What the in-memory filesystem looks like right now
  app.get("/fs", (req, res) => {
    const entries = req.memspace.readdirSync("/", { recursive: true, withFileTypes: true }).map((entry) => {
      const path = `${entry.parentPath === "/" ? "" : entry.parentPath}/${entry.name}`;
      const stat = req.memspace.statSync(path);
      return { path, type: entry.isDirectory() ? "directory" : "file", size: stat.size, expiresInMs: req.memspace.getTtl(path) };
    });
    res.json(entries);
  });

  // How much memory the in-memory filesystem is using
  app.get("/stats", (req, res) => {
    const { usedMemory, maxMemory, fileCount, directoryCount } = req.memspace.getStats();
    res.json({ users: fileCount, directories: directoryCount, usedMemory, maxMemory, maxUsers, userTtlMs });
  });

  // Memspace errors (e.g. ENOSPC when the 5 MiB cap is hit) end up here
  app.use((error, _req, res, _next) => {
    if (error.code === "ENOSPC") return res.status(507).json({ error: "storage full" });
    if (error.type === "entity.parse.failed") return res.status(400).json({ error: "invalid JSON" });
    if (error.type === "entity.too.large") return res.status(413).json({ error: "body too large" });
    console.error(error);
    res.status(500).json({ error: "internal error" });
  });

  return { app, fs };
}
