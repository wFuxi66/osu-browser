# Security

## Reporting a vulnerability

Please report security issues privately: on GitHub, open the **Security** tab of this repository and choose **Report a vulnerability**. Don't open a public issue for them.

Include what an attacker could do, the steps to reproduce it, and the deployment it affects (osu-browser.vercel.app or a self-hosted server).

## What's in scope

- The API (`server/`, `api/`): osu! and Google sign-in, the session and Drive cookies, the osu! API lookups and the mirror proxy.
- The web app: anything that runs script on the app's origin, reads another user's data, or reaches a user's Google Drive files.
- The userscript (`public/osu-browser.user.js`), which runs on osu.ppy.sh.

Beatmaps you open yourself are trusted as much as any file you open: a huge or broken `.osz` slowing down or crashing your own tab isn't a vulnerability.

## How the app is protected

See **Security headers** and **No database** in the README: a strict Content-Security-Policy, encrypted httpOnly cookies instead of a session store, and the `drive.file` scope so the app can only see the files it created in your Drive.
