# Crown Work Dashboard

A single-page dashboard for daily and weekly Crown work:

The main page is a one-page summary made of small windows. Click a window to open its full view.

- **Today**: each event's name, the bar staff working it, and the time each person starts. Click it for the full day view: one row per event, with the event details (BEO, function times, beverage, after-event jobs) on the left and the people working it (plus any unfilled spots) on the right. Use ‹ / › to move between days.
- **Calendar**: just today and tomorrow. Click it for the **week view** (Mon–Sun, with ‹ / › to change week). It has a **Month** switch, and **Shifts / Events** and **Only mine** filters. Click a day in the calendar to open that day's full view.
- **Bar consumption**: this week's units used, beverage revenue, cost and cost %, plus the most-used products. Click it for the totals panel (see below).
- **3 empty add-on slots** for future features.

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

**Old data is cleared automatically.** Events and shifts dated more than **3 months** ago are removed from the dashboard's saved data. This happens when it opens, after each import, and at midnight, and keeps browser storage small. Change the period, or choose *Forever*, in **⚙︎ Settings**. Only the dashboard's own copy is cleared: TL Sheets, BEO PDFs and linked folders are never touched, and an old file isn't re-imported just because its events were cleared. To bring old events back, set a longer period and use **Re-read all** on the folder.

Example files to try are in `samples/`. **Documents → Load sample data** fills the dashboard with demo data.

### Linked folders (automatic)

Click **📁 Link folder** and choose a folder where TL Sheets or BEOs are saved. You can link several, e.g. the synced SharePoint TL folder and a folder you save BEOs into: **Documents → Link another folder**. Each folder has its own Re-read, Change folder and Unlink buttons. Sub-folders up to 6 levels deep are included, so link the top folder. From then on, the dashboard:

- loads every TL workbook and BEO PDF in the folder, skipping files untouched for more than 60 days on the first check
- checks every minute while it's open, and whenever you switch back to its tab. Any file whose saved time has changed is re-read, so edits to a TL workbook replace that week's shifts. A message names the files that were updated, and **Documents** shows each file's last-saved time.
- note that edits made in SharePoint reach the synced folder only once OneDrive has downloaded them, usually within a minute or a few. For quickest updates, right-click the synced folder → **Always keep on this device**.
- ignores Office lock files (`~$…`) and lists anything it couldn't use under **Documents → skipped**

**SharePoint:** open the document library in the browser and click **Sync** (or **Add shortcut to My files**). It then appears in File Explorer under *OneDrive - Crown Resorts*. Link that folder.

**Shortcuts (.url) don't work.** A folder of `.url` shortcuts only holds web addresses, and the browser can't open SharePoint files from them. The dashboard lists any shortcuts it finds under **Documents** and links to the SharePoint site they point to. Sync that site's library and link the synced folder instead.

This needs Microsoft Edge or Google Chrome. The browser may ask for permission again after it restarts: click **📁 Reconnect** in the header, or choose "Allow on every visit" when it asks.

