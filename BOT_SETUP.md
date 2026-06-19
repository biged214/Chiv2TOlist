# Discord Nitrado Bot Setup

The bot runs inside the same Node process as `chivalrytierlist.com`. No second domain is needed.

## Required Secrets

Set these in the hosting environment:

```text
DISCORD_TOKEN=your-discord-bot-token
DISCORD_CLIENT_ID=your-discord-application-client-id
BOT_ENCRYPTION_KEY=long-random-secret-used-to-encrypt-linked-nitrado-tokens
```

`DISCORD_GUILD_ID` is recommended while testing because guild commands update quickly. For the community version, remove `DISCORD_GUILD_ID` and run registration again so commands become global.

`NITRADO_TOKEN` and `NITRADO_SERVICE_ID` are now optional fallback values. Each Discord server can link one or more Nitrado servers with `/nitrado link`.

Do not change `BOT_ENCRYPTION_KEY` after users link servers. Existing encrypted Nitrado tokens depend on that key.

## Optional Secrets

```text
DISCORD_ALLOWED_ROLE_IDS=role_id_1,role_id_2
DISCORD_SKIP_COMMAND_REGISTER=true
```

Users with Discord's Manage Server permission can always use the bot. `DISCORD_ALLOWED_ROLE_IDS` lets extra roles use it too.

Use `DISCORD_SKIP_COMMAND_REGISTER=true` only if command registration is already done and you want startup to skip it.

## First Commands

The bot registers one slash command:

```text
/nitrado link
/nitrado info
/nitrado unlink
/server status server:main
/server restart server:main
/server stop server:main
/server rename name:New Name server:main
/server password mode:Set value:password server:main
/server password mode:Remove server:main
/server maxplayers count:8 server:main
```

Server admins should run `/nitrado link alias:main` first. It opens a private Discord form for the Nitrado API token and service ID. Then use `/server status server:main` to confirm the link.

Aliases let one Discord server manage multiple Nitrado services. Examples:

```text
/nitrado link alias:main
/nitrado link alias:duel
/nitrado link alias:practice
/nitrado info
/server status server:duel
/server restart server:practice
/nitrado unlink alias:duel
```

If only one Nitrado server is linked, `/server status` can be used without the `server` option. Once multiple servers are linked, use the `server` option to choose the alias.

Nitrado requires the game server to be offline before settings changes are applied. For rename, password, and max-player changes, use this flow:

```text
/server stop server:main
/server status server:main
/server password mode:Set value:password server:main
/server restart server:main
```

Wait for `/server status` to show stopped/offline before running the setting command.

`/nitrado link` requires `BOT_ENCRYPTION_KEY` or `SESSION_SECRET` to be set before it will save tokens.

The command appears only in the Discord server whose ID is set as `DISCORD_GUILD_ID`. It will not appear in DMs or in other Discord servers while guild-scoped testing is enabled.

## Register Commands Manually

The app registers commands automatically on startup when the Discord secrets are set. To force registration, run:

```powershell
npm run bot:register
```

Successful registration logs:

```text
Registered 2 Discord command(s) for guild YOUR_GUILD_ID.
```

If `DISCORD_GUILD_ID` is empty, registration uses global commands instead, which can take longer to appear in Discord.

## Troubleshooting

If `/server` or `/nitrado` does not appear in Discord's slash-command picker:

1. Confirm the bot was invited to that Discord server with both `bot` and `applications.commands` scopes.
2. Confirm `DISCORD_GUILD_ID` is the server ID for the Discord server where you are testing.
3. Restart the hosted Node app after setting secrets.
4. Check hosting logs for `Registered 1 Discord command(s)` and `Discord bot logged in as`.

If commands appear but never reply, the commands registered but the bot process is probably offline or crashed. Check hosting logs for `Discord bot failed to start` or `Discord client error`.

If `/server status` replies with `Permission scope service missing for this action`, the Discord bot is working and Nitrado rejected the token permissions. Create or update the Nitrado API token with service/gameserver access, then run `/nitrado link` again.

If `/server status` replies with `The selected service has not been found`, the token works but the service ID is wrong or belongs to a different Nitrado account. Run this locally with the same Nitrado token:

```powershell
npm run nitrado:services
```

Copy the matching `id=` value, run `/nitrado link` again, and try `/server status` again.

## Local Run

```powershell
npm install
npm start
```

If the Discord/Nitrado secrets are not set, the website still starts and the bot logs that it is disabled.
