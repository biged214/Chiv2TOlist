import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import express from "express";
import mysql from "mysql2/promise";

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = process.env.PORT || 3000;

process.on("unhandledRejection", (error) => {
  console.error("Unhandled rejection:", error);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
});

const adminUsername = process.env.ADMIN_USERNAME || "admin";
const adminPassword = process.env.ADMIN_PASSWORD;
const adminTotpSecret = process.env.ADMIN_TOTP_SECRET || process.env.ADMIN_MFA_SECRET || "";
const sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const cookieName = "chiv2_admin";
const defaultListType = "team_objective";
const listTypes = [
  { id: "team_objective", label: "Team Objective", path: "/" },
  { id: "ranked_duelist", label: "Ranked Duelists", path: "/ranked-duelists" }
];
const defaultRegions = ["NA East", "NA Central", "NA West", "EU", "OCE", "SA", "SEA"];
const defaultLeaderboardStats = [
  "Score",
  "Kills",
  "Wins",
  "Deaths",
  "Level",
  "Rank",
  "XP",
  "Experience",
  "GlobalScore",
  "TotalScore",
  "LeaderboardScore",
  "DuelRank",
  "DuelRating",
  "RankedDuelRating",
  "TeamObjectiveScore"
];
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, "data");
const playersFile = path.join(dataDir, "players.json");
const submissionsFile = path.join(dataDir, "submissions.json");
const regionsFile = path.join(dataDir, "regions.json");
const playfabCacheFile = path.join(dataDir, "playfab-cache.json");
const discordWebhooks = {
  approved: process.env.DISCORD_WEBHOOK_NEWAPPROVE,
  newSubmission: process.env.DISCORD_WEBHOOK_NEWSUB,
  updateRequest: process.env.DISCORD_WEBHOOK_UPDATEREQ
};

