# ChatGPT Conversation Navigator

[简体中文](README.md) | [English](README.en.md)

A browser extension that adds a conversation navigator to the right side of ChatGPT, for Chrome and Chromium-based Microsoft Edge. Hover over the navigation ticks to reveal prompt summaries, click a prompt to jump to it, and follow the highlighted entry as you read. Includes a virtualized directory for long conversations, light and dark themes, keyboard navigation, history scanning, and automatic conversation switching.

**[Download the latest installation package](https://github.com/0Whisperos/chatgpt-toc/releases/latest/download/chatgpt-toc-navigator.zip)** · [All releases](https://github.com/0Whisperos/chatgpt-toc/releases)

## Features

- **Prompt directory**: Lists user prompts in conversation order. Hover to expand and click to jump.
- **Reading position highlighting**: Highlights the relevant prompt as you scroll, including while reading its answer.
- **Long conversation navigation**: Renders only the visible directory rows, locates unmounted messages, and scans history to collect missing entries.
- **Automatic updates**: Refreshes when new prompts arrive or you switch conversations, displaying only the current branch.
- **Local processing**: Supports light and dark themes, collapsing, and keyboard controls. Chat content is processed within your browser.

## Installation

1. [Download the latest installation package](https://github.com/0Whisperos/chatgpt-toc/releases/latest/download/chatgpt-toc-navigator.zip), extract `chatgpt-toc-navigator.zip`, and locate the `dist` folder.
2. Open your browser's extension management page: `chrome://extensions` in Chrome or `edge://extensions` in Edge.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select the **`dist` folder containing `manifest.json`**.
5. Refresh an open ChatGPT page or open an existing conversation. The extension only runs on `https://chatgpt.com/`.

Keep the installation folder in place. To update, extract the new package into the same installation location, click the extension's reload button on the extension management page, and refresh ChatGPT.

The **Source code (zip / tar.gz)** archives generated automatically by GitHub Releases are source snapshots. They do not contain a built `dist` folder. For installation, download **`chatgpt-toc-navigator.zip`**. If you downloaded the source, follow the development instructions below to build `dist` first.

## Usage

- **View the directory**: Hover over the ticks on the right side of the page. Each row shows a prompt summary; hover over it to view more text.
- **Jump to a prompt**: Click a prompt or a tick. Unmounted historical messages may require scrolling to load. Click **取消 (Cancel)** to stop; using the mouse wheel, touch scrolling, or page navigation keys also cancels navigation.
- **Collapse**: Click **×** in the top-right corner of the directory. Click **≡** on the right to reopen it. The collapsed preference is saved locally.
- **Keyboard controls**: Focus **≡** and press **Enter** to open the directory. Use the up and down arrow keys, **Home**, or **End** to select an entry, **Enter** to jump, and **Escape** to collapse.
- **Narrow windows**: At widths of 760px or less, click **≡** to open the directory. Hover expansion is disabled to reduce obstruction.
- **Collect missing entries**: If the directory displays **目录尚未完整加载 (Directory not fully loaded)**, click **加载完整目录 (Load complete directory)**. Scanning temporarily scrolls the page and attempts to restore your original reading position afterward. If you cancel by scrolling manually, your new position is respected.

## Completeness and compatibility

The extension passively observes same-origin JSON responses for the current conversation from document startup. It recognizes the `mapping` / `current_node` structure in `/backend-api/conversation/{id}`, including `/backend-api/f/conversation/{id}`, and extracts only the selected branch. Responses wrapped in a `conversation` or `data` field are also supported. The extension does not make additional requests to these endpoints.

If ChatGPT changes its endpoints, sends only part of the history, uses a different schema, or the extension misses the initial load, the directory falls back to the page DOM. Refresh the page first; if entries are still missing, use history scanning. An unrecognized schema is not assumed to contain a complete conversation.

The DOM adapter supports the newer `data-user-message-bubble` / `data-chatgpt-search-message-ids` attributes and the older `data-message-author-role` / `data-message-id` attributes. It scans only the currently visible conversation. Entries are deduplicated by message ID, so identical prompts remain separate entries.

A history scan is marked complete only after it reaches stable top and bottom boundaries and finds an explicit beginning marker. The newer `fallback-turn-0` attribute may be a local index and **is not accepted on its own as proof of complete history**. If completeness cannot be established, the directory remains marked incomplete even after all currently accessible history has been scanned.

Navigation runs for up to 60 seconds. If the target has not loaded, a message has been replaced by an edit, or DOM identifiers change, the extension reports that navigation failed and offers a retry. When fallback nodes have no message IDs, relocation after virtualization unmounts them cannot be guaranteed. Canceling or timing out a scan retains the entries already collected.

The first version supports regular `/c/{id}` paths and conversation paths within projects. New conversations initially use a temporary directory built from visible prompts. The directory is hidden on the home page when no prompts are present. Other chat websites, read-only shared pages, and desktop clients are outside the supported scope.

The extension UI currently uses Chinese. Automated browser tests run in Chrome; Edge is compatible at the code level and still requires an actual installation check. See the [validation record, in Chinese](https://github.com/0Whisperos/chatgpt-toc/blob/main/VALIDATION.md) for testing details.

## Privacy and permissions

- Uses Manifest V3 and matches only `https://chatgpt.com/*`.
- The only additional permission is `storage`, used to save the collapsed preference.
- Does not read login credentials, add network requests, upload or synchronize conversations, or persist chat content.
- Keeps the current conversation index in memory and releases it when switching conversations.
- Inserts directory content as plain text and validates page-provided index data again in the isolated content script.

## Development

Requires Node.js 20.19+ or 22.12+. To get started:

```powershell
git clone https://github.com/0Whisperos/chatgpt-toc.git
cd chatgpt-toc
npm ci
npm run build
```

Once built, load the `dist` folder in the project root using the installation steps above. Other useful commands:

```powershell
npm test
npm run test:e2e
npm run test:extension
npm run package
```

Build output is written to `dist/`. Packaging creates `chatgpt-toc-navigator.zip` in the project root. Playwright is included in the development dependencies. Browser tests use Chrome from its standard Windows installation location when available; otherwise they use Playwright Chromium, which can be installed with `npx playwright install chromium`. Set `TOC_CHROME_PATH` to use another browser executable, or `TOC_PLAYWRIGHT_PATH` to override the Playwright module path.

`test:extension` loads the actual MV3 extension into a temporary Chrome profile through Chrome's extension debugging interface. It checks communication between the main and isolated worlds and persistence of the local preference. The test browser is separate from your regular Chrome profile, and all page responses are supplied by local test data.

The source is organized into the page data bridge, branch parsing and indexing, DOM adaptation, directory UI, and navigation and scanning. Automated browser tests use local fixture conversations and do not edit real ChatGPT chats.
