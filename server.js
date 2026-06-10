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
const defaultListType = "team_objective";
const listTypes = [
  { id: "team_objective", label: "Team Objective", path: "/" },
  { id: "ranked_duelist", label: "Ranked Duelists", path: "/ranked-duelists" }
];
const defaultRegions = ["NA East", "NA Central", "NA West", "EU", "OCE", "SA", "SEA"];
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, "data");
const playersFile = path.join(dataDir, "players.json");
const submissionsFile = path.join(dataDir, "submissions.json");
const regionsFile = path.join(dataDir, "regions.json");
const discordWebhooks = {
  approved: process.env.DISCORD_WEBHOOK_NEWAPPROVE,
  newSubmission: process.env.DISCORD_WEBHOOK_NEWSUB,
  updateRequest: process.env.DISCORD_WEBHOOK_UPDATEREQ
};
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

function tierLabel(tierId) {
  return tiers.find((tier) => tier.id === tierId)?.label || tierId || "Unknown";
}

function listLabel(listType) {
  return listTypes.find((item) => item.id === listType)?.label || listType || "Team Objective";
}

function discordField(name, value, inline = true) {
  return { name, value: cleanText(value || "Not provided", 1024) || "Not provided", inline };
}

async function notifyDiscord(webhookUrl, payload) {
  if (!webhookUrl) return;

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      console.error(`Discord webhook failed with ${response.status}`);
    }
  } catch (error) {
    console.error("Discord webhook failed:", error.message);
  }
}

function submissionEmbed(submission, title, color) {
  return {
    title,
    color,
    fields: [
      discordField("Player", submission.name),
      discordField("List", listLabel(submission.listType)),
      discordField("Tier", tierLabel(submission.tier)),
      discordField("Region", submission.region || "Unknown"),
      discordField("Role", submission.role || "Flexible"),
      discordField("Clan", submission.clan || "None"),
      discordField("PlayFab ID", submission.playfabId || "Not provided", false),
      discordField("Notes", submission.notes || "No notes included.", false)
    ],
    timestamp: new Date().toISOString()
  };
}

async function notifyNewSubmission(submission) {
  await notifyDiscord(discordWebhooks.newSubmission, {
    username: "Chiv Tier List",
    embeds: [submissionEmbed(submission, "New Player Submission", 0xc8953e)]
  });
}

async function notifyUpdateRequest(submission, existingPlayer) {
  const embed = submissionEmbed(submission, `Update Request: ${submission.name}`, 0x536673);
  embed.fields.unshift(discordField("Current Record", existingPlayer?.name || submission.name, false));
  await notifyDiscord(discordWebhooks.updateRequest, {
    username: "Chiv Tier List",
    embeds: [embed]
  });
}

async function notifyApproval(submission, player) {
  const title = submission.requestType === "update" ? "Update Request Approved" : "Submission Approved";
  const embed = submissionEmbed({ ...submission, ...player }, title, 0x50683e);
  await notifyDiscord(discordWebhooks.approved, {
    username: "Chiv Tier List",
    embeds: [embed]
  });
}

function normalizeListType(value) {
  return listTypes.some((item) => item.id === value) ? value : defaultListType;
}