function envValue(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

const playfabConfig = {
  titleId: envValue("PLAYFAB_TITLE_ID", "playfab_title_id"),
  sessionTicket: envValue("PLAYFAB_SESSION_TICKET", "playfab_session_ticket"),
  cacheMinutes: Number(envValue("PLAYFAB_CACHE_MINUTES", "playfab_cache_minutes") || "360"),
  sessionMinutes: Number(envValue("PLAYFAB_SESSION_MINUTES", "playfab_session_minutes") || "120"),
  leaderboardStats: envValue("PLAYFAB_LEADERBOARD_STATS", "playfab_leaderboard_stats"),
  autoNameSync: envValue("PLAYFAB_AUTO_NAME_SYNC", "playfab_auto_name_sync").toLowerCase() !== "false",
  autoNameSyncHours: Number(envValue("PLAYFAB_AUTO_NAME_SYNC_HOURS", "playfab_auto_name_sync_hours") || "24"),
  autoNameSyncStartDelaySeconds: Number(
    envValue("PLAYFAB_AUTO_NAME_SYNC_START_DELAY_SECONDS", "playfab_auto_name_sync_start_delay_seconds") || "60"
  )
};
const steamConfig = {
  appId: Number(envValue("CHIVALRY2_STEAM_APP_ID", "chivalry2_steam_app_id", "STEAM_APP_ID", "steam_app_id") || "1824220"),
  username: envValue("STEAM_USERNAME", "steam_username"),
  password: envValue("STEAM_PASSWORD", "steam_password"),
  sharedSecret:
    envValue("STEAM_SHARED_SECRET", "steam_shared_secret", "STEAM_IDENTITY_SECRET", "steam_identity_secret"),
  refreshToken: envValue("STEAM_REFRESH_TOKEN", "steam_refresh_token"),
  ticketMode: envValue("PLAYFAB_STEAM_TICKET_MODE", "playfab_steam_ticket_mode") || "session",
  ticketIsServiceSpecific: ["1", "true", "yes"].includes(
    envValue("PLAYFAB_STEAM_TICKET_SERVICE_SPECIFIC", "playfab_steam_ticket_service_specific").toLowerCase()
  ),
  createPlayfabAccount: !["0", "false", "no"].includes(
    envValue("PLAYFAB_STEAM_CREATE_ACCOUNT", "playfab_steam_create_account").toLowerCase()
  )
};
let steamClientPromise;
let playfabSessionPromise;
let cachedPlayfabSession;
let playfabNameSyncRunning = false;
let playfabWarmupStatus = {
  state: "idle",
  message: "",
  playfabStage: "",
  updatedAt: ""
};
function hasDatabase() {
  return Boolean(process.env.DB_HOST && process.env.DB_NAME && process.env.DB_USER);
}

const tiers = [
  { id: "creator", label: "Creator", name: "", color: "#2f1f4f" },
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

function timingSafeEqualText(left = "", right = "") {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function decodeBase32(value = "") {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = String(value).toUpperCase().replace(/[^A-Z2-7]/g, "");
  const bytes = [];
  let bits = 0;
  let valueBuffer = 0;

  for (const character of clean) {
    const index = alphabet.indexOf(character);
    if (index === -1) continue;
    valueBuffer = (valueBuffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((valueBuffer >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

function totpCode(secret, counter) {
  const key = decodeBase32(secret);
  if (!key.length) return "";

  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac("sha1", key).update(buffer).digest();
  const offset = digest[digest.length - 1] & 15;
  const binary =
    ((digest[offset] & 127) << 24) |
    ((digest[offset + 1] & 255) << 16) |
    ((digest[offset + 2] & 255) << 8) |
    (digest[offset + 3] & 255);

  return String(binary % 1000000).padStart(6, "0");
}

function verifyTotp(code, secret) {
  const cleanCode = String(code || "").replace(/\D/g, "");
  if (!secret || cleanCode.length !== 6) return false;

  const counter = Math.floor(Date.now() / 30000);
  for (const offset of [-1, 0, 1]) {
    if (timingSafeEqualText(cleanCode, totpCode(secret, counter + offset))) return true;
  }
  return false;
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
      discordField("Discord", submission.discordUsername || "Not provided"),
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

function normalizePublicSubmissionTier(value) {
  return tiers.some((item) => item.id === value && item.id !== "creator") ? value : "b";
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
    discordUsername: cleanText(firstDefined(input.discordUsername, input.discord_username, fallback.discordUsername, fallback.discord_username), 64),
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
    await ensurePlayfabCacheTable(connection);
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
      \`discord_username\` VARCHAR(64) DEFAULT '',
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
    ["discord_username", "VARCHAR(64) DEFAULT '' AFTER `clan`"],
    ["playfab_id", "VARCHAR(64) DEFAULT '' AFTER `discord_username`"],
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
      \`discord_username\` VARCHAR(64) DEFAULT '',
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
    ["discord_username", "VARCHAR(64) DEFAULT '' AFTER `clan`"],
    ["playfab_id", "VARCHAR(64) DEFAULT '' AFTER `discord_username`"],
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

async function ensurePlayfabCacheTable(connection) {
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS \`playfab_cache\` (
      \`playfab_id\` VARCHAR(64) PRIMARY KEY,
      \`payload\` MEDIUMTEXT NOT NULL,
      \`fetched_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
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
    discordUsername: row.discord_username,
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
    discordUsername: row.discord_username,
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
      "SELECT `id`, `list_type`, `name`, `tier`, `region`, `role`, `clan`, `discord_username`, `playfab_id`, `notes`, `status`, `request_type`, `target_player_id`, `created_at` FROM `submissions` WHERE `list_type` = ? ORDER BY `created_at` ASC, `name` ASC",
      [normalizeListType(listType)]
    );
    return rows.map(rowToSubmission);
  });
}

async function saveSubmissionToDatabase(submission) {
  return withDatabase(async (connection) => {
    const normalized = normalizeSubmission(submission);
    await connection.execute(
      `INSERT INTO \`submissions\` (\`id\`, \`list_type\`, \`name\`, \`tier\`, \`region\`, \`role\`, \`clan\`, \`discord_username\`, \`playfab_id\`, \`notes\`, \`status\`, \`request_type\`, \`target_player_id\`)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         \`list_type\` = VALUES(\`list_type\`),
         \`name\` = VALUES(\`name\`),
         \`tier\` = VALUES(\`tier\`),
         \`region\` = VALUES(\`region\`),
         \`role\` = VALUES(\`role\`),
         \`clan\` = VALUES(\`clan\`),
         \`discord_username\` = VALUES(\`discord_username\`),
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
        normalized.discordUsername,
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
          `INSERT INTO \`submissions\` (\`id\`, \`list_type\`, \`name\`, \`tier\`, \`region\`, \`role\`, \`clan\`, \`discord_username\`, \`playfab_id\`, \`notes\`, \`status\`, \`request_type\`, \`target_player_id\`)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            submission.id,
            normalizedListType,
            submission.name,
            submission.tier,
            submission.region,
            submission.role,
            submission.clan,
            submission.discordUsername,
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
      "SELECT `id`, `list_type`, `name`, `tier`, `region`, `role`, `clan`, `discord_username`, `playfab_id`, `notes`, `sort_order` FROM `players` WHERE `list_type` = ? ORDER BY `sort_order` ASC, `name` ASC",
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
      `INSERT INTO \`players\` (\`id\`, \`list_type\`, \`name\`, \`tier\`, \`region\`, \`role\`, \`clan\`, \`discord_username\`, \`playfab_id\`, \`notes\`, \`sort_order\`)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         \`list_type\` = VALUES(\`list_type\`),
         \`name\` = VALUES(\`name\`),
         \`tier\` = VALUES(\`tier\`),
         \`region\` = VALUES(\`region\`),
         \`role\` = VALUES(\`role\`),
         \`clan\` = VALUES(\`clan\`),
         \`discord_username\` = VALUES(\`discord_username\`),
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
        normalized.discordUsername,
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
      "SELECT `id`, `list_type`, `name`, `tier`, `region`, `role`, `clan`, `discord_username`, `playfab_id`, `notes`, `sort_order` FROM `players` WHERE `id` = ? LIMIT 1",
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
          `INSERT INTO \`players\` (\`id\`, \`list_type\`, \`name\`, \`tier\`, \`region\`, \`role\`, \`clan\`, \`discord_username\`, \`playfab_id\`, \`notes\`, \`sort_order\`)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            player.id,
            normalizedListType,
            player.name,
            player.tier,
            player.region,
            player.role,
            player.clan,
            player.discordUsername,
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

function cleanPlayfabId(value) {
  return cleanText(value, 64).replace(/[^a-zA-Z0-9]/g, "");
}

function playfabCacheMaxAgeMs() {
  return Math.max(5, Number.isFinite(playfabConfig.cacheMinutes) ? playfabConfig.cacheMinutes : 360) * 60 * 1000;
}

function summarizePlayfabProfile(profile = {}, playfabId) {
  return {
    playfabId: profile.PlayerId || playfabId,
    displayName: profile.DisplayName || "",
    avatarUrl: profile.AvatarUrl || "",
    lastLogin: profile.LastLogin || "",
    statistics: Array.isArray(profile.Statistics)
      ? profile.Statistics.map((stat) => ({
          name: cleanText(stat.Name, 80),
          value: Number.isFinite(Number(stat.Value)) ? Number(stat.Value) : stat.Value,
          version: Number.isFinite(Number(stat.Version)) ? Number(stat.Version) : undefined
        }))
      : []
  };
}

function displayNameFromPlayfabProfile(profile = {}, playfabId = "") {
  const displayName = cleanText(profile.displayName || profile.DisplayName || "", 80);
  if (!displayName) return "";

  const separator = displayName.lastIndexOf(":");
  if (separator === -1) return cleanText(displayName, 40);

  const name = displayName.slice(0, separator).trim();
  const suffix = displayName.slice(separator + 1).trim();
  const playfab = String(playfabId || profile.playfabId || profile.PlayerId || "").trim().toUpperCase();
  const looksLikePlayfabSuffix =
    /^[a-fA-F0-9]{5,64}$/.test(suffix) &&
    (!playfab || playfab.startsWith(suffix.toUpperCase()) || playfab.endsWith(suffix.toUpperCase()) || suffix.length < 8);

  return cleanText(looksLikePlayfabSuffix && name ? name : displayName, 40);
}

async function readPlayfabCache(playfabId) {
  if (hasDatabase()) {
    return withDatabase(async (connection) => {
      const [rows] = await connection.execute(
        "SELECT `payload`, `fetched_at` FROM `playfab_cache` WHERE `playfab_id` = ? LIMIT 1",
        [playfabId]
      );
      if (!rows.length) return null;
      return {
        profile: JSON.parse(rows[0].payload),
        fetchedAt: new Date(rows[0].fetched_at).toISOString()
      };
    });
  }

  try {
    const raw = await fs.readFile(playfabCacheFile, "utf8");
    const parsed = JSON.parse(raw);
    return parsed[playfabId] || null;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return null;
  }
}

async function writePlayfabCache(playfabId, profile) {
  const fetchedAt = new Date().toISOString();
  if (hasDatabase()) {
    return withDatabase(async (connection) => {
      await connection.execute(
        `INSERT INTO \`playfab_cache\` (\`playfab_id\`, \`payload\`, \`fetched_at\`)
         VALUES (?, ?, CURRENT_TIMESTAMP)
         ON DUPLICATE KEY UPDATE
           \`payload\` = VALUES(\`payload\`),
           \`fetched_at\` = CURRENT_TIMESTAMP`,
        [playfabId, JSON.stringify(profile)]
      );
      return { profile, fetchedAt };
    });
  }

  let parsed = {};
  try {
    parsed = JSON.parse(await fs.readFile(playfabCacheFile, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  parsed[playfabId] = { profile, fetchedAt };
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(playfabCacheFile, `${JSON.stringify(parsed, null, 2)}\n`);
  return { profile, fetchedAt };
}

function isFreshPlayfabCache(cached) {
  return cached?.fetchedAt && Date.now() - new Date(cached.fetchedAt).getTime() < playfabCacheMaxAgeMs();
}

function hasSteamPlayfabConfig() {
  return Boolean(
    playfabConfig.titleId &&
      steamConfig.appId &&
      ((steamConfig.username && steamConfig.password && steamConfig.sharedSecret) || steamConfig.refreshToken)
  );
}

function playfabConfigStatus() {
  const hasPasswordLogin = Boolean(steamConfig.username && steamConfig.password && steamConfig.sharedSecret);
  const hasRefreshLogin = Boolean(steamConfig.refreshToken);
  const missing = [];

  if (!playfabConfig.titleId) missing.push("PLAYFAB_TITLE_ID");
  if (!steamConfig.appId) missing.push("CHIVALRY2_STEAM_APP_ID");
  if (!hasPasswordLogin && !hasRefreshLogin) {
    if (!steamConfig.username) missing.push("STEAM_USERNAME");
    if (!steamConfig.password) missing.push("STEAM_PASSWORD");
    if (!steamConfig.sharedSecret) missing.push("STEAM_SHARED_SECRET");
    missing.push("or STEAM_REFRESH_TOKEN");
  }

  return {
    configured: Boolean(playfabConfig.sessionTicket || (playfabConfig.titleId && steamConfig.appId && (hasPasswordLogin || hasRefreshLogin))),
    manualSessionTicket: Boolean(playfabConfig.sessionTicket),
    steamLogin: hasPasswordLogin,
    steamRefreshToken: hasRefreshLogin,
    steamAppId: steamConfig.appId || null,
    missing,
    warmupStatus: playfabWarmupStatus
  };
}

function playfabConfigError() {
  return Object.assign(new Error("PlayFab lookup is not configured yet."), {
    statusCode: 503,
    playfabStage: "configuration",
    missingConfig: playfabConfigStatus().missing
  });
}

function playfabServiceError(message, statusCode = 502, playfabStage = "lookup") {
  return Object.assign(new Error(message), { statusCode, playfabStage });
}

function sanitizeExternalError(value) {
  return cleanText(value, 2000)
    .replace(/authentication ticket\s+[a-fA-F0-9]{40,}/g, "authentication ticket [redacted]")
    .replace(/[a-fA-F0-9]{160,}/g, "[redacted-ticket]");
}

function leaderboardStatNames() {
  const configured = playfabConfig.leaderboardStats
    .split(",")
    .map((name) => cleanText(name, 80))
    .filter(Boolean);
  return [...new Set(configured.length ? configured : defaultLeaderboardStats)];
}

function summarizeLeaderboardEntry(entry) {
  return {
    playfabId: entry.PlayFabId,
    displayName: entry.DisplayName || entry.Profile?.DisplayName || "",
    position: entry.Position,
    value: entry.StatValue,
    profile: entry.Profile
      ? {
          displayName: entry.Profile.DisplayName || "",
          avatarUrl: entry.Profile.AvatarUrl || "",
          lastLogin: entry.Profile.LastLogin || ""
        }
      : null
  };
}

function fetchTimeoutSignal(milliseconds = 20000) {
  if (AbortSignal.timeout) return AbortSignal.timeout(milliseconds);

  const controller = new AbortController();
  setTimeout(() => controller.abort(), milliseconds);
  return controller.signal;
}

function playfabSessionMaxAgeMs() {
  return Math.max(15, Number.isFinite(playfabConfig.sessionMinutes) ? playfabConfig.sessionMinutes : 120) * 60 * 1000;
}

function hasReadyPlayfabSession() {
  return Boolean(
    playfabConfig.sessionTicket ||
      (cachedPlayfabSession?.sessionTicket && cachedPlayfabSession.expiresAt > Date.now() + 60000)
  );
}

function updatePlayfabWarmupStatus(nextStatus) {
  playfabWarmupStatus = {
    ...playfabWarmupStatus,
    ...nextStatus,
    updatedAt: new Date().toISOString()
  };
  return playfabWarmupStatus;
}

function waitForSteamEvent(client, successEvent) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      client.off(successEvent, onSuccess);
      client.off("error", onError);
      clearTimeout(timer);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(playfabServiceError("Steam login timed out after 120 seconds.", 504, "steam-login"));
    }, 120000);
    const onSuccess = (...args) => {
      cleanup();
      resolve(args);
    };
    const onError = (error) => {
      cleanup();
      reject(playfabServiceError(`Steam login failed: ${error.message}`, error.statusCode || 502, "steam-login"));
    };
    client.once(successEvent, onSuccess);
    client.once("error", onError);
  });
}

async function getSteamClient() {
  if (steamClientPromise) return steamClientPromise;

  steamClientPromise = (async () => {
    if (!hasSteamPlayfabConfig()) {
      throw playfabConfigError();
    }

    const SteamUser = require("steam-user");
    const SteamTotp = require("steam-totp");
    const client = new SteamUser({ autoRelogin: true });

    client.on("error", (error) => {
      console.error("Steam client error:", error.message);
    });
    client.on("disconnected", (_eresult, message) => {
      console.warn("Steam client disconnected:", message || "No reason provided");
    });
    client.on("refreshToken", (refreshToken) => {
      console.info("Steam refresh token issued. Save it as STEAM_REFRESH_TOKEN in GoDaddy Secrets for more reliable future logins.");
      if (process.env.NODE_ENV !== "production") {
        console.info(`Local Steam refresh token: ${refreshToken}`);
      }
    });
    client.on("steamGuard", (_domain, callback, lastCodeWrong) => {
      if (!steamConfig.sharedSecret) return;
      updatePlayfabWarmupStatus({
        state: "warming",
        message: lastCodeWrong ? "Steam rejected the previous Steam Guard code. Waiting for a fresh code." : "Submitting Steam Guard code.",
        playfabStage: "steam-guard"
      });
      const delay = lastCodeWrong ? 30000 : 0;
      setTimeout(() => callback(SteamTotp.generateAuthCode(steamConfig.sharedSecret)), delay);
    });

    updatePlayfabWarmupStatus({
      state: "warming",
      message: "Steam login started.",
      playfabStage: "steam-login"
    });
    const loggedOn = waitForSteamEvent(client, "loggedOn");
    if (steamConfig.refreshToken) {
      client.logOn({
        refreshToken: steamConfig.refreshToken,
        machineName: "Chiv2TOList PlayFab Bot"
      });
    } else {
      client.logOn({
        accountName: steamConfig.username,
        password: steamConfig.password,
        twoFactorCode: SteamTotp.generateAuthCode(steamConfig.sharedSecret),
        machineName: "Chiv2TOList PlayFab Bot"
      });
    }

    await loggedOn;
    updatePlayfabWarmupStatus({
      state: "warming",
      message: "Steam login succeeded. Requesting a Chivalry 2 app ticket.",
      playfabStage: "steam-ticket"
    });
    return client;
  })().catch((error) => {
    steamClientPromise = null;
    throw error;
  });

  return steamClientPromise;
}

async function createSteamTicket() {
  const client = await getSteamClient();
  if (steamConfig.ticketMode === "encrypted") {
    updatePlayfabWarmupStatus({
      state: "warming",
      message: "Requesting encrypted Chivalry 2 Steam app ticket.",
      playfabStage: "steam-ticket"
    });
    const result = await client.createEncryptedAppTicket(steamConfig.appId);
    updatePlayfabWarmupStatus({
      state: "warming",
      message: "Encrypted Steam app ticket received. Logging into PlayFab.",
      playfabStage: "playfab-login"
    });
    return result.encryptedAppTicket.toString("hex");
  }

  try {
    updatePlayfabWarmupStatus({
      state: "warming",
      message: "Requesting Chivalry 2 Steam auth session ticket.",
      playfabStage: "steam-ticket"
    });
    const result = await client.createAuthSessionTicket(steamConfig.appId);
    updatePlayfabWarmupStatus({
      state: "warming",
      message: "Steam auth session ticket received. Logging into PlayFab.",
      playfabStage: "playfab-login"
    });
    return result.sessionTicket.toString("hex");
  } catch (sessionError) {
    if (steamConfig.ticketMode !== "both") {
      throw playfabServiceError(`Steam auth session ticket failed: ${sanitizeExternalError(sessionError.message)}`, 502, "steam-ticket");
    }

    console.warn("Steam auth session ticket failed, trying encrypted app ticket:", sessionError.message);
    try {
      updatePlayfabWarmupStatus({
        state: "warming",
        message: "Steam auth session ticket failed. Trying encrypted app ticket.",
        playfabStage: "steam-ticket"
      });
      const result = await client.createEncryptedAppTicket(steamConfig.appId);
      updatePlayfabWarmupStatus({
        state: "warming",
        message: "Encrypted Steam app ticket received. Logging into PlayFab.",
        playfabStage: "playfab-login"
      });
      return result.encryptedAppTicket.toString("hex");
    } catch (encryptedError) {
      throw playfabServiceError(
        `Steam ticket failed: session ticket: ${sanitizeExternalError(sessionError.message)}; encrypted ticket: ${sanitizeExternalError(encryptedError.message)}`,
        502,
        "steam-ticket"
      );
    }
  }
}

async function loginPlayfabWithSteam() {
  if (!playfabConfig.titleId) {
    throw Object.assign(new Error("PLAYFAB_TITLE_ID is required for Steam PlayFab lookup."), {
      statusCode: 503,
      playfabStage: "configuration"
    });
  }

  const steamTicket = await createSteamTicket();
  let response;
  try {
    response = await fetch(`https://${playfabConfig.titleId}.playfabapi.com/Client/LoginWithSteam`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: fetchTimeoutSignal(),
      body: JSON.stringify({
        TitleId: playfabConfig.titleId,
        SteamTicket: steamTicket,
        TicketIsServiceSpecific: steamConfig.ticketIsServiceSpecific,
        CreateAccount: steamConfig.createPlayfabAccount
      })
    });
  } catch (error) {
    throw playfabServiceError(`PlayFab Steam login request failed: ${error.message}`, 502, "playfab-login");
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.error) {
    const message = sanitizeExternalError(payload.errorMessage || payload.error || `PlayFab Steam login returned ${response.status}`);
    throw playfabServiceError(`PlayFab Steam login failed: ${message}`, response.status || 502, "playfab-login");
  }
  if (!payload.data?.SessionTicket) {
    throw playfabServiceError("PlayFab did not return a session ticket.", 502, "playfab-login");
  }

  updatePlayfabWarmupStatus({
    state: "warming",
    message: "PlayFab login succeeded.",
    playfabStage: "session-ready"
  });
  return {
    sessionTicket: payload.data.SessionTicket,
    expiresAt: Date.now() + playfabSessionMaxAgeMs()
  };
}

async function getPlayfabSessionTicket() {
  if (playfabConfig.sessionTicket) return playfabConfig.sessionTicket;

  if (cachedPlayfabSession?.sessionTicket && cachedPlayfabSession.expiresAt > Date.now() + 60000) {
    return cachedPlayfabSession.sessionTicket;
  }

  if (!hasSteamPlayfabConfig()) {
    throw playfabConfigError();
  }

  if (!playfabSessionPromise) {
    playfabSessionPromise = loginPlayfabWithSteam()
      .then((session) => {
        cachedPlayfabSession = session;
        return session.sessionTicket;
      })
      .finally(() => {
        playfabSessionPromise = null;
      });
  }

  return playfabSessionPromise;
}

function warmPlayfabSession() {
  if (hasReadyPlayfabSession()) return Promise.resolve(cachedPlayfabSession?.sessionTicket || playfabConfig.sessionTicket);
  if (playfabSessionPromise) return playfabSessionPromise;

  updatePlayfabWarmupStatus({
    state: "warming",
    message: "Steam/PlayFab login is warming up.",
    playfabStage: "session-warmup"
  });
  playfabSessionPromise = loginPlayfabWithSteam()
    .then((session) => {
      cachedPlayfabSession = session;
      updatePlayfabWarmupStatus({
        state: "ready",
        message: "Steam/PlayFab session is ready.",
        playfabStage: "session-ready"
      });
      return session.sessionTicket;
    })
    .catch((error) => {
      console.error("PlayFab warmup failed:", error.message);
      return updatePlayfabWarmupStatus({
        state: "failed",
        message: error.message,
        playfabStage: error.playfabStage || "session-warmup"
      });
    })
    .finally(() => {
      playfabSessionPromise = null;
    });

  return playfabSessionPromise;
}

async function fetchPlayfabProfile(playfabId) {
  if (!playfabConfig.titleId || (!playfabConfig.sessionTicket && !hasSteamPlayfabConfig())) {
    throw playfabConfigError();
  }

  const sessionTicket = await getPlayfabSessionTicket();
  let response;
  try {
    response = await fetch(`https://${playfabConfig.titleId}.playfabapi.com/Client/GetPlayerProfile`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Authorization": sessionTicket
      },
      signal: fetchTimeoutSignal(),
      body: JSON.stringify({
        PlayFabId: playfabId,
        ProfileConstraints: {
          ShowAvatarUrl: true,
          ShowDisplayName: true,
          ShowLastLogin: true
        }
      })
    });
  } catch (error) {
    throw playfabServiceError(`PlayFab profile request failed: ${error.message}`, 502, "playfab-profile");
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.error) {
    const message = sanitizeExternalError(payload.errorMessage || payload.error || `PlayFab returned ${response.status}`);
    throw playfabServiceError(`PlayFab profile lookup failed: ${message}`, response.status || 502, "playfab-profile");
  }

  return summarizePlayfabProfile(payload.data?.PlayerProfile, playfabId);
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function playfabNameSyncIntervalMs() {
  return Math.max(1, Number.isFinite(playfabConfig.autoNameSyncHours) ? playfabConfig.autoNameSyncHours : 24) * 60 * 60 * 1000;
}

function playfabNameSyncStartDelayMs() {
  return (
    Math.max(
      5,
      Number.isFinite(playfabConfig.autoNameSyncStartDelaySeconds) ? playfabConfig.autoNameSyncStartDelaySeconds : 60
    ) * 1000
  );
}

async function syncPlayfabNames() {
  if (playfabNameSyncRunning) {
    console.log("PlayFab name sync skipped because another sync is still running.");
    return { skipped: true, reason: "already-running" };
  }

  if (!playfabConfig.autoNameSync) {
    console.log("PlayFab name sync is disabled.");
    return { skipped: true, reason: "disabled" };
  }

  if (!playfabConfig.titleId || (!playfabConfig.sessionTicket && !hasSteamPlayfabConfig())) {
    console.log("PlayFab name sync skipped because PlayFab lookup is not configured.");
    return { skipped: true, reason: "not-configured" };
  }

  playfabNameSyncRunning = true;
  const summary = {
    checked: 0,
    updated: 0,
    skipped: 0,
    failed: 0
  };

  console.log("Starting PlayFab name sync.");
  try {
    for (const listType of listTypes) {
      const players = await readPlayers(listType.id);
      let changed = false;
      const nextPlayers = [];

      for (const player of players) {
        const playfabId = cleanPlayfabId(player.playfabId);
        if (!playfabId) {
          summary.skipped += 1;
          nextPlayers.push(player);
          continue;
        }

        summary.checked += 1;
        try {
          const profile = await fetchPlayfabProfile(playfabId);
          await writePlayfabCache(playfabId, profile);
          const playfabName = displayNameFromPlayfabProfile(profile, playfabId);
          if (playfabName && playfabName !== player.name) {
            nextPlayers.push(normalizePlayer({ ...player, name: playfabName }));
            changed = true;
            summary.updated += 1;
            console.log(`Updated ${player.name} to PlayFab name ${playfabName}.`);
          } else {
            nextPlayers.push(player);
          }
        } catch (error) {
          summary.failed += 1;
          nextPlayers.push(player);
          console.error(`PlayFab name sync failed for ${player.name || player.id}:`, error.message);
        }

        await sleep(750);
      }

      if (changed) {
        await writePlayers(nextPlayers, listType.id);
      }
    }
  } finally {
    playfabNameSyncRunning = false;
    console.log(
      `PlayFab name sync finished. checked=${summary.checked} updated=${summary.updated} skipped=${summary.skipped} failed=${summary.failed}`
    );
  }

  return summary;
}

function startPlayfabNameSyncSchedule() {
  if (!playfabConfig.autoNameSync) return;

  const interval = playfabNameSyncIntervalMs();
  const run = () => {
    syncPlayfabNames().catch((error) => {
      console.error("PlayFab name sync failed:", error);
    });
  };

  setTimeout(run, playfabNameSyncStartDelayMs());
  setInterval(run, interval);
  console.log(`PlayFab name sync scheduled every ${Math.round(interval / 60 / 60 / 1000)} hour(s).`);
}

async function fetchPlayfabLeaderboard(statisticName, playfabId) {
  const sessionTicket = await getPlayfabSessionTicket();
  let response;
  try {
    response = await fetch(`https://${playfabConfig.titleId}.playfabapi.com/Client/GetLeaderboard`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Authorization": sessionTicket
      },
      signal: fetchTimeoutSignal(),
      body: JSON.stringify({
        StatisticName: statisticName,
        StartPosition: 0,
        MaxResultsCount: 100,
        ProfileConstraints: {
          ShowDisplayName: true,
          ShowLastLogin: true,
          ShowAvatarUrl: true
        }
      })
    });
  } catch (error) {
    throw playfabServiceError(`Leaderboard request failed: ${error.message}`, 502, "playfab-leaderboard");
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.error) {
    const message = sanitizeExternalError(payload.errorMessage || payload.error || `PlayFab returned ${response.status}`);
    throw playfabServiceError(message, response.status || 502, "playfab-leaderboard");
  }

  const leaderboard = Array.isArray(payload.data?.Leaderboard) ? payload.data.Leaderboard : [];
  const targetId = playfabId.toUpperCase();
  return {
    statisticName,
    request: {
      endpoint: "Client/GetLeaderboard",
      statisticName,
      startPosition: 0,
      maxResultsCount: 100
    },
    totalReturned: leaderboard.length,
    version: payload.data?.Version,
    nextReset: payload.data?.NextReset || "",
    match:
      leaderboard.find((entry) => String(entry.PlayFabId || "").toUpperCase() === targetId) || null,
    sample: leaderboard.slice(0, 10).map(summarizeLeaderboardEntry)
  };
}

