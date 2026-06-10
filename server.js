import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import mysql from "mysql2/promise";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = process.env.PORT || 3000;
const adminPassword = process.env.ADMIN_PASSWORD;
const sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const cookieName = "chiv2_admin";
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, "data");
const playersFile = path.join(dataDir, "players.json");
const submissionsFile = path.join(dataDir, "submissions.json");
function hasDatabase() {
  return Boolean(process.env.DB_HOST && process.env.DB_NAME && process.env.DB_USER);
}

const tiers = [
  { id: "s", label: "S", name: "", color: "#7f1d1d" },
  { id: "a", label: "A", name: "", color: "#9b5d1f" },
  { id: "b", label: "B", name: "", color: "#50683e" },
  { id: "c", label: "C", name: "", color: "#536673" },
  { id: "watch", label: "D", name: "", color: "#4c3b62" }
];

const starterPlayers = [
  {
    id: crypto.randomUUID(),
    name: "Sir Objective",
    tier: "s",
    region: "NA East",
    role: "Frontline",
    clan: "Free Agent",
    notes: "Always on carts, gates, banners, and overtime fights.",
    order: 1
  },
  {
    id: crypto.randomUUID(),
    name: "Banner Breaker",
    tier: "a",
    region: "EU",
    role: "Knight",
    clan: "Mason",
    notes: "Strong anchor player with consistent pressure on final objectives.",
    order: 2
  },
  {
    id: crypto.randomUUID(),
    name: "Supply Crate",
    tier: "b",
    region: "NA Central",
    role: "Engineer",
    clan: "Agatha",
    notes: "Builds, repairs, and plays the boring jobs that win maps.",
    order: 3
  },
  {
    id: crypto.randomUUID(),
    name: "Ladder Lord",
    tier: "watch",
    region: "OCE",
    role: "Vanguard",
    clan: "",
    notes: "Explosive pushes, needs more matches against top groups.",
    order: 4
  }
];

app.use(express.json({ limit: "1mb" }));
app.use((request, response, next) => {
  if (request.path === "/admin" || request.path === "/admin.html" || request.path === "/admin.js") {
    response.set("Cache-Control", "no-store");
  }
  next();
});
app.use(express.static(__dirname));

function parseCookies(header = "") {
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [name, ...value] = part.split("=");
        return [decodeURIComponent(name), decodeURIComponent(value.join("="))];
      })
  );
}

function sign(value) {
  return crypto.createHmac("sha256", sessionSecret).update(value).digest("base64url");
}

function makeSession() {
  const payload = JSON.stringify({ role: "admin", exp: Date.now() + 1000 * 60 * 60 * 12 });
  const encoded = Buffer.from(payload).toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}

function isValidSession(token) {
  if (!token || !token.includes(".")) return false;
  const [encoded, signature] = token.split(".");
  if (signature !== sign(encoded)) return false;

  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    return payload.role === "admin" && payload.exp > Date.now();
  } catch {
    return false;
  }
}