function normalizePlayer(input = {}, fallback = {}) {
  const tier = firstDefined(input.tier, fallback.tier, "b");
  const order = firstDefined(input.order, fallback.order, 1);

  return {
    id: cleanText(firstDefined(input.id, fallback.id, crypto.randomUUID()), 80),
    listType: normalizeListType(firstDefined(input.listType, input.list_type, fallback.listType, fallback.list_type)),
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

async function readPlayers(listType = defaultListType) {
  if (hasDatabase()) return readPlayersFromDatabase(listType);
  return readPlayersFromFile(listType);
}

async function readAllPlayersFromFile() {
  try {
    const raw = await fs.readFile(playersFile, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((player) => normalizePlayer(player)) : starterPlayers;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return starterPlayers;
  }
}

async function readPlayersFromFile(listType = defaultListType) {
  return (await readAllPlayersFromFile()).filter((player) => player.listType === listType).sort(byOrder);
}

async function writePlayers(players, listType = defaultListType) {
  if (hasDatabase()) {
    await writePlayersToDatabase(players, listType);
    return;
  }

  const normalizedListType = normalizeListType(listType);
  const existingPlayers = await readAllPlayersFromFile();
  const otherPlayers = existingPlayers.filter((player) => player.listType !== normalizedListType);
  const nextPlayers = players.map((player) => normalizePlayer({ ...player, listType: normalizedListType })).sort(byOrder);
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(playersFile, `${JSON.stringify([...otherPlayers, ...nextPlayers], null, 2)}\n`);
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
    await ensureRegionsTable(connection);
    return await callback(connection);
  } finally {
    await connection.end();
  }
}

async function ensurePlayersTable(connection) {
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS \`players\` (
      \`id\` VARCHAR(80) PRIMARY KEY,
      \`list_type\` VARCHAR(40) NOT NULL DEFAULT 'team_objective',
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
    ["list_type", "VARCHAR(40) NOT NULL DEFAULT 'team_objective' AFTER `id`"],
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
      \`list_type\` VARCHAR(40) NOT NULL DEFAULT 'team_objective',
      \`name\` VARCHAR(40) NOT NULL,
      \`tier\` VARCHAR(20) NOT NULL DEFAULT 'b',
      \`region\` VARCHAR(24) DEFAULT '',
      \`role\` VARCHAR(28) DEFAULT '',
      \`clan\` VARCHAR(28) DEFAULT '',
      \`playfab_id\` VARCHAR(64) DEFAULT '',
      \`notes\` VARCHAR(180) DEFAULT '',
      \`status\` VARCHAR(20) NOT NULL DEFAULT 'pending',
      \`request_type\` VARCHAR(20) NOT NULL DEFAULT 'new',
      \`target_player_id\` VARCHAR(80) DEFAULT '',
      \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  const [columns] = await connection.execute("SHOW COLUMNS FROM `submissions`");
  const columnNames = new Set(columns.map((column) => column.Field));
  const requiredColumns = [
    ["list_type", "VARCHAR(40) NOT NULL DEFAULT 'team_objective' AFTER `id`"],
    ["tier", "VARCHAR(20) NOT NULL DEFAULT 'b' AFTER `name`"],
    ["region", "VARCHAR(24) DEFAULT '' AFTER `tier`"],
    ["role", "VARCHAR(28) DEFAULT '' AFTER `region`"],
    ["clan", "VARCHAR(28) DEFAULT '' AFTER `role`"],
    ["playfab_id", "VARCHAR(64) DEFAULT '' AFTER `clan`"],
    ["notes", "VARCHAR(180) DEFAULT '' AFTER `playfab_id`"],
    ["status", "VARCHAR(20) NOT NULL DEFAULT 'pending' AFTER `notes`"],
    ["request_type", "VARCHAR(20) NOT NULL DEFAULT 'new' AFTER `status`"],
    ["target_player_id", "VARCHAR(80) DEFAULT '' AFTER `request_type`"],
    ["created_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP AFTER `target_player_id`"],
    ["updated_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER `created_at`"]
  ];

  for (const [name, definition] of requiredColumns) {
    if (!columnNames.has(name)) {
      await connection.execute(`ALTER TABLE \`submissions\` ADD COLUMN \`${name}\` ${definition}`);
    }
  }
}

async function ensureRegionsTable(connection) {
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS \`regions\` (
      \`name\` VARCHAR(24) PRIMARY KEY,
      \`sort_order\` INT NOT NULL DEFAULT 1
    )
  `);

  const [rows] = await connection.execute("SELECT COUNT(*) AS count FROM `regions`");
  if (!Number(rows[0]?.count)) {
    for (const [index, region] of defaultRegions.entries()) {
      await connection.execute("INSERT INTO `regions` (`name`, `sort_order`) VALUES (?, ?)", [region, index + 1]);
    }
  }
}

