# Smart Home Control System (ESP32 + Mobile Web Dashboard)

A lightweight, mobile-first IoT control panel for **ESP32**, featuring:
- **Door Control:** Smooth servo movement (Open / Close)
- **Light Control:** Digital output for relay or MOSFET (ON / OFF)
- **Voice Commands:** Browser-based speech recognition on mobile (Web Speech API)
- **Live Status Polling:** Real-time state synchronization with hardware
- **Mobile Responsive & PWA:** Installable as a Progressive Web App on Android / iOS
- **Configurable Connection:** Stores your ESP32 IP or remote gateway URL in `localStorage` with auto-reconnect

---

## 1. System Architecture

```text
               +----------------------------------+
               |  Android Phone / Desktop Chrome  |
               |  Web Dashboard (HTML / CSS / JS) |
               +----------------------------------+
                                |
             +------------------+------------------+
             |                                     |
   [Mode A: Local Wi-Fi]                 [Mode B: Remote Internet]
             |                                     |
    Direct HTTP Requests                  Secure HTTPS Tunnel
  (e.g. http://192.168.1.50)         (e.g. https://my-tunnel.domain)
             |                                     |
             +------------------+------------------+
                                |
                                v
                     +---------------------+
                     |    ESP32 Web Server |
                     |   (smart_home.ino)  |
                     +---------------------+
                                |
                   +------------+------------+
                   |                         |
              GPIO 13 (PWM)            GPIO 25 (Digital)
                   |                         |
                   v                         v
               SG90 Servo              Relay / MOSFET
              (Door Panel)             (Light Fixture)
```

---

## 2. Local vs. Remote Network Access

### Mode A: Same Wi-Fi Network (Local Access)
* Both your **Phone** and the **ESP32** must be connected to the **same 2.4 GHz Wi-Fi network**.
* You enter the local IP address assigned to the ESP32 (e.g. `192.168.1.50`).
* The dashboard communicates directly with the ESP32 via local REST API calls.

### Mode B: Remote Internet Access (Secure Gateway / Tunnel)
> [!IMPORTANT]
> A publicly hosted HTTPS dashboard (e.g., on Vercel or GitHub Pages) **cannot directly reach private IP addresses (like `192.168.x.x`) across the public internet** without a tunnel or gateway.

If you want to control your home from outside your home Wi-Fi:
1. Run a secure HTTPS tunnel (such as **Cloudflare Tunnel** or **ngrok**) on your home network pointing to the ESP32's local IP on port 80.
2. Enter the resulting public HTTPS URL (e.g., `https://esp32.yourdomain.com`) into the dashboard's address field and tap **Connect**.

---

## 3. Understanding the HTTPS / Mixed Content Rule

Modern mobile browsers (Chrome, Safari, Firefox) enforce strict security policies regarding **Mixed Content** and **Private Network Access (PNA)**:

* If your web dashboard is served over **`https://`** (such as `https://my-app.vercel.app` or GitHub Pages), the browser will **block plain `http://` requests to local private IPs (`http://192.168.x.x`)**.
* **Three ways to use the dashboard:**
  1. **HTTPS Gateway (Recommended for Hosted Web):** Route requests through an HTTPS tunnel (e.g., ngrok or Cloudflare Tunnel) to your ESP32.
  2. **Local HTTP Server (Recommended for Pure Local Wi-Fi):** Serve the dashboard over local HTTP on your home network (e.g., `npx serve` or Python `http.server 8000`), or host the static files directly from the ESP32's LittleFS/SPIFFS flash!
  3. **Android Chrome Site Setting:** On Android Chrome, tap the **Tune / Lock icon** next to the address bar → **Site settings** → set **Insecure content** to **Allow**.

---

## 4. Hardware Wiring Table

| Component | Pin / Wire | Connects to ESP32 Pin | Notes |
|---|---|---|---|
| **Door Servo** | Signal (Orange/Yellow) | **GPIO 13** | Smooth servo sweep |
| **Door Servo** | VCC (Red) | External 5V Power Supply | Join ground with ESP32 |
| **Door Servo** | GND (Brown/Black) | Common GND | Essential shared ground |
| **Light Switch** | IN / Signal | **GPIO 25** | Digital 3.3V logic output (Relay / MOSFET) |
| **Light Switch** | VCC | 3.3V / 5V | Isolated switching module |
| **Light Switch** | GND | Common GND | Essential shared ground |

> [!TIP]
> **Active-LOW vs Active-HIGH Relays:** Most 5V relay modules are Active-LOW (they turn ON when the input is LOW). In `smart_home.ino`, `RELAY_ACTIVE_LOW` is set to `true` by default. If your relay or transistor turns on with HIGH, change `const bool RELAY_ACTIVE_LOW = false;`.

