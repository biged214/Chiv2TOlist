import { PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import { NitradoClient } from "../nitrado/client.js";

const commandTimeoutMs = 55000;

export const serverCommand = new SlashCommandBuilder()
  .setName("server")
  .setDescription("Control the linked Chivalry 2 Nitrado server.")
  .addSubcommand((subcommand) => withServerOption(subcommand.setName("status").setDescription("Show server status.")))
  .addSubcommand((subcommand) =>
    withServerOption(
      subcommand
        .setName("settings")
        .setDescription("Show editable Nitrado setting keys.")
        .addIntegerOption((option) =>
          option
            .setName("page")
            .setDescription("Settings page to show.")
            .setMinValue(1)
            .setMaxValue(10)
            .setRequired(false)
        )
      )
  )
  .addSubcommand((subcommand) =>
    withServerOption(
      subcommand
        .setName("files")
        .setDescription("List Nitrado file-server entries for troubleshooting.")
        .addStringOption((option) =>
          option
            .setName("path")
            .setDescription("Directory path to list, such as / or /games.")
            .setMaxLength(160)
            .setRequired(false)
        )
      )
  )
  .addSubcommand((subcommand) => withServerOption(subcommand.setName("filescan").setDescription("Scan common Nitrado file roots.")))
  .addSubcommand((subcommand) => withServerOption(subcommand.setName("debug").setDescription("Show safe Nitrado service fields for troubleshooting.")))
  .addSubcommand((subcommand) => withServerOption(subcommand.setName("restart").setDescription("Restart the server.")))
  .addSubcommand((subcommand) => withServerOption(subcommand.setName("stop").setDescription("Stop the server.")))
  .addSubcommand((subcommand) =>
    withServerOption(
      subcommand
        .setName("rename")
        .setDescription("Rename the server.")
        .addStringOption((option) =>
          option
            .setName("name")
            .setDescription("New server name.")
            .setMinLength(3)
            .setMaxLength(80)
            .setRequired(true)
        )
      )
  )
  .addSubcommand((subcommand) =>
    withServerOption(
      subcommand
        .setName("password")
        .setDescription("Set or remove the server password.")
        .addStringOption((option) =>
          option
            .setName("mode")
            .setDescription("Whether to set or remove the password.")
            .setRequired(true)
            .addChoices({ name: "Set", value: "set" }, { name: "Remove", value: "remove" })
        )
        .addStringOption((option) =>
          option
            .setName("value")
            .setDescription("Password to set. Leave empty when removing.")
            .setMinLength(1)
            .setMaxLength(64)
            .setRequired(false)
        )
      )
  )
  .addSubcommand((subcommand) =>
    withServerOption(
      subcommand
        .setName("maxplayers")
        .setDescription("Change the max player count.")
        .addIntegerOption((option) =>
          option
            .setName("count")
            .setDescription("Allowed player count.")
            .setMinValue(2)
            .setMaxValue(64)
            .setRequired(true)
        )
      )
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export async function handleServerCommand(interaction, { getNitradoCredentials, allowedRoleIds }) {
  if (!canControlServer(interaction, allowedRoleIds)) {
    await interaction.reply({
      content: "You need Manage Server permission or an allowed bot-control role to use this.",
      ephemeral: true
    });
    return;
  }

  const subcommand = interaction.options.getSubcommand();
  await interaction.deferReply({ ephemeral: true });

  try {
    const serverAlias = interaction.options.getString("server") || "";
    const credentials = await getNitradoCredentials(interaction.guildId, serverAlias);
    if (credentials?.needsAlias) {
      await interaction.editReply(`This Discord server has multiple linked Nitrado servers. Choose one with \`server:\`: ${credentials.choices.map((choice) => `\`${choice}\``).join(", ")}`);
      return;
    }

    if (!credentials?.token || !credentials?.serviceId) {
      await interaction.editReply(serverAlias ? `No linked Nitrado server found for \`${serverAlias}\`.` : "This Discord server is not linked yet. Ask a server admin to run `/nitrado link`.");
      return;
    }

    const nitradoClient = new NitradoClient(credentials);
    const result = await withCommandTimeout(runServerSubcommand(subcommand, interaction, nitradoClient));

    if (typeof result === "string") {
      await interaction.editReply(result);
      return;
    }

    await interaction.editReply(`Done: ${result.message}`);
  } catch (error) {
    console.error(`Discord /server ${subcommand} failed:`, error);
    await interaction.editReply(formatNitradoError(error));
  }
}

