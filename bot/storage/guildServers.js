import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.resolve(__dirname, "..", "..", "data");
const guildServersFile = path.join(dataDir, "nitrado-guilds.json");
const encryptionSecret = process.env.BOT_ENCRYPTION_KEY || process.env.SESSION_SECRET || "";

export async function getGuildServer(guildId) {
  return getGuildServerByAlias(guildId, "");
}

export async function getGuildServerByAlias(guildId, alias = "") {
  if (hasDatabase()) return getGuildServerFromDatabase(guildId, alias);

  const data = await readGuildServers();
  const record = selectJsonGuildServer(data.guilds?.[guildId], alias);
  if (!record) return null;
  if (record.needsAlias) return record;

  return {
    guildId,
    alias: record.alias || normalizeAlias(alias) || "default",
    serviceId: record.serviceId,
    token: decryptToken(record.token),
    linkedBy: record.linkedBy || "",
    linkedAt: record.linkedAt || ""
  };
}

export async function listGuildServers(guildId) {
  if (hasDatabase()) return listGuildServersFromDatabase(guildId);

  const data = await readGuildServers();
  const guildRecord = data.guilds?.[guildId];
  if (!guildRecord) return [];

  if (guildRecord.servers) {
    return Object.entries(guildRecord.servers).map(([alias, record]) => ({
      guildId,
      alias,
      serviceId: record.serviceId,
      linkedBy: record.linkedBy || "",
      linkedAt: record.linkedAt || ""
    }));
  }

  return [
    {
      guildId,
      alias: "default",
      serviceId: guildRecord.serviceId,
      linkedBy: guildRecord.linkedBy || "",
      linkedAt: guildRecord.linkedAt || ""
    }
  ];
}

export async function saveGuildServer({ guildId, alias = "default", serviceId, token, linkedBy }) {
  if (hasDatabase()) {
    await saveGuildServerToDatabase({ guildId, alias, serviceId, token, linkedBy });
    return;
  }

  const data = await readGuildServers();
  data.guilds = data.guilds || {};
  const normalizedAlias = normalizeAlias(alias) || "default";
  const existingGuild = data.guilds[guildId] || {};
  const servers = existingGuild.servers || {};
  if (!existingGuild.servers && existingGuild.serviceId) {
    servers.default = {
      serviceId: existingGuild.serviceId,
      token: existingGuild.token,
      linkedBy: existingGuild.linkedBy || "",
      linkedAt: existingGuild.linkedAt || ""
    };
  }
  servers[normalizedAlias] = {
    alias: normalizedAlias,
    serviceId,
    token: encryptToken(token),
    linkedBy,
    linkedAt: new Date().toISOString()
  };
  data.guilds[guildId] = { servers };
  await writeGuildServers(data);
}

export async function deleteGuildServer(guildId, alias = "") {
  if (hasDatabase()) return deleteGuildServerFromDatabase(guildId, alias);

  const data = await readGuildServers();
  const normalizedAlias = normalizeAlias(alias);
  if (!normalizedAlias && data.guilds?.[guildId]) {
    delete data.guilds[guildId];
    await writeGuildServers(data);
    return true;
  }

  if (normalizedAlias && data.guilds?.[guildId]?.servers?.[normalizedAlias]) {
    delete data.guilds[guildId].servers[normalizedAlias];
    await writeGuildServers(data);
    return true;
  }
  return false;
}

export function hasTokenEncryption() {
  return Boolean(encryptionSecret);
}

export function getGuildServerStorageStatus() {
  const configuredVariables = [
    "MYSQL_URL",
    "DATABASE_URL",
    "MYSQLHOST",
    "MYSQLDATABASE",
    "MYSQLUSER",
    "DB_HOST",
    "DB_NAME",
    "DB_USER"
  ].filter((name) => Boolean(envValue(name)));

  return {
    backend: hasDatabase() ? "mysql" : "json",
    configuredVariables,
    jsonPath: hasDatabase() ? "" : guildServersFile
  };
}

async function readGuildServers() {
  try {
    const content = await fs.readFile(guildServersFile, "utf8");
    return JSON.parse(content);
  } catch (error) {
    if (error.code === "ENOENT") {
      return { guilds: {} };
    }
    throw error;
  }
}

