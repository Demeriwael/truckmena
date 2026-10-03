import {
  BedDouble,
  Coffee,
  Flag,
  Fuel,
  MapPin,
  Package,
  RotateCcw,
  Truck,
  type LucideIcon,
} from "lucide-react";
import type { DutyStatus, EventType } from "./contracts";

export const eventLabels: Record<EventType, string> = {
  start: "Start",
  driving: "Driving",
  pickup: "Pickup",
  dropoff: "Delivery",
  fuel: "Fuel stop",
  break: "30-minute break",
  rest: "10-hour rest",
  restart: "34-hour restart",
};
export const statusLabels: Record<DutyStatus, string> = {
  OFF: "Off Duty",
  SLEEPER: "Sleeper Berth",
  DRIVING: "Driving",
  ON_DUTY: "On Duty",
};
export const eventIcons: Record<EventType, LucideIcon> = {
  start: MapPin,
  driving: Truck,
  pickup: Package,
  dropoff: Flag,
  fuel: Fuel,
  break: Coffee,
  rest: BedDouble,
  restart: RotateCcw,
};
export const eventSymbols: Record<EventType, string> = {
  start: "S",
  driving: "→",
  pickup: "P",
  dropoff: "D",
  fuel: "F",
  break: "B",
  rest: "R",
  restart: "34",
};
