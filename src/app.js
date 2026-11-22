import express from "express";
import { randomUUID } from "node:crypto";
import { createFs, expressMiddleware } from "memspace-fs/express";

/**
 * Builds the Express app. Users are stored as JSON files inside an in-memory
 * filesystem (/users/<id>.json): nothing is ever written to disk.
 */
export function createApp() {
  const fs = createFs({ name: "users", maxMemory: 5 * 1024 * 1024 }); // 5 MiB cap
  fs.mkdirSync("/users", { recursive: true });

  const app = express();
  app.use(express.json());
  app.use(expressMiddleware(fs, { attachToRequest: true })); // req.memspace

  // Create a user
  app.post("/users", (req, res) => {
    const { name, email } = req.body ?? {};
    if (typeof name !== "string" || !name.trim() || typeof email !== "string" || !email.includes("@")) {
      return res.status(400).json({ error: "name and a valid email are required" });
    }
    const user = { id: randomUUID(), name: name.trim(), email, createdAt: new Date().toISOString() };
    req.memspace.writeFileSync(`/users/${user.id}.json`, JSON.stringify(user));
    res.status(201).json(user);
  });

  // List users
  app.get("/users", async (req, res) => {
    const files = await req.memspace.promises.readdir("/users");
    const users = await Promise.all(
      files.map(async (file) => JSON.parse(await req.memspace.promises.readFile(`/users/${file}`, "utf8"))),
    );
    res.json(users.sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
  });

  // Get one user
  app.get("/users/:id", (req, res) => {
    const path = `/users/${req.params.id}.json`;
    if (!req.memspace.existsSync(path)) return res.status(404).json({ error: "user not found" });
    res.json(JSON.parse(req.memspace.readFileSync(path, "utf8")));
  });

  // Delete a user
  app.delete("/users/:id", (req, res) => {
    try {
      req.memspace.unlinkSync(`/users/${req.params.id}.json`);
      res.status(204).end();
    } catch (error) {
      if (error.code === "ENOENT") return res.status(404).json({ error: "user not found" });
      throw error;
    }
  });

  // How much memory the in-memory filesystem is using
  app.get("/stats", (req, res) => {
    const { usedMemory, maxMemory, fileCount } = req.memspace.getStats();
    res.json({ users: fileCount, usedMemory, maxMemory });
  });

  // Memspace errors (e.g. ENOSPC when the 5 MiB cap is hit) end up here
  app.use((error, _req, res, _next) => {
    if (error.code === "ENOSPC") return res.status(507).json({ error: "storage full" });
    if (error.type === "entity.parse.failed") return res.status(400).json({ error: "invalid JSON" });
    console.error(error);
    res.status(500).json({ error: "internal error" });
  });

  return { app, fs };
}