function requireAdmin(request, response, next) {
  const cookies = parseCookies(request.headers.cookie);
  if (!isValidSession(cookies[cookieName])) {
    response.status(401).json({ error: "Admin login required." });
    return;
  }

  next();
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function cleanText(value, maxLength) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function normalizePlayer(input = {}, fallback = {}) {
  const tier = firstDefined(input.tier, fallback.tier, "b");
  const order = firstDefined(input.order, fallback.order, 1);

  return {
    id: cleanText(firstDefined(input.id, fallback.id, crypto.randomUUID()), 80),
    name: cleanText(firstDefined(input.name, fallback.name), 40),
    tier: tiers.some((item) => item.id === tier) ? tier : "b",
    region: cleanText(firstDefined(input.region, fallback.region), 24),
    role: cleanText(firstDefined(input.role, fallback.role), 28),
    clan: cleanText(firstDefined(input.clan, fallback.clan), 28),
    playfabId: cleanText(
      firstDefined(
        input.playfabId,
        input.playfab_id,
        input.playerfabId,
        input.playerfab_id,
        fallback.playfabId,
        fallback.playfab_id
      ),
      64
    ),
    notes: cleanText(firstDefined(input.notes, fallback.notes), 180),
    order: Number.isFinite(Number(order)) ? Number(order) : 1
  };
}

async function readPlayers() {
  if (hasDatabase()) return readPlayersFromDatabase();
  return readPlayersFromFile();
}

async function readPlayersFromFile() {
  try {
    const raw = await fs.readFile(playersFile, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((player) => normalizePlayer(player)).sort(byOrder) : starterPlayers;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await writePlayers(starterPlayers);
    return starterPlayers;
  }
}

async function writePlayers(players) {
  if (hasDatabase()) {
    await writePlayersToDatabase(players);
    return;
  }

  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(playersFile, `${JSON.stringify(players.sort(byOrder), null, 2)}\n`);
}

function databaseConfig() {
  return {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || "3306"),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
  };
}

async function withDatabase(callback) {
  const connection = await mysql.createConnection(databaseConfig());
  try {
    await ensurePlayersTable(connection);
    await ensureSubmissionsTable(connection);
    return await callback(connection);
  } finally {
    await connection.end();
  }
}

async function ensurePlayersTable(connection) {
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS \`players\` (
      \`id\` VARCHAR(80) PRIMARY KEY,
      \`name\` VARCHAR(40) NOT NULL,
      \`tier\` VARCHAR(20) NOT NULL,
      \`region\` VARCHAR(24) DEFAULT '',
      \`role\` VARCHAR(28) DEFAULT '',
      \`clan\` VARCHAR(28) DEFAULT '',
      \`playfab_id\` VARCHAR(64) DEFAULT '',
      \`notes\` VARCHAR(180) DEFAULT '',
      \`sort_order\` INT NOT NULL DEFAULT 1,
      \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  const [columns] = await connection.execute("SHOW COLUMNS FROM `players`");
  const columnNames = new Set(columns.map((column) => column.Field));
  const requiredColumns = [
    ["region", "VARCHAR(24) DEFAULT '' AFTER `tier`"],
    ["role", "VARCHAR(28) DEFAULT '' AFTER `region`"],
    ["clan", "VARCHAR(28) DEFAULT '' AFTER `role`"],
    ["playfab_id", "VARCHAR(64) DEFAULT '' AFTER `clan`"],
    ["notes", "VARCHAR(180) DEFAULT '' AFTER `playfab_id`"],
    ["sort_order", "INT NOT NULL DEFAULT 1 AFTER `notes`"],
    ["updated_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER `sort_order`"]
  ];

  for (const [name, definition] of requiredColumns) {
    if (!columnNames.has(name)) {
      await connection.execute(`ALTER TABLE \`players\` ADD COLUMN \`${name}\` ${definition}`);
    }
  }

  if (columnNames.has("playfabId")) {
    await connection.execute("UPDATE `players` SET `playfab_id` = `playfabId` WHERE `playfab_id` = '' OR `playfab_id` IS NULL");
  }
}