**Which copy of a BEO is used:** if there are several copies of the same BEO (same BEO#), the one with the latest **"Created:"** time in its header is kept, wherever and whenever the files turn up. An older printout downloaded later is listed under *Older BEO copies (ignored)* and doesn't replace the newer one. Deleting the PDF afterwards doesn't remove it from the dashboard.

### Bar consumption workbooks → totals

Link the folder of daily consumption workbooks (e.g. `November/04.xlsm`) with **Documents → Link another folder**, or load one with **Load documents**. They're recognised by the "Banquet Consumption Report" blocks (`js/consumption.js`):

- **Each event tab:** the event details are read (BEO #, date, name, pax, room, event type, event / service manager, DM), plus every product used in each **bar block** (bar name, category, size, opening, transfer, closing, used, charge, cost).
- **The Total block:** gives each event's official beverage revenue, cost and cost %. These are the same figures as the workbook's Summary tab.
- **Every consumption area is read:** all four bar blocks on each event tab, both Menu Tasting blocks, and the Internal Cost Transfer tabs. A filled-in block with no bar name is listed as "Bar 1", "Bar 2"… by position.
- **Cross-check:** for each event, the units read from the bar blocks are compared with the workbook's own Total block. Any difference is flagged in the review window and the folder's file list.
- **Empty tabs** (Event 5…15 etc.) are skipped. A re-saved copy of the same day replaces the earlier one.
- **Big workbooks are slimmed first:** drawings, buttons and macros are left out, so a 5 MB / 48 MB-unpacked workbook reads in about a second (`js/slimzip.js`). The file itself isn't changed.

Click the **Bar consumption** window for the totals panel:

- **Period:** this/last week, this/last month, last 3 months, this/last financial year, this calendar year, everything, or custom dates.
- **Total by:** product, category, bar, event, day, month, financial year, event type, event manager, service manager or room.
- **Click a row** to filter to it and see its breakdown, e.g. Category → *Beer* → by product → *Peroni* → by event. Filters show as chips; × removes one.
- **Search** product, event or bar names. **Click a heading** to sort. **Export CSV** saves the current table.

Consumption data is kept in the browser's IndexedDB, separately from events. By default it keeps **this and last financial year** (1 July – 30 June). For example, on 6 Nov 2026 it keeps everything from 1 Jul 2025; on 1 Jul 2027 FY 2025–26 drops off. Other options are in ⚙︎ Settings: three financial years, 12 months, 2 years or forever. The totals panel has **This / Last financial year** periods and a **Financial year** grouping. The dashboard asks the browser to keep this data even when disk space runs low. Because the workbooks stay in their folder, **Re-read all** can always rebuild the totals.

### TL Sheet → bar team roster

Download the week's TL workbook (Excel for the web: *File → Create a Copy → Download a Copy*) and load it with **Load documents**. It's recognised automatically (`js/tl.js`):

- Only the **bar tabs** are read: `MON-BAR`, `FRI-BAR (1)` and so on. Every other tab is ignored.
- The **date** comes from the top-right cell (e.g. "Monday, October 26, 2026"). If that cell is empty, it uses the day in the tab name plus the week in the file name (`TL 26.10.2026-1.11.2026`).
- The **manager** comes from the MANAGER cell.
- **Bold Duties text is an event name.** Everyone listed below it, up to the next bold entry, works that event. The **Bar** column cross-checks this: a person whose bar belongs to an earlier event joins that one, and a bar with no event (e.g. `SET UP`) becomes its own team. Bold is read straight from the workbook's formatting (`js/xlsxfmt.js`). If formatting can't be read, event names are guessed and the review window says so.
- **The same event name written again** (on every row, further down the tab, or on another bar tab for the same day) continues that one event rather than starting a new one.
- **Non-bold Duties text is the team's after-event jobs** ("GB1 - CLEAN & RESET FOR LGPA COCKTAIL"). Lines on consecutive rows are joined into one job. A job starting with a bar code goes to that bar's event; otherwise it goes to the event it sits under. Jobs show under **After the event** on the event.
- **A row with a start time but no name** (the highlighted blanks) is an **unfilled spot**. Events show "⚠ 3 staff still needed (4:15pm CB)", the **On shift** list shows each one as a yellow **⚠ Unfilled** row (bar, event, start time), and the calendar shows a red "⚠ 3 missing" on that day.
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

**Matching:** on each day, bar staff from the TL sheet are attached to the BEO whose name best matches their **Duties** text (`js/match.js`). Small differences are allowed:

- Capitals, punctuation, "&"/"and" and possessives are ignored: *Phill's* reads as *Phill*.
- Small typos and short forms are accepted: *Phil* ↔ *Phill*, *Vic* ↔ *Victoria*.
- Extra words are fine: *REBECCA & PHIL WEDDING* matches *Rebecca & Phill's Wedding Reception*, and *PGA GALA DINNER* matches *(Inc) PGA Conference & Gala Dinner*.
- At least one name word must match, so two weddings on the same day aren't mixed up.
- The bar code is a tie-breaker: *AST3* ↔ *Astral 3*, *CB3* ↔ *Crown Ballroom 3*.
- Initials count: *RMHC* matches *Ronald McDonald House Charities*, and *LGPA* matches *Ladies Golf Professional Association*. Numbers such as the year don't count as a name match.
- Anyone listed on more than one event that day gets an **⚠ Also on: …** note in the day view.

A TL duty with no matching BEO still shows, tagged *TL only · no matching BEO*, with a picker to link it to one of that day's BEOs by hand. Matched events show which TL duty they came from, with a **change** link to correct or undo a match. Manual choices are remembered.

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
js/match.js       TL duty ↔ BEO name matching
js/consumption.js reads bar consumption workbooks
js/consui.js      bar consumption window + totals panel
js/slimzip.js     makes big .xlsx/.xlsm files quick to read
js/folder.js      linked-folder access (File System Access API)
js/drive.js       optional Google Drive picker
config.js         optional Google credentials
vendor/           SheetJS (xlsx) and PDF.js libraries, Apache-2.0
samples/          example files
```
