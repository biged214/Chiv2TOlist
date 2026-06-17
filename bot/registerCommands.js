import { REST, Routes } from "discord.js";
import { serverCommand } from "./commands/server.js";
import { nitradoCommand } from "./commands/nitrado.js";

export const botCommands = [serverCommand, nitradoCommand];

export async function registerBotCommands({ token, clientId, guildId }) {
  const rest = new REST({ version: "10" }).setToken(token);
  const body = botCommands.map((command) => command.toJSON());

  if (guildId) {
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body });
    console.info(`Registered ${body.length} Discord command(s) for guild ${guildId}.`);
    return;
  }

  await rest.put(Routes.applicationCommands(clientId), { body });
  console.info(`Registered ${body.length} global Discord command(s).`);
}
