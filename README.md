# Performance Vehicles

- Public website: https://performancevehicles.ie/
- Private stock management: https://admin.performancevehicles.ie/
- Location: Railway Road, Kilmallock, Co. Limerick, V35 TH92, Ireland.

The public showroom includes the vehicle collection, search filters, saved favourites, supplied prices and a dark photo viewer with swipe navigation, thumbnails, zoom and slideshow controls. Sales enquiries use sales@performancevehicles.ie.

## Manage cars

Bookmark the private stock-management address. Cloudflare Access sends a one-time sign-in code to an approved administrator’s email address. The Worker checks that identity and its own email allowlist before serving the editor, photographs or publishing API. The public `/admin.html` address forwards to this protected site.

After signing in, add or edit a car, enter its description and euro price, upload and order photographs, choose a cover and set its status. **Save draft** keeps changes on the current device. **Publish changes** saves the stock and photographs together; GitHub Pages then rebuilds the public showroom. The editor checks for concurrent stock changes before publishing.

Existing showcase vehicles have no invented prices or specifications. New listings start as drafts. Confirm their actual details before marking them available. Draft status hides a listing from the public catalogue; reserved and sold cars are labelled. Published inventory files and photographs are public, so listing fields should contain information intended for the public website.

Browser drafts belong to their hostname and device. Use **Download draft backup** and **Restore draft backup** to move saved work to another admin address or device.

## Admin access and handover

The current approved email is `conor@moreydigital.ie`. Configure that email in both the Cloudflare Access application’s Allow policy and the Worker’s comma-separated `ADMIN_EMAILS` setting. The application uses Cloudflare’s One-time PIN identity provider.

To hand over access, add the new administrator’s email to both settings, verify that they can sign in, and remove access no longer needed. Administrators use their own email codes; there is no shared website password to distribute. Signing out uses Cloudflare Access’s logout route.

Protect all traffic to the Worker. The deployment keeps `workers.dev` and preview URLs disabled. Its frontend is embedded directly in the Worker because the static-assets internal router does not propagate `ctx.access`. If verified runtime identity is missing, the Worker denies access.

## Configure publishing

Publishing credentials stay on the server. The private editor has no GitHub-key entry field.

1. Create a fine-grained GitHub personal access token for the `conormorey3131` resource owner. Select only the `performance-vehicles` repository and grant **Contents: Read and write**.
2. Save the token in Cloudflare Worker Settings as the encrypted secret **`GITHUB_PUBLISH_TOKEN`**. Keep it out of source files, browser storage, configuration files and chat.
3. Set **`PUBLIC_SITE_URL`** to `https://performancevehicles.ie` and configure the administrator allowlist as described above. If using **`ACCESS_AUD`**, copy the exact audience of the protected Access application.
4. Renew the publishing token before its chosen expiry date, then replace the Worker secret. Token lifetime depends on the expiry selected when creating it.
5. Verify an approved-email sign-in, signed-out access denial and a reversible stock update before handing over publishing access.

See [the protected-admin deployment guide](cloudflare-admin/README.md) for build commands, API details and request limits.

## Build the public website or ZIP

The GitHub Pages workflow builds and deploys only the allowlisted public showroom artifact:

```sh
node --test scripts/build-public-site.test.mjs
node scripts/build-public-site.mjs
```

The generated `dist-public/` contains the showroom, vehicle records, image assets, domain file and the private-admin redirect. The build excludes the protected Worker, editor code, server publisher, dependencies, credentials and setup documents. It recreates the artifact on every build so stale files cannot remain.

To create a public website ZIP from that artifact:

```sh
cd dist-public
zip -r ../performance-vehicles-public.zip .
```

## Source files

- `index.html`: page content and location
- `styles.css`, `gallery.css`: showroom and vehicle-viewer design
- `inventory.js`: published vehicle records
- `app.js`: public catalogue, galleries, favourites and enquiries
- `admin.html`: redirect to protected stock management
- `cloudflare-admin/frontend/`: private stock editor
- `cloudflare-admin/worker.mjs`: identity checks and server-side publishing API
- `cloudflare-admin/build.mjs`: direct Worker bundle and embedded frontend
- `admin-publisher.js`: GitHub publishing library bundled only into the protected Worker
- `scripts/build-public-site.mjs`: public artifact allowlist
- `assets/`: public website photographs
