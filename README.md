# Performance Vehicles

- Public website: https://performancevehicles.ie/
- Private stock management: https://admin.performancevehicles.ie/
- Location: Railway Road, Kilmallock, Co. Limerick, V35 TH92, Ireland.

The public showroom includes the vehicle collection, search filters, saved favourites, supplied prices and a dark photo viewer with swipe navigation, thumbnails, zoom and slideshow controls. The website uses sales@performancevehicles.ie for sales enquiries.

The sales mailbox was created on Blacknight's Titan Email 5GB monthly plan on 2 November 2026. The domain's MX, SPF and DKIM records are configured in Cloudflare and verified by Titan. Sign in at https://app.titan.email/ using the full email address and the mailbox password chosen during setup. After setup or changes to mail settings, test sending and receiving a message and check the spam folder; DNS verification alone does not confirm delivery.

## Manage cars

Bookmark the private stock-management address. Cloudflare Access sends a one-time sign-in code to an approved administrator’s email address. The Worker checks that identity and its own email allowlist before serving the editor, photographs or publishing API. The public `/admin.html` address forwards to this protected site.

After signing in, add or edit a car, enter its description and price, upload and order photographs, choose a cover and set its status. **Save draft** keeps changes on the current device. **Publish changes** saves the stock and photographs together; GitHub Pages then rebuilds the public showroom. The editor checks for concurrent stock changes before publishing.

To add or change a price, open the car, select **GBP** for pounds or **EUR** for euro, untick **Price on request**, enter the amount, choose **Save draft**, then **Publish changes**. New cars default to pounds (£). The website shows each listing in its selected currency. Existing numeric euro prices retain their currency; no exchange-rate conversion is performed. To show “Price on request” again, retick the checkbox, save the draft and publish.

The current collection contains six cars offered for sale, with prices on request. New listings start as drafts. Confirm their actual details before marking them available. Draft status hides a listing from the public catalogue; reserved and sold cars are labelled. Published inventory files and photographs are public, so listing fields should contain information intended for the public website.

Browser drafts belong to their hostname and device. Use **Download draft backup** and **Restore draft backup** to move saved work to another admin address or device.

## Admin access and handover

The current approved email is `sales@performancevehicles.ie`. Configure that exact email in both the Cloudflare Access application’s Allow policy and the Worker’s comma-separated `ADMIN_EMAILS` setting. The application uses Cloudflare’s One-time PIN identity provider.

To hand over access, first add the new administrator’s email to both settings while keeping the existing administrator approved. Verify a fresh sign-in with the new email and confirm that the stock loads. Then remove the old email from both settings and verify that its previous session can no longer access the editor. Administrators use their own email codes; there is no shared website password to distribute. Signing out uses Cloudflare Access’s logout route.

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
