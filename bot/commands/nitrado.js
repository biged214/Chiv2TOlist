import {
  ActionRowBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle
} from "discord.js";
import {
  deleteGuildServer,
  getGuildServer,
  getGuildServerStorageStatus,
  hasTokenEncryption,
  saveGuildServer
} from "../storage/guildServers.js";

export const nitradoCommand = new SlashCommandBuilder()
  .setName("nitrado")
  .setDescription("Link this Discord server to a Nitrado-hosted Chivalry 2 server.")
  .addSubcommand((subcommand) =>
    subcommand.setName("link").setDescription("Privately enter this server's Nitrado token and service ID.")
  )
  .addSubcommand((subcommand) =>
    subcommand.setName("info").setDescription("Show whether this Discord server is linked.")
  )
  .addSubcommand((subcommand) =>
    subcommand.setName("unlink").setDescription("Remove this Discord server's linked Nitrado credentials.")
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export async function handleNitradoCommand(interaction) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({
      content: "You need Manage Server permission to link or unlink a Nitrado server.",
      ephemeral: true
    });
    return;
  }

  const subcommand = interaction.options.getSubcommand();

  if (subcommand === "link") {
    await showLinkModal(interaction);
    return;
  }

  if (subcommand === "info") {
    await showLinkInfo(interaction);
    return;
  }

  if (subcommand === "unlink") {
    const deleted = await deleteGuildServer(interaction.guildId);
    await interaction.reply({
      content: deleted ? "This Discord server is no longer linked to Nitrado." : "No linked Nitrado server was found.",
      ephemeral: true
    });
  }
}

export async function handleNitradoLinkModal(interaction) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({
      content: "You need Manage Server permission to link a Nitrado server.",
      ephemeral: true
    });
    return;
  }

  const token = interaction.fields.getTextInputValue("nitrado_token").trim();
  const serviceId = interaction.fields.getTextInputValue("nitrado_service_id").trim();

  if (!token || !serviceId) {
    await interaction.reply({
      content: "Both the Nitrado token and service ID are required.",
      ephemeral: true
    });
    return;
  }

  if (!hasTokenEncryption()) {
    await interaction.reply({
      content: "Token storage is not enabled yet. Set BOT_ENCRYPTION_KEY in the app environment, restart, and try again.",
      ephemeral: true
    });
    return;
  }

  await saveGuildServer({
    guildId: interaction.guildId,
    serviceId,
    token,
    linkedBy: interaction.user.id
  });

  await interaction.reply({
    content: "Linked this Discord server to the Nitrado service. Try `/server status` next.",
    ephemeral: true
  });
}

function showLinkModal(interaction) {
  const modal = new ModalBuilder()
    .setCustomId("nitrado_link_modal")
    .setTitle("Link Nitrado Server");

  const tokenInput = new TextInputBuilder()
    .setCustomId("nitrado_token")
    .setLabel("Nitrado API token")
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const serviceInput = new TextInputBuilder()
    .setCustomId("nitrado_service_id")
    .setLabel("Nitrado service ID")
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  modal.addComponents(
    new ActionRowBuilder().addComponents(tokenInput),
    new ActionRowBuilder().addComponents(serviceInput)
  );

  return interaction.showModal(modal);
}

async function showLinkInfo(interaction) {
  const linked = await getGuildServer(interaction.guildId);

  if (!linked) {
    await interaction.reply({
      content: "This Discord server is not linked yet. Use `/nitrado link` to connect it.",
      ephemeral: true
    });
    return;
  }

  await interaction.reply({
    content: `This Discord server is linked to Nitrado service ID ${linked.serviceId}. Storage: ${getGuildServerStorageStatus().backend}.`,
    ephemeral: true
  });
}
