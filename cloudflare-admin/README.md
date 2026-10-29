# Protected Performance Vehicles admin

The public website stays on GitHub Pages. This separate Worker serves the stock editor and server-side publishing API only after Cloudflare Access has verified an approved email address. It does not implement a browser password or accept identity headers as authentication.

## Deployment prerequisites

1. Build the protected frontend into `public/`. Keep the server-only publisher library outside that directory. The Worker bundles `lib/admin-publisher.js`, which is copied from the existing repository publisher by the build script.
2. Deploy without an automatic custom domain, `workers.dev`, or preview URLs. This config intentionally declares no routes and makes every asset request run through the Worker first.
3. In Cloudflare, protect **all traffic for this Worker**, including production and previews, using a Worker-level Access application. Add an Allow policy for `conor@moreydigital.ie` and enable the **One-time PIN** identity provider. No broad domain-wide or Everyone allow rule is needed. The Worker independently checks the runtime identity against `ADMIN_EMAILS` and rejects requests if Access did not run.
4. Store a new fine-grained GitHub publishing key as the Worker secret `GITHUB_PUBLISH_TOKEN`. Restrict it to `conormorey3131/performance-vehicles` with Contents read/write. Do not put the key in configuration, source, browser storage, build output, or chat. No broad CLI credential should be copied into this secret.
5. Set `ADMIN_EMAILS` to a comma-separated list of approved email addresses, `PUBLIC_SITE_URL` to `https://performancevehicles.ie`, and optionally `ACCESS_AUD` to the exact Access application audience. The Access policy and Worker allowlist should agree.
6. Attach `admin.performancevehicles.ie` only after Access is configured. Replace the public GitHub Pages editor with a redirect to that protected address. Keep the original website's email DNS records intact.

Cloudflare's documented Worker-level Access supplies `ctx.access.getIdentity()`. The Worker deliberately has no fallback that trusts `Cf-Access-*` request headers. If that runtime identity is unavailable, it fails closed and the Access configuration must be corrected.

Changing the allowlist is the handover mechanism: approve the intended email in Access and in `ADMIN_EMAILS`, then remove access no longer needed. Users authenticate with a single-use code sent by Cloudflare; there is no website password to share or reset.

## Frontend contract

All requests are same-origin and use `credentials: 'same-origin'`. Responses are JSON unless they are private static assets or photo bytes. Nothing is cross-origin readable. All responses are private and `no-store`.

- `GET /api/session` → `{ authenticated: true, email, name, user: { email, name }, publicSiteURL, logoutURL, publishingReady }`. `logoutURL` is `/cdn-cgi/access/logout`. The session endpoint remains usable when the publishing secret has not yet been configured, with `publishingReady: false`.
- `GET /api/inventory` → `{ vehicles, sha }`, read live from the fixed GitHub repository.
- `POST /api/publish`, `Content-Type: application/json` → request `{ vehicles, uploads, expectedSha }`; response `{ vehicles, sha, commitSha, url }`. The response URL is the canonical public website. The browser must supply its own origin in the automatically generated `Origin` header. The Worker rejects missing/foreign origins and cross-site Fetch Metadata. JSON-only input and absent CORS support prevent form-based CSRF; no separate CSRF token is used.
- `GET`/`HEAD /assets/*` → read-only image proxy to `PUBLIC_SITE_URL`, after authentication. It does not forward cookies, Access headers, or the publishing key, and does not follow redirects. This keeps current relative image references and future `assets/uploads/*.jpg` references usable.
- Other `GET`/`HEAD` paths are served from protected `ASSETS`; `/` and `/admin.html` map to `/index.html`.

API errors have `{ error: { code, message } }`: 401 sign-in required, 403 unapproved identity/CSRF, 400 invalid stock, 409 conflict or interrupted publish verification, 413 size limit, 415 unsupported body format, 503 publishing/configuration not ready, and 502 an unavailable upstream. An unknown `/api/*` path is always 404; there is no arbitrary GitHub proxy.

Limits: 500 cars, 30 photographs per car, 30 new photos per update, 2 MB per prepared JPEG, and 24 MB for the complete streamed request. Browser photo preparation already resizes images to 1600 px. A listing can still use confirmed optional details and euro prices. Existing publisher validation and atomic Git commits remain in force. The 30-photo update cap also stays below the Workers Free external-subrequest limit with the publisher’s fixed API calls and recovery check. Large photo batches should be tested against the account’s CPU allowance; a paid plan must not be enabled without the owner’s approval.

## Verification

Run `npm test` after the server publisher has been copied by the build. Tests exercise missing/forged identity, wrong email/audience, private asset headers, credential isolation, API method restrictions, CSRF, streamed size enforcement, payload/photo validation, fixed-origin image proxying, and conflict/error handling. Production credentials or account mutations are not involved.

Before handover, verify signed-out requests to every admin route are challenged or denied, approved-email login succeeds, another email is denied, and the original GitHub Pages admin can no longer expose the editor. Verify server publishing with a reversible stock change after the restricted secret is configured.

Official references:

- [Cloudflare Access for Workers](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)
- [Worker-level Access and runtime identity](https://developers.cloudflare.com/changelog/post/2026-08-14-workers-access/)
- [Cloudflare email one-time PIN](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/)
