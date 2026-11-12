# Crown Work Dashboard

A single-page dashboard for daily and weekly Crown work:

The main page is a one-page summary made of small windows. Click a window to open its full view.

- **Today**: each event's name, the bar staff working it, and the time each person starts. Click it for the full day view: one row per event, with the event details (BEO, function times, beverage, after-event jobs) on the left and the people working it (plus any unfilled spots) on the right. Use ‹ / › to move between days.
- **Hiding events that aren't yours:** each event in the full Today view has a **Hide** button, and hidden events stay off the Today window and calendar too. "N events hidden · Show" at the bottom of a day brings them back, where each can be unhidden. ⚙︎ Settings → **Hide BEO events with no bar staff on the TL sheet** does this automatically.
- **Calendar**: just today and tomorrow. Click it for the **week view** (Mon–Sun, with ‹ / › to change week). It has a **Month** switch, and **Shifts / Events** and **Only mine** filters. Click a day in the calendar to open that day's full view.
- **Bar consumption**: this week's units used, beverage total (the MICROS amount, inc GST), cost and cost %, plus the most-used products. Click it for the totals panel (see below).
- **Managers on today**: every manager working today from the Manager Allocation workbook, earliest start first, with their role, start time and the events under their name. Anyone on RDO or AL is listed on one "Off" line. Click it for the **week breakdown** (see below).
- **Closing a popup:** click ✕, press Esc, or click anywhere outside it on the dimmed dashboard. Import and ⚙︎ Settings only close with their buttons, so choices aren't lost.
- **On-consumption sheets**: today's and tomorrow's events with beverages on consumption. Click one (or the window) to make a printable check-off sheet for the bar team (see below).
- **1 empty add-on slot** for future features.

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

**Documents** shows each linked folder with a one-line summary, e.g. *45 loaded · 194 older BEO copies ignored*. The per-file lists are under **File details**, and every loaded document is under **All loaded documents**. PDFs that aren't BEOs (contracts, banquet checks) are noted once and not re-read on every check.

Click **📁 Link folder** and choose a folder where TL Sheets or BEOs are saved. You can link several, e.g. the synced SharePoint TL folder and a folder you save BEOs into: **Documents → Link another folder**. Each folder has its own Re-read, Change folder and Unlink buttons. Sub-folders up to 6 levels deep are included, so link the top folder. From then on, the dashboard:

- loads every TL workbook and BEO PDF in the folder, skipping files untouched for more than 60 days on the first check
- checks when the dashboard opens, then **on the hour, every hour** while it's open (e.g. 3:00, 4:00). **Check all now** in Documents checks straight away.
- only opens files that are **new or have been saved since the last check**. Unchanged files are skipped after a quick look at their saved time (taken 16 files at a time). When a dashboard update improves how one kind of file is read (TL Sheets, BEOs, consumption or manager allocations), only that kind is read again. Any file whose saved time has changed is re-read, so edits to a TL workbook replace that week's shifts. A message names the files that were updated, and **Documents** shows each file's last-saved time.
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
- **Beverage total (MICROS):** taken from the "Beverage/Corkage" line of each tab's revenue box (the MICROS column, inc GST), not the Ex GST column. Cost % is still worked on the ex GST figure, so it matches the workbook. Revenue per head uses the MICROS amount.
- **Every consumption area is read:** all four bar blocks on each event tab, both Menu Tasting blocks, and the Internal Cost Transfer tabs. A filled-in block with no bar name is listed as "Bar 1", "Bar 2"… by position.
- **Cross-check:** for each event, the units read from the bar blocks are compared with the workbook's own Total block. Any difference is flagged in the review window and the folder's file list.
- **Every event belongs to its report's day.** The day comes from the Summary date, checked against the file name ("05.xlsm" = the 5th). A tab whose own Date cell says a different day (a typo, or left over from a copied report) is put on the report's day. The difference is shown in the review window, the folder list and on flagged events ("its Date cell says …").
- Each report file is stored separately, so two reports can never overwrite each other. A re-saved copy of the same report ("05 (1).xlsm", "05 - Copy.xlsm") still replaces it.
- **Hidden tabs are skipped** in consumption workbooks and TL sheets (e.g. an old event tab left in a workbook copied from another day). The review window and the folder's file list name them.
- Flagged events show which file and tab they came from (e.g. *from 05.xlsm › RSM One Zone*).
- **Empty tabs** (Event 5…15 etc.) are skipped. A re-saved copy of the same day replaces the earlier one.
- **Big workbooks are slimmed first:** drawings, buttons and macros are left out, so a 5 MB / 48 MB-unpacked workbook reads in about a second (`js/slimzip.js`). The file itself isn't changed.

