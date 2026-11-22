import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";

let server;
let base;
let fs;

before(async () => {
  const created = createApp();
  fs = created.fs;
  server = created.app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  fs.dispose();
});

const post = (body) =>
  fetch(`${base}/users`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

test("create, list, get and delete a user", async () => {
  const createdRes = await post({ name: "Ada Lovelace", email: "ada@example.com" });
  assert.equal(createdRes.status, 201);
  const user = await createdRes.json();
  assert.equal(user.name, "Ada Lovelace");

  const list = await (await fetch(`${base}/users`)).json();
  assert.deepEqual(list.map((u) => u.id), [user.id]);

  const one = await (await fetch(`${base}/users/${user.id}`)).json();
  assert.equal(one.email, "ada@example.com");

  // stored as a file in the in-memory filesystem, not on disk
  assert.ok(fs.existsSync(`/users/${user.id}.json`));

  assert.equal((await fetch(`${base}/users/${user.id}`, { method: "DELETE" })).status, 204);
  assert.equal((await fetch(`${base}/users/${user.id}`)).status, 404);
});

test("rejects invalid input", async () => {
  assert.equal((await post({ name: "No Email" })).status, 400);
  const bad = await fetch(`${base}/users`, { method: "POST", headers: { "content-type": "application/json" }, body: "{oops" });
  assert.equal(bad.status, 400);
});

test("stats reflect stored users", async () => {
  await post({ name: "Grace", email: "grace@example.com" });
  const stats = await (await fetch(`${base}/stats`)).json();
  assert.equal(stats.users, 1);
  assert.ok(stats.usedMemory > 0);
});

test("serves the demo page and the fs view", async () => {
  const page = await fetch(base);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Memspace users demo/);
  const entries = await (await fetch(`${base}/fs`)).json();
  assert.ok(entries.some((e) => e.path === "/users" && e.type === "directory"));
});

test("users carry a TTL and the user cap is enforced", async () => {
  const { app, fs: small } = createApp({ maxUsers: 1, userTtlMs: 60_000 });
  const s = app.listen(0);
  await new Promise((r) => s.once("listening", r));
  const url = `http://127.0.0.1:${s.address().port}/users`;
  const send = () => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "A", email: "a@b.c" }) });
  const first = await (await send()).json();
  assert.ok(first.expiresInMs > 0 && first.expiresInMs <= 60_000);
  assert.equal((await send()).status, 507);
  s.close();
  small.dispose();
});
