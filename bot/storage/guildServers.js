import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.resolve(__dirname, "..", "..", "data");
const guildServersFile = path.join(dataDir, "nitrado-guilds.json");
const encryptionSecret = process.env.BOT_ENCRYPTION_KEY || process.env.SESSION_SECRET || "";

export async function getGuildServer(guildId) {
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
