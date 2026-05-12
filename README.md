# Spice Haus

Slow-cooked Bhuna Gosht by the kilo — home kitchen in Sharjah, UAE.

Live site: https://rihanprobe.github.io/spice-haus/

## What's in here

- `index.html` — single-page site
- `css/style.css` — all styles (teal + cream + brass palette)
- `js/main.js` — order modal, WhatsApp + Google Sheets flow, 24-hour date rule
- `assets/` — logo, hero video/poster, dish photo
- `SETUP.md` — Google Apps Script + Sheets setup for receiving orders

## Stack

Static HTML/CSS/JS. No build step. Deploy with GitHub Pages or any static host.

## Local preview

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000

## Updating the order webhook

Edit `CONFIG.SHEETS_WEBHOOK_URL` in `js/main.js` after deploying the Apps Script.