async function writeGuildServers(data) {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(guildServersFile, `${JSON.stringify(data, null, 2)}\n`);
}

function encryptToken(token) {
  if (!encryptionSecret) {
    throw new Error("BOT_ENCRYPTION_KEY or SESSION_SECRET is required before storing Nitrado tokens.");
  }

  const iv = crypto.randomBytes(12);
  const key = crypto.createHash("sha256").update(encryptionSecret).digest();
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);

  return {
    mode: "aes-256-gcm",
    iv: iv.toString("base64url"),
    value: encrypted.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url")
  };
}

function decryptToken(tokenRecord) {
  if (!tokenRecord) return "";
  if (typeof tokenRecord === "string") return tokenRecord;
  if (tokenRecord.mode === "plain") return tokenRecord.value || "";
  if (tokenRecord.mode !== "aes-256-gcm") return "";

  const key = crypto.createHash("sha256").update(encryptionSecret).digest();
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(tokenRecord.iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tokenRecord.tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(tokenRecord.value, "base64url")),
    decipher.final()
  ]).toString("utf8");
}

function hasDatabase() {
  if (envValue("MYSQL_URL", "DATABASE_URL")) return true;

  return Boolean(
    envValue("DB_HOST", "MYSQLHOST") &&
      envValue("DB_NAME", "MYSQLDATABASE") &&
      envValue("DB_USER", "MYSQLUSER")
  );
}

async function getGuildServerFromDatabase(guildId, alias = "") {
  return withDatabase(async (connection) => {
    await ensureGuildServersTable(connection);
    const normalizedAlias = normalizeAlias(alias);
    const [rows] = normalizedAlias
      ? await connection.execute(
          "SELECT `guild_id`, `alias`, `service_id`, `token_payload`, `linked_by`, `linked_at` FROM `nitrado_guild_servers` WHERE `guild_id` = ? AND `alias` = ? LIMIT 1",
          [guildId, normalizedAlias]
        )
      : await connection.execute(
          "SELECT `guild_id`, `alias`, `service_id`, `token_payload`, `linked_by`, `linked_at` FROM `nitrado_guild_servers` WHERE `guild_id` = ? ORDER BY `alias` = 'default' DESC, `linked_at` ASC LIMIT 2",
          [guildId]
        );

    if (!rows.length) return null;
    if (!normalizedAlias && rows.length > 1) {
      return { needsAlias: true, choices: rows.map((row) => row.alias) };
    }

    const row = rows[0];
    return {
      guildId: row.guild_id,
      alias: row.alias || "default",
      serviceId: row.service_id,
      token: decryptToken(JSON.parse(row.token_payload)),
      linkedBy: row.linked_by || "",
      linkedAt: row.linked_at ? new Date(row.linked_at).toISOString() : ""
    };
  });
}

async function listGuildServersFromDatabase(guildId) {
  return withDatabase(async (connection) => {
    await ensureGuildServersTable(connection);
    const [rows] = await connection.execute(
      "SELECT `guild_id`, `alias`, `service_id`, `linked_by`, `linked_at` FROM `nitrado_guild_servers` WHERE `guild_id` = ? ORDER BY `alias` = 'default' DESC, `alias` ASC",
      [guildId]
    );

    return rows.map((row) => ({
      guildId: row.guild_id,
      alias: row.alias || "default",
      serviceId: row.service_id,
      linkedBy: row.linked_by || "",
      linkedAt: row.linked_at ? new Date(row.linked_at).toISOString() : ""
    }));
  });
}

async function saveGuildServerToDatabase({ guildId, alias = "default", serviceId, token, linkedBy }) {
  const tokenPayload = JSON.stringify(encryptToken(token));
  const normalizedAlias = normalizeAlias(alias) || "default";

  return withDatabase(async (connection) => {
    await ensureGuildServersTable(connection);
    await connection.execute(
      `INSERT INTO \`nitrado_guild_servers\` (\`guild_id\`, \`alias\`, \`service_id\`, \`token_payload\`, \`linked_by\`, \`linked_at\`)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON DUPLICATE KEY UPDATE
         \`service_id\` = VALUES(\`service_id\`),
         \`token_payload\` = VALUES(\`token_payload\`),
         \`linked_by\` = VALUES(\`linked_by\`),
         \`linked_at\` = CURRENT_TIMESTAMP`,
      [guildId, normalizedAlias, serviceId, tokenPayload, linkedBy || ""]
    );
  });
}