async function fetchPlayfabLeaderboardAroundPlayer(statisticName, playfabId) {
  const sessionTicket = await getPlayfabSessionTicket();
  let response;
  try {
    response = await fetch(`https://${playfabConfig.titleId}.playfabapi.com/Client/GetLeaderboardAroundPlayer`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Authorization": sessionTicket
      },
      signal: fetchTimeoutSignal(),
      body: JSON.stringify({
        StatisticName: statisticName,
        PlayFabId: playfabId,
        MaxResultsCount: 15,
        ProfileConstraints: {
          ShowDisplayName: true,
          ShowLastLogin: true,
          ShowAvatarUrl: true
        }
      })
    });
  } catch (error) {
    throw playfabServiceError(`Leaderboard around-player request failed: ${error.message}`, 502, "playfab-leaderboard-around-player");
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.error) {
    const message = sanitizeExternalError(payload.errorMessage || payload.error || `PlayFab returned ${response.status}`);
    throw playfabServiceError(message, response.status || 502, "playfab-leaderboard-around-player");
  }

  const leaderboard = Array.isArray(payload.data?.Leaderboard) ? payload.data.Leaderboard : [];
  const targetId = playfabId.toUpperCase();
  return {
    request: {
      endpoint: "Client/GetLeaderboardAroundPlayer",
      statisticName,
      playfabId,
      maxResultsCount: 15
    },
    totalReturned: leaderboard.length,
    version: payload.data?.Version,
    nextReset: payload.data?.NextReset || "",
    match:
      leaderboard.find((entry) => String(entry.PlayFabId || "").toUpperCase() === targetId) || null,
    sample: leaderboard.map(summarizeLeaderboardEntry)
  };
}

