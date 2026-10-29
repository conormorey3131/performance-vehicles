# Performance Vehicles

Website design preview for Performance Vehicles.

- Website: https://conormorey3131.github.io/performance-vehicles/
- Stock management: https://conormorey3131.github.io/performance-vehicles/admin.html
- Location: Railway Road, Kilmallock, Co. Limerick, V35 TH92, Ireland.

The public site includes the vehicle collection, search filters, saved favourites, prices when supplied, and a dark photo viewer with swipe navigation, thumbnails, zoom and slideshow controls. The sales email remains a placeholder.

## Manage cars

The public website does not link to stock management. Bookmark the admin address above. GitHub Pages serves the admin page publicly; authentication protects publishing, not viewing the page. The admin uses a GitHub publishing key rather than a separate website password.

Open **Stock management** to add a car, enter its description and euro price, upload and order photos, choose its cover and set its status. Drafts are stored on the current device. **Publish changes** saves the stock and new images to this repository; GitHub Pages then rebuilds the shared website.

Publishing requires a GitHub account with write access to this repository and a fine-grained personal access token restricted to **performance-vehicles**, with **Contents: Read and write**. The admin page links to GitHub's key-creation screen and explains these steps. The key is held in memory for the session and is never included in repository files or browser storage.

Existing showcase vehicles have no invented prices or specifications. New listings start as drafts. Enter and confirm the actual details before marking a car available. Draft cars are hidden from visitors; reserved and sold cars are labelled.

Concurrent stock changes are checked before publishing; a conflicting update requires reloading published stock. Uploaded images are optimised for the website. The website remains a review preview; connect performancevehicles.ie to production hosting before launch.

## Files

- `index.html`: page content and location
- `styles.css`: responsive page design
- `gallery.css`: vehicle viewer
- `inventory.js`: published vehicle records
- `app.js`: public catalogue, galleries, favourites and enquiries
- `admin.html`, `admin.css`, `admin.js`: stock management
- `admin-publisher.js`: authenticated repository publishing
- `assets/`: website images
