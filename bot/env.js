import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const booleanValues = new Set(["1", "true", "yes", "on"]);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envFilePath = path.resolve(__dirname, "..", ".env");

loadLocalEnvFile();

export function readEnv(name, fallback = "") {
  const value = process.env[name];
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

export function readOptionalEnv(...names) {
  for (const name of names) {
    const value = readEnv(name);
    if (value) return value;
  }
  return "";
}

export function isEnabled(name) {
  return booleanValues.has(readEnv(name).toLowerCase());
}

export function getBotConfig() {
  return {
    discordToken: readEnv("DISCORD_TOKEN"),
    discordClientId: readEnv("DISCORD_CLIENT_ID"),
    discordGuildId: readEnv("DISCORD_GUILD_ID"),
    allowedRoleIds: readEnv("DISCORD_ALLOWED_ROLE_IDS")
      .split(",")
      .map((roleId) => roleId.trim())
      .filter(Boolean),
    nitradoToken: readEnv("NITRADO_TOKEN"),
    nitradoServiceId: readOptionalEnv("NITRADO_SERVICE_ID", "CHIVALRY_NITRADO_SERVICE_ID"),
    shouldRegisterCommands: !isEnabled("DISCORD_SKIP_COMMAND_REGISTER")
  };
}

export function hasRequiredBotConfig(config) {
  return Boolean(config.discordToken && config.discordClientId);
}

function loadLocalEnvFile() {
  if (!fs.existsSync(envFilePath)) return;

  const lines = fs.readFileSync(envFilePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;

    const [key, ...valueParts] = trimmed.split("=");
    const name = key.trim();
    const value = unquote(valueParts.join("=").trim());

    if (name && process.env[name] === undefined) {
      process.env[name] = value;
    }
  }
}

function unquote(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}
