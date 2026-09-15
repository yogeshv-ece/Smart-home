/*
  =====================================================================
  Smart Home Voice Control System - ESP32 Firmware
  =====================================================================
  This firmware:
    - connects to Wi-Fi
    - runs an HTTP REST web server
    - moves a servo (door) on GPIO 13
    - controls a digital light output (relay / MOSFET) on GPIO 25
  All voice recognition happens in the phone/browser dashboard.

  REQUIRED LIBRARIES (Arduino IDE -> Tools -> Manage Libraries):
    - "ESP32Servo" by Kevin Harrington / Jack Christensen
  =====================================================================
*/

#include <WiFi.h>
#include <WebServer.h>
#include <ESP32Servo.h>

// ===================== USER CONFIGURATION ===========================
#if __has_include("secrets.h")
  #include "secrets.h"
#else
  #include "secrets.example.h"
#endif

const char* WIFI_SSID     = WIFI_SSID_SECRET;
const char* WIFI_PASSWORD = WIFI_PASSWORD_SECRET;

// Door servo angles - tune these to match your physical door mechanism
int DOOR_CLOSED_ANGLE = 0;
int DOOR_OPEN_ANGLE   = 90;

// RELAY LOGIC CONFIGURATION:
// Set to true for Active-LOW relay modules (relay turns ON when pin is LOW - most common 5V relay modules)
// Set to false for Active-HIGH relay modules or direct transistors/MOSFETs/LEDs
const bool RELAY_ACTIVE_LOW = true;

// ===================== PIN CONFIGURATION =============================
// --- Servo (door) ---
const int SERVO_PIN = 13;   // Signal wire of the servo (Orange/White)

// --- Light (digital output / relay) ---
const int LIGHT_PIN = 25;   // Light relay or switching module

// ===================== STATE ==========================================
Servo doorServo;
WebServer server(80);

bool doorOpen = false;
bool lightOn  = false;

const unsigned long SERVO_STEP_DELAY_MS = 12;
int currentServoAngle = 0;

// ===================== HELPERS ========================================
void addCORSHeaders() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With, Access-Control-Request-Private-Network");
  server.sendHeader("Access-Control-Allow-Private-Network", "true");
}

void sendJSON(int code, const String& json) {
  addCORSHeaders();
  server.send(code, "application/json", json);
}

String statusJSON(bool success) {
  String json = "{";
  json += "\"success\":" + String(success ? "true" : "false") + ",";
  json += "\"door\":\"" + String(doorOpen ? "open" : "closed") + "\",";
  json += "\"light\":\"" + String(lightOn ? "on" : "off") + "\"";
  json += "}";
  return json;
}

void moveServoSmoothly(int targetAngle) {
  targetAngle = constrain(targetAngle, 0, 180);
  if (targetAngle == currentServoAngle) return;
  int step = (targetAngle > currentServoAngle) ? 1 : -1;
  while (currentServoAngle != targetAngle) {
    currentServoAngle += step;
    doorServo.write(currentServoAngle);
    delay(SERVO_STEP_DELAY_MS);
  }
}

void setLight(bool state) {
  lightOn = state;
  int pinVal = state ? (RELAY_ACTIVE_LOW ? LOW : HIGH) : (RELAY_ACTIVE_LOW ? HIGH : LOW);
  digitalWrite(LIGHT_PIN, pinVal);
}

// ===================== HTTP HANDLERS ===================================
void handleOptions() {
  addCORSHeaders();
  server.send(204);
}

// --- Door routes ---
void handleDoorOpen() {
  doorOpen = true;
  moveServoSmoothly(DOOR_OPEN_ANGLE);
  sendJSON(200, statusJSON(true));
}

void handleDoorClose() {
  doorOpen = false;
  moveServoSmoothly(DOOR_CLOSED_ANGLE);
  sendJSON(200, statusJSON(true));
}

// --- Light routes ---
void handleLightOn() {
  setLight(true);
  sendJSON(200, statusJSON(true));
}

void handleLightOff() {
  setLight(false);
  sendJSON(200, statusJSON(true));
}

void handleLightToggle() {
  setLight(!lightOn);
  sendJSON(200, statusJSON(true));
}

// --- Emergency / All off ---
void handleAllOff() {
  setLight(false);
  sendJSON(200, statusJSON(true));
}

void handleStatus() {
  sendJSON(200, statusJSON(true));
}

void handleNotFound() {
  sendJSON(404, "{\"success\":false,\"error\":\"unknown endpoint\"}");
}

// ===================== SETUP / LOOP =====================================
void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println("\n=================================");
  Serial.println("  ESP32 SMART HOME BOOTING UP    ");
  Serial.println("=================================");

  // --- Door servo ---
  Serial.println("Initializing Servo...");
  ESP32PWM::allocateTimer(0);
  doorServo.setPeriodHertz(50);
  doorServo.attach(SERVO_PIN, 500, 2400);
  currentServoAngle = DOOR_CLOSED_ANGLE;
  doorServo.write(currentServoAngle);
  doorOpen = false;

  // --- Light (digital output / relay) ---
  Serial.println("Initializing Light GPIO...");
  pinMode(LIGHT_PIN, OUTPUT);
  setLight(false);

  // --- Wi-Fi ---
  Serial.printf("Connecting to Wi-Fi SSID: %s\n", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  while (WiFi.status() != WL_CONNECTED) {
    delay(400);
    Serial.print(".");
  }
  Serial.println();
  Serial.println("WiFi Connected Successfully!");
  Serial.print("ESP32 IP Address : ");
  Serial.println(WiFi.localIP());

  // --- HTTP routes ---
  server.on("/api/door/open",   HTTP_GET, handleDoorOpen);
  server.on("/api/door/close",  HTTP_GET, handleDoorClose);
  server.on("/api/light/on",    HTTP_GET, handleLightOn);
  server.on("/api/light/off",   HTTP_GET, handleLightOff);
  server.on("/api/light/toggle",HTTP_GET, handleLightToggle);
  server.on("/api/all/off",     HTTP_GET, handleAllOff);
  server.on("/api/status",      HTTP_GET, handleStatus);
  server.onNotFound(handleNotFound);

  // CORS preflight (OPTIONS)
  server.on("/api/door/open",   HTTP_OPTIONS, handleOptions);
  server.on("/api/door/close",  HTTP_OPTIONS, handleOptions);
  server.on("/api/light/on",    HTTP_OPTIONS, handleOptions);
  server.on("/api/light/off",   HTTP_OPTIONS, handleOptions);
  server.on("/api/light/toggle",HTTP_OPTIONS, handleOptions);
  server.on("/api/all/off",     HTTP_OPTIONS, handleOptions);
  server.on("/api/status",      HTTP_OPTIONS, handleOptions);

  server.begin();
  Serial.println("HTTP Web Server Started!");
}

void loop() {
  server.handleClient();

  static unsigned long lastWifiCheck = 0;
  if (millis() - lastWifiCheck > 5000) {
    lastWifiCheck = millis();
    if (WiFi.status() != WL_CONNECTED) {
      Serial.println("WiFi disconnected, reconnecting...");
      WiFi.disconnect();
      WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    }
  }
}