function withCommandTimeout(promise) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Nitrado command timed out before Discord could receive a result.")), commandTimeoutMs)
    )
  ]);
}

function withServerOption(subcommand) {
  return subcommand.addStringOption((option) =>
    option
      .setName("server")
      .setDescription("Linked server alias, such as main, duel, or practice.")
      .setMaxLength(40)
      .setRequired(false)
  );
}

function canControlServer(interaction, allowedRoleIds) {
  if (interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    return true;
  }

  if (!allowedRoleIds.length) {
    return false;
  }

  const memberRoles = interaction.member?.roles;
  if (Array.isArray(memberRoles)) {
    return memberRoles.some((roleId) => allowedRoleIds.includes(roleId));
  }

  return allowedRoleIds.some((roleId) => memberRoles?.cache?.has(roleId));
}

async function runServerSubcommand(subcommand, interaction, nitradoClient) {
  if (subcommand === "status") {
    const server = await nitradoClient.getGameserver();
    return formatStatus(server);
  }

  if (subcommand === "settings") {
    const settings = await nitradoClient.getGameserverSettings();
    return formatSettings(settings, interaction.options.getInteger("page") || 1);
  }

  if (subcommand === "files") {
    const path = interaction.options.getString("path") || "/";
    const result = await nitradoClient.listFiles(path);
    return formatFiles(path, result);
  }

  if (subcommand === "filescan") {
    const results = await nitradoClient.scanFileRoots();
    return formatFileScan(results);
  }

  if (subcommand === "debug") {
    const debug = await nitradoClient.getServiceDebug();
    return formatDebug(debug);
  }

  if (subcommand === "restart") return nitradoClient.restartGameserver();
  if (subcommand === "stop") return nitradoClient.stopGameserver();

  if (subcommand === "rename") {
    return nitradoClient.renameGameserver(interaction.options.getString("name", true));
  }

  if (subcommand === "password") {
    const mode = interaction.options.getString("mode", true);
    if (mode === "remove") return nitradoClient.removeGameserverPassword();

    const password = interaction.options.getString("value");
    if (!password) {
      return "Choose `mode:set` and provide `value` to set a password.";
    }

    return nitradoClient.setGameserverPassword(password);
  }

  if (subcommand === "maxplayers") {
    return nitradoClient.setGameserverMaxPlayers(interaction.options.getInteger("count", true));
  }

  throw new Error(`Unknown server subcommand: ${subcommand}`);
}

function formatStatus(server) {
  const playerText =
    server.players === undefined || server.maxPlayers === undefined
      ? "Unknown"
      : `${server.players}/${server.maxPlayers}`;
  const lines = [
    `Server: ${server.name}`,
    `Status: ${server.status}`,
    `Game: ${server.game}`,
    `Players: ${playerText}`
  ];

  if (server.map) lines.push(`Map: ${server.map}`);
  if (server.address) lines.push(`Address: ${server.address}`);

  return lines.join("\n");
}

function formatSettings(settings, page) {
  if (!settings.length) {
    return "Nitrado did not return editable setting keys for this server.";
  }

  const pageSize = 25;
  const pageCount = Math.max(1, Math.ceil(settings.length / pageSize));
  const currentPage = Math.min(Math.max(1, page), pageCount);
  const start = (currentPage - 1) * pageSize;
  const selected = settings.slice(start, start + pageSize);
  const lines = selected.map((setting) => {
    const value = maskSettingValue(setting.key, setting.value);
    const label = setting.label ? ` (${setting.label})` : "";
    return `${setting.key}${label}: ${value}`;
  });

  lines.push(`Showing page ${currentPage}/${pageCount}, entries ${start + 1}-${start + selected.length} of ${settings.length}.`);

  return lines.join("\n").slice(0, 1900);
}

