"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import { ref, onValue, set, off } from "firebase/database";
import { database, hasFirebaseConfig } from "@/lib/firebase";
import type {
  SensorReadings,
  ControlState,
  SystemState,
  ChartDataPoint,
  WeatherData,
  GeocodingResult,
  VegetableProfile,
  PinoutRow,
} from "@/lib/types";
import {
  Thermometer,
  Droplets,
  BatteryCharging,
  CloudSun,
  Zap,
  ZapOff,
  Fan,
  Cpu,
  LayoutDashboard,
  Carrot,
  SlidersHorizontal,
  CircuitBoard,
  Snowflake,
  Sun,
  Wind,
  AlertTriangle,
  Wifi,
  WifiOff,
  Clock,
  ChevronRight,
  Menu,
  X,
  MapPin,
  Search,
  Loader2,
} from "lucide-react";

// ─── Dynamic Recharts (SSR disabled) ───────────────────────────────────────
// Outer React.ComponentType<any> cast preserves children/props support while
// bypassing the recharts 2.15.x / Next.js dynamic() type incompatibility.
const LineChart = dynamic(
  () => import("recharts").then((m) => m.LineChart),
  { ssr: false }
) as React.ComponentType<any>;
const Line = dynamic(
  () => import("recharts").then((m) => m.Line),
  { ssr: false }
) as React.ComponentType<any>;
const XAxis = dynamic(
  () => import("recharts").then((m) => m.XAxis),
  { ssr: false }
) as React.ComponentType<any>;
const YAxis = dynamic(
  () => import("recharts").then((m) => m.YAxis),
  { ssr: false }
) as React.ComponentType<any>;
const CartesianGrid = dynamic(
  () => import("recharts").then((m) => m.CartesianGrid),
  { ssr: false }
) as React.ComponentType<any>;
const Tooltip = dynamic(
  () => import("recharts").then((m) => m.Tooltip),
  { ssr: false }
) as React.ComponentType<any>;
const Legend = dynamic(
  () => import("recharts").then((m) => m.Legend),
  { ssr: false }
) as React.ComponentType<any>;
const ResponsiveContainer = dynamic(
  () => import("recharts").then((m) => m.ResponsiveContainer),
  { ssr: false }
) as React.ComponentType<any>;

// ─── Constants ─────────────────────────────────────────────────────────────
const VEGETABLES: VegetableProfile[] = [
  { name: "Tomato", targetTemp: 11, emoji: "🍅", description: "Ideal: 10–13°C • NER staple crop, moisture-sensitive" },
  { name: "Ginger", targetTemp: 13, emoji: "🫚", description: "Ideal: 12–14°C • Meghalaya export-grade rhizome" },
  { name: "Cabbage", targetTemp: 2, emoji: "🥬", description: "Ideal: 0–4°C • High-altitude NER variety" },
  { name: "Citrus (Khasi Mandarin)", targetTemp: 7, emoji: "🍊", description: "Ideal: 5–9°C • Indigenous NER citrus" },
  { name: "King Chilli (Bhut Jolokia)", targetTemp: 10, emoji: "🌶️", description: "Ideal: 8–12°C • Nagaland / Assam specialty" },
  { name: "Black Sesame", targetTemp: 15, emoji: "🌿", description: "Ideal: 14–16°C • Manipur heritage oilseed" },
];

const PINOUT_DATA: PinoutRow[] = [
  { component: "DHT22 (Chamber Temp + Humidity)", gpio: "GPIO 4", notes: "3.3V logic, 10kΩ pull-up recommended" },
  { component: "DS18B20 (PCM Gel Battery Temp)", gpio: "GPIO 5", notes: "4.7kΩ pull-up to 3.3V, OneWire bus" },
  { component: "Relay CH1 — TEC1-12706 Peltier", gpio: "GPIO 18", notes: "Active LOW, 12V 6A load via SMPS" },
  { component: "Relay CH2 — Hot-Side Fan", gpio: "GPIO 19", notes: "Active LOW, 12V 0.3A brushless" },
  { component: "Relay CH3 — Cold-Side Fan", gpio: "GPIO 21", notes: "Active LOW, 12V 0.15A axial" },
  { component: "Relay CH4 — Reserved / Aux", gpio: "GPIO 22", notes: "Spare channel for expansion" },
  { component: "SMPS 12V 10A Input", gpio: "—", notes: "AC 220V → DC 12V, powers Peltier + fans" },
  { component: "ESP32 DevKit Power", gpio: "VIN / 5V USB", notes: "USB-C or buck converter from 12V rail" },
];

const CHART_MAX_POINTS = 50;

