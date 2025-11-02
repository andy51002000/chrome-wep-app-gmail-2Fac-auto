(() => {
  const gmailApiBase = "https://gmail.googleapis.com/gmail/v1";
  const statusEl = document.getElementById("status");
  const authorizeButton = document.getElementById("authorizeButton");
  const signoutButton = document.getElementById("signoutButton");
  const fetchButton = document.getElementById("fetchButton");
  const domainInput = document.getElementById("domainInput");
  const codesList = document.getElementById("codesList");
  const codesEmpty = document.getElementById("codesEmpty");
  const linksList = document.getElementById("linksList");
  const linksEmpty = document.getElementById("linksEmpty");

  const state = {
    signedIn: false,
    loading: false,
    token: null,
    lastResults: { codes: [], links: [] },
  };

  const setStatus = (message, type = "info") => {
    statusEl.textContent = message;
    statusEl.className = `status status--${type}`;
  };

  const toggleLoading = (isLoading) => {
    state.loading = isLoading;
    fetchButton.disabled = isLoading || !state.signedIn;
    fetchButton.textContent = isLoading ? "Fetching…" : "Fetch latest codes";
  };

  const initDomainInput = () => {
    const defaultDomain = window.location.hostname || "";
    if (!domainInput.value) {
      domainInput.value = defaultDomain;
    }
  };

  const chromeIdentityAvailable = () => {
    const available = typeof chrome !== "undefined" && !!chrome.identity;
    if (!available) {
      setStatus(
        "Chrome identity API unavailable. Load 2FacTrac as an unpacked Chrome extension to authorize Gmail.",
        "error"
      );
      authorizeButton.disabled = true;
      fetchButton.disabled = true;
    }
    return available;
  };

  const updateSigninStatus = (isSignedIn) => {
    state.signedIn = isSignedIn;
    authorizeButton.hidden = isSignedIn;
    signoutButton.hidden = !isSignedIn;
    fetchButton.disabled = !isSignedIn || state.loading;

    if (isSignedIn) {
      setStatus("Signed in. Fetch the latest verification codes sent to your Gmail inbox.", "success");
    } else {
      setStatus("Sign in with Google to allow read-only access to the last five minutes of Gmail messages.", "info");
      clearResults();
    }
  };

  const getAuthToken = (interactive = false) =>
    new Promise((resolve, reject) => {
      chrome.identity.getAuthToken({ interactive }, (token) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!token) {
          reject(new Error("Unable to retrieve an OAuth token."));
          return;
        }
        resolve(token);
      });
    });

  const ensureToken = async (interactive = false) => {
    if (state.token) {
      return state.token;
    }
    const token = await getAuthToken(interactive);
    state.token = token;
    updateSigninStatus(true);
    return token;
  };

  const invalidateToken = () =>
    new Promise((resolve, reject) => {
      if (!state.token) {
        resolve();
        return;
      }
      chrome.identity.removeCachedAuthToken({ token: state.token }, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        state.token = null;
        resolve();
      });
    });

  const gmailRequest = async (path, params = {}) => {
    const url = new URL(`${gmailApiBase}/${path}`);
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, value);
      }
    });

    let token;
    try {
      token = await ensureToken(false);
    } catch (error) {
      throw error;
    }

    let response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (response.status === 401) {
      await invalidateToken();
      token = await ensureToken(true);
      response = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
    }

    if (!response.ok) {
      let message = `${response.status} ${response.statusText}`;
      try {
        const payload = await response.json();
        message = payload.error?.message || message;
      } catch (err) {
        // ignore json parsing errors
      }
      throw new Error(message);
    }

    return response.json();
  };

  const handleSignIn = async () => {
    if (!chromeIdentityAvailable()) return;
    try {
      await ensureToken(true);
    } catch (error) {
      console.error("Sign-in failed", error);
      setStatus(error.message || "Failed to sign in with Google.", "error");
    }
  };

  const handleSignOut = async () => {
    if (!chromeIdentityAvailable()) return;
    try {
      await invalidateToken();
      await new Promise((resolve) => chrome.identity.clearAllCachedAuthTokens(() => resolve()));
      updateSigninStatus(false);
      setStatus("Signed out. Sign in again when you need to scan for verification emails.", "info");
    } catch (error) {
      console.error("Sign-out failed", error);
      setStatus(error.message || "Failed to sign out.", "error");
    }
  };

  const clearResults = () => {
    state.lastResults = { codes: [], links: [] };
    renderResults();
  };

  const fetchVerificationData = async () => {
    if (!chromeIdentityAvailable()) return;
    toggleLoading(true);
    setStatus("Scanning your inbox for recent verification messages…", "info");

    try {
      const listResponse = await gmailRequest("users/me/messages", {
        q: "newer_than:5m",
        maxResults: "20",
      });

      const messages = listResponse.messages || [];
      if (!messages.length) {
        state.lastResults = { codes: [], links: [] };
        renderResults();
        setStatus("No recent verification emails found. Try again after a new code arrives.", "info");
        toggleLoading(false);
        return;
      }

      const details = await Promise.all(
        messages.map(async (message) => {
          try {
            return await gmailRequest(`users/me/messages/${message.id}`, { format: "full" });
          } catch (error) {
            console.error("Failed to fetch message", message.id, error);
            return null;
          }
        })
      );

      const usableMessages = details.filter(Boolean);
      const parsed = parseMessages(usableMessages);
      state.lastResults = parsed;
      renderResults();

      const summary = [];
      if (parsed.codes.length) summary.push(`${parsed.codes.length} code${parsed.codes.length > 1 ? "s" : ""}`);
      if (parsed.links.length) summary.push(`${parsed.links.length} link${parsed.links.length > 1 ? "s" : ""}`);

      setStatus(
        summary.length
          ? `Found ${summary.join(" and ")} in your recent Gmail messages.`
          : "No verification content detected. Try refreshing once a new email arrives.",
        summary.length ? "success" : "info"
      );
    } catch (error) {
      console.error("Failed to fetch verification data", error);
      setStatus(error.message || "Unable to read Gmail messages.", "error");
    } finally {
      toggleLoading(false);
    }
  };

  const parseMessages = (messages) => {
    const codesMap = new Map();
    const links = [];
    const currentDomain = (domainInput.value || "").trim().toLowerCase();

    messages.forEach((message) => {
      const headers = indexHeaders(message.payload?.headers || []);
      const from = headers["from"] || "Unknown sender";
      const subject = headers["subject"] || "";
      const date = headers["date"] ? new Date(headers["date"]) : null;
      const snippet = message.snippet || "";
      const bodyText = extractPlainText(message.payload) || "";
      const combined = `${subject}\n${snippet}\n${bodyText}`;

      const codes = extractVerificationCodes(combined);
      codes.forEach((code) => {
        const key = `${code.value}-${from}`;
        if (!codesMap.has(key)) {
          codesMap.set(key, {
            value: code.value,
            format: code.format,
            from,
            subject,
            snippet,
            date,
          });
        }
      });

      const messageLinks = extractVerificationLinks(combined);
      messageLinks.forEach((link) => {
        try {
          const url = new URL(link);
          const hostname = url.hostname.toLowerCase();
          const isMatch = currentDomain && hostname.includes(currentDomain);
          links.push({
            url: link,
            hostname,
            from,
            subject,
            date,
            matchScore: calculateMatchScore(hostname, currentDomain),
            isMatch,
          });
        } catch (err) {
          console.warn("Invalid URL skipped", link);
        }
      });
    });

    const codes = Array.from(codesMap.values()).sort((a, b) => (b.date || 0) - (a.date || 0));
    const rankedLinks = links
      .sort((a, b) => b.matchScore - a.matchScore || (b.date || 0) - (a.date || 0))
      .filter((link, index, self) => self.findIndex((item) => item.url === link.url) === index);

    return { codes, links: rankedLinks };
  };

  const indexHeaders = (headers) =>
    headers.reduce((acc, header) => {
      acc[header.name.toLowerCase()] = header.value;
      return acc;
    }, {});

  const extractPlainText = (payload) => {
    if (!payload) return "";

    if (payload.parts?.length) {
      return payload.parts.map(extractPlainText).join("\n");
    }

    if (!payload.body?.data) return "";

    try {
      const decoded = decodeBase64(payload.body.data);
      const text = decoded;
      if (payload.mimeType === "text/html") {
        const doc = new DOMParser().parseFromString(text, "text/html");
        return doc.body.textContent || "";
      }
      return text;
    } catch (err) {
      console.error("Failed to decode message body", err);
      return "";
    }
  };

  const decodeBase64 = (data) => {
    const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(normalized);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    try {
      return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    } catch (err) {
      console.warn("Falling back to latin1 decoding", err);
      return binary;
    }
  };

  const extractVerificationCodes = (text) => {
    if (!text) return [];

    const results = new Map();
    const patterns = [
      { regex: /\b\d{4,8}\b/g, format: "numeric" },
      { regex: /\b[A-Z0-9]{3,}-[A-Z0-9]{3,}\b/g, format: "alphanumeric" },
      { regex: /\b[A-Z0-9]{5,8}\b/g, format: "alphanumeric" },
    ];

    patterns.forEach(({ regex, format }) => {
      const matches = text.match(regex) || [];
      matches.forEach((value) => {
        const normalized = value.trim();
        if (normalized.length <= 12) {
          results.set(normalized, { value: normalized, format });
        }
      });
    });

    return Array.from(results.values());
  };

  const extractVerificationLinks = (text) => {
    if (!text) return [];
    const urlRegex = /(https?:\/\/[\w.-]+(?:\/[\w\-./?%&=+#]*)?)/gi;
    return Array.from(new Set((text.match(urlRegex) || []).map((url) => url.replace(/[)>\]\s]+$/, ""))));
  };

  const calculateMatchScore = (hostname, currentDomain) => {
    if (!hostname) return 0;
    if (!currentDomain) return 0.5; // neutral score when no domain provided
    if (hostname === currentDomain) return 1;
    if (hostname.endsWith(currentDomain)) return 0.9;
    if (currentDomain.endsWith(hostname)) return 0.8;
    return 0.4;
  };

  const renderResults = () => {
    renderCodes(state.lastResults.codes);
    renderLinks(state.lastResults.links);
  };

  const renderCodes = (codes) => {
    codesList.innerHTML = "";
    if (!codes || !codes.length) {
      codesList.hidden = true;
      codesEmpty.hidden = false;
      return;
    }

    codes.forEach((code) => {
      const item = document.createElement("article");
      item.className = "card";
      item.innerHTML = `
        <div class="card__header">
          <div class="card__title">${code.value}</div>
          <div class="card__meta">
            <span><strong>${sanitizeHTML(code.from)}</strong></span>
            ${code.date ? `<span>${formatRelativeTime(code.date)}</span>` : ""}
          </div>
        </div>
        <div class="card__meta">
          ${code.subject ? `<span>Subject: ${sanitizeHTML(code.subject)}</span>` : ""}
        </div>
        <div class="card__footer">
          <button class="button button--copy" data-code="${code.value}">Copy code</button>
          <div class="card__chips">
            <span class="chip">${code.format}</span>
            <span class="chip">Gmail</span>
          </div>
        </div>
      `;
      codesList.appendChild(item);
    });

    codesList.hidden = false;
    codesEmpty.hidden = true;

    codesList.querySelectorAll("[data-code]").forEach((button) => {
      button.addEventListener("click", (event) => {
        const value = event.currentTarget.getAttribute("data-code");
        navigator.clipboard.writeText(value).then(() => {
          button.textContent = "Copied!";
          button.disabled = true;
          setTimeout(() => {
            button.textContent = "Copy code";
            button.disabled = false;
          }, 1800);
        });
      });
    });
  };

  const renderLinks = (links) => {
    linksList.innerHTML = "";
    if (!links || !links.length) {
      linksList.hidden = true;
      linksEmpty.hidden = false;
      return;
    }

    links.forEach((link) => {
      const item = document.createElement("article");
      item.className = "card";
      const safeSubject = link.subject ? sanitizeHTML(link.subject) : "Verification email";
      const matchChip = link.isMatch
        ? '<span class="chip chip--match">Domain match</span>'
        : "";

      item.innerHTML = `
        <div class="card__header">
          <div class="card__title">${sanitizeHTML(link.hostname)}</div>
          <div class="card__meta">
            <span><strong>${sanitizeHTML(link.from)}</strong></span>
            ${link.date ? `<span>${formatRelativeTime(link.date)}</span>` : ""}
          </div>
        </div>
        <div class="card__meta">
          <span>${safeSubject}</span>
        </div>
        <div class="card__footer">
          <a class="button button--secondary" href="${link.url}" target="_blank" rel="noopener noreferrer">Open link</a>
          <div class="card__chips">
            ${matchChip}
            <span class="chip">Gmail</span>
          </div>
        </div>
      `;
      linksList.appendChild(item);
    });

    linksList.hidden = false;
    linksEmpty.hidden = true;
  };

  const sanitizeHTML = (value) => {
    const div = document.createElement("div");
    div.textContent = value;
    return div.innerHTML;
  };

  const formatRelativeTime = (date) => {
    if (!date) return "";
    const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
    const diffMs = date.getTime() - Date.now();
    const diffMinutes = Math.round(diffMs / (1000 * 60));
    if (Math.abs(diffMinutes) < 60) {
      return formatter.format(diffMinutes, "minute");
    }
    const diffHours = Math.round(diffMinutes / 60);
    return formatter.format(diffHours, "hour");
  };

  const initialize = () => {
    initDomainInput();

    authorizeButton.addEventListener("click", handleSignIn);
    signoutButton.addEventListener("click", handleSignOut);
    fetchButton.addEventListener("click", fetchVerificationData);

    if (!chromeIdentityAvailable()) {
      return;
    }

    chrome.identity.getAuthToken({ interactive: false }, (token) => {
      if (chrome.runtime.lastError || !token) {
        updateSigninStatus(false);
        return;
      }
      state.token = token;
      updateSigninStatus(true);
    });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize);
  } else {
    initialize();
  }
})();
