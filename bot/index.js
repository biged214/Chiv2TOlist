import { Client, Events, GatewayIntentBits } from "discord.js";
import { getBotConfig, hasRequiredBotConfig } from "./env.js";
import { handleServerCommand, handleServerComponentInteraction } from "./commands/server.js";
import { handleNitradoCommand, handleNitradoLinkModal } from "./commands/nitrado.js";
import { registerBotCommands } from "./registerCommands.js";
import { getGuildServerByAlias, getGuildServerStorageStatus } from "./storage/guildServers.js";

let discordClient;
const botStatus = {
  enabled: false,
  loggedIn: false,
  userTag: "",
  message: "Not started.",
  updatedAt: new Date().toISOString()
};

export async function startDiscordBot() {
  const config = getBotConfig();

  if (!hasRequiredBotConfig(config)) {
    setBotStatus({
      enabled: false,
      loggedIn: false,
      userTag: "",
      message: "Discord bot disabled. Set DISCORD_TOKEN and DISCORD_CLIENT_ID to enable it."
    });
    console.info("Discord bot disabled. Set DISCORD_TOKEN and DISCORD_CLIENT_ID to enable it.");
    return null;
  }

  if (discordClient) {
    return discordClient;
  }

  if (config.shouldRegisterCommands) {
    await registerBotCommands({
      token: config.discordToken,
      clientId: config.discordClientId,
      guildId: config.discordGuildId
    });
  }

  const client = new Client({
    intents: [GatewayIntentBits.Guilds]
  });

  client.once(Events.ClientReady, (readyClient) => {
    setBotStatus({
      enabled: true,
      loggedIn: true,
      userTag: readyClient.user.tag,
      message: "Discord bot is online."
    });
    console.info(`Discord bot logged in as ${readyClient.user.tag}.`);
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (interaction.isModalSubmit()) {
      if (interaction.customId === "nitrado_link_modal" || interaction.customId.startsWith("nitrado_link_modal:")) {
        await handleNitradoLinkModal(interaction);
      }
      return;
    }

    if (interaction.isStringSelectMenu() || interaction.isButton()) {
      const handled = await handleServerComponentInteraction(interaction, {
        allowedRoleIds: config.allowedRoleIds
      });
      if (handled) return;
    }

    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === "server") {
      await handleServerCommand(interaction, {
        getNitradoCredentials: (guildId, alias) => getNitradoCredentials(guildId, config, alias),
        allowedRoleIds: config.allowedRoleIds
      });
      return;
    }

    if (interaction.commandName === "nitrado") {
      await handleNitradoCommand(interaction);
    }
  });

  client.on(Events.Error, (error) => {
    setBotStatus({
      enabled: true,
      loggedIn: false,
      userTag: "",
      message: error.message || "Discord client error."
    });
    console.error("Discord client error:", error);
  });

  await client.login(config.discordToken);
  discordClient = client;
  return client;
}

export function getDiscordBotStatus() {
  return {
    ...botStatus,
    guildServerStorage: getGuildServerStorageStatus()
  };
}

function setBotStatus(nextStatus) {
  Object.assign(botStatus, nextStatus, {
    updatedAt: new Date().toISOString()
  });
}

async function getNitradoCredentials(guildId, config, alias = "") {
  if (guildId) {
    const linkedServer = await getGuildServerByAlias(guildId, alias);
    if (linkedServer) {
      if (linkedServer.needsAlias) return linkedServer;
      return {
        alias: linkedServer.alias || alias || "default",
        token: linkedServer.token,
        serviceId: linkedServer.serviceId
      };
    }
  }

  return {
    token: config.nitradoToken,
    serviceId: config.nitradoServiceId
  };
}