// ─── Mock Data Generator ──────────────────────────────────────────────────
function createMockReadings(prev: SensorReadings): SensorReadings {
  const walk = (val: number, range: number = 0.2) =>
    Math.round((val + (Math.random() - 0.5) * range * 2) * 10) / 10;
  return {
    chamber_temp: Math.max(0, Math.min(20, walk(prev.chamber_temp))),
    chamber_humidity: Math.max(40, Math.min(95, walk(prev.chamber_humidity, 0.5))),
    pcm_temp: Math.max(-2, Math.min(15, walk(prev.pcm_temp))),
    ambient_temp: Math.max(20, Math.min(38, walk(prev.ambient_temp, 0.1))),
  };
}

function computePCMReserve(pcmTemp: number): number {
  if (pcmTemp <= 2) return 100;
  if (pcmTemp >= 10) return 0;
  return Math.round(((10 - pcmTemp) / 8) * 100);
}

// ─── Tab IDs ───────────────────────────────────────────────────────────────
type TabId = "dashboard" | "storage" | "controls" | "hardware";

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: "dashboard", label: "Dashboard", icon: <LayoutDashboard size={20} /> },
  { id: "storage", label: "Vegetable Storage", icon: <Carrot size={20} /> },
  { id: "controls", label: "Control Logic", icon: <SlidersHorizontal size={20} /> },
  { id: "hardware", label: "Hardware & Pins", icon: <CircuitBoard size={20} /> },
];