function formatFiles(path, result) {
  const entries = result.entries || [];
  const displayPath = result.path || path;
  if (!entries.length) {
    const keys = result.rawKeys?.length ? ` Returned keys: ${result.rawKeys.join(", ")}.` : "";
    return `No file-server entries found for ${displayPath}.${keys}`;
  }

  const lines = [`Entries for ${displayPath}:`];
  for (const entry of entries.slice(0, 35)) {
    const type = entry.type === "dir" || entry.isDirectory ? "dir" : "file";
    lines.push(`${type}: ${entry.path || entry.name}`);
  }

  lines.push(`Showing ${Math.min(entries.length, 35)} of ${entries.length} entries.`);
  return lines.join("\n").slice(0, 1900);
}

function formatFileScan(results) {
  const lines = ["Nitrado file root scan:"];
  for (const result of results) {
    if (result.error) {
      lines.push(`${result.path}: error ${result.error}`);
      continue;
    }

    const sample = result.sample?.length ? ` (${result.sample.join(", ")})` : "";
    const keys = result.rawKeys?.length ? ` keys:${result.rawKeys.join(",")}` : "";
    lines.push(`${result.path}: ${result.count} entries${sample}${keys}`);
  }

  return lines.join("\n").slice(0, 1900);
}

function formatDebug(debug) {
  const lines = [`Service ID: ${debug.serviceId}`];
  lines.push("Service fields:");
  lines.push(...flattenDebug(debug.service).slice(0, 18));
  lines.push("Gameserver fields:");
  lines.push(...flattenDebug(debug.gameserver).slice(0, 22));
  return lines.join("\n").slice(0, 1900);
}

function flattenDebug(value, prefix = "", lines = []) {
  if (!value || typeof value !== "object" || lines.length >= 45) return lines;

  for (const [key, entryValue] of Object.entries(value)) {
    if (lines.length >= 45) break;
    const path = prefix ? `${prefix}.${key}` : key;
    if (entryValue && typeof entryValue === "object" && !Array.isArray(entryValue)) {
      flattenDebug(entryValue, path, lines);
      continue;
    }

    if (Array.isArray(entryValue)) {
      lines.push(`${path}: [${entryValue.length} items]`);
      continue;
    }

    if (entryValue !== undefined && entryValue !== null && entryValue !== "") {
      lines.push(`${path}: ${String(entryValue).slice(0, 80)}`);
    }
  }

  return lines;
}

function maskSettingValue(key, value) {
  if (String(key || "").toLowerCase().includes("password") || String(key || "").toLowerCase().includes("token")) {
    return value ? "[set]" : "[empty]";
  }

  if (value === undefined || value === null || value === "") return "[empty]";
  return String(value).slice(0, 80);
}

function formatNitradoError(error) {
  const message = error.message || "Unknown error.";

  if (message.toLowerCase().includes("permission scope service missing")) {
    return [
      "Nitrado request failed: the API token is missing the service permission scope.",
      "Create or update the Nitrado API token with service/gameserver access, then update the linked server token with `/nitrado link`."
    ].join("\n");
  }

  if (message.toLowerCase().includes("selected service has not been found")) {
    return [
      "Nitrado request failed: the configured Nitrado service ID was not found for this token.",
      "Run `/nitrado link` again with the correct token and service ID."
    ].join("\n");
  }

  if (message.toLowerCase() === "not found") {
    return "Nitrado request failed: Not Found. This action may not be available for this Chivalry 2 service state.";
  }

  if (message.toLowerCase().includes("http 429") || message.toLowerCase().includes("rate limit")) {
    return "Nitrado rate limited the bot. Wait 5-10 minutes, keep the server stopped, then try the command once more.";
  }

  if (message.toLowerCase().includes("timed out")) {
    return "Nitrado did not respond in time. Wait a minute, confirm the server is stopped, then try once more.";
  }

  if (message.toLowerCase().includes("public settings endpoint")) {
    return [
      "Nitrado did not apply the ServerPassword setting through the public settings endpoint.",
      "Password control is disabled until we map the correct Nitrado file/config API path."
    ].join("\n");
  }

  return `Nitrado request failed: ${message}`;
}