> [!CAUTION]
> **Electrical Safety:** Never connect high-voltage AC mains wiring (110V/220V) directly to the ESP32 pins. Always use an appropriately rated, optocoupled relay module.

---

## 5. ESP32 Firmware Setup

1. Open **Arduino IDE**.
2. Go to **Tools → Manage Libraries...**, search for and install:
   - **`ESP32Servo`** (by Kevin Harrington / Jack Christensen)
3. Open `esp32/smart_home/smart_home.ino`.
4. Copy `esp32/smart_home/secrets.example.h` to `esp32/smart_home/secrets.h` and enter your 2.4 GHz Wi-Fi credentials:
   ```cpp
   #define WIFI_SSID_SECRET     "YOUR_WIFI_SSID"
   #define WIFI_PASSWORD_SECRET "YOUR_WIFI_PASSWORD"
   ```
   *(Note: `secrets.h` is excluded from Git via `.gitignore` to keep your private network credentials secure).*
5. Connect your ESP32 via USB, select your board and COM port, and click **Upload**.
6. Open the **Serial Monitor** (115200 baud). Note the IP address printed:
   ```text
   WiFi Connected Successfully!
   ESP32 IP Address : 192.168.1.50
   HTTP Web Server Started!
   ```

---

## 6. Deploying the Web Dashboard (Free Static Hosting)

The web dashboard is completely static (HTML, CSS, JavaScript) and can be hosted anywhere for free.

### Option A: GitHub Pages
1. Push this directory to a GitHub repository:
   ```bash
   git init
   git add .
   git commit -m "Deploy Smart Home Dashboard"
   git branch -M main
   git remote add origin https://github.com/<YOUR_USERNAME>/<REPO_NAME>.git
   git push -u origin main
   ```
2. Go to your GitHub repository **Settings → Pages**.
3. Under **Build and deployment**, select **Deploy from a branch** → Branch: `main` `/ (root)` → **Save**.
4. Your site will be live at: `https://<YOUR_USERNAME>.github.io/<REPO_NAME>/`.

### Option B: Vercel or Netlify
1. Log in to [Vercel](https://vercel.com) or [Netlify](https://app.netlify.com).
2. Choose **Deploy Project** and select your GitHub repository (or drag-and-drop the project folder into Netlify Drop).
3. Instant live HTTPS URL generated.

---

## 7. Mobile Phone Usage & PWA Installation

1. Open your deployed URL (or local URL) in **Google Chrome on Android**.
2. Tap the Chrome three-dot menu (⋮) → **Add to Home screen** (or **Install App**).
3. The dashboard will install as **"Smart Home Control"** with its own standalone icon on your phone's home screen.
4. Enter your ESP32 IP address or gateway URL and tap **Connect** (or tap **Demo Mode** to test in-browser immediately).
5. When prompted, grant **Microphone permissions** to enable voice commands.

---

## 8. REST API Reference

All endpoints return JSON and include CORS & Private Network Access (PNA) headers:

| Method | Endpoint | Description | JSON Response Example |
|---|---|---|---|
| `GET` | `/api/status` | Current system status | `{"success":true,"door":"closed","light":"off"}` |
| `GET` | `/api/door/open` | Moves door servo to 90° | `{"success":true,"door":"open",...}` |
| `GET` | `/api/door/close` | Moves door servo to 0° | `{"success":true,"door":"closed",...}` |
| `GET` | `/api/light/on` | Turns light output ON | `{"success":true,"light":"on",...}` |
| `GET` | `/api/light/off` | Turns light output OFF | `{"success":true,"light":"off",...}` |
| `GET` | `/api/light/toggle`| Toggles light output state | `{"success":true,"light":"on",...}` |
| `GET` | `/api/all/off` | Emergency Stop (turns Light OFF) | `{"success":true,"light":"off",...}` |

*(All endpoints support `OPTIONS` for browser CORS and Chrome Private Network Access preflights).*

---

## 9. Voice Commands

Tap the **"Speak"** button and speak naturally:

* **Light Control:**
  * `"Turn on the light"` / `"Light on"` / `"Switch on the light"`
  * `"Turn off the light"` / `"Light off"` / `"Switch off the light"`
* **Door Control:**
  * `"Open the door"` / `"Open door"`
  * `"Close the door"` / `"Close door"` / `"Shut the door"`
* **Emergency:**
  * `"Turn everything off"` / `"All off"` / `"Stop everything"`
* **Emergency:**
  * `"Turn everything off"` / `"All off"` / `"Stop everything"`