app.get("/api/config", (_request, response) => {
  response.json({ tiers, listTypes });
});

app.get("/api/playfab-status", requireAdmin, (_request, response) => {
  response.json(playfabConfigStatus());
});

app.post("/api/playfab-name-sync", requireAdmin, async (_request, response, next) => {
  try {
    const result = await syncPlayfabNames();
    response.json({ ok: true, result });
  } catch (error) {
    next(error);
  }
});

app.get("/api/playfab-leaderboards/:playfabId", requireAdmin, async (request, response, next) => {
  try {
    const playfabId = cleanPlayfabId(request.params.playfabId);
    if (!playfabId) {
      response.status(400).json({ error: "PlayFab ID is required." });
      return;
    }

    if (!hasReadyPlayfabSession()) {
      if (!hasSteamPlayfabConfig()) {
        throw playfabConfigError();
      }

      void warmPlayfabSession().catch(() => {});
      response.json({
        pending: true,
        playfabStage: "session-warmup",
        message: "Steam/PlayFab login is warming up. Try the leaderboard probe again shortly.",
        warmupStatus: playfabWarmupStatus
      });
      return;
    }

    const statNames = leaderboardStatNames().slice(0, 25);
    const results = [];
    for (const statisticName of statNames) {
      try {
        const result = await fetchPlayfabLeaderboard(statisticName, playfabId);
        if (result.totalReturned) {
          try {
            result.aroundPlayer = await fetchPlayfabLeaderboardAroundPlayer(statisticName, playfabId);
          } catch (error) {
            result.aroundPlayerError = error.message;
          }
        }
        results.push(result);
      } catch (error) {
        results.push({
          statisticName,
          error: error.message,
          playfabStage: error.playfabStage || "playfab-leaderboard"
        });
      }
    }

    response.json({
      playfabId,
      checkedAt: new Date().toISOString(),
      statNames,
      matches: results.filter((result) => result.match || result.aroundPlayer?.match),
      results
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/playfab/:playfabId", requireAdmin, async (request, response, next) => {
  try {
    const playfabId = cleanPlayfabId(request.params.playfabId);
    if (!playfabId) {
      response.status(400).json({ error: "PlayFab ID is required." });
      return;
    }

    const cached = await readPlayfabCache(playfabId);
    const forceRefresh = request.query.force === "1";
    if (!forceRefresh && isFreshPlayfabCache(cached)) {
      response.json({ source: "cache", ...cached });
      return;
    }

    if (!hasReadyPlayfabSession()) {
      if (!hasSteamPlayfabConfig()) {
        throw playfabConfigError();
      }

      if (playfabWarmupStatus.state === "failed") {
        const failedStatus = playfabWarmupStatus;
        updatePlayfabWarmupStatus({
          state: "idle",
          message: "Previous warmup failure was reported. Next fetch will retry.",
          playfabStage: "session-warmup"
        });
        response.json({
          failed: true,
          error: failedStatus.message || "Steam/PlayFab warmup failed.",
          playfabStage: failedStatus.playfabStage || "session-warmup",
          warmupStatus: failedStatus
        });
        return;
      }

      void warmPlayfabSession().catch(() => {});
      response.json({
        pending: true,
        playfabStage: "session-warmup",
        message:
          playfabWarmupStatus.state === "warming"
            ? `${playfabWarmupStatus.message || "Steam/PlayFab login is still warming up."} Wait another minute, then click Fetch PlayFab again.`
            : "Steam/PlayFab login is warming up. Wait about 2 minutes, then click Fetch PlayFab again.",
        warmupStatus: playfabWarmupStatus
      });
      return;
    }

    try {
      const profile = await fetchPlayfabProfile(playfabId);
      response.json({ source: "playfab", ...(await writePlayfabCache(playfabId, profile)) });
    } catch (error) {
      if (cached) {
        response.json({ source: "stale-cache", warning: error.message, ...cached });
        return;
      }
      response.json({
        failed: true,
        error: error.message,
        playfabStage: error.playfabStage || "lookup",
        missingConfig: error.missingConfig || []
      });
    }
  } catch (error) {
    next(error);
  }
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

  if (
    !timingSafeEqualText(request.body?.username || "", adminUsername) ||
    !timingSafeEqualText(request.body?.password || "", adminPassword)
  ) {
    response.status(401).json({ error: "Wrong admin username or password." });
    return;
  }

  if (adminTotpSecret && !verifyTotp(request.body?.mfaCode, adminTotpSecret)) {
    response.status(401).json({ error: "Wrong MFA code." });
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
      tier: normalizePublicSubmissionTier(request.body?.tier),
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
        tier: normalizePublicSubmissionTier(request.body?.tier),
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

app.use((error, request, response, _next) => {
  console.error(error);
  if (request.path.startsWith("/api/playfab")) {
    response.status(error.statusCode || 502).json({
      error: error.message || "PlayFab request failed.",
      playfabStage: error.playfabStage || "server",
      missingConfig: error.missingConfig || []
    });
    return;
  }

  response.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : "Server error." });
});

app.listen(port, () => {
  console.log(`Chiv2 tier list server running on port ${port}`);
  startPlayfabNameSyncSchedule();
});
