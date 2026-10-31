# Crown Work Dashboard

A single-page dashboard for daily and weekly Crown work:

- **Daily overview**: the day's events with times, venue and pax, who's working each one, and who's rostered on. Use ‹ / › to change day, or click any calendar day.
- **Calendar**: a month view. The **Shifts** view puts every loaded shift (start time, name, bar) on its day; **Events** shows the events instead. The "Next 7 days" list follows the same switch. Tick **Only mine** to see only your own shifts and events. After an import, the calendar jumps to the first date that was loaded.
- **4 empty add-on slots** for future features.

It's plain HTML/CSS/JS with no build step and no server. All data stays in your browser (localStorage). Nothing is uploaded anywhere.

## Getting your documents in

Click **📂 Load documents** (or drag files onto the page) and choose files from your **G: drive**. Google Drive for Desktop shows up as a normal drive, so you don't need any Google setup.

Supported files:

| Type | What it's used for |
| --- | --- |
| `.xlsx` / `.xls` / `.csv` | Function sheets / event lists, or rosters |
| `.pdf` | BEOs (Delphi event orders) |
| `.ics` | Calendar exports (Outlook / Google Calendar) |
| `.json` | `{ "events": [...], "shifts": [...] }` |

When you pick files, a **Review** window opens. It guesses what each sheet is and which columns hold the date, time, event, venue and staff. You can correct anything it got wrong, and the preview updates as you change it. It understands:

- **Event sheets**: one row per event. If a date appears only on the first row of a block, it carries down to the rows below. Times can be `18:00`, `6:30 PM`, `1800` or a range like `0800-1700`. Staff cells can hold several names (`Alex / Cedric`, `Jordan & Mia`).
- **Rosters, list format**: one row per shift (Name, Date, Start/End or a shift range).
- **Rosters, grid format**: names down the side and days across the top (`Mon 2/11`, …). Cells like `OFF`, `RDO` and `AL` are skipped.

Dates are read day-first (Australian format). If you load a file with the same name again (e.g. this week's updated roster), it **replaces** the old data from that file. Manage loaded files under **Documents**.

Set your name in **⚙︎ Settings** so your shifts and events are highlighted.

Example files to try are in `samples/`. **Documents → Load sample data** fills the dashboard with demo data.

### TL Sheet → bar team roster

Download the week's TL workbook (Excel for the web: *File → Create a Copy → Download a Copy*) and load it with **Load documents**. It's recognised automatically (`js/tl.js`):

- Only the **bar tabs** are read: `MON-BAR`, `FRI-BAR (1)` and so on. Every other tab is ignored.
- The **date** comes from the top-right cell (e.g. "Monday, October 26, 2026"). If that cell is empty, it uses the day in the tab name plus the week in the file name (`TL 26.10.2026-1.11.2026`).
- The **manager** comes from the MANAGER cell.
- Each staff row gives **Name**, **Start**, **Bar** and **Duties**. Duties is the event they're working. A row with blank Duties belongs to the same event as the row above (or the last event at that bar).
- Duties text on rows with no name becomes notes, attached by bar code ("AST - CLEAN & RESET FOR…").
- Staff whose Start says `REJ` or `Cancelled` are left out, and the review window lists them.
- Every staff member becomes a **shift on the calendar**.

Each week is stored separately. Re-importing the same week (including a re-download named `… (1).xlsx`) replaces that week only.

### BEOs → events

Load BEO PDFs (Delphi "Event Order") the same way (`js/beo.js`). Each BEO becomes an event titled with its **Booking Name**, showing:

- BEO name and number, and the Event Manager
- the main venue and guaranteed numbers
- the guest-facing time span (client access, crew catering and bump in/out are left out of the span)
- the full function table
- the **Beverage** section, with packages, prices and beverage notes

A revised BEO with the same BEO# replaces the earlier version.

**Matching:** on each day, bar staff from the TL sheet are attached to the BEO whose Booking Name matches their **Duties** text. The match ignores capitals, punctuation and "&"/"and", and allows small differences. A TL duty with no matching BEO still shows, tagged *TL only · no matching BEO*, so a name mismatch is easy to spot.

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
js/tl.js          TL workbook reader (bar tabs → shifts)
js/beo.js         BEO PDF reader (→ events)
js/drive.js       optional Google Drive picker
config.js         optional Google credentials
vendor/           SheetJS (xlsx) and PDF.js libraries, Apache-2.0
samples/          example files
```