Click the **Bar consumption** window for the totals panel:

- **Period:** this/last week, this/last month, last 3 months, this/last financial year, this calendar year, everything, or custom dates.
- **Total by:** product, category, bar, event, day, month, financial year, event type, event manager, service manager or room.
- **Click a row** to filter to it and see its breakdown, e.g. Category → *Beer* → by product → *Peroni* → by event. Filters show as chips; × removes one.
- **Missing stock check:** the reverse case. Any event with beverage revenue but no beverages recorded in any bar section is flagged *⚠ no stock recorded* in the same places, with its own **Mark as OK** (shown as *✓ no stock needed*).
- **Missing revenue check:** any event that used stock but has no beverage revenue entered (a report that wasn't finished) is flagged. The flag shows in red at the top of the panel, with the date, BEO #, units, cost and **service manager**; with *⚠ no revenue entered* beside it in the table; and as a warning line in the main-page window. When the $0 is correct, e.g. the revenue is recorded on another event's tab for the same client, click **✓ Mark as OK** and add an optional note. Checked events stop warning, show *✓ revenue elsewhere* in the table, and are listed under *checked as OK* with your note and an **undo**. This is remembered in this browser by date, BEO # and event name, so re-reading the workbook doesn't bring the warning back.
- **Search** an event name, BEO #, room or manager to show those events, including events that used no stock. Or search a product, category or bar name. You can also search a date or year ("2025", "sept 2026", "12/09/2025"), and mix words: "udia 2025" shows only the 2025 UDIA. Dates in the table include the year. **Click a heading** to sort. **Export CSV** saves the current table.

**Faster checks on big folders:** linked folders only look at what can hold data being kept. With the default setting, that means from 1 July of last financial year.
- **Older folders aren't opened.** These are folders whose names show an earlier period, e.g. `2024`, `FY24`, `FY 2023-24`, `2024-2025`, `June 2025` or `2025/01 January`. They're listed under *Older folders skipped* in Documents. Folders with no date in their name, like *November* or *Week 45*, are always checked.
- **Files last saved before that date aren't read.** If one is edited later, it's picked up again.

The cut-off moves forward each 1 July and follows the *Keep bar consumption data for* setting. Choose *Forever* to look at everything.

Consumption data is kept in the browser's IndexedDB, separately from events. By default it keeps **this and last financial year** (1 July – 30 June). For example, on 6 Nov 2026 it keeps everything from 1 Jul 2025; on 1 Jul 2027 FY 2025–26 drops off. Other options are in ⚙︎ Settings: three financial years, 12 months, 2 years or forever. The totals panel has **This / Last financial year** periods and a **Financial year** grouping. The dashboard asks the browser to keep this data even when disk space runs low. Because the workbooks stay in their folder, **Re-read all** can always rebuild the totals.

### Manager Allocation workbooks → Managers on today

Link the folder that holds the weekly *Managers Allocation 09.11.26 - 15.11.26.xlsx* workbooks the same way as the others (📁 → **Link another folder**), or load one with 📂. They're recognised by their "… Manager Allocation" title above a Monday–Sunday row, wherever they sit in the folder.

- **Each manager:** the name in column A, with a start time (`900`, `1630`, `900 - 1700`) or **RDO / AL** under each day. The line below the name is their **role** (BSM, Asst Ops Mgr…). The lines below that, up to the next manager, are the **events and duties** for each day (PWC, Setup, Duty Manager…).
- **Section headings** (SERVICE, HIGH DUTIES, ADMINISTRATION) group the week view.
- **Hidden rows and columns are ignored**, as they're not part of the roster you see in Excel.
- **A visible line with times or duties but no name** is shown as *Name not filled in*. Template lines with no name and nobody working are left out.
- **Leave:** RDO, **SL** (sick leave), **AL** (annual leave), LSL and PH show in the week view and on the window's "Off" line, e.g. *Supuni (Sick leave)*. People on leave all week still show; tick **Hide managers who are off all week** to hide them.
- **Dates:** from the date row under Monday–Sunday, or from the file name if that's missing.
- **Click the window** to open the allocation on **today's roster**: everyone working, earliest start first, with their role and events, and who is off. ‹ / › move a day at a time, **Today** comes back.
- **Week** shows Mon–Sun for everyone, with today highlighted (‹ / › move a week). Your name (⚙︎ Settings → My name) is highlighted.
- **Person:** pick someone from the **Person** list, or click a name anywhere in the panel, to see just their roster for the week: each day's start time, events, RDOs and leave. ‹ / › move a week. Choose **Everyone** to go back.
- **Hiding people you don't need:** hover over someone in the Day or Week view and click **Hide** (or use *Hide from the Managers views* on their roster). They're left off the main-page window and the day and week views for every week, and "N hidden" shows at the bottom. Open **N people hidden** and click **Unhide** to bring someone back. Hidden people can still be picked from the **Person** list (marked *hidden*). This is remembered in this browser.
- **One allocation per week:** a re-saved or renamed copy of the same week replaces it. Weeks are cleared with the rest of the old data (⚙︎ Settings → keep months).

### Banquet Menu + BEOs → On-consumption sheets

Link the **Banquet Menu** folder (📁 → **Link another folder**). Each menu PDF (e.g. *EC Menu 2026 - Beer & Cider.pdf*) is read for its beverage items and the section they're under (AUSTRALIAN BEER, IMPORTED BEER, CIDER → *Beer & cider*). Prices are ignored. Menus are read however old they are, since they're valid for a year or more. A menu kept as a workbook with "menu" in its name works too.

The sheet is laid out like the ON CONSUMPTION form: **Event Name, Event Date, Bar Location, On consumption** time, then **Product | Consumption** with a line per item, a few blank lines for extras, and **Entered By / Checked By**.

- **Pick an event** (from today to two weeks ahead). The name, date, bar(s) from the TL Sheet (or the BEO room) and the on-consumption time are filled in. The time runs from the start of the on-consumption service (including pre-event drinks that are "included in beverage on consumption").
- **Items** come from the BEO's *Beverages on consumption* list (e.g. "Hahn Super Dry 3.5 @ $11.50 per bottle"), named as on the Banquet Menu and grouped into Sparkling, White wine, Rosé, Red wine, Beer & cider, Non-alcoholic, Soft drinks & juice, Spirits, Cocktails. "Assorted soft drinks and orange juice" becomes Pepsi, Pepsi Max, Soda, Lemonade, Solo, LLD and Orange Juice.
- **Add an item** by typing in the box (it suggests menu items and picks the section), then **Add**. Anything not on the menu can be typed in too. ✕ removes an item, and names and sections can be edited.
- **A separate sheet for each bar**: list the bars with commas and tick the box to print one page per bar.
- **Print** prints just the sheet(s), one A4 page each. Your changes are kept as a draft for that event; the window shows *✓ printed* once printed. **Start again from the BEO** throws the changes away.
- **New sheet (not linked to an event)** for anything that isn't on a BEO.

### TL Sheet → bar team roster

Download the week's TL workbook (Excel for the web: *File → Create a Copy → Download a Copy*) and load it with **Load documents**. It's recognised automatically (`js/tl.js`):

- Only the **bar tabs** are read: `MON-BAR`, `FRI-BAR (1)` and so on. Every other tab is ignored.
- The **date** comes from the top-right cell (e.g. "Monday, October 26, 2026"). If that cell is empty, it uses the day in the tab name plus the week in the file name (`TL 26.10.2026-1.11.2026`).
- The **manager** comes from the MANAGER cell.
- **Bold Duties text is an event name.** Everyone listed below it, up to the next bold entry, works that event. The **Bar** column cross-checks this: a person whose bar belongs to an earlier event joins that one, and a bar with no event (e.g. `SET UP`) becomes its own team. Bold is read straight from the workbook's formatting (`js/xlsxfmt.js`). If formatting can't be read, event names are guessed and the review window says so.
- **A date cell outside the workbook's own week** (e.g. a tab copied from last week whose date wasn't updated) is replaced by the day from the tab name plus the week in the file name. The review window warns when this happens.
- **Two TL files covering the same day** (e.g. an old copy of the week): only the most recently saved one is used for that day.
- TL-only entries in the day view show **"From <file> › <tab>"**, and matched events show it when you hover over the TL name, so an odd entry can be traced.
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
js/mgr.js         reads Manager Allocation workbooks
js/mgrui.js       Managers on today window + week panel
js/menu.js        reads Banquet Menus; BEO on-consumption items; name matching
js/onconui.js     On-consumption sheets window, builder and printing
js/slimzip.js     makes big .xlsx/.xlsm files quick to read
js/folder.js      linked-folder access (File System Access API)
js/drive.js       optional Google Drive picker
config.js         optional Google credentials
vendor/           SheetJS (xlsx) and PDF.js libraries, Apache-2.0
samples/          example files
```
