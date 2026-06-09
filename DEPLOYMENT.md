# Getting The Site Live

This first version is a static website. That means it can go live quickly, but admin edits are still saved only in the browser where you make them.

For a public launch, use this version to show the tier list. For real admin control that updates the public site for everyone, the next build step is adding Supabase.

## Fastest Option: Netlify Drop

1. Go to `https://app.netlify.com/drop`.
2. Drag in `chiv2-to-tier-list-site.zip`.
3. Netlify gives you a live website link.
4. You can rename the site inside Netlify's site settings.

This is the easiest option when you are just getting started.

## Vercel Option

1. Create a GitHub repository for these files.
2. Go to `https://vercel.com/new`.
3. Import the GitHub repository.
4. Choose `Other` if Vercel asks for a framework.
5. Leave the build command blank.
6. Set the output directory to `.` if it asks.
7. Deploy.

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
- Hosting on Vercel or Netlify

That is the point where this changes from a local editable prototype into a proper live admin-managed website.