async function ensureSubmissionsTable(connection) {
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS \`submissions\` (
      \`id\` VARCHAR(80) PRIMARY KEY,
      \`name\` VARCHAR(40) NOT NULL,
      \`tier\` VARCHAR(20) NOT NULL DEFAULT 'b',
      \`region\` VARCHAR(24) DEFAULT '',
      \`role\` VARCHAR(28) DEFAULT '',
      \`clan\` VARCHAR(28) DEFAULT '',
      \`playfab_id\` VARCHAR(64) DEFAULT '',
      \`notes\` VARCHAR(180) DEFAULT '',
      \`status\` VARCHAR(20) NOT NULL DEFAULT 'pending',
      \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  const [columns] = await connection.execute("SHOW COLUMNS FROM `submissions`");
  const columnNames = new Set(columns.map((column) => column.Field));
  const requiredColumns = [
    ["tier", "VARCHAR(20) NOT NULL DEFAULT 'b' AFTER `name`"],
    ["region", "VARCHAR(24) DEFAULT '' AFTER `tier`"],
    ["role", "VARCHAR(28) DEFAULT '' AFTER `region`"],
    ["clan", "VARCHAR(28) DEFAULT '' AFTER `role`"],
    ["playfab_id", "VARCHAR(64) DEFAULT '' AFTER `clan`"],
    ["notes", "VARCHAR(180) DEFAULT '' AFTER `playfab_id`"],
    ["status", "VARCHAR(20) NOT NULL DEFAULT 'pending' AFTER `notes`"],
    ["created_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP AFTER `status`"],
    ["updated_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER `created_at`"]
  ];

  for (const [name, definition] of requiredColumns) {
    if (!columnNames.has(name)) {
      await connection.execute(`ALTER TABLE \`submissions\` ADD COLUMN \`${name}\` ${definition}`);
    }
  }
}

function rowToPlayer(row) {
  return normalizePlayer({
    id: row.id,
    name: row.name,
    tier: row.tier,
    region: row.region,
    role: row.role,
    clan: row.clan,
    playfabId: row.playfab_id,
    notes: row.notes,
    order: row.sort_order
  });
}

function normalizeSubmission(input = {}, fallback = {}) {
  const player = normalizePlayer(input, fallback);
  const status = cleanText(firstDefined(input.status, fallback.status, "pending"), 20);
  return {
    ...player,
    status: ["pending", "approved", "rejected"].includes(status) ? status : "pending",
    createdAt: firstDefined(input.createdAt, input.created_at, fallback.createdAt, fallback.created_at, new Date().toISOString())
  };
}

function rowToSubmission(row) {
  return normalizeSubmission({
    id: row.id,
    name: row.name,
    tier: row.tier,
    region: row.region,
    role: row.role,
    clan: row.clan,
    playfabId: row.playfab_id,
    notes: row.notes,
    status: row.status,
    createdAt: row.created_at
  });
}

async function readSubmissions() {
  if (hasDatabase()) return readSubmissionsFromDatabase();
  return readSubmissionsFromFile();
}

