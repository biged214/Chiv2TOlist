# Getting The Site Live

This version is a small Express app that serves the tier list and stores player data on the server.

Admin edits are no longer browser-local. They go through the server API and update `data/players.json` on the deployed app.

## GoDaddy Settings

If GoDaddy asks for build settings, use:

| Setting | Value |
| --- | --- |
| Install command | `npm install` |
| Build command | `npm run build` |
| Start command | `npm start` |
| Output directory | leave blank |

The build command only prints a message because this site does not need a bundler. GoDaddy starts the app with `server.js`.

## Admin Login

Set these environment variables in GoDaddy if the dashboard gives you an environment variable section:

| Variable | Purpose |
| --- | --- |
| `ADMIN_PASSWORD` | The password used to unlock admin controls |
| `SESSION_SECRET` | A long random phrase used to sign admin login cookies |

If `ADMIN_PASSWORD` is not set, the temporary default is `mason-order`. Change it before sharing admin access.

## GoDaddy Domain

Your custom domain is:

`chivalrytierlist.com`

In GoDaddy DNS, use these records for the root domain:

| Type | Name | Value |
| --- | --- | --- |
| A | @ | 185.199.108.153 |
| A | @ | 185.199.109.153 |
| A | @ | 185.199.110.153 |
| A | @ | 185.199.111.153 |

For `www.chivalrytierlist.com`, add:

| Type | Name | Value |
| --- | --- | --- |
| CNAME | www | biged214.github.io |

DNS updates can take a while.

## Data Notes

The current data file is `data/players.json`. Back it up occasionally using the admin panel's Export Data button.

The next serious upgrade would be moving from this server-side JSON store to GoDaddy MySQL or Supabase so data is independent from deployments.
