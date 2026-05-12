# Spice Haus — Setup Guide

You have two things to wire up before going live: your **WhatsApp number** and a **Google Sheet** to capture every order. Total time: ~5 minutes.

---

## 1. Add your WhatsApp number

Open `js/main.js` and edit the top of the file:

```js
const CONFIG = {
  // Replace with your real WhatsApp business number — digits only,
  // country code first, no '+', no spaces.
  // Example: '971501234567' for +971 50 123 4567
  WA_NUMBER: '971500000000',
  ...
};
```

If you skip this, every "Continue on WhatsApp" button will go to a fake number.

---

## 2. Create the Google Sheet

1. Go to <https://sheets.new> (signs you in to a new blank Sheet).
2. Rename it to **Spice Haus — Orders**.
3. In **Row 1**, paste these column headers (one per cell, left to right):

   ```
   Timestamp | Name | Phone | Meat | Price/kg (AED) | Quantity (kg) | Method | Address | Date | Notes | Total (AED)
   ```

4. Freeze row 1: **View → Freeze → 1 row**.

---

## 3. Add the Apps Script

1. In the same Sheet, click **Extensions → Apps Script**.
2. Delete any starter code in `Code.gs` and paste this in:

   ```js
   function doPost(e) {
     try {
       const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
       const data = JSON.parse(e.postData.contents);
       sheet.appendRow([
         new Date(),
         data.name || '',
         data.phone || '',
         data.meat || '',
         data.price_per_kg || '',
         data.quantity || '',
         data.method || '',
         data.address || '',
         data.date || '',
         data.notes || '',
         data.total || ''
       ]);
       return ContentService
         .createTextOutput(JSON.stringify({ ok: true }))
         .setMimeType(ContentService.MimeType.JSON);
     } catch (err) {
       return ContentService
         .createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
         .setMimeType(ContentService.MimeType.JSON);
     }
   }
   ```

3. Click the **floppy-disk save icon** (or Ctrl/Cmd+S). Name the project "Spice Haus Orders".

---

## 4. Deploy as a Web App

1. Top right of Apps Script editor → **Deploy → New deployment**.
2. Click the **gear icon** next to "Select type" → choose **Web app**.
3. Fill in:
   - **Description:** `Spice Haus order capture v1`
   - **Execute as:** **Me (your@email)**
   - **Who has access:** **Anyone**
4. Click **Deploy**.
5. Google will ask you to **Authorize access** — choose your account, click **Advanced → Go to Spice Haus Orders (unsafe)** (it says "unsafe" only because it's your own private script), then **Allow**.
6. Copy the **Web app URL** that appears. It looks like:

   ```
   https://script.google.com/macros/s/AKfycby...../exec
   ```

---

## 5. Paste the URL into your site

Open `js/main.js` and update:

```js
const CONFIG = {
  WA_NUMBER: '971501234567',
  SHEET_WEBHOOK_URL: 'https://script.google.com/macros/s/AKfycby...../exec',
  ...
};
```

Save the file.

---

## 6. Test the full flow

1. Open the site.
2. Click **Order Now**.
3. Fill in fake details, click **Continue on WhatsApp**.
4. ✓ A new row should appear in your Google Sheet within 1–2 seconds.
5. ✓ A WhatsApp chat to your number opens, with the order summary pre-filled.

If the row didn't appear:
- Open browser DevTools → Console. If you see a CORS error, that's fine — the request is sent with `mode: 'no-cors'` and the row will still post. Wait a few seconds and refresh the Sheet.
- Make sure the deployment access is set to **Anyone** (not "Anyone with Google account").

---

## 7. Push to GitHub for spicehaus.org

Once you've added your WhatsApp number and the Sheet URL:

```bash
cd /your/local/spice-haus-folder
git add .
git commit -m "Launch single-product Bhuna Gosht site"
git push
```

GitHub Pages / your hosting provider for `spicehaus.org` will pick it up.

---

## When you need to change something later

- **Price changed?** Edit `CONFIG.PRICES` in `js/main.js` (e.g. `{ Beef: 185, Mutton: 205 }`).
- **Need 48-hour notice instead of 24?** In `js/main.js`, find `applyDateMin()` and change the offset (`hour < CUTOFF_HOUR_DUBAI ? 1 : 2`) to `2 : 3`.
- **Want to change the cutoff hour?** Edit `CONFIG.CUTOFF_HOUR_DUBAI` (24-hour, Dubai time).
- **Updated the Apps Script?** You must redeploy: **Deploy → Manage deployments → pencil icon → Version: New version → Deploy**. The URL stays the same.
