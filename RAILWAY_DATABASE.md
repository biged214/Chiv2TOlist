# Railway Database Setup

Use this when moving `chivalrytierlist.com` to Railway without exporting old GoDaddy data.

## Create MySQL

1. Open the Railway project.
2. Click `+ New`.
3. Choose `Database`.
4. Choose `MySQL`.
5. Make sure the web app service can reference the MySQL service variables.

The app accepts Railway's default MySQL variables:

```text
MYSQLHOST
MYSQLPORT
MYSQLUSER
MYSQLPASSWORD
MYSQLDATABASE
MYSQL_URL
```

It also accepts the older variable names:

```text
DB_HOST
DB_PORT
DB_USER
DB_PASSWORD
DB_NAME
```

## Load Empty Schema

Run this against the Railway app environment:

```text
npm run db:migrate
```

This creates:

```text
players
submissions
regions
playfab_cache
nitrado_guild_servers
```

The migration seeds only the default region names. Player and submission data can be entered manually afterward.

## Seed Manually

After the migration:

1. Deploy/restart the web app.
2. Log into `/admin`.
3. Add players and regions manually.
4. Use `/nitrado link` in Discord servers to save their Nitrado connection.

Keep `BOT_ENCRYPTION_KEY` stable forever after users start linking Nitrado servers.