async function readSubmissionsFromFile() {
  try {
    const raw = await fs.readFile(submissionsFile, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((submission) => normalizeSubmission(submission)).sort(byCreated) : [];
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await writeSubmissions([]);
    return [];
  }
}

async function writeSubmissions(submissions) {
  if (hasDatabase()) {
    await writeSubmissionsToDatabase(submissions);
    return;
  }

  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(submissionsFile, `${JSON.stringify(submissions.sort(byCreated), null, 2)}\n`);
}

async function readSubmissionsFromDatabase() {
  return withDatabase(async (connection) => {
    const [rows] = await connection.execute(
      "SELECT `id`, `name`, `tier`, `region`, `role`, `clan`, `playfab_id`, `notes`, `status`, `created_at` FROM `submissions` ORDER BY `created_at` ASC, `name` ASC"
    );
    return rows.map(rowToSubmission);
  });
}

async function saveSubmissionToDatabase(submission) {
  return withDatabase(async (connection) => {
    const normalized = normalizeSubmission(submission);
    await connection.execute(
      `INSERT INTO \`submissions\` (\`id\`, \`name\`, \`tier\`, \`region\`, \`role\`, \`clan\`, \`playfab_id\`, \`notes\`, \`status\`)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         \`name\` = VALUES(\`name\`),
         \`tier\` = VALUES(\`tier\`),
         \`region\` = VALUES(\`region\`),
         \`role\` = VALUES(\`role\`),
         \`clan\` = VALUES(\`clan\`),
         \`playfab_id\` = VALUES(\`playfab_id\`),
         \`notes\` = VALUES(\`notes\`),
         \`status\` = VALUES(\`status\`)`,
      [
        normalized.id,
        normalized.name,
        normalized.tier,
        normalized.region,
        normalized.role,
        normalized.clan,
        normalized.playfabId,
        normalized.notes,
        normalized.status
      ]
    );

    return normalized;
  });
}

async function writeSubmissionsToDatabase(submissions) {
  return withDatabase(async (connection) => {
    await connection.beginTransaction();
    try {
      await connection.execute("DELETE FROM `submissions`");
      for (const submission of submissions.map((item) => normalizeSubmission(item)).sort(byCreated)) {
        await connection.execute(
          `INSERT INTO \`submissions\` (\`id\`, \`name\`, \`tier\`, \`region\`, \`role\`, \`clan\`, \`playfab_id\`, \`notes\`, \`status\`)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            submission.id,
            submission.name,
            submission.tier,
            submission.region,
            submission.role,
            submission.clan,
            submission.playfabId,
            submission.notes,
            submission.status
          ]
        );
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    }
  });
}

async function readPlayersFromDatabase() {
  return withDatabase(async (connection) => {
    const [rows] = await connection.execute(
      "SELECT `id`, `name`, `tier`, `region`, `role`, `clan`, `playfab_id`, `notes`, `sort_order` FROM `players` ORDER BY `sort_order` ASC, `name` ASC"
    );
    if (rows.length) return rows.map(rowToPlayer);

    const seededPlayers = await readPlayersFromFile();
    await writePlayersToDatabase(seededPlayers);
    return seededPlayers;
  });
}

async function savePlayerToDatabase(player) {
  return withDatabase(async (connection) => {
    const normalized = normalizePlayer(player);
    await connection.execute(
      `INSERT INTO \`players\` (\`id\`, \`name\`, \`tier\`, \`region\`, \`role\`, \`clan\`, \`playfab_id\`, \`notes\`, \`sort_order\`)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         \`name\` = VALUES(\`name\`),
         \`tier\` = VALUES(\`tier\`),
         \`region\` = VALUES(\`region\`),
         \`role\` = VALUES(\`role\`),
         \`clan\` = VALUES(\`clan\`),
         \`playfab_id\` = VALUES(\`playfab_id\`),
         \`notes\` = VALUES(\`notes\`),
         \`sort_order\` = VALUES(\`sort_order\`)`,
      [
        normalized.id,
        normalized.name,
        normalized.tier,
        normalized.region,
        normalized.role,
        normalized.clan,
        normalized.playfabId,
        normalized.notes,
        normalized.order
      ]
    );

    await connection.execute("UPDATE `players` SET `playfab_id` = ? WHERE `id` = ?", [
      normalized.playfabId,
      normalized.id
    ]);

    const [rows] = await connection.execute(
      "SELECT `id`, `name`, `tier`, `region`, `role`, `clan`, `playfab_id`, `notes`, `sort_order` FROM `players` WHERE `id` = ? LIMIT 1",
      [normalized.id]
    );
    const saved = rows.length ? rowToPlayer(rows[0]) : normalized;

    if (saved.playfabId !== normalized.playfabId) {
      throw new Error("PlayFab ID did not save to the database.");
    }

    return saved;
  });
}

async function deletePlayerFromDatabase(id) {
  return withDatabase(async (connection) => {
    await connection.execute("DELETE FROM `players` WHERE `id` = ?", [id]);
  });
}

async function writePlayersToDatabase(players) {
  return withDatabase(async (connection) => {
    const sortedPlayers = players.map((player) => normalizePlayer(player)).sort(byOrder);
    await connection.beginTransaction();
    try {
      await connection.execute("DELETE FROM `players`");
      for (const player of sortedPlayers) {
        await connection.execute(
          `INSERT INTO \`players\` (\`id\`, \`name\`, \`tier\`, \`region\`, \`role\`, \`clan\`, \`playfab_id\`, \`notes\`, \`sort_order\`)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            player.id,
            player.name,
            player.tier,
            player.region,
            player.role,
            player.clan,
            player.playfabId,
            player.notes,
            player.order
          ]
        );
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    }
  });
}

function byOrder(a, b) {
  return a.order - b.order || a.name.localeCompare(b.name);
}

function byCreated(a, b) {
  return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() || a.name.localeCompare(b.name);
}

app.get("/api/config", (_request, response) => {
  response.json({ tiers });
});

app.get("/api/players", async (_request, response, next) => {
  try {
    response.json(await readPlayers());
  } catch (error) {
    next(error);
  }
});

app.get("/api/session", (request, response) => {
  const cookies = parseCookies(request.headers.cookie);
  response.json({ isAdmin: isValidSession(cookies[cookieName]) });
});

app.post("/api/login", (request, response) => {
  if (!adminPassword) {
    response.status(503).json({ error: "Admin password is not configured." });
    return;
  }

  if (request.body?.password !== adminPassword) {
    response.status(401).json({ error: "Wrong admin code." });
    return;
  }

  response.cookie(cookieName, makeSession(), {
    httpOnly: true,
    sameSite: "lax",
    secure: request.secure || request.headers["x-forwarded-proto"] === "https",
    maxAge: 1000 * 60 * 60 * 12
  });
  response.json({ ok: true });
});

app.post("/api/logout", (_request, response) => {
  response.clearCookie(cookieName);
  response.json({ ok: true });
});

app.post("/api/players", requireAdmin, async (request, response, next) => {
  try {
    const players = await readPlayers();
    const nextPlayer = normalizePlayer({
      ...request.body,
      order: players.length ? Math.max(...players.map((player) => player.order)) + 1 : 1
    });

    if (!nextPlayer.name) {
      response.status(400).json({ error: "Player name is required." });
      return;
    }

    if (hasDatabase()) {
      response.status(201).json(await savePlayerToDatabase(nextPlayer));
      return;
    }

    players.push(nextPlayer);
    await writePlayers(players);
    response.status(201).json(nextPlayer);
  } catch (error) {
    next(error);
  }
});

app.put("/api/players/:id", requireAdmin, async (request, response, next) => {
  try {
    const players = await readPlayers();
    const existing = players.find((player) => player.id === request.params.id);
    if (!existing) {
      response.status(404).json({ error: "Player not found." });
      return;
    }

    const updated = normalizePlayer(request.body, existing);
    if (!updated.name) {
      response.status(400).json({ error: "Player name is required." });
      return;
    }

    if (hasDatabase()) {
      response.json(await savePlayerToDatabase(updated));
      return;
    }

    const nextPlayers = players.map((player) => (player.id === existing.id ? updated : player));
    await writePlayers(nextPlayers);
    response.json(updated);
  } catch (error) {
    next(error);
  }
});

app.delete("/api/players/:id", requireAdmin, async (request, response, next) => {
  try {
    if (hasDatabase()) {
      await deletePlayerFromDatabase(request.params.id);
      response.json({ ok: true });
      return;
    }

    const players = await readPlayers();
    await writePlayers(players.filter((player) => player.id !== request.params.id));
    response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post("/api/players/reorder", requireAdmin, async (request, response, next) => {
  try {
    const players = await readPlayers();
    const sorted = players.sort(byOrder);
    const currentIndex = sorted.findIndex((player) => player.id === request.body?.id);
    const targetIndex = request.body?.direction === "up" ? currentIndex - 1 : currentIndex + 1;

    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= sorted.length) {
      response.json(sorted);
      return;
    }

    [sorted[currentIndex].order, sorted[targetIndex].order] = [sorted[targetIndex].order, sorted[currentIndex].order];
    await writePlayers(sorted);
    response.json(sorted);
  } catch (error) {
    next(error);
  }
});

app.post("/api/players/import", requireAdmin, async (request, response, next) => {
  try {
    const nextPlayers = Array.isArray(request.body?.players)
      ? request.body.players.map((player, index) => normalizePlayer({ ...player, order: index + 1 }))
      : [];
    await writePlayers(nextPlayers);
    response.json(nextPlayers);
  } catch (error) {
    next(error);
  }
});

app.post("/api/submissions", async (request, response, next) => {
  try {
    const submission = normalizeSubmission({
      ...request.body,
      id: crypto.randomUUID(),
      status: "pending",
      createdAt: new Date().toISOString()
    });

    if (!submission.name) {
      response.status(400).json({ error: "Player name is required." });
      return;
    }

    if (hasDatabase()) {
      response.status(201).json(await saveSubmissionToDatabase(submission));
      return;
    }

    const submissions = await readSubmissions();
    submissions.push(submission);
    await writeSubmissions(submissions);
    response.status(201).json(submission);
  } catch (error) {
    next(error);
  }
});

app.get("/api/submissions", requireAdmin, async (_request, response, next) => {
  try {
    const submissions = await readSubmissions();
    response.json(submissions.filter((submission) => submission.status === "pending"));
  } catch (error) {
    next(error);
  }
});

app.post("/api/submissions/:id/approve", requireAdmin, async (request, response, next) => {
  try {
    const submissions = await readSubmissions();
    const submission = submissions.find((item) => item.id === request.params.id);
    if (!submission) {
      response.status(404).json({ error: "Submission not found." });
      return;
    }

    const players = await readPlayers();
    const approvedPlayer = normalizePlayer({
      ...submission,
      id: crypto.randomUUID(),
      order: players.length ? Math.max(...players.map((player) => player.order)) + 1 : 1
    });

    if (hasDatabase()) {
      await savePlayerToDatabase(approvedPlayer);
      await saveSubmissionToDatabase({ ...submission, status: "approved" });
      response.json({ player: approvedPlayer });
      return;
    }

    players.push(approvedPlayer);
    await writePlayers(players);
    await writeSubmissions(submissions.map((item) => (item.id === submission.id ? { ...item, status: "approved" } : item)));
    response.json({ player: approvedPlayer });
  } catch (error) {
    next(error);
  }
});

app.post("/api/submissions/:id/reject", requireAdmin, async (request, response, next) => {
  try {
    const submissions = await readSubmissions();
    const submission = submissions.find((item) => item.id === request.params.id);
    if (!submission) {
      response.status(404).json({ error: "Submission not found." });
      return;
    }

    if (hasDatabase()) {
      await saveSubmissionToDatabase({ ...submission, status: "rejected" });
      response.json({ ok: true });
      return;
    }

    await writeSubmissions(submissions.map((item) => (item.id === submission.id ? { ...item, status: "rejected" } : item)));
    response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post("/api/players/reset", requireAdmin, async (_request, response, next) => {
  try {
    const nextPlayers = starterPlayers.map((player, index) => ({
      ...player,
      id: `demo-${player.name.toLowerCase().replaceAll(" ", "-")}`,
      order: index + 1
    }));
    await writePlayers(nextPlayers);
    response.json(nextPlayers);
  } catch (error) {
    next(error);
  }
});

app.get("/admin", (_request, response) => {
  response.sendFile(path.join(__dirname, "admin.html"));
});

app.use((request, response) => {
  if (request.path.startsWith("/api/")) {
    response.status(404).json({ error: "Not found." });
    return;
  }

  response.sendFile(path.join(__dirname, "index.html"));
});

app.use((error, _request, response, _next) => {
  console.error(error);
  response.status(500).json({ error: "Server error." });
});

app.listen(port, () => {
  console.log(`Chiv2 tier list server running on port ${port}`);
});
