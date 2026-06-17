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
  if (hasDatabase()) return getGuildServerFromDatabase(guildId);

  const data = await readGuildServers();
  const record = data.guilds?.[guildId];
  if (!record) return null;

  return {
    guildId,
    serviceId: record.serviceId,
    token: decryptToken(record.token),
    linkedBy: record.linkedBy || "",
    linkedAt: record.linkedAt || ""
  };
}

export async function saveGuildServer({ guildId, serviceId, token, linkedBy }) {
  if (hasDatabase()) {
    await saveGuildServerToDatabase({ guildId, serviceId, token, linkedBy });
    return;
  }

  const data = await readGuildServers();
  data.guilds = data.guilds || {};
  data.guilds[guildId] = {
    serviceId,
    token: encryptToken(token),
    linkedBy,
    linkedAt: new Date().toISOString()
  };
  await writeGuildServers(data);
}

export async function deleteGuildServer(guildId) {
  if (hasDatabase()) return deleteGuildServerFromDatabase(guildId);

  const data = await readGuildServers();
  if (data.guilds?.[guildId]) {
    delete data.guilds[guildId];
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

async function getGuildServerFromDatabase(guildId) {
  return withDatabase(async (connection) => {
    await ensureGuildServersTable(connection);
    const [rows] = await connection.execute(
      "SELECT `guild_id`, `service_id`, `token_payload`, `linked_by`, `linked_at` FROM `nitrado_guild_servers` WHERE `guild_id` = ? LIMIT 1",
      [guildId]
    );

    if (!rows.length) return null;

    const row = rows[0];
    return {
      guildId: row.guild_id,
      serviceId: row.service_id,
      token: decryptToken(JSON.parse(row.token_payload)),
      linkedBy: row.linked_by || "",
      linkedAt: row.linked_at ? new Date(row.linked_at).toISOString() : ""
    };
  });
}

async function saveGuildServerToDatabase({ guildId, serviceId, token, linkedBy }) {
  const tokenPayload = JSON.stringify(encryptToken(token));

  return withDatabase(async (connection) => {
    await ensureGuildServersTable(connection);
    await connection.execute(
      `INSERT INTO \`nitrado_guild_servers\` (\`guild_id\`, \`service_id\`, \`token_payload\`, \`linked_by\`, \`linked_at\`)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON DUPLICATE KEY UPDATE
         \`service_id\` = VALUES(\`service_id\`),
         \`token_payload\` = VALUES(\`token_payload\`),
         \`linked_by\` = VALUES(\`linked_by\`),
         \`linked_at\` = CURRENT_TIMESTAMP`,
      [guildId, serviceId, tokenPayload, linkedBy || ""]
    );
  });
}

async function deleteGuildServerFromDatabase(guildId) {
  return withDatabase(async (connection) => {
    await ensureGuildServersTable(connection);
    const [result] = await connection.execute("DELETE FROM `nitrado_guild_servers` WHERE `guild_id` = ?", [guildId]);
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
      \`guild_id\` VARCHAR(32) PRIMARY KEY,
      \`service_id\` VARCHAR(64) NOT NULL,
      \`token_payload\` MEDIUMTEXT NOT NULL,
      \`linked_by\` VARCHAR(32) DEFAULT '',
      \`linked_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);
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
