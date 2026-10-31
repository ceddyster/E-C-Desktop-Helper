# Crown Work Dashboard

A single-page dashboard for daily and weekly Crown work:

- **Daily overview**: the day's events with times, venue and pax, who's working each one, and who's rostered on. Use ‹ / › to change day, or click any calendar day.
- **Calendar**: a month view with your shifts and events, plus a "Next 7 days" list. Tick **Only mine** to see only the events you're on.
- **4 empty add-on slots** for future features.

It's plain HTML/CSS/JS with no build step and no server. All data stays in your browser (localStorage). Nothing is uploaded anywhere.

## Getting your documents in

Click **📂 Load documents** (or drag files onto the page) and choose files from your **G: drive**. Google Drive for Desktop shows up as a normal drive, so you don't need any Google setup.

Supported files:

| Type | What it's used for |
| --- | --- |
| `.xlsx` / `.xls` / `.csv` | Function sheets / event lists, or rosters |
| `.ics` | Calendar exports (Outlook / Google Calendar) |
| `.json` | `{ "events": [...], "shifts": [...] }` |

When you pick files, a **Review** window opens. It guesses what each sheet is and which columns hold the date, time, event, venue and staff. You can correct anything it got wrong, and the preview updates as you change it. It understands:

- **Event sheets**: one row per event. If a date appears only on the first row of a block, it carries down to the rows below. Times can be `18:00`, `6:30 PM`, `1800` or a range like `0800-1700`. Staff cells can hold several names (`Alex / Cedric`, `Jordan & Mia`).
- **Rosters, list format**: one row per shift (Name, Date, Start/End or a shift range).
- **Rosters, grid format**: names down the side and days across the top (`Mon 2/11`, …). Cells like `OFF`, `RDO` and `AL` are skipped.

Dates are read day-first (Australian format). If you load a file with the same name again (e.g. this week's updated roster), it **replaces** the old data from that file. Manage loaded files under **Documents**.

Set your name in **⚙︎ Settings** so your shifts and events are highlighted.

Example files to try are in `samples/`. **Documents → Load sample data** fills the dashboard with demo data.

### TL Sheet (SharePoint)

The **TL Sheet** card stores the SharePoint link. Paste it in, or choose the `.url` shortcut file. After that, **Open TL Sheet ↗** opens it in one click. To get its data into the dashboard, download a copy (Excel for the web: *File → Create a Copy → Download a Copy*) or pick the workbook from a synced SharePoint folder, then click **Import copy**. The main *Load documents* button recognises TL workbooks too.

How a TL workbook is read (`js/tl.js`):

- Only the **bar tabs** are read: `MON-BAR`, `FRI-BAR (1)` and so on. GB, Studio, Set Up, Off charges and other tabs are ignored.
- The **date** comes from the top-right cell (e.g. "Monday, October 26, 2026"). If that cell is empty, it uses the day in the tab name plus the week in the file name (`TL 26.10.2026-1.11.2026`).
- The **manager** comes from the MANAGER cell.
- Each staff row gives **Name**, **Start**, **Bar** and **Duties**. Duties is the event they're working. A row with a Bar but no Duties joins the event already running at that bar. `YOLMO, Momo` is shown as `Momo Yolmo`.
- Duties text on rows with no name becomes notes on the event. A note starting with a bar code (e.g. "AST - CLEAN & RESET FOR…") goes to that bar's event, and lines that follow are joined onto it.
- Staff whose Start says `REJ` or `Cancelled` are left out, and the review window lists them.
- Reading stops at the "Bar Hrs:" / "CLOSING DUTIES" footer.

Each week's workbook is kept separately. Re-importing the same week (including a re-download named `… (1).xlsx`) replaces that week only.

Reading SharePoint live would need a Microsoft 365 app registration approved by IT. It's a possible later step.

### Native Google Sheets

If a roster is a *native* Google Sheet, it appears on G: as a `.gsheet` shortcut, and the page can't read that. Either use **File → Download → Microsoft Excel** in Sheets and load the `.xlsx`, or set up the optional Drive button below.

## Optional: Google Drive button

Fill in `config.js` and a **☁️ Google Drive** button appears. It opens Google's file picker and can read native Google Sheets directly. It uses the `drive.file` permission, so the page can only read files you pick.

1. In Google Cloud Console, create a project and enable the **Google Picker API** and **Google Drive API**.
2. Under **Credentials**, create an **API key** and an **OAuth client ID** (type *Web application*). Add the dashboard's address (e.g. `https://<you>.github.io`) to *Authorised JavaScript origins*.
3. Put the key, the client ID and the project **number** into `config.js`.

Your work's Google Workspace admin may need to allow the app.

## Opening it on your work computer

- **GitHub Pages** (live at **https://ceddyster.github.io/E-C-Desktop-Helper/** once switched on): Repo → Settings → Pages → *Source: Deploy from a branch* → branch `claude/crown-work-dashboard-xylp3o`, folder `/ (root)` → Save. The first build takes a minute or two. The code is public, but your documents never leave your browser.
- **Or just open it locally**: download the repo as a ZIP and double-click `index.html`. Everything works offline because the spreadsheet library is bundled in `vendor/`.

## Files

```
index.html        page layout
styles.css        styling (light + dark mode)
js/parse.js       reads spreadsheets / CSV / ICS and guesses columns
js/app.js         dashboard, calendar, import review, storage
js/drive.js       optional Google Drive picker
config.js         optional Google credentials
vendor/           SheetJS (xlsx) library, Apache-2.0
samples/          example files
```
