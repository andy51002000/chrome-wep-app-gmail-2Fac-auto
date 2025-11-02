# 2FacTrac – Gmail Verification Assistant (Chrome Extension)

2FacTrac is a Chrome extension that surfaces verification codes and confirmation links from your Gmail inbox directly in the browser action popup. Authorize with Google once, then copy codes or open domain-matching links without leaving the flow you are in.

https://github.com/USERNAME/REPO/assets/placeholder

## ✨ Features

- **Instant code extraction** – finds 4–8 digit codes as well as mixed alphanumeric tokens.
- **Smart link discovery** – locates verification links and ranks them by how closely they match the site you are visiting.
- **One-click actions** – copy codes to the clipboard or open links in a new tab instantly.
- **Privacy-first** – read-only Gmail scope, no backend, and no persistence of email content.
- **Chrome-native auth** – uses the `chrome.identity` API for OAuth flows right inside the browser.

## 🧰 Project structure

```
.
├── manifest.json      # Chrome extension manifest (update the OAuth client ID here)
├── index.html         # Browser action popup UI
├── app.js             # Chrome identity sign-in and Gmail parsing logic
├── styles.css         # Tailored interface styling
└── README.md
```

## 🚀 Getting started

1. **Load the extension once to obtain an ID**
   - Open `chrome://extensions` in Chrome and enable **Developer mode**.
   - Click **Load unpacked** and choose this project folder.
   - Chrome assigns an extension ID (visible on the card). Copy it for the next step.

2. **Create OAuth credentials**
   - Visit the [Google Cloud Console](https://console.cloud.google.com/).
   - Create a project (or select an existing one) and enable the **Gmail API**.
   - Go to **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
   - Choose **Chrome App** and enter your extension ID as `https://<EXTENSION_ID>.chromiumapp.org/` for the redirect URL.
   - After creation, copy the generated client ID.

3. **Update the manifest**
   - Edit `manifest.json` and replace `YOUR_CHROME_OAUTH_CLIENT_ID.apps.googleusercontent.com` with the client ID from the previous step.
   - Save the file and refresh the extension from `chrome://extensions`.

4. **Authorize and fetch**
   - Click the 2FacTrac toolbar icon, then **“Sign in with Google”** in the popup.
   - Approve the requested read-only Gmail scope.
   - Use **“Fetch latest codes”** to scan messages from the last five minutes.
   - Copy codes with one click or open verification links in a new tab.

## 🔐 Permissions & privacy

- Uses the Gmail read-only scope (`https://www.googleapis.com/auth/gmail.readonly`).
- Requests are sent directly from the extension popup to Google – no intermediary server.
- Only the last five minutes of messages are queried by default (`newer_than:5m`).
- Parsed results stay in memory only for the current popup session.

## 🧠 How parsing works

- Emails are downloaded with the `full` format so headers, snippets, and body parts are available.
- Body content is decoded (HTML stripped to text) and merged with the snippet and subject.
- Regular expressions target numeric and alphanumeric verification tokens while avoiding long IDs.
- URLs are extracted from the same text block and deduplicated.
- Links receive a score based on how well their domain matches the value you enter in **Current website**.

## 🧪 Development tips

- The domain input defaults to the hostname of the popup, but you can change it to the site you are verifying (e.g., `slack.com`).
- Update the Gmail search query in `app.js` if you want to widen the time window or add additional filters.
- Use the **Errors** link on the extension card inside `chrome://extensions` to inspect console output from the popup.

## 📄 License

Released under the MIT License. Feel free to adapt the UI or extend the Gmail parsing logic for your own projects.
