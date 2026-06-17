import { getBotConfig } from "./env.js";
import { registerBotCommands } from "./registerCommands.js";

const config = getBotConfig();
const missing = [];

if (!config.discordToken) missing.push("DISCORD_TOKEN");
if (!config.discordClientId) missing.push("DISCORD_CLIENT_ID");

if (missing.length) {
  console.error(`Missing required env var(s): ${missing.join(", ")}`);
  process.exitCode = 1;
} else {
  try {
    await registerBotCommands({
      token: config.discordToken,
      clientId: config.discordClientId,
      guildId: config.discordGuildId
    });
  } catch (error) {
    if (error.status === 401) {
      console.error("Discord rejected DISCORD_TOKEN with 401 Unauthorized.");
      console.error("Use the Bot token from Discord Developer Portal > Bot > Token.");
      console.error("Do not use the Client Secret, Public Key, OAuth2 secret, or Application ID as DISCORD_TOKEN.");
    } else if (error.status === 403) {
      console.error("Discord rejected this request with 403 Forbidden.");
      console.error("Confirm DISCORD_CLIENT_ID belongs to the same app as DISCORD_TOKEN.");
    } else {
      console.error("Discord command registration failed:", error);
    }

    process.exitCode = 1;
  }
}
