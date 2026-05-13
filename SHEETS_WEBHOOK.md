# Spice Haus — Orders Sheet Webhook Setup

This wires your live website at https://spicehaus.org/ into the Google Sheet:
**Spice Haus Orders** — https://docs.google.com/spreadsheets/d/1mh5hU1TUyeTtMz58WT3b3SS8Wjlyt_s0vwp2NSJffww/edit

You only do this **once**. After that, every order placed on the site appears in the sheet automatically (in addition to opening WhatsApp).

---

## Step 1 — Open Apps Script

1. Go to https://script.google.com/
2. Click **New project** (top-left)
3. Delete the placeholder `function myFunction() {}` code

## Step 2 — Paste this script

```javascript
const SHEET_ID = '1mh5hU1TUyeTtMz58WT3b3SS8Wjlyt_s0vwp2NSJffww';
const SHEET_NAME = 'Orders';

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);
    sheet.appendRow([
      new Date(),
      data.name || '',
      data.phone || '',
      data.meat || '',
      data.pricePerKg || '',
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

function doGet() {
  return ContentService.createTextOutput('Spice Haus webhook is alive.');
}
```

## Step 3 — Name and save

- Top-left rename "Untitled project" to **Spice Haus Webhook**
- Press **Ctrl/Cmd + S** to save

## Step 4 — Deploy as Web App

1. Click **Deploy** (top right) → **New deployment**
2. Click the gear icon ⚙️ next to "Select type" → choose **Web app**
3. Fill in:
   - **Description:** `Spice Haus orders webhook`
   - **Execute as:** `Me (rihan.probe@gmail.com)`
   - **Who has access:** `Anyone`
4. Click **Deploy**
5. Google will ask for permissions — click **Authorize access**, choose your account, click **Advanced** → **Go to Spice Haus Webhook (unsafe)** → **Allow**
   (It says "unsafe" because Google hasn't verified your personal script — it's only your script writing to your own sheet.)
6. Copy the **Web app URL** — it looks like:
   `https://script.google.com/macros/s/AKfycb.../exec`

## Step 5 — Send me the URL

Paste the Web app URL back in chat. I'll:
- Put it in `CONFIG.SHEET_WEBHOOK_URL` inside `js/main.js`
- Commit and push to GitHub
- Run a real test order on spicehaus.org and show you the row appearing in your sheet

---

## When updating the script later

If you change the script, you need to deploy a **new version**:
- Deploy → **Manage deployments** → pencil icon → **Version** = New version → **Deploy**
- The URL stays the same.
