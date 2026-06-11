# Admin PlayFab Lookup

The admin review queue has a `Fetch PlayFab` button for submissions and update requests that include a PlayFab ID.

The lookup is server-side only and requires admin login. Nothing is exposed on public player cards.

## Environment Variables

Set these in GoDaddy when you are ready to enable live PlayFab lookups:

- `PLAYFAB_TITLE_ID`: Chivalry 2's PlayFab title ID.
- `PLAYFAB_SESSION_TICKET`: A valid PlayFab client session ticket from the dedicated bot account flow.
- `PLAYFAB_CACHE_MINUTES`: Optional cache duration. Defaults to `360`.

If these are not configured, the button will show a setup error instead of breaking the site.

## Next Integration Step

The current code is ready to call PlayFab once a valid session ticket exists. The next piece is a server-side Steam bot login adapter that:

1. Logs into a dedicated Steam account that owns Chivalry 2.
2. Gets a Steam app/session ticket for Chivalry 2.
3. Exchanges that ticket for a PlayFab session ticket.
4. Stores or refreshes `PLAYFAB_SESSION_TICKET` server-side.

Do not put Steam credentials, PlayFab tickets, or secret values in frontend code.