function rowToPlayer(row) {
  return normalizePlayer({
    id: row.id,
    listType: row.list_type,
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
  const requestType = cleanText(firstDefined(input.requestType, input.request_type, fallback.requestType, fallback.request_type, "new"), 20);
  return {
    ...player,
    status: ["pending", "approved", "rejected"].includes(status) ? status : "pending",
    requestType: ["new", "update"].includes(requestType) ? requestType : "new",
    targetPlayerId: cleanText(firstDefined(input.targetPlayerId, input.target_player_id, fallback.targetPlayerId, fallback.target_player_id), 80),
    createdAt: firstDefined(input.createdAt, input.created_at, fallback.createdAt, fallback.created_at, new Date().toISOString())
  };
}

function rowToSubmission(row) {
  return normalizeSubmission({
    id: row.id,
    listType: row.list_type,
    name: row.name,
    tier: row.tier,
    region: row.region,
    role: row.role,
    clan: row.clan,
    playfabId: row.playfab_id,
    notes: row.notes,
    status: row.status,
    requestType: row.request_type,
    targetPlayerId: row.target_player_id,
    createdAt: row.created_at
  });
}

async function readSubmissions(listType = defaultListType) {
  if (hasDatabase()) return readSubmissionsFromDatabase(listType);
  return readSubmissionsFromFile(listType);
}

async function readAllSubmissionsFromFile() {
  try {
    const raw = await fs.readFile(submissionsFile, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((submission) => normalizeSubmission(submission)) : [];
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return [];
  }
}

async function readSubmissionsFromFile(listType = defaultListType) {
  return (await readAllSubmissionsFromFile()).filter((submission) => submission.listType === listType).sort(byCreated);
}

async function writeSubmissions(submissions, listType = defaultListType) {
  if (hasDatabase()) {
    await writeSubmissionsToDatabase(submissions, listType);
    return;
  }

  const normalizedListType = normalizeListType(listType);
  const existingSubmissions = await readAllSubmissionsFromFile();
  const otherSubmissions = existingSubmissions.filter((submission) => submission.listType !== normalizedListType);
  const nextSubmissions = submissions.map((submission) => normalizeSubmission({ ...submission, listType: normalizedListType })).sort(byCreated);
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(submissionsFile, `${JSON.stringify([...otherSubmissions, ...nextSubmissions], null, 2)}\n`);
}

async function readSubmissionsFromDatabase(listType = defaultListType) {
  return withDatabase(async (connection) => {
    const [rows] = await connection.execute(
      "SELECT `id`, `list_type`, `name`, `tier`, `region`, `role`, `clan`, `playfab_id`, `notes`, `status`, `request_type`, `target_player_id`, `created_at` FROM `submissions` WHERE `list_type` = ? ORDER BY `created_at` ASC, `name` ASC",
      [normalizeListType(listType)]
    );
    return rows.map(rowToSubmission);
  });
}

async function saveSubmissionToDatabase(submission) {
  return withDatabase(async (connection) => {
    const normalized = normalizeSubmission(submission);
    await connection.execute(
      `INSERT INTO \`submissions\` (\`id\`, \`list_type\`, \`name\`, \`tier\`, \`region\`, \`role\`, \`clan\`, \`playfab_id\`, \`notes\`, \`status\`, \`request_type\`, \`target_player_id\`)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         \`list_type\` = VALUES(\`list_type\`),
         \`name\` = VALUES(\`name\`),
         \`tier\` = VALUES(\`tier\`),
         \`region\` = VALUES(\`region\`),
         \`role\` = VALUES(\`role\`),
         \`clan\` = VALUES(\`clan\`),
         \`playfab_id\` = VALUES(\`playfab_id\`),
         \`notes\` = VALUES(\`notes\`),
         \`status\` = VALUES(\`status\`),
         \`request_type\` = VALUES(\`request_type\`),
         \`target_player_id\` = VALUES(\`target_player_id\`)`,
      [
        normalized.id,
        normalized.listType,
        normalized.name,
        normalized.tier,
        normalized.region,
        normalized.role,
        normalized.clan,
        normalized.playfabId,
        normalized.notes,
        normalized.status,
        normalized.requestType,
        normalized.targetPlayerId
      ]
    );

    return normalized;
  });
}

async function writeSubmissionsToDatabase(submissions, listType = defaultListType) {
  return withDatabase(async (connection) => {
    const normalizedListType = normalizeListType(listType);
    await connection.beginTransaction();
    try {
      await connection.execute("DELETE FROM `submissions` WHERE `list_type` = ?", [normalizedListType]);
      for (const submission of submissions.map((item) => normalizeSubmission(item)).sort(byCreated)) {
        await connection.execute(
          `INSERT INTO \`submissions\` (\`id\`, \`list_type\`, \`name\`, \`tier\`, \`region\`, \`role\`, \`clan\`, \`playfab_id\`, \`notes\`, \`status\`, \`request_type\`, \`target_player_id\`)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            submission.id,
            normalizedListType,
            submission.name,
            submission.tier,
            submission.region,
            submission.role,
            submission.clan,
            submission.playfabId,
            submission.notes,
            submission.status,
            submission.requestType,
            submission.targetPlayerId
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

async function readPlayersFromDatabase(listType = defaultListType) {
  return withDatabase(async (connection) => {
    const normalizedListType = normalizeListType(listType);
    const [rows] = await connection.execute(
      "SELECT `id`, `list_type`, `name`, `tier`, `region`, `role`, `clan`, `playfab_id`, `notes`, `sort_order` FROM `players` WHERE `list_type` = ? ORDER BY `sort_order` ASC, `name` ASC",
      [normalizedListType]
    );
    if (rows.length) return rows.map(rowToPlayer);

    if (normalizedListType !== defaultListType) return [];
    const seededPlayers = await readPlayersFromFile(defaultListType);
    await writePlayersToDatabase(seededPlayers, defaultListType);
    return seededPlayers;
  });
}

async function savePlayerToDatabase(player) {
  return withDatabase(async (connection) => {
    const normalized = normalizePlayer(player);
    await connection.execute(
      `INSERT INTO \`players\` (\`id\`, \`list_type\`, \`name\`, \`tier\`, \`region\`, \`role\`, \`clan\`, \`playfab_id\`, \`notes\`, \`sort_order\`)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         \`list_type\` = VALUES(\`list_type\`),
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
        normalized.listType,
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
      "SELECT `id`, `list_type`, `name`, `tier`, `region`, `role`, `clan`, `playfab_id`, `notes`, `sort_order` FROM `players` WHERE `id` = ? LIMIT 1",
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

async function writePlayersToDatabase(players, listType = defaultListType) {
  return withDatabase(async (connection) => {
    const normalizedListType = normalizeListType(listType);
    const sortedPlayers = players.map((player) => normalizePlayer({ ...player, listType: normalizedListType })).sort(byOrder);
    await connection.beginTransaction();
    try {
      await connection.execute("DELETE FROM `players` WHERE `list_type` = ?", [normalizedListType]);
      for (const player of sortedPlayers) {
        await connection.execute(
          `INSERT INTO \`players\` (\`id\`, \`list_type\`, \`name\`, \`tier\`, \`region\`, \`role\`, \`clan\`, \`playfab_id\`, \`notes\`, \`sort_order\`)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            player.id,
            normalizedListType,
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

function requestListType(request) {
  return normalizeListType(request.query.listType || request.body?.listType || request.body?.list_type);
}

async function readRegions() {
  if (hasDatabase()) {
    return withDatabase(async (connection) => {
      const [rows] = await connection.execute("SELECT `name` FROM `regions` ORDER BY `sort_order` ASC, `name` ASC");
      return rows.map((row) => row.name);
    });
  }

  try {
    const raw = await fs.readFile(regionsFile, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length ? parsed.map((region) => cleanText(region, 24)).filter(Boolean) : defaultRegions;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return defaultRegions;
  }
}

async function writeRegions(regions) {
  const nextRegions = [...new Set(regions.map((region) => cleanText(region, 24)).filter(Boolean))].sort();
  if (hasDatabase()) {
    return withDatabase(async (connection) => {
      await connection.beginTransaction();
      try {
        await connection.execute("DELETE FROM `regions`");
        for (const [index, region] of nextRegions.entries()) {
          await connection.execute("INSERT INTO `regions` (`name`, `sort_order`) VALUES (?, ?)", [region, index + 1]);
        }
        await connection.commit();
        return nextRegions;
      } catch (error) {
        await connection.rollback();
        throw error;
      }
    });
  }

  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(regionsFile, `${JSON.stringify(nextRegions, null, 2)}\n`);
  return nextRegions;
}

async function ensureRegionAllowed(region) {
  if (!region) return "";
  const regions = await readRegions();
  return regions.includes(region) ? region : "";
}

app.get("/api/config", (_request, response) => {
  response.json({ tiers, listTypes });
});

app.get("/api/regions", async (_request, response, next) => {
  try {
    response.json(await readRegions());
  } catch (error) {
    next(error);
  }
});

app.post("/api/regions", requireAdmin, async (request, response, next) => {
  try {
    const region = cleanText(request.body?.name, 24);
    if (!region) {
      response.status(400).json({ error: "Region name is required." });
      return;
    }
    const regions = await readRegions();
    response.status(201).json(await writeRegions([...regions, region]));
  } catch (error) {
    next(error);
  }
});

app.delete("/api/regions/:name", requireAdmin, async (request, response, next) => {
  try {
    const region = cleanText(request.params.name, 24);
    const regions = await readRegions();
    response.json(await writeRegions(regions.filter((item) => item !== region)));
  } catch (error) {
    next(error);
  }
});

app.get("/api/players", async (request, response, next) => {
  try {
    response.json(await readPlayers(requestListType(request)));
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
    const listType = requestListType(request);
    const players = await readPlayers(listType);
    const nextPlayer = normalizePlayer({
      ...request.body,
      listType,
      region: await ensureRegionAllowed(request.body?.region),
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
    await writePlayers(players, listType);
    response.status(201).json(nextPlayer);
  } catch (error) {
    next(error);
  }
});

app.put("/api/players/:id", requireAdmin, async (request, response, next) => {
  try {
    const listType = requestListType(request);
    const players = await readPlayers(listType);
    const existing = players.find((player) => player.id === request.params.id);
    if (!existing) {
      response.status(404).json({ error: "Player not found." });
      return;
    }

    const updated = normalizePlayer({ ...request.body, listType, region: await ensureRegionAllowed(request.body?.region) }, existing);
    if (!updated.name) {
      response.status(400).json({ error: "Player name is required." });
      return;
    }

    if (hasDatabase()) {
      response.json(await savePlayerToDatabase(updated));
      return;
    }

    const nextPlayers = players.map((player) => (player.id === existing.id ? updated : player));
    await writePlayers(nextPlayers, listType);
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

    const listType = requestListType(request);
    const players = await readPlayers(listType);
    await writePlayers(players.filter((player) => player.id !== request.params.id), listType);
    response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post("/api/players/reorder", requireAdmin, async (request, response, next) => {
  try {
    const listType = requestListType(request);
    const players = await readPlayers(listType);
    const sorted = players.sort(byOrder);
    const currentIndex = sorted.findIndex((player) => player.id === request.body?.id);
    const targetIndex = request.body?.direction === "up" ? currentIndex - 1 : currentIndex + 1;

    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= sorted.length) {
      response.json(sorted);
      return;
    }

    [sorted[currentIndex].order, sorted[targetIndex].order] = [sorted[targetIndex].order, sorted[currentIndex].order];
    await writePlayers(sorted, listType);
    response.json(sorted);
  } catch (error) {
    next(error);
  }
});

app.post("/api/players/import", requireAdmin, async (request, response, next) => {
  try {
    const listType = requestListType(request);
    const nextPlayers = Array.isArray(request.body?.players)
      ? request.body.players.map((player, index) => normalizePlayer({ ...player, listType, order: index + 1 }))
      : [];
    await writePlayers(nextPlayers, listType);
    response.json(nextPlayers);
  } catch (error) {
    next(error);
  }
});

app.post("/api/submissions", async (request, response, next) => {
  try {
    const listType = requestListType(request);
    const submission = normalizeSubmission({
      ...request.body,
      listType,
      region: await ensureRegionAllowed(request.body?.region),
      id: crypto.randomUUID(),
      status: "pending",
      requestType: "new",
      createdAt: new Date().toISOString()
    });

    if (!submission.name) {
      response.status(400).json({ error: "Player name is required." });
      return;
    }

    if (hasDatabase()) {
      const saved = await saveSubmissionToDatabase(submission);
      await notifyNewSubmission(saved);
      response.status(201).json(saved);
      return;
    }

    const submissions = await readSubmissions(listType);
    submissions.push(submission);
    await writeSubmissions(submissions, listType);
    await notifyNewSubmission(submission);
    response.status(201).json(submission);
  } catch (error) {
    next(error);
  }
});

app.post("/api/update-requests", async (request, response, next) => {
  try {
    const listType = requestListType(request);
    const targetPlayerId = cleanText(request.body?.targetPlayerId || request.body?.target_player_id, 80);
    const players = await readPlayers(listType);
    const existingPlayer = players.find((player) => player.id === targetPlayerId);
    if (!existingPlayer) {
      response.status(404).json({ error: "Player record not found." });
      return;
    }

    const submission = normalizeSubmission(
      {
        ...request.body,
        listType,
        region: await ensureRegionAllowed(request.body?.region),
        id: crypto.randomUUID(),
        status: "pending",
        requestType: "update",
        targetPlayerId,
        createdAt: new Date().toISOString()
      },
      existingPlayer
    );

    if (!submission.name) {
      response.status(400).json({ error: "Player name is required." });
      return;
    }

    if (hasDatabase()) {
      const saved = await saveSubmissionToDatabase(submission);
      await notifyUpdateRequest(saved, existingPlayer);
      response.status(201).json(saved);
      return;
    }

    const submissions = await readSubmissions(listType);
    submissions.push(submission);
    await writeSubmissions(submissions, listType);
    await notifyUpdateRequest(submission, existingPlayer);
    response.status(201).json(submission);
  } catch (error) {
    next(error);
  }
});

app.get("/api/submissions", requireAdmin, async (request, response, next) => {
  try {
    const submissions = await readSubmissions(requestListType(request));
    response.json(submissions.filter((submission) => submission.status === "pending"));
  } catch (error) {
    next(error);
  }
});

app.post("/api/submissions/:id/approve", requireAdmin, async (request, response, next) => {
  try {
    const listType = requestListType(request);
    const submissions = await readSubmissions(listType);
    const submission = submissions.find((item) => item.id === request.params.id);
    if (!submission) {
      response.status(404).json({ error: "Submission not found." });
      return;
    }

    const players = await readPlayers(listType);
    const existingPlayer = submission.requestType === "update"
      ? players.find((player) => player.id === submission.targetPlayerId)
      : null;

    if (submission.requestType === "update" && !existingPlayer) {
      response.status(404).json({ error: "Original player record was not found." });
      return;
    }

    const approvedPlayer = normalizePlayer(
      {
        ...submission,
        listType,
        id: existingPlayer?.id || crypto.randomUUID(),
        order: existingPlayer?.order || (players.length ? Math.max(...players.map((player) => player.order)) + 1 : 1)
      },
      existingPlayer || {}
    );

    if (hasDatabase()) {
      await savePlayerToDatabase(approvedPlayer);
      await saveSubmissionToDatabase({ ...submission, status: "approved" });
      await notifyApproval(submission, approvedPlayer);
      response.json({ player: approvedPlayer });
      return;
    }

    const nextPlayers = existingPlayer
      ? players.map((player) => (player.id === existingPlayer.id ? approvedPlayer : player))
      : [...players, approvedPlayer];
    await writePlayers(nextPlayers, listType);
    await writeSubmissions(submissions.map((item) => (item.id === submission.id ? { ...item, status: "approved" } : item)), listType);
    await notifyApproval(submission, approvedPlayer);
    response.json({ player: approvedPlayer });
  } catch (error) {
    next(error);
  }
});

app.post("/api/submissions/:id/reject", requireAdmin, async (request, response, next) => {
  try {
    const listType = requestListType(request);
    const submissions = await readSubmissions(listType);
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

    await writeSubmissions(submissions.map((item) => (item.id === submission.id ? { ...item, status: "rejected" } : item)), listType);
    response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post("/api/players/reset", requireAdmin, async (_request, response, next) => {
  try {
    const listType = requestListType(_request);
    const nextPlayers = starterPlayers.map((player, index) => ({
      ...player,
      listType,
      id: `demo-${player.name.toLowerCase().replaceAll(" ", "-")}`,
      order: index + 1
    }));
    await writePlayers(nextPlayers, listType);
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
