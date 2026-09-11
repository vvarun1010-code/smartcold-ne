// ─── TypeScript Interfaces ───────────────────────────────────────────────────

export interface SensorReadings {
  chamber_temp: number;
  chamber_humidity: number;
  pcm_temp: number;
  ambient_temp: number;
}

export interface ControlState {
  mode: "AUTO" | "MANUAL";
  relay_peltier: boolean;
  relay_hotfan: boolean;
  relay_coldfan: boolean;
  manual_relay_peltier: boolean;
  manual_relay_hotfan: boolean;
  manual_relay_coldfan: boolean;
  target_temp: number;
}

export interface SystemState {
  status: "RUNNING" | "POWER_OUTAGE" | "IDLE";
  uptime_seconds: number;
  wifi_rssi: number;
}

export interface ChartDataPoint {
  time: string;
  chamberTemp: number;
  pcmTemp: number;
}

export interface WeatherData {
  temperature: number;
  time: string;
}

export interface VegetableProfile {
  name: string;
  targetTemp: number;
  emoji: string;
  description: string;
}

export interface PinoutRow {
  component: string;
  gpio: string;
  notes: string;
}
