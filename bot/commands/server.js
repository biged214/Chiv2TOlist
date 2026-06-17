import {
  PermissionFlagsBits,
  SlashCommandBuilder
} from "discord.js";
import { NitradoClient } from "../nitrado/client.js";

const commandChoices = [
  { name: "Status", value: "status" },
  { name: "Start", value: "start" },
  { name: "Stop", value: "stop" },
  { name: "Restart", value: "restart" }
];

export const serverCommand = new SlashCommandBuilder()
  .setName("server")
  .setDescription("Control the linked Chivalry 2 Nitrado server.")
  .addStringOption((option) =>
    option
      .setName("action")
      .setDescription("The server action to run.")
      .setRequired(true)
      .addChoices(...commandChoices)
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

  const action = interaction.options.getString("action", true);
  await interaction.deferReply({ ephemeral: true });

  try {
    const credentials = await getNitradoCredentials(interaction.guildId);
    if (!credentials?.token || !credentials?.serviceId) {
      await interaction.editReply("This Discord server is not linked yet. Ask a server admin to run `/nitrado link`.");
      return;
    }

    const nitradoClient = new NitradoClient(credentials);

    if (action === "status") {
      const server = await nitradoClient.getGameserver();
      await interaction.editReply(formatStatus(server));
      return;
    }

    const result = await runServerAction(action, nitradoClient);
    await interaction.editReply(`Done: ${result.message}`);
  } catch (error) {
    console.error(`Discord /server ${action} failed:`, error);
    await interaction.editReply(formatNitradoError(error));
  }
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

async function runServerAction(action, nitradoClient) {
  if (action === "start") {
    const server = await nitradoClient.getGameserver();
    if (isStarted(server.status)) {
      return {
        action,
        ok: true,
        message: `Server is already ${server.status}.`
      };
    }
    return nitradoClient.startGameserver();
  }
  if (action === "stop") return nitradoClient.stopGameserver();
  if (action === "restart") return nitradoClient.restartGameserver();
  throw new Error(`Unknown server action: ${action}`);
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

function isStarted(status) {
  return ["started", "running", "online"].includes(String(status || "").toLowerCase());
}

function formatNitradoError(error) {
  const message = error.message || "Unknown error.";

  if (message.toLowerCase().includes("permission scope service missing")) {
    return [
      "Nitrado request failed: the API token is missing the service permission scope.",
      "Create or update the Nitrado API token with service/gameserver access, then update NITRADO_TOKEN and restart the app."
    ].join("\n");
  }

  if (message.toLowerCase().includes("selected service has not been found")) {
    return [
      "Nitrado request failed: the configured NITRADO_SERVICE_ID was not found for this token.",
      "Run `npm run nitrado:services` locally with the same NITRADO_TOKEN, copy the correct service id, then restart the app."
    ].join("\n");
  }

  if (message.toLowerCase() === "not found") {
    return [
      "Nitrado request failed: Not Found.",
      "If this was `start`, the server may already be started or Nitrado may not expose a start action for this service state."
    ].join("\n");
  }

  return `Nitrado request failed: ${message}`;
}
