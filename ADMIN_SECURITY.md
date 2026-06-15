# Admin Security

Set these values in GoDaddy Secrets:

- `ADMIN_USERNAME`: Admin login username. If omitted, the app uses `admin`.
- `ADMIN_PASSWORD`: Admin login password. Use a long unique password.
- `SESSION_SECRET`: Long random string used to sign admin sessions.
- `ADMIN_TOTP_SECRET`: Optional MFA secret for authenticator apps.

## MFA setup

MFA is disabled unless `ADMIN_TOTP_SECRET` is set.

To enable MFA:

1. Generate a random base32 secret.
2. Add that secret to an authenticator app as a time-based one-time password account.
3. Save the same secret in GoDaddy as `ADMIN_TOTP_SECRET`.
4. Redeploy the site.
5. Log in with username, password, and the current 6-digit authenticator code.

The app accepts the current code plus one 30-second step before or after, which helps with small clock differences.
