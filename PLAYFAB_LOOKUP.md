# Admin PlayFab Lookup

The admin review queue has a `Fetch PlayFab` button for submissions and update requests that include a PlayFab ID.

The lookup is server-side only and requires admin login. Nothing is exposed on public player cards.

## Environment Variables

Set these in GoDaddy when you are ready to enable live PlayFab lookups:

- `PLAYFAB_TITLE_ID`: Chivalry 2's PlayFab title ID.
- `CHIVALRY2_STEAM_APP_ID`: Steam app ID for Chivalry 2. Defaults to `1824220` if omitted.
- `STEAM_USERNAME`: Dedicated Steam bot account username.
- `STEAM_PASSWORD`: Dedicated Steam bot account password.
- `STEAM_SHARED_SECRET`: Steam Guard mobile `shared_secret` from the bot account authenticator.
- `STEAM_REFRESH_TOKEN`: Optional. After a successful local username/password login, the server can print a refresh token in non-production logs. Save it as a GoDaddy secret to make future hosted Steam logins more reliable.
- `PLAYFAB_STEAM_TICKET_MODE`: Optional. Defaults to `session`, which uses Steam auth session tickets. Use `encrypted` only if the PlayFab exchange specifically requires encrypted app tickets. Use `both` to try session first, then encrypted only if the Steam session ticket request fails.
- `PLAYFAB_SESSION_TICKET`: Optional manual fallback. If set, the server uses this directly instead of logging into Steam.
- `PLAYFAB_CACHE_MINUTES`: Optional cache duration. Defaults to `360`.
- `PLAYFAB_SESSION_MINUTES`: Optional in-memory PlayFab session duration. Defaults to `120`.

If these are not configured, the button will show a setup error instead of breaking the site.

## How It Works

When an admin clicks `Fetch PlayFab`, the server:

1. Logs into a dedicated Steam account that owns Chivalry 2.
2. Gets a Steam app ticket for Chivalry 2.
3. Exchanges that ticket with `Client/LoginWithSteam` for a PlayFab session ticket.
4. Uses that PlayFab session ticket to call `Client/GetPlayerProfile`.
5. Caches player lookup results so repeated admin review checks do not spam the API.

Do not put Steam credentials, PlayFab tickets, or secret values in frontend code.
