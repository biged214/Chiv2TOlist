# Getting The Site Live

This first version is a static website. That means it can go live quickly, but admin edits are still saved only in the browser where you make them.

For a public launch, use this version to show the tier list. For real admin control that updates the public site for everyone, the next build step is adding Supabase.

## GitHub Pages With GoDaddy

Your custom domain is:

`chivalrytierlist.com`

A `CNAME` file has already been added to this repository with that domain.

In GitHub:

1. Open `biged214/Chiv2TOlist`.
2. Go to Settings.
3. Go to Pages.
4. Set the source to deploy from the `main` branch and root folder.
5. Confirm the custom domain is `chivalrytierlist.com`.
6. After DNS finishes updating, turn on Enforce HTTPS if GitHub allows it.

In GoDaddy DNS, add these records for the root domain:

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

DNS updates can take a while. GitHub says they can take up to 24 hours.

## What To Do Before Sharing

1. Replace the demo players with your real first list.
2. Open the admin panel with `mason-order`.
3. Make your edits.
4. Use `Export Data` and save that data somewhere safe.
5. Ask me to make that exported data the site's default public list before you upload.

## Next Serious Upgrade

The next version should use:

- Supabase database
- Real admin login
- Public data that updates for everyone
- Hosting on GitHub Pages, Vercel, or Netlify

That is the point where this changes from a local editable prototype into a proper live admin-managed website.
