# PDF Cover Cards

PDF Cover Cards shows a PDF page on a Bases card. Keep one note for each document, with a PDF link. The plugin draws page 1 as its cover. Pick another page with `#page=N`.

It uses core Bases to select, filter and sort notes, and the PDF reader of Obsidian to draw pages.

<img src="https://raw.githubusercontent.com/theluckystrike/pdf-cover-cards/HEAD/docs/pdf-cover-cards.gif" alt="A library base shown as cards with PDF covers, then the PDF files as cards, then papers cropped to the top half" width="720">

Pro costs $15 one time or $5 a month: [Sponsor](https://github.com/sponsors/theluckystrike?metadata_source=pdf-cover-cards) or [$15 one-time offer](https://github.com/sponsors/theluckystrike/sponsorships?tier_id=666162&metadata_source=pdf-cover-cards).

## Features

### Page 1 of the linked PDF on each card

Choose a property that links to the PDF, for example `pdf: "[[Field Guide to Mosses.pdf]]"`. Each card shows page 1 of that file, the note name, the properties of the view and the page count. Click a card to open the note. Ctrl-click (Cmd-click on macOS) opens it in a new tab. The plugin can also use the first PDF that a note links to or embeds.

<img src="https://raw.githubusercontent.com/theluckystrike/pdf-cover-cards/HEAD/docs/shelf.png" alt="Twelve cards with drawn book, manual and paper covers, each with author and year" width="720">

<details><summary>How the plugin finds the PDF and the page</summary>

The order: a PDF file in the base is its own cover, then the PDF property of the view (one link or a list), then the first PDF that the note links to or embeds.

Add `#page=N` to a link to show another page, for example `[[Manual.pdf#page=3]]`.

</details>

<img src="https://raw.githubusercontent.com/theluckystrike/pdf-cover-cards/HEAD/docs/link-fallback.png" alt="A note that embeds its PDF in the text, next to the base where that note has the PDF as its cover" width="720">

### Open the PDF at the cover page

Each card with a PDF has an "Open at page N" button that opens the PDF at the page that the card shows. Ctrl-click (Cmd-click on macOS) the button to open the PDF in a new tab. Cards without a PDF have no button.

<img src="https://raw.githubusercontent.com/theluckystrike/pdf-cover-cards/HEAD/docs/open-at-page.png" alt="Library cards, each with an Open at page 1 button under the author and the year" width="720">

### Browse PDF pages on a card

Use "Previous page" or "Next page" to preview another page. The open button follows the preview. Controls appear on drawn PDFs with two or more pages. They stop at the first and last pages.

Browsing changes no file. A refresh restores the page from the link.

<img src="https://raw.githubusercontent.com/theluckystrike/pdf-cover-cards/HEAD/docs/page-browsing.png" alt="A PDF card on page 2 with controls for the previous and next pages" width="720">

### PDF files as cards

A base can select the PDF files themselves, for example with the filter `file.ext == "pdf"`. Then each PDF is a card with its own cover.

<img src="https://raw.githubusercontent.com/theluckystrike/pdf-cover-cards/HEAD/docs/pdf-files.png" alt="A base of twelve PDF files, each drawn as its own card" width="720">

### Images on cards without a PDF

A card without a PDF shows an image: the entry itself when it is an image, then an image in the PDF property, then the first image that the note links to or embeds (with the link option on). PNG, JPG, GIF, WebP, AVIF, BMP and SVG files work. A PDF always wins. Image covers do not use the 30 free covers.

<img src="https://raw.githubusercontent.com/theluckystrike/pdf-cover-cards/HEAD/docs/image-covers.png" alt="A shelf of scans with three PDF covers, a photo of a notebook, a postcard image and one note without a file" width="720">

### Embeds and live update

Embed the layout in any note with `![[Library.base#Shelf]]`. When a PDF changes, its cover draws again.

<img src="https://raw.githubusercontent.com/theluckystrike/pdf-cover-cards/HEAD/docs/embedded.png" alt="The card layout embedded in a reading list note" width="720">

### Cover crop (Pro)

Show only the top half or the top third of the page or image. Then the title and abstract of a paper or report are large enough to read on the card.

<img src="https://raw.githubusercontent.com/theluckystrike/pdf-cover-cards/HEAD/docs/crop.png" alt="Two papers with covers cropped to the top half, so the title and abstract are readable" width="720">

### Contact sheet export (Pro)

Export the drawn covers of the view, image covers too, to a PNG image with the note names. More than about 150 covers go on more than one image. The images go into the folder for new files. Use the button above the cards or the command "Export the covers of this view as a contact sheet".

<img src="https://raw.githubusercontent.com/theluckystrike/pdf-cover-cards/HEAD/docs/contact-sheet.png" alt="An exported PNG with twelve covers in a grid and the titles under them" width="720">

## Install

1. Open "Settings → Community plugins" and turn off restricted mode.
2. Select "Browse", search for "PDF Cover Cards", then select "Install" and "Enable".
3. Make sure that the core plugin "Bases" is on ("Settings → Core plugins").

## Usage

1. Create a base, or open one. Set its filters so that it selects your document notes, for example a folder or a tag.
2. Select the view menu in the base toolbar and add a view of the type "PDF covers".
3. Open the view options. In "PDF property", choose the property that holds the link to the PDF.
4. Use "Properties" in the base toolbar to choose the properties that show under the title.

## Pro

The free version draws the first 30 PDF covers in a view. Image covers, `#page=N`, embeds and live updates are free. A line reports skipped covers.

Pro draws PDF covers on every card, crops covers to the top, saves drawn covers so large bases open fast, and exports PNG contact sheets, split for large views. To get it:

1. Sponsor through [GitHub Sponsors](https://github.com/sponsors/theluckystrike?metadata_source=pdf-cover-cards). A total payment of $15 meets the payment requirement for Pro without further payment. Sign-in and the checks below still apply.
2. In Obsidian, open the settings of PDF Cover Cards and select "Sign in with GitHub".
3. The plugin copies a code and opens github.com/login/device. Paste the code there and approve.

The status line then shows your GitHub login and the tier. If you sponsor after you sign in, select Refresh.

## Settings

After a minor or major update, this plugin opens one What's new tab in the background. The tab and settings card suggest other NoteMods plugins and Zovo Chat and link to notemods.com for feedback ([privacy](https://notemods.com/privacy/)). The tab sends no data. Turn the tab off in Settings.

The view options are in the base toolbar. Bases saves them with each view in the base file.

| Option | What it does |
| --- | --- |
| PDF property | The property that links to the PDF. It can hold one link or a list. |
| Use the first PDF link in the note | When the property gives no PDF, use the first PDF that the note links to or embeds. On by default. |
| Show images when there is no PDF | Shows an image on a card without a PDF. On by default. |
| Card width | From 120 to 400 pixels. |
| Show properties | Shows the properties of the view under the title. |
| Cover crop (Pro) | Whole page, top half or top third. |

<img src="https://raw.githubusercontent.com/theluckystrike/pdf-cover-cards/HEAD/docs/settings.png" alt="The plugin settings with the Pro section, cover sharpness, parallel drawing and saved covers" width="720">

The plugin settings tab has the Pro section (sign in with GitHub, status and Refresh) and these settings:

- "Cover sharpness" is from 1 (fastest) to 3. The default, 2, is sharp on high-density screens.
- "PDFs drawn at the same time" is from 1 to 4, default 2. Use 1 on a phone.
- "Save drawn covers (Pro)" keeps PDF covers in the plugin folder. On by default.
- "Clear saved covers" deletes them. A command does the same.

## FAQ

### Does PDF Cover Cards change my notes or my PDFs?

No. It only reads them. The contact sheet export makes new PNG files. Saved covers go into the plugin folder.

### How is this different from the core Cards layout?

The core Cards layout shows an image property as the picture. It shows nothing for a PDF link. This plugin draws the PDF page, and it shows an image on cards without a PDF. PDF scans and photos fit on one shelf.

### How fast is it?

It draws only covers near the screen, with two PDFs at a time by default. The first open after the app starts is slower, because Obsidian loads its PDF reader then.

### Which PDFs work?

Each PDF that the Obsidian PDF viewer opens. A damaged or locked PDF shows a short message on its card.

## Payment, account and network

The core features are free. Pro features need a GitHub Sponsors sponsorship of theluckystrike: $5 a month or more, or $15 once. A total payment of $15 meets the payment requirement for Pro without further payment. Sign-in and the checks below still apply. Your notes stay readable and editable with or without Pro.

GitHub handles the payment. Sponsor at https://github.com/sponsors/theluckystrike. You need no account for the free features. Pro needs the GitHub account that sponsors.

Until you select "Sign in with GitHub" in the settings, PDF Cover Cards makes no network requests. Sign in uses the GitHub device flow. PDF Cover Cards sends its public client ID and the scope `read:user` to `https://github.com/login/device/code` and shows you a code. While you enter the code at https://github.com/login/device, it asks `https://github.com/login/oauth/access_token` every few seconds to check the sign-in status. The scope permits profile reads only. GitHub needs this access to show the sponsorship tier. It grants no repository scope and no write access.

After sign in, PDF Cover Cards sends one query to `https://api.github.com/graphql`. It checks if the signed-in account sponsors theluckystrike. It asks for the tier and the total payment to theluckystrike. The plugin reuses a successful check for 7 days. Failed checks can retry after 6 hours. Select Refresh to request an earlier check. It sends no note content, file names or other vault data, and it has no telemetry.

After a successful check, Pro can work offline for up to 14 days. Sign out or a negative sponsorship answer turns Pro off. The plugin stores the GitHub token through the secret storage API of Obsidian. It does not put the token in its saved settings or its local sponsorship data. The local storage of this device keeps your GitHub login, the tier and the time of the last check. Sign out clears the token. You can also revoke the access in your GitHub settings, under Applications.

## Support

Plugin page: [pdf-cover-cards](https://notemods.com/plugins/pdf-cover-cards/).

Report bugs and feature requests in this repository's GitHub issues.

## Community

Questions, bugs or plugin ideas? Talk to me and other Obsidian users in [Zovo Chat](https://t.me/+k2MM-BIc7SQ5OWM0) on Telegram. It has a topic for these plugins. You can also open an issue here.
