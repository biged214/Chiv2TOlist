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
  getGuildServerStorageStatus,
  hasTokenEncryption,
  listGuildServers,
  saveGuildServer
} from "../storage/guildServers.js";

export const nitradoCommand = new SlashCommandBuilder()
  .setName("nitrado")
  .setDescription("Link this Discord server to a Nitrado-hosted Chivalry 2 server.")
  .addSubcommand((subcommand) =>
    subcommand
      .setName("link")
      .setDescription("Privately enter a Nitrado token and service ID.")
      .addStringOption((option) =>
        option
          .setName("alias")
          .setDescription("Short name for this server, such as main, duel, or practice.")
          .setMinLength(1)
          .setMaxLength(40)
          .setRequired(false)
      )
  )
  .addSubcommand((subcommand) =>
    subcommand.setName("info").setDescription("Show linked Nitrado servers for this Discord server.")
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("unlink")
      .setDescription("Remove linked Nitrado credentials.")
      .addStringOption((option) =>
        option
          .setName("alias")
          .setDescription("Server alias to remove. Leave empty to remove all linked servers.")
          .setMaxLength(40)
          .setRequired(false)
      )
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
    await showLinkModal(interaction, interaction.options.getString("alias") || "default");
    return;
  }

  if (subcommand === "info") {
    await showLinkInfo(interaction);
    return;
  }

  if (subcommand === "unlink") {
    const alias = interaction.options.getString("alias") || "";
    const deleted = await deleteGuildServer(interaction.guildId, alias);
    await interaction.reply({
      content: deleted
        ? alias
          ? `Removed linked Nitrado server \`${normalizeAlias(alias)}\`.`
          : "This Discord server is no longer linked to Nitrado."
        : "No matching linked Nitrado server was found.",
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
  const alias = modalAlias(interaction.customId);

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
    alias,
    serviceId,
    token,
    linkedBy: interaction.user.id
  });

  await interaction.reply({
    content: `Linked \`${alias}\` to Nitrado service ID ${serviceId}. Try \`/server status server:${alias}\` next.`,
    ephemeral: true
  });
}

function showLinkModal(interaction, alias) {
  const normalizedAlias = normalizeAlias(alias) || "default";
  const modal = new ModalBuilder()
    .setCustomId(`nitrado_link_modal:${normalizedAlias}`)
    .setTitle(`Link Nitrado: ${normalizedAlias}`);

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
  const linkedServers = await listGuildServers(interaction.guildId);

  if (!linkedServers.length) {
    await interaction.reply({
      content: "This Discord server is not linked yet. Use `/nitrado link` to connect it.",
      ephemeral: true
    });
    return;
  }

  const lines = linkedServers.map((server) => `\`${server.alias}\`: service ID ${server.serviceId}`);
  await interaction.reply({
    content: [`Linked Nitrado servers:`, ...lines, `Storage: ${getGuildServerStorageStatus().backend}.`].join("\n"),
    ephemeral: true
  });
}

function normalizeAlias(alias) {
  return String(alias || "default")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 40) || "default";
}

function modalAlias(customId) {
  const [, alias] = String(customId || "").split(":");
  return normalizeAlias(alias || "default");
}
