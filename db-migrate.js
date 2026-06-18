import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";

loadLocalEnv();

const config = databaseConfig();
const missing = Object.entries(config)
  .filter(([key, value]) => key !== "port" && !value)
  .map(([key]) => key);

if (missing.length) {
  console.error(`Missing database config: ${missing.join(", ")}`);
  console.error("Set Railway MySQL variables or DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, and DB_NAME.");
  process.exitCode = 1;
} else {
  const connection = await mysql.createConnection(config);
  try {
    await migrate(connection);
    console.log("Database schema is ready.");
  } finally {
    await connection.end();
  }
}

async function migrate(connection) {
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
      \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX \`idx_players_list_type_sort\` (\`list_type\`, \`sort_order\`),
      INDEX \`idx_players_name\` (\`name\`)
    )
  `);

  await addMissingColumns(connection, "players", [
    ["list_type", "VARCHAR(40) NOT NULL DEFAULT 'team_objective' AFTER `id`"],
    ["region", "VARCHAR(24) DEFAULT '' AFTER `tier`"],
    ["role", "VARCHAR(28) DEFAULT '' AFTER `region`"],
    ["clan", "VARCHAR(28) DEFAULT '' AFTER `role`"],
    ["discord_username", "VARCHAR(64) DEFAULT '' AFTER `clan`"],
    ["playfab_id", "VARCHAR(64) DEFAULT '' AFTER `discord_username`"],
    ["notes", "VARCHAR(180) DEFAULT '' AFTER `playfab_id`"],
    ["sort_order", "INT NOT NULL DEFAULT 1 AFTER `notes`"],
    ["updated_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER `sort_order`"]
  ]);

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
      \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX \`idx_submissions_list_status\` (\`list_type\`, \`status\`),
      INDEX \`idx_submissions_created\` (\`created_at\`)
    )
  `);

  await addMissingColumns(connection, "submissions", [
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
  ]);

  await connection.execute(`
    CREATE TABLE IF NOT EXISTS \`regions\` (
      \`name\` VARCHAR(24) PRIMARY KEY,
      \`sort_order\` INT NOT NULL DEFAULT 1
    )
  `);

  await connection.execute(`
    CREATE TABLE IF NOT EXISTS \`playfab_cache\` (
      \`playfab_id\` VARCHAR(64) PRIMARY KEY,
      \`payload\` MEDIUMTEXT NOT NULL,
      \`fetched_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

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
  await ensureNitradoGuildServersAlias(connection);

  const [regions] = await connection.execute("SELECT COUNT(*) AS count FROM `regions`");
  if (!Number(regions[0]?.count)) {
    const defaultRegions = ["NA East", "NA Central", "NA West", "EU", "OCE", "SA", "SEA"];
    for (const [index, region] of defaultRegions.entries()) {
      await connection.execute("INSERT INTO `regions` (`name`, `sort_order`) VALUES (?, ?)", [region, index + 1]);
    }
  }
}

async function addMissingColumns(connection, table, columns) {
  const [existingColumns] = await connection.execute(`SHOW COLUMNS FROM \`${table}\``);
  const columnNames = new Set(existingColumns.map((column) => column.Field));

  for (const [name, definition] of columns) {
    if (!columnNames.has(name)) {
      await connection.execute(`ALTER TABLE \`${table}\` ADD COLUMN \`${name}\` ${definition}`);
    }
  }
}

async function ensureNitradoGuildServersAlias(connection) {
  await addMissingColumns(connection, "nitrado_guild_servers", [
    ["alias", "VARCHAR(40) NOT NULL DEFAULT 'default' AFTER `guild_id`"]
  ]);

  const [keys] = await connection.execute("SHOW KEYS FROM `nitrado_guild_servers` WHERE `Key_name` = 'PRIMARY'");
  const primaryColumns = keys.map((key) => key.Column_name);
  if (primaryColumns.length === 1 && primaryColumns[0] === "guild_id") {
    await connection.execute("ALTER TABLE `nitrado_guild_servers` DROP PRIMARY KEY, ADD PRIMARY KEY (`guild_id`, `alias`)");
  }
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

function loadLocalEnv() {
  const envPath = path.join(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;

  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;

    const [key, ...valueParts] = trimmed.split("=");
    const name = key.trim();
    const value = valueParts.join("=").trim().replace(/^['"]|['"]$/g, "");
    if (name && process.env[name] === undefined) {
      process.env[name] = value;
    }
  }
}