// ═══════════════════════════════════════════════════════════════════════════
// MAIN PAGE COMPONENT
// ═══════════════════════════════════════════════════════════════════════════
export default function HomePage() {
  // ─── State ─────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<TabId>("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [demoMode, setDemoMode] = useState(!hasFirebaseConfig);
  const [readings, setReadings] = useState<SensorReadings>({
    chamber_temp: 8.0,
    chamber_humidity: 72,
    pcm_temp: 4.5,
    ambient_temp: 28.0,
  });
  const [controls, setControls] = useState<ControlState>({
    mode: "AUTO",
    relay_peltier: false,
    relay_hotfan: false,
    relay_coldfan: false,
    manual_relay_peltier: false,
    manual_relay_hotfan: false,
    manual_relay_coldfan: false,
    target_temp: 8,
  });
  const [system, setSystem] = useState<SystemState>({
    status: "RUNNING",
    uptime_seconds: 0,
    wifi_rssi: -55,
  });
  const [chartData, setChartData] = useState<ChartDataPoint[]>([]);
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [locationQuery, setLocationQuery] = useState("");
  const [locationCoords, setLocationCoords] = useState({ lat: 25.5788, lon: 91.8933, name: "Shillong" });
  const [geoResults, setGeoResults] = useState<GeocodingResult[]>([]);
  const [geoLoading, setGeoLoading] = useState(false);
  const [showGeoDropdown, setShowGeoDropdown] = useState(false);
  const [selectedVeg, setSelectedVeg] = useState<string>("Tomato");
  const [mounted, setMounted] = useState(false);

  const readingsRef = useRef(readings);
  readingsRef.current = readings;

  // ─── Mount guard ──────────────────────────────────────────────────────
  useEffect(() => {
    setMounted(true);
  }, []);

  // ─── Firebase Realtime Listeners OR Mock Fallback ─────────────────────
  useEffect(() => {
    if (!mounted) return;

    if (hasFirebaseConfig && database) {
      const readingsDbRef = ref(database, "/readings");
      const controlsDbRef = ref(database, "/controls");
      const systemDbRef = ref(database, "/system");

      let firebaseFailed = false;

      const readingsUnsub = onValue(
        readingsDbRef,
        (snapshot) => {
          const data = snapshot.val();
          if (data) {
            setReadings(data as SensorReadings);
            setDemoMode(false);
          }
        },
        (error) => {
          console.warn("Firebase readings listener error:", error);
          if (!firebaseFailed) {
            firebaseFailed = true;
            setDemoMode(true);
          }
        }
      );

      onValue(
        controlsDbRef,
        (snapshot) => {
          const data = snapshot.val();
          if (data) setControls(data as ControlState);
        },
        (error) => console.warn("Firebase controls error:", error)
      );

      onValue(
        systemDbRef,
        (snapshot) => {
          const data = snapshot.val();
          if (data) setSystem(data as SystemState);
        },
        (error) => console.warn("Firebase system error:", error)
      );

      return () => {
        off(readingsDbRef);
        off(controlsDbRef);
        off(systemDbRef);
      };
    } else {
      // Mock mode: random walk every 3 seconds
      setDemoMode(true);
      const interval = setInterval(() => {
        setReadings((prev) => createMockReadings(prev));
      }, 3000);
      return () => clearInterval(interval);
    }
  }, [mounted]);

  // ─── Chart Data Accumulator (sliding window, interval-driven) ──────
  useEffect(() => {
    if (!mounted) return;

    const pushDataPoint = () => {
      const now = new Date();
      const timeLabel = `${now.getHours().toString().padStart(2, "0")}:${now
        .getMinutes()
        .toString()
        .padStart(2, "0")}:${now.getSeconds().toString().padStart(2, "0")}`;

      setChartData((prev) => {
        const next = [
          ...prev,
          {
            time: timeLabel,
            chamberTemp: readingsRef.current.chamber_temp,
            pcmTemp: readingsRef.current.pcm_temp,
          },
        ];
        return next.slice(-CHART_MAX_POINTS);
      });
    };

    // Push first point immediately, then every 3 seconds
    pushDataPoint();
    const interval = setInterval(pushDataPoint, 3000);
    return () => clearInterval(interval);
  }, [mounted]);

  // ─── Geocoding Search (Open-Meteo, India only) ─────────────────────
  const searchLocation = useCallback(async (query: string) => {
    if (query.trim().length < 2) {
      setGeoResults([]);
      setShowGeoDropdown(false);
      return;
    }
    setGeoLoading(true);
    try {
      const res = await fetch(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query.trim())}&count=6&language=en&country=IN`
      );
      const data = await res.json();
      if (data?.results?.length) {
        setGeoResults(
          data.results.map((r: any) => ({
            name: r.name,
            admin1: r.admin1,
            latitude: r.latitude,
            longitude: r.longitude,
            country: r.country,
          }))
        );
        setShowGeoDropdown(true);
      } else {
        setGeoResults([]);
        setShowGeoDropdown(true); // show "no results"
      }
    } catch (e) {
      console.warn("Geocoding search failed:", e);
      setGeoResults([]);
    }
    setGeoLoading(false);
  }, []);

  const selectLocation = useCallback((result: GeocodingResult) => {
    const label = result.admin1
      ? `${result.name}, ${result.admin1}`
      : result.name;
    setLocationCoords({ lat: result.latitude, lon: result.longitude, name: label });
    setLocationQuery("");
    setGeoResults([]);
    setShowGeoDropdown(false);
    setWeather(null); // clear stale data, new fetch will fire via useEffect
  }, []);

  // ─── Weather API (Open-Meteo, 15-minute poll, dynamic location) ────
  const fetchWeather = useCallback(async () => {
    try {
      const res = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${locationCoords.lat}&longitude=${locationCoords.lon}&current=temperature_2m`
      );
      const data = await res.json();
      if (data?.current?.temperature_2m !== undefined) {
        setWeather({
          temperature: data.current.temperature_2m,
          time: data.current.time,
          locationName: locationCoords.name,
        });
      }
    } catch (e) {
      console.warn("Weather fetch failed:", e);
    }
  }, [locationCoords]);

  useEffect(() => {
    if (!mounted) return;
    fetchWeather();
    const interval = setInterval(fetchWeather, 15 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchWeather, mounted]);

  // ─── Firebase Write Helpers ───────────────────────────────────────────
  const writeControl = useCallback(
    (path: string, value: boolean | string | number) => {
      if (hasFirebaseConfig && database) {
        const dbRef = ref(database, `/controls/${path}`);
        set(dbRef, value).catch((e) =>
          console.error(`Failed to write /controls/${path}:`, e)
        );
      }
      // Also update local state for immediate UI feedback
      setControls((prev) => ({ ...prev, [path]: value }));
    },
    []
  );

  const toggleMode = useCallback(() => {
    const newMode = controls.mode === "AUTO" ? "MANUAL" : "AUTO";
    writeControl("mode", newMode);
  }, [controls.mode, writeControl]);

  const setTargetTemp = useCallback(
    (temp: number) => {
      writeControl("target_temp", temp);
    },
    [writeControl]
  );

  // ─── Derived Values ──────────────────────────────────────────────────
  const pcmReserve = computePCMReserve(readings.pcm_temp);
  const isPowerOutage = system.status === "POWER_OUTAGE";

  if (!mounted) return null;

  // ═══════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════
  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* ─── Mobile Overlay ─────────────────────────────────────────── */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/60 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ─── Sidebar ───────────────────────────────────────────────── */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 bg-surface border-r border-highlight/30 flex flex-col transition-transform duration-300 lg:static lg:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Logo */}
        <div className="p-5 border-b border-highlight/30">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-accent/20 flex items-center justify-center">
              <Snowflake className="text-accent" size={22} />
            </div>
            <div>
              <h1 className="text-lg font-bold text-white leading-tight">
                ColdVault
              </h1>
              <p className="text-xs text-highlight">NER Smart Storage</p>
            </div>
          </div>
        </div>

        {/* Nav Items */}
        <nav className="flex-1 p-3 space-y-1">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => {
                setActiveTab(tab.id);
                setSidebarOpen(false);
              }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all duration-200 ${
                activeTab === tab.id
                  ? "bg-accent/15 text-accent border border-accent/30"
                  : "text-gray-400 hover:bg-highlight/20 hover:text-white"
              }`}
            >
              {tab.icon}
              {tab.label}
              {activeTab === tab.id && (
                <ChevronRight size={16} className="ml-auto" />
              )}
            </button>
          ))}
        </nav>

        {/* Status Footer */}
        <div className="p-4 border-t border-highlight/30 space-y-3">
          {/* Connection Status */}
          <div className="flex items-center gap-2 text-xs">
            {demoMode ? (
              <>
                <WifiOff size={14} className="text-yellow-400" />
                <span className="text-yellow-400">Offline — Demo Mode</span>
              </>
            ) : (
              <>
                <Wifi size={14} className="text-green-400" />
                <span className="text-green-400">
                  Live ({system.wifi_rssi} dBm)
                </span>
              </>
            )}
          </div>
          {/* Uptime */}
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <Clock size={14} />
            <span>
              Uptime:{" "}
              {Math.floor(system.uptime_seconds / 3600)}h{" "}
              {Math.floor((system.uptime_seconds % 3600) / 60)}m
            </span>
          </div>
          {/* Credit */}
          <p className="text-[10px] text-gray-600 leading-relaxed">
            SIH26005 Prototype | Engineered by Vasudevan S., Mirdula B., &
            Logesh R.
          </p>
        </div>
      </aside>

      {/* ─── Main Content ──────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col min-h-screen overflow-y-auto">
        {/* Top Bar */}
        <header className="sticky top-0 z-20 bg-surface/80 backdrop-blur-xl border-b border-highlight/30 px-4 py-3 flex items-center gap-4">
          <button
            className="lg:hidden p-2 rounded-lg hover:bg-highlight/20"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu size={20} className="text-gray-400" />
          </button>
          <h2 className="text-lg font-semibold text-white">
            {TABS.find((t) => t.id === activeTab)?.label}
          </h2>

          {/* Demo Mode Badge */}
          {demoMode && (
            <span className="ml-auto px-3 py-1 rounded-full bg-yellow-500/20 border border-yellow-500/40 text-yellow-400 text-xs font-semibold flex items-center gap-1.5 animate-pulse">
              <AlertTriangle size={14} />
              DEMO MODE
            </span>
          )}

          {/* Live indicator */}
          {!demoMode && (
            <span className="ml-auto flex items-center gap-2 text-xs text-green-400">
              <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse-dot" />
              LIVE
            </span>
          )}
        </header>

        {/* Power Outage Banner */}
        {isPowerOutage && (
          <div className="mx-4 mt-3 p-4 rounded-xl bg-red-500/15 border border-red-500/40 flex items-center gap-3">
            <ZapOff size={24} className="text-red-400 shrink-0" />
            <div>
              <p className="text-red-400 font-bold text-sm">
                ⚡ POWER OUTAGE DETECTED
              </p>
              <p className="text-red-300/70 text-xs mt-0.5">
                System running on PCM thermal reserve. Estimated hold time based
                on reserve: {pcmReserve > 50 ? "2–4 hours" : "< 1 hour"}
              </p>
            </div>
          </div>
        )}

        {/* Tab Content */}
        <div className="flex-1 p-4 lg:p-6">
          {activeTab === "dashboard" && (
            <DashboardView
              readings={readings}
              pcmReserve={pcmReserve}
              weather={weather}
              chartData={chartData}
              controls={controls}
              locationCoords={locationCoords}
              locationQuery={locationQuery}
              setLocationQuery={setLocationQuery}
              searchLocation={searchLocation}
              geoResults={geoResults}
              geoLoading={geoLoading}
              showGeoDropdown={showGeoDropdown}
              setShowGeoDropdown={setShowGeoDropdown}
              selectLocation={selectLocation}
            />
          )}
          {activeTab === "storage" && (
            <StorageView
              selectedVeg={selectedVeg}
              onSelect={(name, temp) => {
                setSelectedVeg(name);
                setTargetTemp(temp);
              }}
              currentTemp={readings.chamber_temp}
              targetTemp={controls.target_temp}
            />
          )}
          {activeTab === "controls" && (
            <ControlsView
              controls={controls}
              toggleMode={toggleMode}
              writeControl={writeControl}
            />
          )}
          {activeTab === "hardware" && <HardwareView />}
        </div>
      </main>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB 1: DASHBOARD VIEW
// ═══════════════════════════════════════════════════════════════════════════
function DashboardView({
  readings,
  pcmReserve,
  weather,
  chartData,
  controls,
  locationCoords,
  locationQuery,
  setLocationQuery,
  searchLocation,
  geoResults,
  geoLoading,
  showGeoDropdown,
  setShowGeoDropdown,
  selectLocation,
}: {
  readings: SensorReadings;
  pcmReserve: number;
  weather: WeatherData | null;
  chartData: ChartDataPoint[];
  controls: ControlState;
  locationCoords: { lat: number; lon: number; name: string };
  locationQuery: string;
  setLocationQuery: (q: string) => void;
  searchLocation: (q: string) => void;
  geoResults: GeocodingResult[];
  geoLoading: boolean;
  showGeoDropdown: boolean;
  setShowGeoDropdown: (v: boolean) => void;
  selectLocation: (r: GeocodingResult) => void;
}) {
  // Debounce timer for geocoding search
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  const handleQueryChange = (value: string) => {
    setLocationQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      searchLocation(value);
    }, 400);
  };

  const stats = [
    {
      label: "Chamber Temp",
      value: `${readings.chamber_temp}°C`,
      icon: <Thermometer size={22} />,
      color: readings.chamber_temp > controls.target_temp + 2 ? "text-red-400" : "text-accent",
      bgColor: readings.chamber_temp > controls.target_temp + 2 ? "bg-red-400/10" : "bg-accent/10",
      sub: `Target: ${controls.target_temp}°C`,
    },
    {
      label: "Humidity",
      value: `${readings.chamber_humidity}%`,
      icon: <Droplets size={22} />,
      color: "text-blue-400",
      bgColor: "bg-blue-400/10",
      sub: readings.chamber_humidity > 85 ? "⚠ High moisture" : "Optimal range",
    },
    {
      label: "PCM Reserve",
      value: `${pcmReserve}%`,
      icon: <BatteryCharging size={22} />,
      color: pcmReserve > 50 ? "text-green-400" : pcmReserve > 20 ? "text-yellow-400" : "text-red-400",
      bgColor: pcmReserve > 50 ? "bg-green-400/10" : pcmReserve > 20 ? "bg-yellow-400/10" : "bg-red-400/10",
      sub: `Gel: ${readings.pcm_temp}°C`,
    },
    {
      label: `Ambient (${locationCoords.name})`,
      value: weather ? `${weather.temperature}°C` : `${readings.ambient_temp}°C`,
      icon: <CloudSun size={22} />,
      color: "text-orange-400",
      bgColor: "bg-orange-400/10",
      sub: weather ? `Open-Meteo · ${locationCoords.name}` : "Sensor fallback",
    },
  ];

  return (
    <div className="space-y-6">
      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {stats.map((s) => (
          <div
            key={s.label}
            className="bg-surface rounded-xl border border-highlight/20 p-5 hover:border-highlight/50 transition-colors"
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs text-gray-400 uppercase tracking-wider font-medium">
                {s.label}
              </span>
              <div className={`p-2 rounded-lg ${s.bgColor}`}>
                <span className={s.color}>{s.icon}</span>
              </div>
            </div>
            <p className={`text-3xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-xs text-gray-500 mt-1">{s.sub}</p>
          </div>
        ))}
      </div>

      {/* Location Search */}
      <div className="bg-surface rounded-xl border border-highlight/20 p-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex items-center gap-2 shrink-0">
            <MapPin size={16} className="text-accent" />
            <span className="text-sm font-medium text-white">Weather Location</span>
          </div>
          <div className="relative flex-1 max-w-md">
            <div className="relative">
              <input
                type="text"
                value={locationQuery}
                onChange={(e) => handleQueryChange(e.target.value)}
                onFocus={() => { if (geoResults.length > 0) setShowGeoDropdown(true); }}
                placeholder={`Currently: ${locationCoords.name} — type to search…`}
                className="w-full bg-background border border-highlight/30 rounded-lg pl-9 pr-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20 transition-colors"
              />
              <div className="absolute left-3 top-1/2 -translate-y-1/2">
                {geoLoading ? (
                  <Loader2 size={15} className="text-accent animate-spin" />
                ) : (
                  <Search size={15} className="text-gray-500" />
                )}
              </div>
            </div>

            {/* Dropdown */}
            {showGeoDropdown && (
              <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-surface border border-highlight/30 rounded-lg shadow-2xl overflow-hidden">
                {geoResults.length > 0 ? (
                  geoResults.map((r, i) => (
                    <button
                      key={`${r.latitude}-${r.longitude}-${i}`}
                      onClick={() => selectLocation(r)}
                      className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-highlight/15 transition-colors border-b border-highlight/10 last:border-b-0"
                    >
                      <MapPin size={14} className="text-accent shrink-0" />
                      <div>
                        <p className="text-sm text-white font-medium">{r.name}</p>
                        <p className="text-xs text-gray-500">
                          {r.admin1 ? `${r.admin1}, ` : ""}India · {r.latitude.toFixed(2)}°N, {r.longitude.toFixed(2)}°E
                        </p>
                      </div>
                    </button>
                  ))
                ) : (
                  <div className="px-4 py-3 text-sm text-gray-500">
                    No Indian cities found for &ldquo;{locationQuery}&rdquo;
                  </div>
                )}
              </div>
            )}
          </div>
          <span className="text-xs text-gray-500 hidden sm:block">
            {locationCoords.lat.toFixed(4)}°N, {locationCoords.lon.toFixed(4)}°E
          </span>
        </div>
      </div>

      {/* Live Chart */}
      <div className="bg-surface rounded-xl border border-highlight/20 p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-white">
            Temperature Trends (Live)
          </h3>
          <span className="text-xs text-gray-500">
            Last {chartData.length} readings
          </span>
        </div>
        <div className="w-full h-[320px]">
          {chartData.length > 1 ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#3A506B33" />
                <XAxis
                  dataKey="time"
                  stroke="#3A506B"
                  tick={{ fill: "#6B7280", fontSize: 11 }}
                  interval="preserveStartEnd"
                />
                <YAxis
                  stroke="#3A506B"
                  tick={{ fill: "#6B7280", fontSize: 11 }}
                  domain={["auto", "auto"]}
                  unit="°C"
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#1C2541",
                    border: "1px solid #3A506B",
                    borderRadius: "8px",
                    fontSize: "12px",
                  }}
                  labelStyle={{ color: "#9CA3AF" }}
                />
                <Legend
                  wrapperStyle={{ fontSize: "12px", paddingTop: "8px" }}
                />
                <Line
                  type="monotone"
                  dataKey="chamberTemp"
                  name="Chamber °C"
                  stroke="#00F5D4"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
                <Line
                  type="monotone"
                  dataKey="pcmTemp"
                  name="PCM Gel °C"
                  stroke="#3B82F6"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex items-center justify-center text-gray-500 text-sm">
              Collecting data points…
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB 2: VEGETABLE STORAGE VIEW
// ═══════════════════════════════════════════════════════════════════════════
function StorageView({
  selectedVeg,
  onSelect,
  currentTemp,
  targetTemp,
}: {
  selectedVeg: string;
  onSelect: (name: string, temp: number) => void;
  currentTemp: number;
  targetTemp: number;
}) {
  return (
    <div className="space-y-6">
      {/* Current Status */}
      <div className="bg-surface rounded-xl border border-highlight/20 p-5">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex-1">
            <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">
              Active Storage Profile
            </p>
            <p className="text-2xl font-bold text-white">{selectedVeg}</p>
          </div>
          <div className="flex gap-6">
            <div className="text-center">
              <p className="text-xs text-gray-400">Target</p>
              <p className="text-xl font-bold text-accent">{targetTemp}°C</p>
            </div>
            <div className="text-center">
              <p className="text-xs text-gray-400">Current</p>
              <p
                className={`text-xl font-bold ${
                  Math.abs(currentTemp - targetTemp) <= 2
                    ? "text-green-400"
                    : "text-red-400"
                }`}
              >
                {currentTemp}°C
              </p>
            </div>
            <div className="text-center">
              <p className="text-xs text-gray-400">Deviation</p>
              <p
                className={`text-xl font-bold ${
                  Math.abs(currentTemp - targetTemp) <= 2
                    ? "text-green-400"
                    : "text-yellow-400"
                }`}
              >
                {Math.abs(currentTemp - targetTemp).toFixed(1)}°C
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Crop Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {VEGETABLES.map((veg) => {
          const isActive = selectedVeg === veg.name;
          return (
            <button
              key={veg.name}
              onClick={() => onSelect(veg.name, veg.targetTemp)}
              className={`text-left bg-surface rounded-xl border p-5 transition-all duration-200 hover:scale-[1.02] ${
                isActive
                  ? "border-accent/60 ring-2 ring-accent/20 shadow-lg shadow-accent/5"
                  : "border-highlight/20 hover:border-highlight/50"
              }`}
            >
              <div className="flex items-start justify-between mb-3">
                <span className="text-3xl">{veg.emoji}</span>
                {isActive && (
                  <span className="px-2 py-0.5 rounded-full bg-accent/20 text-accent text-[10px] font-bold uppercase">
                    Active
                  </span>
                )}
              </div>
              <h4 className="text-base font-semibold text-white mb-1">
                {veg.name}
              </h4>
              <p className="text-xs text-gray-400 mb-3">{veg.description}</p>
              <div className="flex items-center gap-2">
                <Thermometer size={14} className="text-accent" />
                <span className="text-sm font-medium text-accent">
                  {veg.targetTemp}°C
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB 3: CONTROL LOGIC VIEW
// ═══════════════════════════════════════════════════════════════════════════
function ControlsView({
  controls,
  toggleMode,
  writeControl,
}: {
  controls: ControlState;
  toggleMode: () => void;
  writeControl: (path: string, value: boolean | string | number) => void;
}) {
  const isManual = controls.mode === "MANUAL";

  const relays = [
    {
      key: "manual_relay_peltier",
      label: "TEC Peltier Module",
      desc: "TEC1-12706 thermoelectric cooler",
      icon: <Snowflake size={20} />,
      active: controls.manual_relay_peltier,
      autoActive: controls.relay_peltier,
    },
    {
      key: "manual_relay_hotfan",
      label: "Hot-Side Fan",
      desc: "Heat dissipation exhaust fan",
      icon: <Sun size={20} />,
      active: controls.manual_relay_hotfan,
      autoActive: controls.relay_hotfan,
    },
    {
      key: "manual_relay_coldfan",
      label: "Cold-Side Fan",
      desc: "Cold air circulation fan",
      icon: <Wind size={20} />,
      active: controls.manual_relay_coldfan,
      autoActive: controls.relay_coldfan,
    },
  ];

  return (
    <div className="space-y-6">
      {/* Mode Toggle */}
      <div className="bg-surface rounded-xl border border-highlight/20 p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-white mb-1">
              Operation Mode
            </h3>
            <p className="text-sm text-gray-400">
              {isManual
                ? "Manual control — you manage each relay independently"
                : "Automatic PID control — ESP32 manages relays based on target temperature"}
            </p>
          </div>
          <div className="flex items-center gap-4">
            <span
              className={`text-sm font-medium ${
                !isManual ? "text-accent" : "text-gray-500"
              }`}
            >
              AUTO
            </span>
            <button
              onClick={toggleMode}
              className={`toggle-switch ${isManual ? "active" : ""}`}
              aria-label="Toggle operation mode"
            />
            <span
              className={`text-sm font-medium ${
                isManual ? "text-accent" : "text-gray-500"
              }`}
            >
              MANUAL
            </span>
          </div>
        </div>
      </div>

      {/* Relay Controls */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {relays.map((relay) => {
          const isOn = isManual ? relay.active : relay.autoActive;
          return (
            <div
              key={relay.key}
              className={`bg-surface rounded-xl border p-5 transition-all ${
                isOn
                  ? "border-accent/40 shadow-lg shadow-accent/5"
                  : "border-highlight/20"
              }`}
            >
              <div className="flex items-center justify-between mb-4">
                <div
                  className={`p-2.5 rounded-lg ${
                    isOn ? "bg-accent/15 text-accent" : "bg-highlight/20 text-gray-500"
                  }`}
                >
                  {relay.icon}
                </div>
                <span
                  className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase ${
                    isOn
                      ? "bg-accent/20 text-accent"
                      : "bg-gray-700/50 text-gray-500"
                  }`}
                >
                  {isOn ? "ON" : "OFF"}
                </span>
              </div>
              <h4 className="text-sm font-semibold text-white mb-1">
                {relay.label}
              </h4>
              <p className="text-xs text-gray-500 mb-4">{relay.desc}</p>

              {isManual ? (
                <button
                  onClick={() => writeControl(relay.key, !relay.active)}
                  className={`w-full py-2.5 rounded-lg text-sm font-medium transition-all ${
                    relay.active
                      ? "bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/30"
                      : "bg-accent/15 text-accent hover:bg-accent/25 border border-accent/30"
                  }`}
                >
                  {relay.active ? "Turn OFF" : "Turn ON"}
                </button>
              ) : (
                <div className="w-full py-2.5 rounded-lg text-sm text-center text-gray-500 bg-highlight/10 border border-highlight/20 cursor-not-allowed">
                  Auto-managed
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Info Card */}
      <div className="bg-surface/50 rounded-xl border border-highlight/10 p-4 text-xs text-gray-500 space-y-1">
        <p>
          <strong className="text-gray-400">AUTO mode:</strong> The ESP32 runs a
          PID loop to maintain chamber temperature at the set target. Relay
          states are read-only.
        </p>
        <p>
          <strong className="text-gray-400">MANUAL mode:</strong> Each relay
          button writes directly to Firebase at{" "}
          <code className="text-accent/60">/controls/manual_relay_*</code>. The
          ESP32 reads these values and actuates the relays accordingly.
        </p>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB 4: HARDWARE & ARCHITECTURE VIEW
// ═══════════════════════════════════════════════════════════════════════════
function HardwareView() {
  return (
    <div className="space-y-6">
      {/* Architecture Overview */}
      <div className="bg-surface rounded-xl border border-highlight/20 p-6">
        <h3 className="text-base font-semibold text-white mb-4">
          System Architecture
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            {
              icon: <Sun size={24} />,
              title: "Power Layer",
              items: [
                "Solar Panel → MPPT Charger",
                "12V 10A SMPS Backup",
                "LiFePO₄ Battery Bank",
              ],
            },
            {
              icon: <Cpu size={24} />,
              title: "Control Layer",
              items: [
                "ESP32 DevKit V1 MCU",
                "DHT22 + DS18B20 Sensors",
                "4-Channel Relay Module",
              ],
            },
            {
              icon: <Snowflake size={24} />,
              title: "Cooling Layer",
              items: [
                "TEC1-12706 Peltier × 2",
                "PCM Gel Battery (HS-29)",
                "Dual Fan Heat Exchanger",
              ],
            },
          ].map((block) => (
            <div
              key={block.title}
              className="bg-background/50 rounded-lg p-4 border border-highlight/10"
            >
              <div className="flex items-center gap-2 mb-3 text-accent">
                {block.icon}
                <h4 className="text-sm font-semibold">{block.title}</h4>
              </div>
              <ul className="space-y-2">
                {block.items.map((item) => (
                  <li
                    key={item}
                    className="text-xs text-gray-400 flex items-start gap-2"
                  >
                    <ChevronRight
                      size={12}
                      className="text-highlight mt-0.5 shrink-0"
                    />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      {/* ESP32 Pinout Table */}
      <div className="bg-surface rounded-xl border border-highlight/20 p-6">
        <h3 className="text-base font-semibold text-white mb-4">
          ESP32 GPIO Pinout
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-highlight/30">
                <th className="text-left py-3 px-4 text-xs uppercase tracking-wider text-gray-400 font-medium">
                  Component
                </th>
                <th className="text-left py-3 px-4 text-xs uppercase tracking-wider text-gray-400 font-medium">
                  GPIO Pin
                </th>
                <th className="text-left py-3 px-4 text-xs uppercase tracking-wider text-gray-400 font-medium">
                  Notes
                </th>
              </tr>
            </thead>
            <tbody>
              {PINOUT_DATA.map((row, i) => (
                <tr
                  key={i}
                  className="border-b border-highlight/10 hover:bg-highlight/5 transition-colors"
                >
                  <td className="py-3 px-4 text-white font-medium">
                    {row.component}
                  </td>
                  <td className="py-3 px-4">
                    <code className="px-2 py-0.5 rounded bg-accent/10 text-accent text-xs font-mono">
                      {row.gpio}
                    </code>
                  </td>
                  <td className="py-3 px-4 text-gray-400">{row.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Data Flow Diagram */}
      <div className="bg-surface rounded-xl border border-highlight/20 p-6">
        <h3 className="text-base font-semibold text-white mb-4">
          Data Flow
        </h3>
        <div className="flex flex-wrap items-center justify-center gap-3 text-xs">
          {[
            { label: "Sensors", sub: "DHT22 + DS18B20" },
            { label: "ESP32", sub: "PID Logic" },
            { label: "Firebase RTDB", sub: "Cloud Sync" },
            { label: "Next.js Dashboard", sub: "This UI" },
          ].map((node, i, arr) => (
            <React.Fragment key={node.label}>
              <div className="bg-background/50 border border-highlight/20 rounded-lg px-4 py-3 text-center min-w-[120px]">
                <p className="text-accent font-semibold">{node.label}</p>
                <p className="text-gray-500 text-[10px] mt-0.5">{node.sub}</p>
              </div>
              {i < arr.length - 1 && (
                <ChevronRight size={18} className="text-highlight shrink-0" />
              )}
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}
