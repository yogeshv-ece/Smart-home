/* =====================================================================
   Smart Home Control Panel - app.js
   - Lightweight, mobile-optimized vanilla JavaScript dashboard.
   - Talks directly to ESP32 over HTTP REST API (/api/status, /api/light/*, etc.)
   - Remembers configured ESP32 URL in localStorage with auto-reconnect.
   - Handles both Local Wi-Fi (http://192.168.x.x) and Remote HTTPS Gateways.
   - Web Speech API for speech-to-text in phone browser.
   - Offline-ready static PWA shell with zero stale hardware caching.
   ===================================================================== */

(() => {
  "use strict";

  // ---------------------------------------------------------------
  // Configuration & Defaults
  // ---------------------------------------------------------------
  const STATUS_POLL_MS = 1500;
  const REQUEST_TIMEOUT_MS = 4000;
  const STORAGE_KEY = "smart_home_esp32_url";
  const DEFAULT_API_URL = "";

  let espBaseUrl = "";       // Normalized base URL (e.g. "http://192.168.1.50" or "https://api.domain")
  let pollTimer = null;
  let consecutiveFailures = 0;
  let isDemoMode = false;
  let mockState = {
    success: true,
    door: "closed",
    light: "off"
  };

  // ---------------------------------------------------------------
  // DOM References
  // ---------------------------------------------------------------
  const el = {
    connIndicator: document.getElementById("connIndicator"),
    connLabel: document.getElementById("connLabel"),
    espIpInput: document.getElementById("espIpInput"),
    connectBtn: document.getElementById("connectBtn"),
    setupHint: document.getElementById("setupHint"),
    demoModeBtn: document.getElementById("demoModeBtn"),

    errorBanner: document.getElementById("errorBanner"),
    errorText: document.getElementById("errorText"),
    errorDismiss: document.getElementById("errorDismiss"),

    micBtn: document.getElementById("micBtn"),
    micBtnLabel: document.getElementById("micBtnLabel"),
    transcriptText: document.getElementById("transcriptText"),
    lastCommandText: document.getElementById("lastCommandText"),

    doorPanel: document.getElementById("doorPanel"),
    doorStatusPill: document.getElementById("doorStatusPill"),
    doorOpenBtn: document.getElementById("doorOpenBtn"),
    doorCloseBtn: document.getElementById("doorCloseBtn"),

    lightPanel: document.getElementById("lightPanel"),
    lightStatusPill: document.getElementById("lightStatusPill"),
    lightOnBtn: document.getElementById("lightOnBtn"),
    lightOffBtn: document.getElementById("lightOffBtn"),

    emergencyStopBtn: document.getElementById("emergencyStopBtn"),
    pollingIndicator: document.getElementById("pollingIndicator"),
  };

  // ---------------------------------------------------------------
  // Error Banner Helpers
  // ---------------------------------------------------------------
  function showError(msg) {
    el.errorText.textContent = msg;
    el.errorBanner.hidden = false;
  }

  function hideError() {
    el.errorBanner.hidden = true;
    el.errorText.textContent = "";
  }

  el.errorDismiss.addEventListener("click", hideError);

  // ---------------------------------------------------------------
  // Connection Indicator Helper
  // state: "unknown" | "connecting" | "connected" | "error"
  // ---------------------------------------------------------------
  function setConnState(state, label) {
    el.connIndicator.dataset.state = state;
    el.connLabel.textContent = label;
  }

  // ---------------------------------------------------------------
  // URL Normalization & Storage Helpers
  // ---------------------------------------------------------------
  function normalizeUrl(raw) {
    let str = (raw || "").trim();
    if (!str) return "";
    str = str.replace(/\/+$/, ""); // Strip trailing slashes
    if (!/^https?:\/\//i.test(str)) {
      str = "http://" + str;
    }
    return str;
  }

  function getDisplayHost(url) {
    try {
      const parsed = new URL(url);
      return parsed.host;
    } catch (_) {
      return url.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
    }
  }

  // ---------------------------------------------------------------
  // HTTP Request Helper with Timeout, Demo Mode & Diagnostic Error Handling
  // ---------------------------------------------------------------
  async function esprequest(path, targetBaseUrl = espBaseUrl) {
    // 1. Simulation / Demo Mode handler
    if (isDemoMode) {
      if (path === "/api/door/open") mockState.door = "open";
      else if (path === "/api/door/close") mockState.door = "closed";
      else if (path === "/api/light/on") mockState.light = "on";
      else if (path === "/api/light/off") mockState.light = "off";
      else if (path === "/api/all/off") {
        mockState.light = "off";
      }
      return { ...mockState };
    }

    // 2. Auto-detect address if user entered IP into the input box
    if (!targetBaseUrl && el.espIpInput && el.espIpInput.value.trim()) {
      targetBaseUrl = normalizeUrl(el.espIpInput.value);
      espBaseUrl = targetBaseUrl;
    }

    if (!targetBaseUrl) {
      throw new Error("Enter your ESP32 IP address or gateway URL above and tap Connect (or tap 'Demo Mode' to test buttons right now).");
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    const isHttpsPage = window.location.protocol === "https:";
    const isHttpTarget = targetBaseUrl.startsWith("http://") && !targetBaseUrl.includes("localhost") && !targetBaseUrl.includes("127.0.0.1");

    let response;
    try {
      response = await fetch(targetBaseUrl + path, {
        method: "GET",
        cache: "no-store", // Never cache live hardware requests
        signal: controller.signal,
      });
    } catch (err) {
      if (err.name === "AbortError") {
        throw new Error("ESP32 timed out (no response in 4s). Check that the ESP32 is powered on and reachable.");
      }

      // Detect Mixed Content and Private Network Access blockage
      if (isHttpsPage && isHttpTarget) {
        throw new Error(
          "Insecure Request Blocked (Mixed Content / PNA): This dashboard is loaded over HTTPS, so your browser blocks direct HTTP requests to local IPs. To fix: (1) Use an HTTPS tunnel (e.g. ngrok/Cloudflare), (2) Open this dashboard over local HTTP, or (3) In Chrome, tap the site lock → Site settings → Insecure content → Allow."
        );
      }

      throw new Error(
        "Could not reach the ESP32 at " + targetBaseUrl + ". Check Wi-Fi connection and IP address, or click 'Demo Mode' to test without hardware."
      );
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      let detail = "";
      try {
        const body = await response.json();
        detail = body.error ? ` (${body.error})` : "";
      } catch (_) { /* ignore JSON parse error on non-200 */ }
      throw new Error(`ESP32 returned HTTP error ${response.status}${detail}.`);
    }

    let data;
    try {
      data = await response.json();
    } catch (_) {
      throw new Error("Invalid JSON response received from the ESP32.");
    }

    return data;
  }

  // ---------------------------------------------------------------
  // UI Update from Status Object
  // ---------------------------------------------------------------
  function applyStatus(status) {
    if (!status || typeof status !== "object") return;

    // Door State
    if ("door" in status) {
      const doorOpen = status.door === "open" || status.door === true;
      el.doorPanel.dataset.active = String(doorOpen);
      el.doorStatusPill.textContent = doorOpen ? "OPEN" : "CLOSED";
    }

    // Light State
    if ("light" in status) {
      const lightOn = status.light === "on" || status.light === true;
      el.lightPanel.dataset.active = String(lightOn);
      el.lightStatusPill.textContent = lightOn ? "ON" : "OFF";
    }
  }

  // ---------------------------------------------------------------
  // Status Polling
  // ---------------------------------------------------------------
  async function pollStatus() {
    if (!espBaseUrl || isDemoMode) return;

    try {
      const status = await esprequest("/api/status");
      applyStatus(status);
      setConnState("connected", `Connected (${getDisplayHost(espBaseUrl)})`);
      consecutiveFailures = 0;
      hideError();
    } catch (err) {
      consecutiveFailures += 1;
      setConnState("error", "Disconnected");
      if (consecutiveFailures >= 2) {
        showError(err.message || "Lost connection to the ESP32.");
      }
    }
  }

  function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    if (!isDemoMode) {
      pollStatus();
      pollTimer = setInterval(pollStatus, STATUS_POLL_MS);
    }
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  // ---------------------------------------------------------------
  // Demo / Simulation Mode
  // ---------------------------------------------------------------
  function setDemoMode(enable) {
    isDemoMode = enable;
    if (el.demoModeBtn) {
      el.demoModeBtn.dataset.active = String(enable);
      el.demoModeBtn.textContent = enable ? "Demo Mode ON" : "Demo Mode";
    }
    if (enable) {
      stopPolling();
      setConnState("connected", "Demo Mode (Simulated)");
      el.setupHint.textContent = "Simulation Mode Active: You can test Door and Light buttons without physical hardware.";
      applyStatus(mockState);
      hideError();
    } else {
      if (espBaseUrl) {
        testAndConnect(espBaseUrl, true);
      } else {
        setConnState("unknown", "Not connected");
        el.setupHint.textContent = "Enter your ESP32 local IP (e.g. 192.168.1.50) for home Wi-Fi, or tap Demo Mode.";
      }
    }
  }

  if (el.demoModeBtn) {
    el.demoModeBtn.addEventListener("click", () => {
      setDemoMode(!isDemoMode);
    });
  }

  // ---------------------------------------------------------------
  // Connection Test & Validation Procedure
  // ---------------------------------------------------------------
  async function testAndConnect(rawUrl, showBannerOnFail = true) {
    if (isDemoMode) {
      setDemoMode(false);
    }

    const candidateUrl = normalizeUrl(rawUrl);
    if (!candidateUrl) {
      if (showBannerOnFail) showError("Please enter the ESP32 IP address or gateway URL.");
      return;
    }

    setConnState("connecting", "Connecting...");
    if (showBannerOnFail) hideError();

    try {
      const status = await esprequest("/api/status", candidateUrl);

      // Validate JSON response
      if (!status || typeof status !== "object") {
        throw new Error("The endpoint did not return valid Smart Home JSON status.");
      }

      // Success: Save confirmed URL and update state
      espBaseUrl = candidateUrl;
      try {
        localStorage.setItem(STORAGE_KEY, espBaseUrl);
      } catch (_) { /* ignore storage write errors */ }

      const host = getDisplayHost(espBaseUrl);
      setConnState("connected", `Connected (${host})`);
      el.setupHint.textContent = `Connected to ${espBaseUrl}`;
      applyStatus(status);
      hideError();
      consecutiveFailures = 0;
      startPolling();
    } catch (err) {
      setConnState("error", "Disconnected");
      stopPolling();
      if (showBannerOnFail) {
        showError(err.message);
      }
    }
  }

  // Connect button event
  el.connectBtn.addEventListener("click", () => {
    testAndConnect(el.espIpInput.value, true);
  });

  // Also connect on 'Enter' key inside the input field
  el.espIpInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      testAndConnect(el.espIpInput.value, true);
    }
  });

  // ---------------------------------------------------------------
  // Manual Hardware Control Buttons
  // ---------------------------------------------------------------
  async function runHardwareCommand(path, busyButtons = []) {
    busyButtons.forEach((b) => (b.disabled = true));
    try {
      const status = await esprequest(path);
      applyStatus(status);
      hideError();
    } catch (err) {
      showError(err.message);
    } finally {
      busyButtons.forEach((b) => (b.disabled = false));
    }
  }

  // Door Buttons
  el.doorOpenBtn.addEventListener("click", () =>
    runHardwareCommand("/api/door/open", [el.doorOpenBtn, el.doorCloseBtn]));
  el.doorCloseBtn.addEventListener("click", () =>
    runHardwareCommand("/api/door/close", [el.doorOpenBtn, el.doorCloseBtn]));

  // Light Buttons
  el.lightOnBtn.addEventListener("click", () =>
    runHardwareCommand("/api/light/on", [el.lightOnBtn, el.lightOffBtn]));
  el.lightOffBtn.addEventListener("click", () =>
    runHardwareCommand("/api/light/off", [el.lightOnBtn, el.lightOffBtn]));

  // Emergency Stop Button
  el.emergencyStopBtn.addEventListener("click", () =>
    runHardwareCommand("/api/all/off", [el.emergencyStopBtn]));

  // ---------------------------------------------------------------
  // Voice Command Parser
  // Converts recognized speech text into an internal command
  // ---------------------------------------------------------------
  function normalizeSpeech(text) {
    return text
      .toLowerCase()
      .replace(/please|could you|can you|would you|kindly/g, "")
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function parseCommand(rawText) {
    const text = normalizeSpeech(rawText);
    if (!text) return { type: "UNKNOWN" };

    const mentionsDoor = /\bdoor\b/.test(text);
    const mentionsLight = /\blight\b|\blights\b|\blamp\b/.test(text);

    // Emergency / Everything Off
    if (/turn everything off|all off|shut everything down|stop everything|emergency stop/.test(text)) {
      return { type: "ALL_OFF" };
    }

    // Door commands
    if (mentionsDoor) {
      const opens = /\bopen\b/.test(text);
      const closes = /\bclose\b|\bshut\b/.test(text);
      if (opens && !closes) return { type: "OPEN_DOOR" };
      if (closes && !opens) return { type: "CLOSE_DOOR" };
      return { type: "UNKNOWN" };
    }

    // Light commands
    if (mentionsLight) {
      const turnsOn = /\bon\b|\bstart\b/.test(text);
      const turnsOff = /\boff\b|\bstop\b/.test(text);
      if (turnsOn && !turnsOff) return { type: "LIGHT_ON" };
      if (turnsOff && !turnsOn) return { type: "LIGHT_OFF" };
    }

    return { type: "UNKNOWN" };
  }

  function commandToPath(command) {
    switch (command.type) {
      case "OPEN_DOOR": return "/api/door/open";
      case "CLOSE_DOOR": return "/api/door/close";
      case "LIGHT_ON": return "/api/light/on";
      case "LIGHT_OFF": return "/api/light/off";
      case "ALL_OFF": return "/api/all/off";
      default: return null;
    }
  }

  function commandToLabel(command) {
    switch (command.type) {
      case "OPEN_DOOR": return "OPEN_DOOR";
      case "CLOSE_DOOR": return "CLOSE_DOOR";
      case "LIGHT_ON": return "LIGHT_ON";
      case "LIGHT_OFF": return "LIGHT_OFF";
      case "ALL_OFF": return "ALL_OFF";
      default: return "UNKNOWN (rejected)";
    }
  }

  async function handleRecognizedText(text) {
    el.transcriptText.textContent = `"${text}"`;
    const command = parseCommand(text);
    el.lastCommandText.textContent = commandToLabel(command);

    const path = commandToPath(command);
    if (!path) {
      showError(`Command not recognized: "${text}". Try saying "open the door" or "turn on the light".`);
      return;
    }
    await runHardwareCommand(path);
  }

  // ---------------------------------------------------------------
  // Speech Recognition (Web Speech API)
  // ---------------------------------------------------------------
  const SpeechRecognitionImpl = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognition = null;
  let listening = false;

  function setListeningUI(isListening) {
    listening = isListening;
    el.micBtn.setAttribute("aria-pressed", String(isListening));
    el.micBtnLabel.textContent = isListening ? "Listening..." : "Speak";
  }

  if (!SpeechRecognitionImpl) {
    el.micBtnLabel.textContent = "Unsupported";
    el.micBtn.disabled = true;
    el.setupHint.textContent += " (Note: Voice control is unavailable in this browser. Use Chrome on Android or use manual controls.)";
  } else {
    recognition = new SpeechRecognitionImpl();
    recognition.lang = "en-US";
    recognition.continuous = false;
    recognition.interimResults = true;

    recognition.onstart = () => setListeningUI(true);
    recognition.onend = () => setListeningUI(false);

    recognition.onerror = (event) => {
      setListeningUI(false);
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        showError("Microphone permission denied. Enable microphone access in your browser settings.");
      } else if (event.error === "no-speech") {
        showError("No speech detected. Please try again.");
      } else {
        showError(`Speech recognition error: ${event.error}`);
      }
    };

    recognition.onresult = (event) => {
      let interim = "";
      let final = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) final += transcript;
        else interim += transcript;
      }
      if (interim) el.transcriptText.textContent = `"${interim}"`;
      if (final) handleRecognizedText(final.trim());
    };

    el.micBtn.addEventListener("click", () => {
      hideError();
      if (listening) {
        recognition.stop();
        return;
      }
      try {
        recognition.start();
      } catch (_) {
        showError("Could not start microphone. Please check permissions and try again.");
      }
    });
  }

  // ---------------------------------------------------------------
  // Service Worker Registration for PWA
  // ---------------------------------------------------------------
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch(() => {
        /* Service worker registration failure is non-fatal */
      });
    });
  }

  // ---------------------------------------------------------------
  // Initialization & Auto-Reconnect
  // ---------------------------------------------------------------
  setConnState("unknown", "Not connected");

  let initialUrl = "";
  try {
    initialUrl = localStorage.getItem(STORAGE_KEY) || DEFAULT_API_URL;
  } catch (_) {
    initialUrl = DEFAULT_API_URL;
  }

  if (initialUrl) {
    el.espIpInput.value = initialUrl;
    el.setupHint.textContent = `Saved address: ${initialUrl}`;
    // Background auto-connect without blocking UI or showing an aggressive initial banner
    testAndConnect(initialUrl, false);
  }
})();