async function deleteGuildServerFromDatabase(guildId, alias = "") {
  return withDatabase(async (connection) => {
    await ensureGuildServersTable(connection);
    const normalizedAlias = normalizeAlias(alias);
    const [result] = normalizedAlias
      ? await connection.execute("DELETE FROM `nitrado_guild_servers` WHERE `guild_id` = ? AND `alias` = ?", [guildId, normalizedAlias])
      : await connection.execute("DELETE FROM `nitrado_guild_servers` WHERE `guild_id` = ?", [guildId]);
    return result.affectedRows > 0;
  });
}

async function withDatabase(callback) {
  const connection = await mysql.createConnection(databaseConfig());
  try {
    return await callback(connection);
  } finally {
    await connection.end();
  }
}

async function ensureGuildServersTable(connection) {
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS \`nitrado_guild_servers\` (
      \`guild_id\` VARCHAR(32) NOT NULL,
      \`alias\` VARCHAR(40) NOT NULL DEFAULT 'default',
      \`service_id\` VARCHAR(64) NOT NULL,
      \`token_payload\` MEDIUMTEXT NOT NULL,
      \`linked_by\` VARCHAR(32) DEFAULT '',
      \`linked_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (\`guild_id\`, \`alias\`)
    )
  `);
  await ensureGuildServerAliasColumn(connection);
}

function databaseConfig() {
  const url = envValue("MYSQL_URL", "DATABASE_URL");
  if (url) return databaseConfigFromUrl(url);

  return {
    host: envValue("DB_HOST", "MYSQLHOST"),
    port: Number(envValue("DB_PORT", "MYSQLPORT") || "3306"),
    user: envValue("DB_USER", "MYSQLUSER"),
    password: envValue("DB_PASSWORD", "MYSQLPASSWORD"),
    database: envValue("DB_NAME", "MYSQLDATABASE")
  };
}

function databaseConfigFromUrl(value) {
  const url = new URL(value);
  return {
    host: url.hostname,
    port: Number(url.port || "3306"),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, "")
  };
}

function envValue(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function normalizeAlias(alias) {
  return String(alias || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 40);
}

function selectJsonGuildServer(guildRecord, alias = "") {
  if (!guildRecord) return null;
  const normalizedAlias = normalizeAlias(alias);
  if (guildRecord.servers) {
    if (normalizedAlias) return guildRecord.servers[normalizedAlias] || null;
    const entries = Object.entries(guildRecord.servers);
    if (!entries.length) return null;
    if (entries.length > 1) {
      return { needsAlias: true, choices: entries.map(([entryAlias]) => entryAlias) };
    }
    const [entryAlias, record] = entries[0];
    return { ...record, alias: entryAlias };
  }
  return normalizedAlias && normalizedAlias !== "default" ? null : { ...guildRecord, alias: "default" };
}

async function ensureGuildServerAliasColumn(connection) {
  const [columns] = await connection.execute("SHOW COLUMNS FROM `nitrado_guild_servers`");
  const columnNames = new Set(columns.map((column) => column.Field));
  if (!columnNames.has("alias")) {
    await connection.execute("ALTER TABLE `nitrado_guild_servers` ADD COLUMN `alias` VARCHAR(40) NOT NULL DEFAULT 'default' AFTER `guild_id`");
  }

  const [keys] = await connection.execute("SHOW KEYS FROM `nitrado_guild_servers` WHERE `Key_name` = 'PRIMARY'");
  const primaryColumns = keys.map((key) => key.Column_name);
  if (primaryColumns.length === 1 && primaryColumns[0] === "guild_id") {
    await connection.execute("ALTER TABLE `nitrado_guild_servers` DROP PRIMARY KEY, ADD PRIMARY KEY (`guild_id`, `alias`)");
  }
}
