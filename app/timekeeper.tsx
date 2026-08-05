"use client";

import Link from "next/link";
import { Component, ErrorInfo, ChangeEvent, FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { Viewer } from "../db/viewer";
import "./messages-motion.css";
import EmployeePayStub from "./employee-paystub";
import PersistentPayOvertimeSettingsPage from "./pay-overtime-settings";
import PersistentPayHistoryView from "./pay-history-view";

declare global {
  interface Window {
    Plaid?: { create: (config: { token: string; onSuccess: (publicToken: string, metadata: { institution?: { name?: string; institution_id?: string }; accounts?: Array<{ id?: string; name?: string; mask?: string; type?: string; subtype?: string }> }) => void | Promise<void>; onExit?: () => void }) => { open: () => void } };
  }
}

export type ViewName = "overview" | "time-clock" | "schedule" | "team" | "requests" | "messages" | "reports" | "payroll" | "documents" | "settings" | "employee-home" | "my-hours" | "my-schedule" | "profile";

type Employee = {
  id: number;
  name: string;
  role: string;
  initials: string;
  color: string;
  email?: string | null;
  displayName?: string | null;
  phone?: string | null;
  availability?: string | null;
  desiredHours?: number;
  address?: string | null;
  profilePhoto?: string | null;
  hourlyRateCents?: number;
  status: "clocked_in" | "clocked_out";
  clockIn: string | null;
  clockInTimestamp?: number | null;
  weeklyMinutes: number;
  dailyMinutes?: number[];
  monthMinutes?: number;
  totalMinutes?: number;
  totalShifts?: number;
  currentPayPeriodEarningsCents?: number;
  currentPayPeriodMinutes?: number;
  currentPayPeriodStart?: number;
  currentPayPeriodEnd?: number;
  payFrequency?: string;
  nextPayDate?: number;
  createdAt?: number | null;
};

function nameInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "??";
  return `${parts[0][0] ?? ""}${parts.length > 1 ? parts[parts.length - 1][0] ?? "" : parts[0][1] ?? ""}`.toUpperCase();
}

function displayAccessRole(role: string | null | undefined) {
  const value = String(role ?? "").trim().toLowerCase();
  if (value === "owner" || value === "administrator" || value === "admin") return "Owner";
  if (value === "manager") return "Manager";
  if (value === "supervisor" || value === "shift lead" || value === "lead") return "Supervisor";
  return "Employee";
}

function savedAccessRole(employeeId: number, fallback: string | null | undefined) {
  if (typeof window !== "undefined") {
    try {
      const assignments = JSON.parse(window.localStorage.getItem("coreshift-role-assignments") || "{}") as Record<string, string>;
      if (assignments[String(employeeId)]) return displayAccessRole(assignments[String(employeeId)]);
    } catch { /* use the employee record below */ }
  }
  return displayAccessRole(fallback);
}

const teamAvatarColors = ["violet", "blue", "green", "gold", "coral"] as const;
function teamAvatarColor(index: number) {
  return teamAvatarColors[index % teamAvatarColors.length];
}

type OwnerAccount = {
  id: number;
  name: string;
  email: string;
  createdAt: number;
};

type TimeEntryDetail = {
  id: number;
  clockIn: number;
  clockOut: number | null;
  note: string | null;
};

type PaymentDetail = {
  id: number;
  amountCents: number;
  paidAt: number;
  note: string | null;
};
type AppNotification = { id: string; type: "payment" | "schedule" | "message"; title: string; body: string; createdAt: number };

type ScheduledPayment = {
  id: number;
  amountCents: number;
  paidAt: number;
  note: string | null;
  employeeId: number;
  employeeName: string;
  initials: string;
  color: string;
};

type PublishedShift = {
  id: number;
  date: string;
  startMinutes: number;
  endMinutes: number;
  breakMinutes: number;
  note: string | null;
  employeeId: number;
  employeeName: string;
  role: string;
  initials: string;
  color: string;
};

type ScheduleView = "week" | "month" | "list";

type EmployeeDetail = {
  employee: Employee;
  entries: TimeEntryDetail[];
  payments: PaymentDetail[];
};

type ExpenseTotals = {
  dayCents: number;
  weekCents: number;
  monthCents: number;
  yearCents: number;
  allTimeCents: number;
  paymentCount: number;
  selected: {
    totalCents: number;
    earnedCents: number;
    owedCents: number;
    combinedCents: number;
    paymentCount: number;
    averageCents: number;
    largestCents: number;
    byEmployee: Array<{
      id: number;
      name: string;
      initials: string;
      color: string;
      totalCents: number;
      paymentCount: number;
    }>;
    employeeReport?: Array<{
      id: number;
      name: string;
      initials: string;
      color: string;
      hourlyRateCents: number;
      minutes: number;
      earnedCents: number;
      paidCents: number;
      owedCents: number;
    }>;
    payments: Array<{
      id: number;
      amountCents: number;
      paidAt: number;
      note: string | null;
      employeeId: number;
      employeeName: string;
      initials: string;
      color: string;
    }>;
  };
};

type ExpenseRange = "day" | "week" | "month" | "year" | "all";
type ShiftTemplate = {
  id: number;
  name: string;
  role: string;
  startMinutes: number;
  endMinutes: number;
  breakMinutes: number;
  color: string;
};

type ScheduledShift = {
  id: number;
  employeeId: number;
  employeeName: string;
  employeeInitials: string;
  employeeColor: string;
  date: string;
  startMinutes: number;
  endMinutes: number;
  breakMinutes: number;
  note: string;
  templateId: number | null;
};

type ScheduleDraft = {
  shifts: ScheduledShift[];
  templates: ShiftTemplate[];
  nextShiftId: number;
  nextTemplateId: number;
};

type ShiftEditorState = {
  id: number | null;
  employeeId: number;
  date: string;
  start: string;
  end: string;
  breakMinutes: number;
  templateId: number | null;
  note: string;
};

class PageErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error("Page render error", error, info); }
  render() { return this.state.hasError ? <section className="panel page-error-fallback"><h2>This page could not load</h2><p>Refresh the page to try again. Your saved data is safe.</p><button type="button" className="primary-button" onClick={() => window.location.reload()}>Refresh page</button></section> : this.props.children; }
}

const fallbackEmployees: Employee[] = [];
const scheduleStorageKey = "coreshift-schedule-v2";
const publishedScheduleStorageKey = "coreshift-schedule-published-v1";
const shiftStepMinutes = 15;
const minShiftMinutes = 30;
const pixelsPerStep = 12;

const navigation: Array<[ViewName, string, string]> = [
  ["overview", "Dashboard", "⌂"],
  ["time-clock", "Time clock", "◷"],
  ["schedule", "Schedule", "▦"],
  ["team", "Team", "♙"],
  ["requests", "Requests", "♧"],
  ["messages", "Messages", "✉"],
  ["documents", "Documents", "▣"],
  ["payroll", "Payroll", "$"],
];

const pageCopy: Record<ViewName, [string, string, string]> = {
  overview: ["Today", "Dashboard", "Here’s what’s happening with your team today."],
  "time-clock": ["Live attendance", "Time clock", "Clock team members in or out and see today’s activity."],
  schedule: ["Planner", "Schedule", "Build, review, and publish shifts for your team."],
  team: ["Team management", "Team", "Manage your team members, roles, and permissions."],
  requests: ["Requests", "Requests", "Review and take action on time off, shift changes, availability, and open shifts."],
  reports: ["Weekly insights", "Reports", "Understand hours, attendance, and staffing patterns."],
  messages: ["Team communication", "Messages", "Keep your team aligned in one shared conversation."],
  documents: ["Workspace library", "Documents", "Store, organize, and share important documents with your team."],
  payroll: ["Payroll workspace", "Payroll", "Run payroll, review history, and manage payment methods."],
  settings: ["Workspace", "Settings", "Choose how CoreShift tracks time for your business."],
  "employee-home": ["My workday", "Welcome back", "Everything you need for today, all in one place."],
  "my-hours": ["Current week", "My hours", "Your recorded shifts and weekly total appear here."],
  "my-schedule": ["Current week", "My schedule", "Your shifts appear here after the owner enters them."],
  profile: ["Employee account", "My profile", "Your personal details and account access."],
};

const formatHours = (minutes: number) => `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
const moneyValue = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
const preferredTimeZone = () => typeof window !== "undefined" ? window.localStorage.getItem("coreshift-time-zone") || undefined : undefined;
const formatClockTime = (date: Date) => date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, ...(preferredTimeZone() ? { timeZone: preferredTimeZone() } : {}) });
const localDateTimeParts = (timestamp: number) => {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, "0");
  return { date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`, time: `${pad(date.getHours())}:${pad(date.getMinutes())}` };
};
const dateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const dateFromKey = (value: string) => {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
};
const formatDateRange = (startDate: Date, endDate: Date, includeYear = false) => {
  const options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", ...(includeYear ? { year: "numeric" } : {}) };
  return `${startDate.toLocaleDateString("en-US", options)} – ${endDate.toLocaleDateString("en-US", options)}`;
};
const availabilityStateForDay = (employee: Employee, date: Date): "available" | "unavailable" | "unknown" => {
  const value = String(employee.availability ?? "").trim().toLowerCase();
  if (!value || value === "not set") return "unknown";
  if (/unavailable|never|not available|off all day/.test(value)) return "unavailable";
  const day = date.toLocaleDateString("en-US", { weekday: "long" }).toLowerCase();
  const shortDay = day.slice(0, 3);
  const weekdayOnly = /monday\s*[-–]\s*friday|mon\s*[-–]\s*fri/.test(value);
  const weekendOnly = /saturday\s*[-–]\s*sunday|sat\s*[-–]\s*sun/.test(value);
  const mentionsDays = /(monday|tuesday|wednesday|thursday|friday|saturday|sunday|\bmon\b|\btue\b|\bwed\b|\bthu\b|\bfri\b|\bsat\b|\bsun\b)/.test(value);
  if (weekdayOnly) return date.getDay() >= 1 && date.getDay() <= 5 ? "available" : "unavailable";
  if (weekendOnly) return date.getDay() === 0 || date.getDay() === 6 ? "available" : "unavailable";
  if (mentionsDays) return value.includes(day) || value.includes(shortDay) ? "available" : "unavailable";
  return "available";
};
const weekStartForDate = (date: Date) => {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  // The planner follows the familiar Sunday-to-Saturday weekly layout.
  start.setDate(start.getDate() - start.getDay());
  return start;
};
const addDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};
const minutesToTime = (minutes: number) => {
  const normalized = ((minutes % (24 * 60)) + (24 * 60)) % (24 * 60);
  const hours = Math.floor(normalized / 60);
  const mins = normalized % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
};
const minutesToDisplayTime = (minutes: number) => {
  const value = minutesToTime(minutes);
  const use12Hour = typeof window === "undefined" || window.localStorage.getItem("coreshift-time-format") !== "24";
  if (!use12Hour) return value;
  const [hours, mins] = value.split(":").map(Number);
  const suffix = hours >= 12 ? "PM" : "AM";
  const displayHour = hours % 12 || 12;
  return `${displayHour}:${String(mins).padStart(2, "0")} ${suffix}`;
};
type AppFontSize = "standard" | "large" | "larger" | "largest";
const appFontScale: Record<AppFontSize, number> = { standard: 1.1, large: 1.3, larger: 1.55, largest: 1.8 };
const applyAppFontSize = (value: AppFontSize) => {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.fontSize = value;
  const root = document.querySelector<HTMLElement>(".app-shell");
  if (!root) return;
  const factor = appFontScale[value];
  root.querySelectorAll<HTMLElement>("*").forEach((element) => {
    const current = Number.parseFloat(window.getComputedStyle(element).fontSize);
    if (!Number.isFinite(current)) return;
    const base = Number.parseFloat(element.dataset.baseFontSize ?? "") || current / factor;
    element.dataset.baseFontSize = String(base);
    element.style.fontSize = `${base * factor}px`;
  });
};
const timeToMinutes = (value: string) => {
  const [hours, minutes] = value.split(":").map(Number);
  return Math.max(0, Math.min((24 * 60) - 1, hours * 60 + minutes));
};
const shiftMinutes = (shift: Pick<ScheduledShift, "startMinutes" | "endMinutes" | "breakMinutes">) => Math.max(minShiftMinutes, shift.endMinutes - shift.startMinutes - shift.breakMinutes);
const shiftCardHeight = (shift: Pick<ScheduledShift, "startMinutes" | "endMinutes" | "breakMinutes">) => {
  const durationSteps = Math.max(2, Math.ceil(shiftMinutes(shift) / shiftStepMinutes));
  return Math.min(172, 56 + durationSteps * 8);
};

function createShiftTemplate(seed: number, name: string, role: string, startMinutes: number, endMinutes: number, breakMinutes: number, color: string): ShiftTemplate {
  return { id: seed, name, role, startMinutes, endMinutes, breakMinutes, color };
}

function defaultScheduleDraft(employees: Employee[], startDate: Date): ScheduleDraft {
  const roster = employees.length ? employees : [
    { id: 1, name: "Ava Thompson", role: "Operations Manager", initials: "AT", color: "violet", status: "clocked_out", clockIn: null, weeklyMinutes: 0 },
    { id: 2, name: "Marcus Lee", role: "Shift Lead", initials: "ML", color: "blue", status: "clocked_out", clockIn: null, weeklyMinutes: 0 },
    { id: 3, name: "Sofia Ramirez", role: "Customer Support", initials: "SR", color: "coral", status: "clocked_out", clockIn: null, weeklyMinutes: 0 },
  ];
  const templates = [
    createShiftTemplate(1, "Opening shift", roster[0]?.role ?? "Lead", 8 * 60, 16 * 60, 30, roster[0]?.color ?? "green"),
    createShiftTemplate(2, "Midday shift", roster[1]?.role ?? "Support", 10 * 60, 18 * 60, 30, roster[1]?.color ?? "blue"),
    createShiftTemplate(3, "Closing shift", roster[2]?.role ?? "Closer", 14 * 60, 22 * 60, 30, roster[2]?.color ?? "coral"),
  ];
  const visibleWeek = Array.from({ length: 5 }, (_, index) => addDays(startDate, index));
  const shifts = visibleWeek.flatMap((date, index) => {
    const employee = roster[index % roster.length];
    const template = templates[index % templates.length];
    const dateString = dateKey(date);
    return [{
      id: 100 + index,
      employeeId: employee.id,
      employeeName: employee.name,
      employeeInitials: employee.initials,
      employeeColor: employee.color,
      date: dateString,
      startMinutes: template.startMinutes + (index % 2) * 30,
      endMinutes: template.endMinutes + (index % 2) * 30,
      breakMinutes: template.breakMinutes,
      note: `${template.name} · ${employee.role}`,
      templateId: template.id,
    }];
  });
  return { shifts, templates, nextShiftId: 200, nextTemplateId: 4 };
}

// Older builds seeded the planner with sample shifts. Treat that exact seed
// as demo data so it can never appear as a real employee schedule.
function isSeededSchedule(value: Partial<ScheduleDraft>) {
  const shifts = Array.isArray(value.shifts) ? value.shifts : [];
  const templates = Array.isArray(value.templates) ? value.templates : [];
  return Number(value.nextShiftId) === 200
    && shifts.length === 5
    && shifts.every((shift) => Number(shift.id) >= 100 && Number(shift.id) <= 104)
    && templates.length === 3
    && templates.every((template) => [1, 2, 3].includes(Number(template.id)));
}

function cloneShiftForDate(shift: ScheduledShift, date: string, nextId: number): ScheduledShift {
  return { ...shift, id: nextId, date, note: shift.note || "", templateId: shift.templateId ?? null };
}

function normalizeShiftDraft(shift: ScheduledShift) {
  const startMinutes = Math.max(0, Math.min((24 * 60) - shiftStepMinutes, shift.startMinutes));
  const minimumEnd = startMinutes + minShiftMinutes + shift.breakMinutes;
  const endMinutes = Math.max(minimumEnd, Math.min(24 * 60, shift.endMinutes));
  return { ...shift, startMinutes, endMinutes };
}

function usePaymentSchedule(view: ScheduleView, offset: number) {
  const [payments, setPayments] = useState<ScheduledPayment[]>([]);
  const { start, end } = useMemo(() => {
    const today = new Date();
    const baseDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    let startDate: Date;
    let endDate: Date;
    if (view === "month") {
      startDate = new Date(baseDate.getFullYear(), baseDate.getMonth() + offset, 1);
      endDate = new Date(baseDate.getFullYear(), baseDate.getMonth() + offset + 1, 1);
    } else {
      startDate = new Date(baseDate);
      startDate.setDate(startDate.getDate() - startDate.getDay() + offset * 7);
      endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + 7);
    }
    return { start: startDate, end: endDate };
  }, [offset, view]);
  const days = useMemo(() => {
    const totalDays = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)));
    return Array.from({ length: totalDays }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      return date;
    });
  }, [end, start]);

  useEffect(() => {
    const query = new URLSearchParams({
      start: String(start.getTime()),
      end: String(end.getTime()),
      range: view === "month" ? "month" : "week",
    });
    fetch(`/api/schedule/payments?${query}`)
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((result: ScheduledPayment[]) => setPayments(result))
      .catch(() => setPayments([]));
  }, [end, start, view]);

  return { payments, days, start, end };
}

function formatScheduleLabel(view: ScheduleView, start: Date, end: Date, offset: number) {
  if (view === "month") {
    return start.toLocaleDateString([], { month: "long", year: "numeric" });
  }
  if (offset === 0) return "This week";
  const formatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
  const inclusiveEnd = new Date(end);
  inclusiveEnd.setDate(inclusiveEnd.getDate() - 1);
  return `${formatter.format(start)} - ${formatter.format(inclusiveEnd)}`;
}

function monthMarker(date: Date) {
  return date.toLocaleDateString([], { month: "short" });
}

export function Timekeeper({ view = "overview", viewer }: { view?: ViewName; viewer: Viewer }) {
  // Keep the overview data path explicit so the server render and client render use the same inputs.
  const isEmployee = viewer.access === "employee";
  const isDemo = viewer.businessId === "__coreshift_demo__";
  const [employees, setEmployees] = useState(isEmployee ? [] : fallbackEmployees);
  const [now, setNow] = useState(new Date());
  const [showAll, setShowAll] = useState(false);
  const [notice, setNotice] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [showInstallHelp, setShowInstallHelp] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);
  const [showAddEmployee, setShowAddEmployee] = useState(false);
  const [employeeJoinCode, setEmployeeJoinCode] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [darkMode, setDarkMode] = useState(false);
  const [messagingAllowed, setMessagingAllowed] = useState(true);
  const [employeeControls, setEmployeeControls] = useState<Record<string, boolean> | null>(null);
  const [editingClock, setEditingClock] = useState<{ employee: Employee; entry: TimeEntryDetail } | null>(null);
  const [clockEditError, setClockEditError] = useState("");
  const [approved, setApproved] = useState<number[]>([]);
  const [scheduleNewShiftTick, setScheduleNewShiftTick] = useState(0);
  const working = useMemo(() => employees.filter((person) => person.status === "clocked_in"), [employees]);
  // Keep the employee clock usable during the brief API load (and on slower
  // mobile connections) by using the signed-in employee identity immediately.
  const activeEmployee = isEmployee ? (employees.find((person) => person.id === viewer.employeeId) ?? {
    id: viewer.employeeId,
    name: viewer.displayName,
    role: "Employee",
    initials: nameInitials(viewer.displayName),
    color: "violet",
    email: viewer.email,
    status: "clocked_out" as const,
    clockIn: null,
    clockInTimestamp: null,
    weeklyMinutes: 0,
    dailyMinutes: [0, 0, 0, 0, 0, 0, 0],
    hourlyRateCents: 0,
  }) : undefined;
  const viewerRole = isEmployee ? (employees.find((person) => person.id === viewer.employeeId)?.role || "Employee") : "Owner";
  useEffect(() => {
    if (!isEmployee) return;
    const apply = (byRole: Record<string, Record<string, boolean>>) => { const matchedRole = Object.keys(byRole).find((key) => key.trim().toLowerCase() === viewerRole.trim().toLowerCase()); const permissions = matchedRole ? byRole[matchedRole] : undefined; if (!permissions) { setEmployeeControls(null); setMessagingAllowed(false); return; } setEmployeeControls(permissions); setMessagingAllowed(permissions["View messages"] === true || permissions["Send direct messages"] === true || permissions["Create group messages"] === true); };
    fetch("/api/settings/role-permissions").then((response) => response.ok ? response.json() : Promise.reject()).then((result: { permissions?: Record<string, Record<string, boolean>> }) => apply(result.permissions || {})).catch(() => { try { const saved = window.localStorage.getItem("coreshift-role-schedule-request-controls"); apply(saved ? JSON.parse(saved) : {}); } catch { apply({}); } });
  }, [isEmployee, viewerRole]);
  const totalMinutes = employees.reduce((sum, person) => sum + person.weeklyMinutes, 0);
  const dailyMinutes = employees.reduce((days, person) => days.map((total, index) => total + (person.dailyMinutes?.[index] ?? 0)), [0, 0, 0, 0, 0, 0, 0]);
  const [eyebrow, title, subtitle] = pageCopy[view];
  useEffect(() => {
    const savedTheme = window.localStorage.getItem("coreshift-theme");
    const initialDark = savedTheme === "dark";
    setDarkMode(initialDark);
    document.documentElement.dataset.theme = initialDark ? "dark" : "light";
    const savedFontSize = window.localStorage.getItem("coreshift-font-size") as AppFontSize | null;
    if (savedFontSize && ["standard", "large", "larger", "largest"].includes(savedFontSize)) applyAppFontSize(savedFontSize);
    window.setTimeout(() => applyAppFontSize((window.localStorage.getItem("coreshift-font-size") as AppFontSize) || "large"), 0);
    setIsInstalled(window.matchMedia("(display-mode: standalone)").matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    refreshEmployees();
    if (!isEmployee) fetch("/api/settings/employee-join-code").then((response) => response.ok ? response.json() as Promise<{ code: string | null }> : Promise.reject()).then((result) => setEmployeeJoinCode(result.code)).catch(() => {});
    const loadNotifications = async () => {
      const response = await fetch("/api/notifications").catch(() => null);
      if (!response?.ok) return;
      const result = await response.json().catch(() => null) as { notifications?: AppNotification[] } | null;
      const preferences = viewer.access === "employee" ? JSON.parse(window.localStorage.getItem("coreshift-employee-notifications") || "{}") as { schedule?: boolean; reminders?: boolean; messages?: boolean; payments?: boolean } : {};
      const visible = (result?.notifications ?? []).filter((item) => item.type === "schedule" ? preferences.schedule !== false : item.type === "message" ? preferences.messages !== false : preferences.payments !== false);
      setNotifications(visible);
      const seenKey = `coreshift-notifications-seen:${viewer.employeeId ?? "owner"}`;
      const seen = Number(window.localStorage.getItem(seenKey) || 0);
      setUnreadNotifications(visible.filter((item) => item.createdAt > seen).length);
    };
    loadNotifications();
    const notificationTimer = window.setInterval(loadNotifications, 20000);
    const dataTimer = window.setInterval(() => refreshEmployees(), 30000);
    return () => {
      window.clearInterval(timer);
      window.clearInterval(notificationTimer);
      window.clearInterval(dataTimer);
    };
  }, [viewer.access, viewer.employeeId]);

  useEffect(() => {
    if (!messagingAllowed || isDemo) { setUnreadMessages(0); return; }
    const loadUnreadMessages = async () => {
      const response = await fetch("/api/messages?list=1", { cache: "no-store" }).catch(() => null);
      const result = response?.ok ? await response.json().catch(() => null) as { recentConversations?: Array<{ id: string; unread?: number | boolean }> } | null : null;
      if (!result?.recentConversations) return;
      setUnreadMessages(result.recentConversations.reduce((total, conversation) => total + Math.max(0, Number(conversation.unread) || 0), 0));
    };
    loadUnreadMessages();
    const timer = window.setInterval(loadUnreadMessages, 6000);
    window.addEventListener("focus", loadUnreadMessages);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", loadUnreadMessages); };
  }, [isDemo, messagingAllowed, viewer.businessId, viewer.actorId]);

  function toggleDarkMode() {
    setDarkMode((current) => {
      const next = !current;
      window.localStorage.setItem("coreshift-theme", next ? "dark" : "light");
      document.documentElement.dataset.theme = next ? "dark" : "light";
      return next;
    });
  }

  function openNotifications() {
    setNotificationOpen((open) => !open);
    const newest = notifications[0]?.createdAt;
    if (newest) {
      window.localStorage.setItem(`coreshift-notifications-seen:${viewer.employeeId ?? "owner"}`, String(newest));
      setUnreadNotifications(0);
    }
  }

  if (viewer.access === "pending") {
    return <AccessPending viewer={viewer} />;
  }

  function flash(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2600);
  }

  function refreshEmployees() {
    if (isDemo) return Promise.resolve();
    return fetch("/api/employees")
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((data: Employee[]) => setEmployees(data.map((person) => ({ ...person, clockInTimestamp: person.clockIn ? new Date(person.clockIn).getTime() : null, clockIn: person.clockIn ? (formatClockTime(new Date(person.clockIn))) : null }))))
      .catch(() => undefined);
  }

  async function logOut() {
    try {
      await fetch("/api/session/logout", { method: "POST" });
    } finally {
      window.location.replace("/login");
    }
  }

  async function toggleClock(employee: Employee) {
    if (isDemo) { flash("Demo mode is read-only — no time is saved."); return; }
    const nextStatus = employee.status === "clocked_in" ? "clocked_out" : "clocked_in";
    const clockIn = nextStatus === "clocked_in" ? formatClockTime(now) : null;
    setEmployees((current) => current.map((person) => person.id === employee.id ? { ...person, status: nextStatus, clockIn, clockInTimestamp: nextStatus === "clocked_in" ? now.getTime() : null } : person));
    flash(`${employee.name} ${nextStatus === "clocked_in" ? "clocked in" : "clocked out"}.`);
    const response = await fetch(`/api/employees/${employee.id}/clock`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: nextStatus }),
    }).catch(() => null);
    if (!response?.ok) {
      await refreshEmployees();
      flash("The clock change could not be saved.");
      return;
    }
    await refreshEmployees();
  }

  async function addEmployee(event: FormEvent<HTMLFormElement>) {
    if (isDemo) { event.preventDefault(); flash("Demo mode is read-only — no employees are added."); return; }
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const role = "Employee";
    const email = String(form.get("email") ?? "").trim().toLowerCase();
    const hourlyRateCents = Math.max(0, Math.round(Number(form.get("hourlyRate") ?? 0) * 100));
    if (!name || !role || !email) return;
    const initials = nameInitials(name);
    const optimistic: Employee = { id: Date.now(), name, role, initials, color: "green", email, hourlyRateCents, status: "clocked_out", clockIn: null, weeklyMinutes: 0 };
    setEmployees((current) => [...current, optimistic]);
    setShowAddEmployee(false);
    flash(`${name} added to the team.`);
    const response = await fetch("/api/employees", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, role, initials, email, hourlyRateCents, color: "green" }),
    }).catch(() => null);
    if (response?.ok) {
      const saved = await response.json() as Employee;
      setEmployees((current) => current.map((person) => person.id === optimistic.id ? saved : person));
      // Finish the invite in the same flow: create the employee's access code
      // and immediately offer a shareable login link to the owner.
      await shareEmployeeLogin(saved);
    }
  }

  async function updateEmployeeEmail(employee: Employee, email: string) {
    const normalized = email.trim().toLowerCase();
    if (!normalized || normalized === employee.email) return;
    const response = await fetch(`/api/employees/${employee.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: normalized }),
    }).catch(() => null);
    if (response?.ok) {
      setEmployees((current) => current.map((person) => person.id === employee.id ? { ...person, email: normalized } : person));
      flash(`${employee.name} can now sign in with ${normalized}.`);
    } else {
      flash("That login email could not be saved.");
    }
  }

  async function updateEmployeeRate(employee: Employee, dollars: string) {
    const hourlyRateCents = Math.max(0, Math.round(Number(dollars) * 100));
    if (!Number.isFinite(hourlyRateCents) || hourlyRateCents === employee.hourlyRateCents) return;
    const response = await fetch(`/api/employees/${employee.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hourlyRateCents }),
    }).catch(() => null);
    if (response?.ok) {
      setEmployees((current) => current.map((person) => person.id === employee.id ? { ...person, hourlyRateCents } : person));
      flash(`${employee.name}’s hourly rate was saved.`);
    } else {
      flash("That hourly rate could not be saved.");
    }
  }

  async function shareEmployeeLogin(employee: Employee) {
    const response = await fetch(`/api/employees/${employee.id}/access-code`, { method: "POST" }).catch(() => null);
    const result = response ? await response.json().catch(() => null) as { error?: string; accessCode?: string; email?: string; loginPath?: string } | null : null;
    if (!response?.ok || !result?.accessCode || !result.email || !result.loginPath) {
      return flash(result?.error ?? "That employee login could not be created.");
    }
    const url = `${window.location.origin}${result.loginPath}`;
      const text = `CoreShift employee login\nLink: ${url}\nEmail: ${result.email}\n8-digit access code: ${result.accessCode}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: `${employee.name}’s CoreShift login`, text, url });
        flash(`${employee.name}’s login is ready.`);
        return;
      } catch (error) {
        if ((error as Error).name === "AbortError") return;
      }
    }
    await navigator.clipboard.writeText(text);
    flash(`${employee.name}’s login details were copied.`);
  }

  async function openClockEditor(employee: Employee) {
    setClockEditError("");
    const response = await fetch(`/api/employees/${employee.id}`).catch(() => null);
    const result = response ? await response.json().catch(() => null) as EmployeeDetail | null : null;
    const entry = result?.entries.find((candidate) => candidate.clockOut === null)
      ?? result?.entries.slice().sort((left, right) => right.clockIn - left.clockIn)[0];
    if (!response?.ok || !entry) {
      flash("That time entry could not be loaded.");
      return;
    }
    setEditingClock({ employee, entry });
  }

  async function saveActiveClock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingClock) return;
    const form = new FormData(event.currentTarget);
    const clockIn = new Date(`${String(form.get("clockInDate"))}T${String(form.get("clockInTime"))}`).getTime();
    const clockOutDate = String(form.get("clockOutDate") ?? "").trim();
    const clockOutTime = String(form.get("clockOutTime") ?? "").trim();
    const clockOut = clockOutDate && clockOutTime ? new Date(`${clockOutDate}T${clockOutTime}`).getTime() : null;
    const response = await fetch(`/api/time-entries/${editingClock.entry.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clockIn, clockOut }),
    }).catch(() => null);
    if (!response?.ok) {
      const result = response ? await response.json().catch(() => null) as { error?: string } | null : null;
      setClockEditError(result?.error ?? "That clock-in time could not be saved.");
      return;
    }
    setEditingClock(null);
    await refreshEmployees();
    flash(editingClock.entry.clockOut ? "Completed time updated." : "Clock-in time updated.");
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileOpen ? "mobile-open" : ""}`}>
        <div className="brand">
          <span className="brand-mark"><i /><i /><i /></span>
          <span className="brand-lockup"><strong>Core<span>Shift</span></strong><small>Workforce</small></span>
          <button className="sidebar-close" onClick={() => setMobileOpen(false)} aria-label="Close navigation">×</button>
        </div>
        <nav aria-label="Main navigation">
          <p className="nav-label">{viewer.businessName}</p>
          {(isEmployee ? [
            ["employee-home", "Dashboard", "⌂"],
            ...(employeeControls === null || employeeControls["View time clock"] ? [["time-clock", "Time clock", "◷"] as [ViewName, string, string]] : []),
            ...(employeeControls === null || employeeControls["View time clock"] ? [["my-hours", "My hours", "▤"] as [ViewName, string, string]] : []),
            ...(employeeControls === null || employeeControls["View own schedule"] ? [["my-schedule", "My schedule", "▦"] as [ViewName, string, string]] : []),
            ["profile", "My profile", "♙"],
            ...(employeeControls === null || employeeControls["View messages"] || employeeControls["Send direct messages"] || employeeControls["Create group messages"] ? [["messages", "Messages", "✉"] as [ViewName, string, string]] : []),
          ] as Array<[ViewName, string, string]> : navigation).map(([key, label, icon]) => (
            <Link className={view === key ? "nav-item active" : "nav-item"} href={key === "overview" || key === "employee-home" ? "/" : `/${key}`} key={key}>
              <span aria-hidden="true">{icon}</span>{label}{key === "messages" && unreadMessages > 0 && <span className="nav-unread-badge" aria-label={`${unreadMessages} unread message${unreadMessages === 1 ? "" : "s"}`} title={`${unreadMessages} unread message${unreadMessages === 1 ? "" : "s"}`}>{unreadMessages > 99 ? "99+" : unreadMessages}</span>}
            </Link>
          ))}
          <p className="nav-label reports-label">Insights</p>
          {!isEmployee && <Link className={view === "reports" ? "nav-item active" : "nav-item"} href="/reports"><span aria-hidden="true">↗</span>Reports</Link>}
        </nav>
        <div className="sidebar-bottom">
          {!isEmployee && <Link className={view === "settings" ? "nav-item active" : "nav-item"} href="/settings"><span>⚙</span>Settings</Link>}
          <button className="nav-item" type="button" onClick={() => setShowHelp(true)}><span aria-hidden="true">?</span>Help Center</button>
          {isEmployee ? <Link className="owner" aria-label="Open your profile" href="/profile">
            <div className="avatar owner-avatar">{viewer.displayName.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</div>
            <div><strong>{viewer.displayName}</strong><span>{viewerRole} · {viewer.businessName}</span></div>
          </Link> : <div className="owner sidebar-company" aria-label="Signed-in account">
            <div className="avatar owner-avatar">{viewer.displayName.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</div>
            <div><strong>{viewer.displayName}</strong><span>{viewerRole} · {viewer.businessName}</span></div>
          </div>}
          <button className="nav-item logout-nav" type="button" onClick={logOut}><span aria-hidden="true">↪</span>Log out</button>
        </div>
      </aside>
      {mobileOpen && <button className="sidebar-scrim" onClick={() => setMobileOpen(false)} aria-label="Close navigation" />}

      <main>
        <header className={`topbar ${isEmployee ? "employee-topbar" : ""}`}>
          <button className="mobile-menu" onClick={() => setMobileOpen(true)} aria-label="Open navigation">☰</button>
          <div className="header-context"><span className="location-dot" /><div><strong>{viewer.businessName}</strong><small>{title}</small></div></div>
        </header>

        <div className={`content ${view === "schedule" ? "wide-content" : ""} ${view === "settings" ? "settings-content" : "product-content"}`}>
          <section className={`welcome page-welcome ${view === "overview" ? "overview-page-welcome" : ""}`}>
            <div>
              <p className="eyebrow">{eyebrow}</p>
              <h1>{view === "overview" ? `Good ${now.getHours() < 12 ? "morning" : now.getHours() < 17 ? "afternoon" : "evening"}, ${viewer.displayName}.` : title}</h1>
              <p className="subtitle">{subtitle}</p>
            </div>
            {view === "overview" && <div className="live-time"><span>{formatClockTime(now)}</span><small>Local time</small></div>}
            {view === "team" && <button className="primary-button page-action" disabled={isDemo} onClick={() => setShowAddEmployee(true)}><span>＋</span>Add employee</button>}
            {view === "schedule" && <button className="primary-button page-action" disabled={isDemo} onClick={() => setScheduleNewShiftTick((value) => value + 1)}><span>＋</span>Add shift</button>}
            {view === "messages" && <button className="primary-button page-action" onClick={() => window.dispatchEvent(new Event("coreshift:new-message"))}><span>✎</span>New message</button>}
          </section>
          {isDemo && <div className="demo-mode-banner"><strong>Demo mode</strong><span>Sample data only. Nothing you do here is saved or sent anywhere.</span></div>}

          {view === "overview" && <DashboardOverview employees={employees} working={working} totalMinutes={totalMinutes} dailyMinutes={dailyMinutes} toggleClock={toggleClock} />}
          {view === "time-clock" && <TimeClock employees={employees} working={working} now={now} toggleClock={toggleClock} employeeMode={isEmployee} onEditTime={isEmployee ? undefined : openClockEditor} />}
          
          {view === "schedule" && <PageErrorBoundary><Schedule employees={employees} ownerName={viewer.displayName} flash={flash} openNewShiftTick={scheduleNewShiftTick} demo={isDemo} /></PageErrorBoundary>}
          {view === "team" && <Team employees={employees} toggleClock={toggleClock} setShowAddEmployee={setShowAddEmployee} updateEmployeeEmail={updateEmployeeEmail} updateEmployeeRate={updateEmployeeRate} shareEmployeeLogin={shareEmployeeLogin} onEmployeeDeleted={(id) => setEmployees((current) => current.filter((person) => person.id !== id))} onRecordsChanged={refreshEmployees} flash={flash} />}
          {view === "requests" && <PageErrorBoundary><Requests employees={employees} flash={flash} /></PageErrorBoundary>}
            {view === "reports" && <><PaymentsExport /><Reports employees={employees} totalMinutes={totalMinutes} /></>}
          {view === "payroll" && <PayrollPage employees={employees} flash={flash} />}
          {view === "messages" && <PageErrorBoundary><Messages viewer={viewer} employees={employees} /></PageErrorBoundary>}
          {view === "documents" && <DocumentsLive flash={flash} />}
          {view === "settings" && <PageErrorBoundary><Settings flash={flash} businessName={viewer.businessName} ownerName={viewer.displayName} ownerEmail={viewer.email ?? ""} /></PageErrorBoundary>}
          {view === "employee-home" && <><EmployeeHome employee={activeEmployee} now={now} toggleClock={toggleClock} /><PlaidConnectCard flash={flash} /></>}
          {view === "my-hours" && <EmployeePayStub employee={employees[0]} />}
          {view === "my-schedule" && <MySchedule employee={employees[0]} />}
          {view === "profile" && <Profile employee={employees[0]} viewer={viewer} logOut={logOut} flash={flash} />}
        </div>
      </main>

      {showAddEmployee && (
        <div className="modal-backdrop" role="presentation">
          <form className="modal-card" onSubmit={addEmployee}>
            <div className="modal-head"><div><h2>Add an employee</h2><p>Add their details once, then send their ready-to-use login invite.</p></div><button type="button" onClick={() => setShowAddEmployee(false)} aria-label="Close">×</button></div>
            <div className="employee-join-code-hint"><div><span>8-digit company join code</span><strong>{employeeJoinCode ?? "Not created yet"}</strong></div>{employeeJoinCode && <button type="button" className="secondary-button" onClick={async () => { await navigator.clipboard.writeText(employeeJoinCode); flash("Company code copied."); }}>Copy code</button>}</div>
            <label>Full name<input name="name" placeholder="Alex Morgan" autoFocus required /></label>
            <label>Role<input name="role" value="Employee" readOnly aria-readonly="true" /></label>
            <label>Login email<input name="email" type="email" placeholder="alex@example.com" required /></label>
            <label>Hourly rate<div className="money-field"><span>$</span><input name="hourlyRate" type="number" min="0" step="0.01" placeholder="20.00" required /><small>/ hour</small></div></label>
            <div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setShowAddEmployee(false)}>Cancel</button><button className="primary-button" type="submit">Add &amp; send invite</button></div>
          </form>
        </div>
      )}

      {showHelp && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setShowHelp(false)}>
          <section className="modal-card help-card" role="dialog" aria-modal="true" aria-labelledby="help-title">
            <div className="modal-head"><div><h2 id="help-title">Help &amp; tips</h2><p>Quick ways to get around CoreShift.</p></div><button type="button" onClick={() => setShowHelp(false)} aria-label="Close help">×</button></div>
            <div className="help-links">
              <Link href="/time-clock" onClick={() => setShowHelp(false)}><span aria-hidden="true">◷</span><div><strong>Use the time clock</strong><small>Clock in, clock out, or check who is working.</small></div><i aria-hidden="true">›</i></Link>
              {isEmployee
                ? <Link href="/profile" onClick={() => setShowHelp(false)}><span aria-hidden="true">♙</span><div><strong>View your account</strong><small>Check your login and work details.</small></div><i aria-hidden="true">›</i></Link>
                : <Link href="/team" onClick={() => setShowHelp(false)}><span aria-hidden="true">♙</span><div><strong>Manage your team</strong><small>Add employees and send their login details.</small></div><i aria-hidden="true">›</i></Link>}
              <button type="button" onClick={() => { setShowHelp(false); setShowInstallHelp(true); }}><span aria-hidden="true">⇩</span><div><strong>Install CoreShift</strong><small>Add the app to this phone or computer.</small></div><i aria-hidden="true">›</i></button>
            </div>
          </section>
        </div>
      )}
      {showInstallHelp && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-card install-card" role="dialog" aria-modal="true" aria-labelledby="install-title">
            <div className="modal-head">
              <div><p className="eyebrow">iPhone app</p><h2 id="install-title">Add CoreShift to your Home Screen</h2></div>
              <button type="button" onClick={() => setShowInstallHelp(false)} aria-label="Close">×</button>
            </div>
            <ol className="install-steps">
              <li><span>1</span><div><strong>Open this page in Safari</strong><p>Use Safari on your iPhone for installation.</p></div></li>
              <li><span>2</span><div><strong>Tap the Share button</strong><p>It looks like a square with an arrow pointing up.</p></div></li>
              <li><span>3</span><div><strong>Tap “Add to Home Screen”</strong><p>Then tap Add. CoreShift will appear with your other apps.</p></div></li>
            </ol>
            <button className="primary-button install-done" type="button" onClick={() => setShowInstallHelp(false)}>Got it</button>
          </section>
        </div>
      )}
      {editingClock && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setEditingClock(null)}>
        <form className="modal-card active-clock-editor" onSubmit={saveActiveClock}>
          <div className="modal-head"><div><p className="eyebrow">{editingClock.entry.clockOut ? "Completed time entry" : "Active time entry"}</p><h2>Edit {editingClock.employee.name}’s time</h2><p>{editingClock.entry.clockOut ? "Correct the start or end time for this completed shift." : "Correct the start time while they remain clocked in."}</p></div><button type="button" onClick={() => setEditingClock(null)} aria-label="Close">×</button></div>
          <div className="time-edit-group"><strong>Started working</strong><div className="time-edit-fields"><label>Date<input name="clockInDate" type="date" defaultValue={localDateTimeParts(editingClock.entry.clockIn).date} required /></label><label>Time<input name="clockInTime" type="time" defaultValue={localDateTimeParts(editingClock.entry.clockIn).time} required /></label></div></div>
          {editingClock.entry.clockOut && <div className="time-edit-group"><strong>Ended working</strong><div className="time-edit-fields"><label>Date<input name="clockOutDate" type="date" defaultValue={localDateTimeParts(editingClock.entry.clockOut).date} required /></label><label>Time<input name="clockOutTime" type="time" defaultValue={localDateTimeParts(editingClock.entry.clockOut).time} required /></label></div></div>}
          {clockEditError && <p className="login-error" role="alert">{clockEditError}</p>}
          <div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setEditingClock(null)}>Cancel</button><button className="primary-button" type="submit">Save time</button></div>
        </form>
      </div>}
      {notice && <div className="toast" role="status">{notice}</div>}
    </div>
  );
}

function DashboardOverview({ employees, working, totalMinutes, dailyMinutes, toggleClock }: { employees: Employee[]; working: Employee[]; totalMinutes: number; dailyMinutes: number[]; toggleClock: (employee: Employee) => void }) {
  const [laborRange, setLaborRange] = useState<"day" | "week" | "month" | "ytd">("week");
  const [liveLaborSeries, setLiveLaborSeries] = useState<{ labels: string[]; axisLabels: string[]; values: number[] } | null>(null);
  const weeklyCost = employees.reduce((sum, person) => sum + Math.round((person.weeklyMinutes / 60) * (person.hourlyRateCents ?? 0)), 0);
  const monthCost = employees.reduce((sum, person) => sum + Math.round(((person.monthMinutes ?? person.weeklyMinutes * 4.345) / 60) * (person.hourlyRateCents ?? 0)), 0);
  const yearCost = employees.reduce((sum, person) => sum + Math.round(((person.totalMinutes ?? person.monthMinutes ?? person.weeklyMinutes) / 60) * (person.hourlyRateCents ?? 0)), 0);
  const laborCostByRange = { day: Math.round(weeklyCost / 7), week: weeklyCost, month: monthCost, ytd: yearCost };
  const laborRangeLabels = { day: "Day", week: "Week", month: "Month", ytd: "Year to date" };
  const todayIndex = Math.max(0, Math.min(6, new Date().getDay() - 1));
  const currentMonth = new Date().getMonth();
  const monthLabels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const fallbackLaborSeries = useMemo(() => {
    if (laborRange === "week") return { labels: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], axisLabels: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], values: dailyMinutes.map((minutes) => Math.round((minutes / 60) * (totalMinutes ? weeklyCost / (totalMinutes / 60) : 0))) };
    if (laborRange === "day") {
      const hourly = Math.round(((dailyMinutes[todayIndex] ?? 0) / 60) * (totalMinutes ? weeklyCost / (totalMinutes / 60) : 0));
      const currentHour = new Date().getHours();
      const labels = Array.from({ length: 12 }, (_, index) => `${((index + 8) % 12) || 12}${index + 8 < 12 ? "a" : "p"}`);
      return { labels, axisLabels: labels, values: Array.from({ length: 12 }, (_, index) => index === Math.max(0, Math.min(11, currentHour - 8)) ? hourly : 0) };
    }
    if (laborRange === "month") return { labels: ["Week 1", "Week 2", "Week 3", "Week 4", "Week 5"], axisLabels: ["Week 1", "Week 2", "Week 3", "Week 4", "Week 5"], values: [0, 0, 0, 0, monthCost] };
    return { labels: monthLabels, axisLabels: monthLabels, values: monthLabels.map((_, index) => index === currentMonth ? yearCost : 0) };
  }, [laborRange, dailyMinutes, totalMinutes, weeklyCost, monthCost, yearCost, todayIndex, currentMonth]);
  useEffect(() => {
    let active = true;
    const load = () => fetch(`/api/reports/labor-series?range=${laborRange}&offsetMinutes=${new Date().getTimezoneOffset()}`, { cache: "no-store" })
      .then((response) => response.ok ? response.json() as Promise<{ labels: string[]; axisLabels: string[]; values: number[] }> : Promise.reject())
      .then((series) => { if (active) setLiveLaborSeries(series); })
      .catch(() => { if (active) setLiveLaborSeries(null); });
    setLiveLaborSeries(null); load();
    const timer = window.setInterval(load, 60_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [laborRange]);
  const laborSeries = liveLaborSeries ?? fallbackLaborSeries;
  useEffect(() => { const label = document.querySelector<HTMLElement>(".reference-big-money + small"); if (label) label.textContent = `Total labor cost for ${laborRangeLabels[laborRange]}`; }, [laborRange]);
  const attendance = employees.length ? Math.round((employees.filter((person) => person.weeklyMinutes > 0).length / employees.length) * 100) : 0;
  const workingCount = employees.filter((person) => person.status === "clocked_in").length;
  const breakCount = employees.filter((person) => person.status === "on_break").length;
  const scheduledCount = employees.filter((person) => person.weeklyMinutes > 0).length;
  const clockedOutCount = Math.max(0, scheduledCount - workingCount - breakCount);
  const notScheduledCount = Math.max(0, employees.length - scheduledCount);
  const laborMax = Math.max(0, ...laborSeries.values);
  const laborMagnitude = laborMax > 0 ? 10 ** Math.floor(Math.log10(laborMax)) : 1;
  const laborNormalized = laborMagnitude ? laborMax / laborMagnitude : 0;
  const laborNiceFactor = laborNormalized <= 1 ? 1 : laborNormalized <= 2 ? 2 : laborNormalized <= 5 ? 5 : 10;
  const laborAxisMax = Math.max(1, laborNiceFactor * laborMagnitude);
  const laborCoords = laborSeries.values.map((value, index) => ({ x: laborSeries.values.length === 1 ? 55 : 12 + index * (86 / (laborSeries.values.length - 1)), y: 56 - (value / laborAxisMax) * 44 }));
  const laborPolyline = laborCoords.map((point) => `${point.x},${point.y}`).join(" ");
  const laborArea = laborCoords.length ? `M ${laborCoords[0].x} 56 L ${laborCoords.map((point) => `${point.x} ${point.y}`).join(" L ")} L ${laborCoords[laborCoords.length - 1].x} 56 Z` : "";
  const laborGrid = [0, 0.25, 0.5, 0.75, 1].map((fraction) => ({ y: 56 - fraction * 44, value: Math.round((laborAxisMax * fraction) / 100).toLocaleString("en-US", { maximumFractionDigits: 0 }) }));
  const rangeMinutes = laborRange === "day" ? (dailyMinutes[todayIndex] ?? 0) : laborRange === "week" ? totalMinutes : laborRange === "month" ? monthCost && monthCost !== 0 ? employees.reduce((sum, person) => sum + (person.monthMinutes ?? 0), 0) : 0 : employees.reduce((sum, person) => sum + (person.totalMinutes ?? 0), 0);
  const averageCostPerHour = rangeMinutes ? laborCostByRange[laborRange] / (rangeMinutes / 60) : 0;
  const highestIndex = laborSeries.values.reduce((best, value, index, values) => value > values[best] ? index : best, 0);
  const lowestIndex = laborSeries.values.reduce((best, value, index, values) => value < values[best] ? index : best, 0);
  useEffect(() => { const graph = document.querySelector<HTMLElement>(".labor-graph"); if (!graph) return; let tooltip = graph.querySelector<HTMLElement>(".labor-tooltip"); if (!tooltip) { tooltip = document.createElement("div"); tooltip.className = "labor-tooltip"; graph.appendChild(tooltip); } const circles = Array.from(graph.querySelectorAll<SVGCircleElement>("circle")); const handlers = circles.map((circle, index) => { const label = `${laborSeries.labels[index]} · $${((laborSeries.values[index] ?? 0) / 100).toFixed(2)}`; circle.setAttribute("aria-label", `${label} labor cost`); const show = (event: MouseEvent) => { tooltip!.textContent = label; tooltip!.style.display = "block"; const rect = graph!.getBoundingClientRect(); tooltip!.style.left = `${event.clientX - rect.left}px`; tooltip!.style.top = `${event.clientY - rect.top - 34}px`; }; const hide = () => { tooltip!.style.display = "none"; }; circle.addEventListener("mousemove", show); circle.addEventListener("mouseenter", show); circle.addEventListener("mouseleave", hide); return { circle, show, hide }; }); return () => { handlers.forEach(({ circle, show, hide }) => { circle.removeEventListener("mousemove", show); circle.removeEventListener("mouseenter", show); circle.removeEventListener("mouseleave", hide); }); tooltip?.remove(); }; }, [laborSeries]);
  useEffect(() => { document.querySelectorAll<SVGCircleElement>(".labor-graph circle").forEach((circle) => { circle.setAttribute("stroke", "transparent"); circle.setAttribute("stroke-width", "18"); }); }, [laborSeries]);
  return <section className="reference-dashboard">
    <div className="reference-dashboard-head"><div><p className="eyebrow">TODAY</p><h2>Good {new Date().getHours() < 12 ? "morning" : new Date().getHours() < 17 ? "afternoon" : "evening"}, {" "}Ivey Carroll. 👋</h2><p>Here’s what’s happening with your team today.</p></div></div>
    <div className="reference-kpis"><article><span className="kpi-icon purple">♙</span><small>Employees Working Now</small><strong>{working.length}</strong><em>of {employees.length} scheduled</em><Link href="/time-clock">View live map →</Link></article><article><span className="kpi-icon green">◷</span><small>Total Hours This Week</small><strong>{formatHours(totalMinutes)}</strong><em>Recorded hours</em><Link href="/reports">View report →</Link></article><article><span className="kpi-icon orange">$</span><small>Labor Cost This Week</small><strong>{moneyValue(weeklyCost)}</strong><em>Based on recorded hours</em><Link href="/reports">View report →</Link></article><article><span className="kpi-icon blue">↗</span><small>Attendance</small><strong>{attendance}%</strong><em>Current week</em><Link href="/reports">View report →</Link></article></div>
    <div className="reference-three"><article className="reference-panel"><PanelHead title="Today’s Overview" subtitle="Live notifications" /><div className="overview-list"><div>♙ <strong>{working.length}</strong><span>Employees working now</span></div><div>✦ <strong>0</strong><span>Shifts needing coverage</span></div><div>◷ <strong>{workingCount}</strong><span>Active clock-ins</span></div><div>▣ <strong>0</strong><span>Time-off requests pending</span></div></div><Link className="reference-primary" href="/time-clock">View all notifications</Link></article><article className="reference-panel"><PanelHead title="Schedule Snapshot" subtitle="This week" action={<Link className="text-button" href="/schedule">View full schedule →</Link>} /><div className="snapshot-days">{dailyMinutes.map((minutes, index) => <div className={index === new Date().getDay() - 1 ? "selected" : ""} key={index}><small>{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][index]}</small><strong>{minutes ? formatHours(minutes) : "—"}</strong></div>)}</div><div className="snapshot-totals"><span><b>{formatHours(totalMinutes)}</b>Total scheduled</span><span><b>{employees.length}</b>Total shifts</span><span><b className="danger">0</b>Open shifts</span></div><Link className="full-button" href="/schedule">View full schedule →</Link></article><article className="reference-panel labor-card"><PanelHead title="Labor Cost" subtitle={laborRange === "week" ? "Week of current schedule" : laborRangeLabels[laborRange]} action={<select className="labor-range-select" aria-label="Labor cost period" value={laborRange} onChange={(event) => setLaborRange(event.target.value as typeof laborRange)}>{Object.entries(laborRangeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>} /><div className="labor-total-box"><span className="labor-total-icon">♙<b>$</b></span><div><small>Total labor cost</small><strong>{moneyValue(laborCostByRange[laborRange])}</strong><em>Recorded from your team’s hours</em></div></div><div className="labor-chart-heading"><strong>Labor cost over time</strong><span><i /> Labor cost (USD)</span></div><div className="labor-graph"><svg viewBox="0 0 102 68" preserveAspectRatio="none" aria-label="Labor cost trend"><defs><linearGradient id="labor-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#7658e8" stopOpacity=".28" /><stop offset="100%" stopColor="#7658e8" stopOpacity=".02" /></linearGradient></defs>{laborGrid.map((grid) => <g key={grid.y}><line x1="12" x2="98" y1={grid.y} y2={grid.y} stroke="#dfe4ee" strokeDasharray="1.5 1.5" /><text x="0" y={grid.y + 1.5} fill="#65728b" fontSize="3.4">${grid.value}</text></g>)}<line x1="12" x2="98" y1="56" y2="56" stroke="#aab4c4" /><path d={laborArea} fill="url(#labor-fill)" /><polyline points={laborPolyline} fill="none" stroke="#624de0" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />{laborCoords.map((point, index) => <circle key={index} cx={point.x} cy={point.y} r="1.7" fill="#624de0" />)}</svg><div className="labor-axis">{laborSeries.axisLabels.map((label, index) => <span key={`${index}-${label}`} style={{ left: `${((laborCoords[index]?.x ?? 12) / 102) * 100}%` }}>{label}</span>)}</div></div><div className="labor-stats"><span><i>◷</i><small>Total hours</small><b>{formatHours(rangeMinutes)}</b></span><span><i>$</i><small>Labor cost / hr</small><b>{moneyValue(Math.round(averageCostPerHour))}</b></span><span><i>↗</i><small>Highest period</small><b>{laborSeries.labels[highestIndex] || "—"}</b></span><span><i>▣</i><small>Lowest period</small><b>{laborSeries.labels[lowestIndex] || "—"}</b></span></div><Link className="text-button" href="/reports">View labor report →</Link></article></div>
    <div className="reference-three"><article className="reference-panel"><PanelHead title="Employee Status" action={<Link className="text-button" href="/team">View team →</Link>} /><div className="status-donut" style={{ background: `conic-gradient(#4db77b 0 ${employees.length ? workingCount / employees.length * 100 : 0}%, #6250df 0 ${employees.length ? (workingCount + breakCount) / employees.length * 100 : 0}%, #f1b25b 0 ${employees.length ? scheduledCount / employees.length * 100 : 0}%, #d8dde4 0)` }}><strong>{employees.length}</strong><span>Total</span></div><div className="status-legend" aria-label="Employee status key"><b>Status key</b><span><i className="status-dot working" />{workingCount} Working now</span><span><i className="status-dot break" />{breakCount} On break</span><span><i className="status-dot out" />{clockedOutCount} Clocked out</span><span><i className="status-dot unscheduled" />{notScheduledCount} Not scheduled</span></div></article><article className="reference-panel"><PanelHead title="Time Off Requests" action={<Link className="text-button" href="/team">View all →</Link>} /><EmptyState title="No pending requests" message="Time-off requests will appear here." /></article><article className="reference-panel"><PanelHead title="Recent Activity" action={<Link className="text-button" href="/time-clock">View all →</Link>} />{working.slice(0, 4).map((person) => <div className="reference-activity" key={person.id}><span className={`avatar ${person.color}`}>{person.initials}</span><strong>{person.name} clocked in</strong><small>{person.clockIn ?? "Recently"}</small></div>)}{!working.length && <EmptyState title="No activity yet" message="Recent activity will appear here." />}</article></div>
    <div className="reference-bottom"><article className="reference-panel"><PanelHead title="Top Employees" subtitle="This week" /><div className="top-employee-table">{[...employees].sort((a, b) => b.weeklyMinutes - a.weeklyMinutes).slice(0, 5).map((person) => <div key={person.id} role="link" tabIndex={0} style={{ cursor: "pointer" }} onClick={() => { window.location.href = `/team?employee=${person.id}`; }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); window.location.href = `/team?employee=${person.id}`; } }}><span className={`avatar ${person.color}`}>{person.initials}</span><strong>{person.name}</strong><span>{formatHours(person.weeklyMinutes)}</span><span>{person.hourlyRateCents ? moneyValue(Math.round(person.weeklyMinutes / 60 * person.hourlyRateCents)) : "—"}</span></div>)}</div></article><article className="reference-panel"><PanelHead title="Announcements" action={<button className="text-button">View all →</button>} /><div className="announcement">📣 <div><strong>Team updates</strong><span>Announcements and important updates will appear here.</span></div></div><div className="announcement">▣ <div><strong>Schedule published</strong><span>Employees will see published schedule changes.</span></div></div></article></div>
  </section>;
}

function Overview({ employees, working, totalMinutes, dailyMinutes, showAll, setShowAll, toggleClock, flash }: {
  employees: Employee[]; working: Employee[]; totalMinutes: number; dailyMinutes: number[]; showAll: boolean;
  setShowAll: (value: boolean) => void; toggleClock: (employee: Employee) => void; flash: (message: string) => void;
}) {
  const weeklyPayCents = employees.reduce((total, person) => total + Math.round((person.weeklyMinutes / 60) * (person.hourlyRateCents ?? 0)), 0);
  const [expenses, setExpenses] = useState<ExpenseTotals | null>(null);
  const [expenseError, setExpenseError] = useState("");
  const [expenseRange, setExpenseRange] = useState<ExpenseRange>("week");

  useEffect(() => {
    const current = new Date();
    const dayStart = new Date(current.getFullYear(), current.getMonth(), current.getDate());
    const weekStart = new Date(dayStart);
    weekStart.setDate(dayStart.getDate() - ((dayStart.getDay() + 6) % 7));
    const monthStart = new Date(current.getFullYear(), current.getMonth(), 1);
    const yearStart = new Date(current.getFullYear(), 0, 1);
    const query = new URLSearchParams({
      dayStart: String(dayStart.getTime()),
      weekStart: String(weekStart.getTime()),
      monthStart: String(monthStart.getTime()),
      yearStart: String(yearStart.getTime()),
      range: expenseRange,
    });
    setExpenseError("");
    fetch(`/api/reports/expenses?${query}`)
      .then(async (response) => {
        if (!response.ok) throw new Error("Unable to load expenses");
        const result = await response.json() as Partial<ExpenseTotals>;
        if (!result.selected || !Array.isArray(result.selected.byEmployee)) throw new Error("Expense totals were incomplete");
        setExpenses(result as ExpenseTotals);
      })
      .catch(() => setExpenseError("Expense totals could not be loaded."));
  }, [expenseRange]);

  return <>
    <PayrollSummary />
    <section className="stats" aria-label="Weekly overview">
      <Stat icon="◷" theme="coral" label="Hours this week" value={formatHours(totalMinutes)} note={`Across ${employees.length} employees`} />
      <Stat icon="♙" theme="blue" label="Currently working" value={String(working.length)} note={`${Math.max(0, employees.length - working.length)} clocked out`} />
      <Stat icon="$" theme="green" label="Weekly pay" value={moneyValue(weeklyPayCents)} note="Based on recorded hours" />
    </section>
    <section className="dashboard-grid">
      <article className="panel activity-panel">
        <PanelHead title="Who’s working" subtitle="Live team activity" action={<button className="text-button" onClick={() => setShowAll(!showAll)}>{showAll ? "Show less" : "View all"} →</button>} />
        <EmployeeRows employees={showAll ? employees : employees.slice(0, 4)} toggleClock={toggleClock} />
      </article>
      <article className="panel week-panel">
        <PanelHead title="This week" subtitle="Recorded data only" />
        <div className="week-total"><div className="ring"><span>0%</span></div><div><strong>{formatHours(totalMinutes)}</strong><span>of 0h scheduled</span></div></div>
        <div className="divider" />
        <WeekBars dailyMinutes={dailyMinutes} />
        <Link className="full-button" href="/reports">Open reports <span>→</span></Link>
      </article>
    </section>
    <section className="dashboard-card-grid">
      <article className="panel dashboard-card"><PanelHead title="Schedule snapshot" subtitle="This week" action={<Link className="text-button" href="/schedule">View schedule →</Link>} /><div className="schedule-snapshot-days">{dailyMinutes.map((minutes, index) => <div key={index} className={minutes ? "active" : ""}><strong>{minutes ? formatHours(minutes) : "—"}</strong><span>{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][index]}</span></div>)}</div><Link className="full-button" href="/schedule">Open full schedule <span>→</span></Link></article>
      <article className="panel dashboard-card"><PanelHead title="Employee status" subtitle="Live team overview" action={<Link className="text-button" href="/team">View team →</Link>} /><div className="status-summary"><div><strong>{employees.length}</strong><span>Total employees</span></div><div><strong className="status-green">{working.length}</strong><span>Working now</span></div><div><strong>{Math.max(0, employees.length - working.length)}</strong><span>Clocked out</span></div></div><div className="status-progress"><i style={{ width: `${employees.length ? (working.length / employees.length) * 100 : 0}%` }} /></div></article>
      <article className="panel dashboard-card"><PanelHead title="Recent activity" subtitle="Today" action={<Link className="text-button" href="/time-clock">View all →</Link>} />{working.slice(0, 4).map((person) => <div className="dashboard-activity-row" key={person.id}><span className={`avatar ${person.color}`}>{person.initials}</span><div><strong>{person.name} clocked in</strong><small>{person.clockIn ?? "Recently"}</small></div></div>)}{!working.length && <EmptyState title="No activity yet" message="Clock-ins and updates will appear here." />}</article>
    </section>
    <section className="bottom-strip"><div><span className="strip-icon">0</span><div><strong>0 recorded exceptions</strong><p>Items will appear after employees record time.</p></div></div><button className="text-button" onClick={() => flash("There is no recorded activity yet.")}>View activity →</button></section>
  </>;
}

function PayrollSummary() {
  const [totals, setTotals] = useState<ExpenseTotals | null>(null);
  useEffect(() => {
    const now = new Date();
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(dayStart);
    weekStart.setDate(dayStart.getDate() - ((dayStart.getDay() + 6) % 7));
    const query = new URLSearchParams({
      dayStart: String(dayStart.getTime()),
      weekStart: String(weekStart.getTime()),
      monthStart: String(new Date(now.getFullYear(), now.getMonth(), 1).getTime()),
      yearStart: String(new Date(now.getFullYear(), 0, 1).getTime()),
      range: "week",
    });
    fetch(`/api/reports/expenses?${query}`)
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((result: ExpenseTotals) => result?.selected && setTotals(result))
      .catch(() => setTotals(null));
  }, []);
  const money = (cents: number) => (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
  return <article className="panel expense-report"><PanelHead title="Payroll summary" subtitle="Recorded earnings and payments" /><div className="expense-insights"><div><span>Money owed</span><strong>{totals ? money(totals.selected.owedCents) : "—"}</strong><small>Recorded earnings not yet paid</small></div><div><span>Owed + paid</span><strong>{totals ? money(totals.selected.combinedCents) : "—"}</strong><small>Total labor value</small></div></div></article>;
}

function PlaidConnectCard({ flash }: { flash: (message: string) => void }) {
  const [status, setStatus] = useState<"loading" | "connected" | "disconnected">("loading");
  const [institution, setInstitution] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    fetch("/api/plaid/status").then((response) => response.ok ? response.json() : null).then((data: { connected?: boolean; account?: { institutionName?: string | null } } | null) => {
      setStatus(data?.connected ? "connected" : "disconnected");
      setInstitution(data?.account?.institutionName ?? null);
    }).catch(() => setStatus("disconnected"));
  }, []);
  async function connect() {
    setBusy(true);
    try {
      const response = await fetch("/api/plaid/link-token", { method: "POST" });
      const data = await response.json() as { linkToken?: string; error?: string };
      if (!response.ok || !data.linkToken) throw new Error(data.error || "Unable to start Plaid.");
      if (!window.Plaid) {
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement("script"); script.src = "https://cdn.plaid.com/link/v2/stable/link-initialize.js"; script.onload = () => resolve(); script.onerror = () => reject(new Error("Plaid Link could not load.")); document.head.appendChild(script);
        });
      }
      if (!window.Plaid) throw new Error("Plaid Link is unavailable.");
      const handler = window.Plaid.create({ token: data.linkToken, onSuccess: async (publicToken: string, metadata: { institution?: { name?: string; institution_id?: string }; accounts?: Array<{ id?: string; name?: string; mask?: string; type?: string; subtype?: string }> }) => {
        const exchange = await fetch("/api/plaid/exchange-token", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ publicToken, institution: metadata.institution, account: metadata.accounts?.[0] }) });
        const result = await exchange.json() as { error?: string; institutionName?: string | null };
        if (!exchange.ok) throw new Error(result.error || "Could not save the connection.");
        setInstitution(result.institutionName ?? metadata.institution?.name ?? null); setStatus("connected"); flash("Bank account connected securely through Plaid.");
      }, onExit: () => setBusy(false) });
      handler.open();
    } catch (error) { flash(error instanceof Error ? error.message : "Unable to connect bank account."); setBusy(false); }
  }
  async function disconnect() { setBusy(true); await fetch("/api/plaid/disconnect", { method: "POST" }); setInstitution(null); setStatus("disconnected"); setBusy(false); flash("Bank connection removed."); }
  return <article className="panel plaid-card"><div><span className="payroll-icon green">$</span><div><h2>Bank connection</h2><p>{status === "connected" ? `${institution || "Bank account"} connected through Plaid` : "Connect a bank account to prepare secure payroll payouts."}</p></div></div>{status === "connected" ? <button className="secondary-button" type="button" disabled={busy} onClick={disconnect}>Disconnect</button> : <button className="primary-button" type="button" disabled={busy || status === "loading"} onClick={connect}>{busy ? "Connecting…" : "Connect bank account"}</button>}<small>Plaid keeps your bank credentials in its secure connection flow. CoreShift never receives your bank password.</small></article>;
}

function PlaidTransferPanel({ rows, periodStart, periodEnd, flash }: { rows: Array<{ employee: Employee; estimatedCents: number }>; periodStart: number; periodEnd: number; flash: (message: string) => void }) {
  const [readiness, setReadiness] = useState<{ configured: boolean; environment: string; linkedEmployeeIds: number[]; transfers: Array<{ status?: string }> } | null>(null);
  const [sending, setSending] = useState(false);
  const load = () => fetch("/api/plaid/readiness", { cache: "no-store" })
    .then(async (response) => { const data = await response.json(); if (!response.ok) throw new Error(data?.error || "Could not load Plaid."); setReadiness(data); })
    .catch(() => setReadiness(null));
  useEffect(() => { load(); }, []);
  const linked = new Set(readiness?.linkedEmployeeIds || []);
  const payable = rows.filter((row) => row.estimatedCents > 0).map((row) => ({
    employeeId: row.employee.id,
    employeeName: row.employee.name,
    amountCents: row.estimatedCents,
    periodStart: new Date(periodStart).toISOString().slice(0, 10),
    periodEnd: new Date(periodEnd).toISOString().slice(0, 10),
  }));
  const missing = payable.filter((item) => !linked.has(item.employeeId));
  async function send() {
    if (!readiness?.configured) return flash("Plaid credentials and transfer approval are still required.");
    if (!payable.length) return flash("There is no payroll amount to send.");
    if (missing.length) return flash(`${missing.length} employee${missing.length === 1 ? "" : "s"} must connect a bank account first.`);
    const total = payable.reduce((sum, item) => sum + item.amountCents, 0) / 100;
    if (!window.confirm(`Send ${total.toLocaleString("en-US", { style: "currency", currency: "USD" })} to ${payable.length} employee${payable.length === 1 ? "" : "s"} through Plaid?`)) return;
    setSending(true);
    try {
      const response = await fetch("/api/plaid/transfers", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirmation: "SEND_PAYROLL", items: payable }) });
      const data = await response.json();
      if (!response.ok && !data?.sent) throw new Error(data?.error || data?.results?.[0]?.error || "Plaid could not send payroll.");
      flash(`${data.sent} transfer${data.sent === 1 ? "" : "s"} submitted${data.failed ? `; ${data.failed} failed` : ""}. Employees are marked paid only after settlement.`);
      load();
    } catch (error) { flash(error instanceof Error ? error.message : "Plaid could not send payroll."); }
    finally { setSending(false); }
  }
  const latest = readiness?.transfers?.[0]?.status;
  return <article className="panel plaid-card"><div><span className="payroll-icon green">+</span><div><h2>Direct deposit</h2><p>{readiness?.configured ? `${payable.length - missing.length} of ${payable.length} payable employees ready` : "Plaid transfer setup needs production credentials and approval."}</p></div></div><div>{missing.length > 0 && <small>{missing.map((item) => item.employeeName).join(", ")} still need to connect an account.</small>}{latest && <small>Latest status: <b>{latest.replaceAll("_", " ")}</b></small>}<button className="primary-button" type="button" disabled={sending || !readiness?.configured || missing.length > 0 || !payable.length} onClick={send}>{sending ? "Sending securely..." : "Review and send payroll"}</button></div><small>Transfers remain pending until Plaid confirms settlement. Use "Mark paid" only for payments made outside Plaid.</small></article>;
}

function payrollPeriodFor(date: Date, settings: { frequency: string; payPeriodStarts: string }) {
  const weekdayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const configuredStartDay = Math.max(0, weekdayNames.indexOf(settings.payPeriodStarts));
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - ((start.getDay() - configuredStartDay + 7) % 7));
  const days = settings.frequency === "Biweekly" ? 14 : 7;
  if (days === 14) start.setDate(start.getDate() - 7);
  return { start: start.getTime(), end: addDays(start, days).getTime() - 1, days };
}

type GustoPayrollStatus = { connected: boolean; companyName?: string; companyId?: string; environment?: "Demo" | "Production"; onboardingComplete?: boolean; error?: string };

async function openGustoFlow(flowType: "company_onboarding" | "employee_management" | "run_payroll" | "payroll_history", flash: (message: string) => void) {
  const popup = window.open("about:blank", "_blank");
  if (popup) { popup.document.title = "Opening Gusto"; popup.document.body.innerHTML = '<p style="font:16px sans-serif;padding:32px">Opening secure Gusto payroll...</p>'; popup.opener = null; }
  const response = await fetch("/api/gusto/flows", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ flowType }) }).catch(() => null);
  const payload = response ? await response.json().catch(() => null) as { url?: string; error?: string; environment?: string } | null : null;
  if (!response?.ok || !payload?.url) { popup?.close(); flash(payload?.error || "Gusto could not open the payroll workflow."); return false; }
  if (popup) popup.location.href = payload.url; else window.location.assign(payload.url);
  flash(`${payload.environment || "Gusto"} workflow opened securely.`);
  return true;
}

function GustoPayrollPanel({ flash }: { flash: (message: string) => void }) {
  const [status, setStatus] = useState<GustoPayrollStatus | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const load = () => fetch("/api/gusto/status", { cache: "no-store" }).then((response) => response.ok ? response.json() as Promise<GustoPayrollStatus> : Promise.reject()).then(setStatus).catch(() => setStatus({ connected: false, error: "Gusto status could not be loaded." }));
  useEffect(() => { void load(); }, []);
  const launch = async (flowType: "company_onboarding" | "employee_management" | "run_payroll" | "payroll_history") => { setWorking(flowType); await openGustoFlow(flowType, flash); setWorking(null); };
  if (!status) return <article className="panel plaid-card"><div><span className="payroll-icon green">G</span><div><h2>Gusto Payroll</h2><p>Checking the secure payroll connection...</p></div></div></article>;
  if (!status.connected) return <article className="panel plaid-card"><div><span className="payroll-icon green">G</span><div><h2>Gusto Payroll</h2><p>Connect Gusto before onboarding employees or running payroll.</p></div></div><button className="primary-button" type="button" onClick={() => window.location.assign("/settings?section=integrations")}>Connect Gusto</button><small>CoreShift never stores bank account numbers, tax forms, or Gusto passwords.</small></article>;
  return <article className="panel plaid-card"><div><span className="payroll-icon green">G</span><div><h2>Gusto Payroll <em>{status.environment || "Connected"}</em></h2><p>{status.onboardingComplete ? `${status.companyName || "Company"} is ready for payroll.` : `${status.companyName || "Company"} still needs Gusto onboarding.`}</p></div></div><div className="integration-live-actions"><button className="secondary-button" type="button" disabled={!!working} onClick={() => void launch("company_onboarding")}>{working === "company_onboarding" ? "Opening..." : status.onboardingComplete ? "Review company setup" : "Complete company setup"}</button><button className="secondary-button" type="button" disabled={!!working} onClick={() => void launch("employee_management")}>{working === "employee_management" ? "Opening..." : "Manage employees"}</button><button className="primary-button" type="button" disabled={!!working || !status.onboardingComplete} onClick={() => void launch("run_payroll")}>{working === "run_payroll" ? "Opening..." : "Review and run payroll"}</button><button className="text-button" type="button" disabled={!!working} onClick={() => void launch("payroll_history")}>Payroll history</button></div>{status.error && <small>{status.error}</small>}<small>{status.environment === "Demo" ? "Demo mode: no real money moves. Production requires Gusto approval." : "Gusto handles bank debits, employee direct deposits, payroll taxes, and paystubs."}</small></article>;
}

function PayrollPage({ employees, flash }: { employees: Employee[]; flash: (message: string) => void }) {
  const [tab, setTab] = useState("Run Payroll");
  const [query, setQuery] = useState("");
  const [paidIds, setPaidIds] = useState<number[]>([]);
  const persistedPaidIds = useRef<Set<number>>(new Set());
  const [paySchedule, setPaySchedule] = useState({ frequency: "Weekly", payDay: "Friday", payPeriodStarts: "Sunday" });
  const payrollPeriod = payrollPeriodFor(new Date(), paySchedule);
  const [periodEmployeeReport, setPeriodEmployeeReport] = useState<Record<number, { minutes: number; hourlyRateCents: number; paidCents: number }>>({});
  useEffect(() => {
    fetch("/api/settings/pay", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((payload: { settings?: { frequency?: string; payPeriod?: string; payDay?: string; payPeriodStarts?: string } }) => {
        if (!payload.settings) return;
        const storedPeriod = payload.settings.payPeriod || "";
        const frequency = storedPeriod.startsWith("Biweekly") || payload.settings.frequency === "Biweekly"
          ? "Biweekly"
          : storedPeriod.startsWith("Weekly")
            ? "Weekly"
            : payload.settings.frequency || "Weekly";
        setPaySchedule((current) => ({
          frequency,
          payDay: payload.settings?.payDay || current.payDay,
          payPeriodStarts: payload.settings?.payPeriodStarts || current.payPeriodStarts,
        }));
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    const start = payrollPeriod.start;
    const end = payrollPeriod.end;
    const params = new URLSearchParams({ range: "custom", dayStart: String(start), weekStart: String(start), monthStart: String(start), yearStart: String(start), periodStart: String(start), periodEnd: String(end) });
    fetch(`/api/reports/expenses?${params}`, { cache: "no-store" }).then((response) => response.ok ? response.json() : Promise.reject()).then((payload: { selected?: { employeeReport?: Array<{ id: number; minutes: number; hourlyRateCents: number; paidCents: number }> } }) => {
      const report = payload.selected?.employeeReport ?? [];
      const paid = report.filter((row) => row.paidCents > 0).map((row) => row.id);
      persistedPaidIds.current = new Set(paid);
      setPaidIds(paid);
      setPeriodEmployeeReport(Object.fromEntries(report.map((row) => [row.id, row])));
    }).catch(() => {});
  }, [payrollPeriod.start, payrollPeriod.end]);
  async function undoManualPayments(employeeIds: number[]) {
    const response = await fetch("/api/payroll/payments", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ employeeIds, periodStart: payrollPeriod.start, periodEnd: payrollPeriod.end }),
    });
    const payload = await response.json().catch(() => null) as { removed?: number[]; error?: string } | null;
    if (!response.ok) throw new Error(payload?.error ?? "The payment could not be undone.");
    return payload?.removed ?? [];
  }
  async function setPaid(employeeId: number, employeeName: string) {
    if (paidIds.includes(employeeId)) {
      if (!window.confirm(`Undo the manual paid status for ${employeeName}?`)) return;
      try {
        const removed = await undoManualPayments([employeeId]);
        if (!removed.includes(employeeId)) return flash("Only manual payroll approvals can be undone here.");
        persistedPaidIds.current.delete(employeeId);
        setPaidIds((current) => current.filter((id) => id !== employeeId));
        setPeriodEmployeeReport((current) => current[employeeId] ? { ...current, [employeeId]: { ...current[employeeId], paidCents: 0 } } : current);
        flash(`${employeeName}'s paid status was undone.`);
      } catch (error) { flash(error instanceof Error ? error.message : "The payment could not be undone."); }
      return;
    }
    if (!window.confirm(`Mark ${employeeName} as paid for this payroll period?`)) return;
    setPaidIds((current) => [...current, employeeId]);
    flash(`${employeeName} marked as paid.`);
  }
  const rows = employees.filter((employee) => employee.name.toLowerCase().includes(query.toLowerCase())).map((employee) => {
    const reportRow = periodEmployeeReport[employee.id];
    const totalMinutes = reportRow?.minutes ?? employee.weeklyMinutes;
    const regularMinutes = Math.min(totalMinutes, payrollPeriod.days === 14 ? 4800 : 2400);
    const overtimeMinutes = Math.max(0, totalMinutes - regularMinutes);
    const rate = reportRow?.hourlyRateCents ?? employee.hourlyRateCents ?? 0;
    return { employee, regularMinutes, overtimeMinutes, totalMinutes, estimatedCents: Math.round((regularMinutes / 60) * rate + (overtimeMinutes / 60) * rate * 1.5) };
  });
  const totalRegular = rows.reduce((sum, row) => sum + row.regularMinutes, 0);
  const totalOvertime = rows.reduce((sum, row) => sum + row.overtimeMinutes, 0);
  const estimatedCost = rows.reduce((sum, row) => sum + row.estimatedCents, 0);
  const paidRows = rows.filter((row) => paidIds.includes(row.employee.id));
  const allRowsPaid = rows.length > 0 && rows.every((row) => paidIds.includes(row.employee.id));
  async function toggleAllPaid() {
    const employeeIds = rows.map((row) => row.employee.id);
    if (allRowsPaid) {
      if (!window.confirm("Undo manual paid status for everyone in this payroll period?")) return;
      try {
        const removed = await undoManualPayments(employeeIds);
        if (!removed.length) return flash("No manual payroll approvals could be undone.");
        const removedSet = new Set(removed);
        removed.forEach((id) => persistedPaidIds.current.delete(id));
        setPaidIds((current) => current.filter((id) => !removedSet.has(id)));
        setPeriodEmployeeReport((current) => Object.fromEntries(Object.entries(current).map(([id, report]) => [
          id,
          removedSet.has(Number(id)) ? { ...report, paidCents: 0 } : report,
        ])));
        flash(`${removed.length} manual payment${removed.length === 1 ? "" : "s"} undone.`);
      } catch (error) { flash(error instanceof Error ? error.message : "Payroll payments could not be undone."); }
      return;
    }
    if (!window.confirm(`Open Gusto to review taxes, deductions, bank debits, and direct deposits for ${rows.length} employee${rows.length === 1 ? "" : "s"}? Nothing is submitted until you confirm it in Gusto.`)) return;
    await openGustoFlow("run_payroll", flash);
  }
  useEffect(() => {
    const newlyPaid = paidIds.filter((id) => !persistedPaidIds.current.has(id));
    if (!newlyPaid.length) return;
    const periodStart = payrollPeriod.start;
    const periodEnd = payrollPeriod.end;
    const payments = newlyPaid.map((id) => rows.find((row) => row.employee.id === id)).filter((row): row is NonNullable<typeof row> => !!row && row.estimatedCents > 0).map((row) => ({ employeeId: row.employee.id, amountCents: row.estimatedCents }));
    if (!payments.length) return;
    newlyPaid.forEach((id) => persistedPaidIds.current.add(id));
    fetch("/api/payroll/payments", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ payments, paidAt: Date.now(), periodStart, periodEnd }) })
      .then(async (response) => { const payload = await response.json().catch(() => null) as { error?: string } | null; if (!response.ok) throw new Error(payload?.error ?? "Payroll payments could not be recorded."); })
      .catch((reason: Error) => { newlyPaid.forEach((id) => persistedPaidIds.current.delete(id)); setPaidIds((current) => current.filter((id) => !newlyPaid.includes(id))); flash(reason.message); });
  }, [paidIds, payrollPeriod.start, payrollPeriod.end]);
  const money = (cents: number) => (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
  const payrollStart = new Date(payrollPeriod.start);
  const payrollEnd = new Date(payrollPeriod.end);
  const currentPayPeriod = formatDateRange(payrollStart, payrollEnd, true);
  const weekdayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const configuredPayDay = Math.max(0, weekdayNames.indexOf(paySchedule.payDay));
  const scheduleLengthDays = payrollPeriod.days;
  const upcomingPayrolls = Array.from({ length: 3 }, (_, index) => {
    const start = addDays(payrollEnd, 1 + index * scheduleLengthDays);
    const end = addDays(start, scheduleLengthDays - 1);
    const payDate = addDays(end, 1);
    payDate.setDate(payDate.getDate() + ((configuredPayDay - payDate.getDay() + 7) % 7));
    return {
      label: formatDateRange(start, end, true),
      payDate: payDate.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }),
    };
  });
  const tabs = ["Run Payroll", "Pay History", "Employees", "Tax Documents", "Settings"];
  function downloadPayHistory() {
    const header = ["Pay period", "Employee", "Role", "Hours", "Overtime hours", "Pay rate", "Amount", "Status"];
    const lines = rows.map((row) => [currentPayPeriod, row.employee.name, row.employee.role, formatHours(row.regularMinutes), formatHours(row.overtimeMinutes), money(row.employee.hourlyRateCents ?? 0), money(row.estimatedCents), paidIds.includes(row.employee.id) ? "Paid" : "Unpaid"]);
    const csv = [header, ...lines].map((line) => line.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `coreshift-pay-history-${new Date().toISOString().slice(0, 10)}.csv`; link.click(); URL.revokeObjectURL(url);
    flash("Pay history downloaded.");
  }
  const payHistory = tab === "Pay History" ? <PersistentPayHistoryView currentPayPeriod={currentPayPeriod} currentPeriodStart={payrollPeriod.start} periodDays={payrollPeriod.days} payFrequency={paySchedule.frequency} currentRows={rows} currentEstimatedCost={estimatedCost} currentPaidIds={paidIds} money={money} flash={flash} /> : null;
  if (tab === "Employees") return <section className="payroll-page"><div className="payroll-tabs">{tabs.map((item) => <button key={item} type="button" className={tab === item ? "active" : ""} onClick={() => { setTab(item); flash(`${item} opened.`); }}>{item}</button>)}</div><PayrollEmployeesView rows={rows} money={money} onDownload={downloadPayHistory} /></section>;
  if (tab === "Pay History") return <section className="payroll-page"><div className="payroll-tabs">{tabs.map((item) => <button key={item} type="button" className={tab === item ? "active" : ""} onClick={() => { setTab(item); flash(`${item} opened.`); }}>{item}</button>)}</div>{payHistory}</section>;
  return <section className="payroll-page">
    <div className="payroll-tabs">{tabs.map((item) => <button key={item} type="button" className={tab === item ? "active" : ""} onClick={() => { setTab(item); flash(`${item} opened.`); }}>{item}</button>)}</div>
    {payHistory}
    {tab !== "Pay History" && <>
    <div className="payroll-kpis">
      <article className="panel payroll-kpi"><span className="payroll-icon purple">▣</span><small>Current Payroll Period</small><strong>{currentPayPeriod}</strong><em>{paySchedule.frequency} payroll</em><button className="primary-button" type="button" onClick={() => void openGustoFlow("run_payroll", flash)}>Run in Gusto</button></article>
      <article className="panel payroll-kpi"><span className="payroll-icon green">$</span><small>Pay Period</small><strong>{currentPayPeriod}</strong><em>{payrollPeriod.days} days</em><button className="text-button" type="button" onClick={() => flash("Pay period details opened.")}>View pay period details →</button></article>
      <article className="panel payroll-kpi"><span className="payroll-icon blue">♙</span><small>Employees Paid</small><strong>{paidRows.length} / {rows.length}</strong><em>Marked paid this period</em><button className="text-button" type="button" onClick={() => flash("Employee payroll list opened.")}>View all employees →</button></article>
      <article className="panel payroll-kpi"><span className="payroll-icon orange">▣</span><small>Est. Payroll Cost</small><strong>{money(estimatedCost)}</strong><em>Based on recorded hours</em><button className="text-button" type="button" onClick={() => flash("Cost breakdown opened.")}>View cost breakdown →</button></article>
    </div>
    <GustoPayrollPanel flash={flash} />
    <div className="payroll-layout">
      <article className="panel payroll-employees"><div className="payroll-section-head"><div><h2>Employees in This Payroll ({rows.length})</h2></div><div className="payroll-head-actions"><button className="secondary-button" type="button" onClick={() => flash("Payroll editor opened.")}>✎ Edit payroll</button><button className="primary-button" type="button" onClick={toggleAllPaid}>{allRowsPaid ? "Undo manually paid" : "Open Gusto payroll"}</button></div></div><div className="payroll-filter-row"><label className="documents-search">⌕<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search employees..." /></label><select defaultValue="All Departments"><option>All Departments</option><option>Operations</option><option>Front of House</option></select><select defaultValue="All Employment Types"><option>All Employment Types</option><option>Hourly</option><option>Salaried</option></select><button className="secondary-button" type="button" onClick={() => flash("Payroll filters opened.")}>☷ Filters</button></div><div className="payroll-table payroll-table-head"><span>Employee</span><span>Pay Rate</span><span>Regular Hours</span><span>Overtime Hours</span><span>Total Hours</span><span>Est. Pay</span><span>Status</span></div>{rows.map((row) => { const paid = paidIds.includes(row.employee.id); return <div className="payroll-table" key={row.employee.id}><div className="payroll-person"><span className={`avatar ${row.employee.color}`}>{row.employee.initials}</span><strong>{row.employee.name}<small>{row.employee.role}</small></strong></div><span>{money(row.employee.hourlyRateCents ?? 0)} / hr</span><span>{formatHours(row.regularMinutes)}</span><span>{formatHours(row.overtimeMinutes)}</span><span>{formatHours(row.totalMinutes)}</span><strong>{money(row.estimatedCents)}</strong><button className={`payroll-status ${paid ? "paid" : ""}`} type="button" onClick={() => setPaid(row.employee.id, row.employee.name)}>{paid ? "Paid manually" : "Mark paid manually"}</button></div>; })}{!rows.length && <EmptyState title="No payroll employees" message="Employees and recorded hours will appear here." />}<div className="payroll-table-footer">Showing {rows.length} employees <span>‹　<b>1</b>　›</span></div></article>
      <aside className="payroll-side"><article className="panel payroll-summary-card"><div className="panel-head"><div><h2>Payroll Summary</h2></div><button className="text-button" type="button" onClick={() => flash("Payroll breakdown opened.")}>View full breakdown →</button></div><dl><div><dt>Total Regular Hours</dt><dd>{formatHours(totalRegular)}</dd></div><div><dt>Total Overtime Hours</dt><dd>{formatHours(totalOvertime)}</dd></div><div><dt>Gross Payroll</dt><dd>{money(estimatedCost)}</dd></div><div><dt>Employee Taxes (Est.)</dt><dd>—</dd></div><div><dt>Employer Taxes (Est.)</dt><dd>—</dd></div><div className="payroll-total"><dt>Total Payroll Cost</dt><dd>{money(estimatedCost)}</dd></div></dl><div className="payroll-donut" /><div className="payroll-key"><span><i className="purple" />Gross wages <b>{money(estimatedCost)}</b></span><span><i className="blue" />Employee taxes <b>—</b></span><span><i className="green" />Employer taxes <b>—</b></span></div></article><article className="panel upcoming-payroll"><div className="panel-head"><h2>Upcoming Payroll</h2></div>{upcomingPayrolls.map((period, index) => <button type="button" key={period.label} onClick={() => flash(period.label + " opened.")}><span>$</span><div><strong>{period.label} <em>{paySchedule.frequency}</em></strong><small>Pay Date: {period.payDate}</small></div><b>{index === 0 ? money(estimatedCost) : "$0.00"} &gt;</b></button>)}<button className="text-button" type="button" onClick={() => flash("All payrolls opened.")}>View all payrolls →</button></article><article className="panel payroll-shortcuts"><h2>Payroll Shortcuts</h2><div>{["Add Bonus", "Reimburse Employee", "Manage Deductions", "Payroll Settings"].map((item) => <button type="button" key={item} onClick={() => flash(`${item} opened.`)}><span>✦</span>{item}</button>)}</div></article></aside>
    </div>
    </>}
  </section>;
}

function PayHistoryView({ currentPayPeriod, rows, estimatedCost, paidRows, money, onDownload }: { currentPayPeriod: string; rows: Array<{ employee: Employee; regularMinutes: number; overtimeMinutes: number; totalMinutes: number; estimatedCents: number }>; estimatedCost: number; paidRows: Array<{ employee: Employee; estimatedCents: number }>; money: (cents: number) => string; onDownload: () => void }) {
  const [expanded, setExpanded] = useState(true);
  const allPaid = rows.length > 0 && paidRows.length === rows.length;
  const totalHours = rows.reduce((sum, row) => sum + row.totalMinutes, 0);
  const averageRate = totalHours ? estimatedCost / (totalHours / 60) : 0;
  return <section className="pay-history-view">
    <div className="pay-history-header"><div><h1>Pay History</h1><p>View and download payroll payments recorded for your team.</p></div><div className="pay-history-actions"><button className="secondary-button" type="button" onClick={onDownload}>⇩ Export all</button><button className="primary-button" type="button" onClick={onDownload}>⇩ Download CSV</button></div></div>
    <div className="pay-history-kpis"><article className="panel"><span className="payroll-icon green">$</span><small>Total payroll</small><strong>{money(estimatedCost)}</strong><em>Current period</em></article><article className="panel"><span className="payroll-icon purple">♙</span><small>Employees paid</small><strong>{paidRows.length} / {rows.length}</strong><em>{allPaid ? "Paid this period" : "Awaiting payment"}</em></article><article className="panel"><span className="payroll-icon blue">◷</span><small>Total hours paid</small><strong>{formatHours(totalHours)}</strong><em>Recorded hours</em></article><article className="panel"><span className="payroll-icon orange">↗</span><small>Average labor cost</small><strong>{money(Math.round(averageRate))} / hr</strong><em>Based on recorded hours</em></article></div>
    <div className="pay-history-grid"><article className="panel pay-history-list"><div className="pay-history-list-head"><div><h2>Payroll periods</h2><p>Only payroll data recorded in this account is shown.</p></div><button className="secondary-button" type="button" onClick={onDownload}>Download data</button></div><div className={`pay-period-row ${expanded ? "expanded" : ""}`}><button className="pay-period-summary" type="button" onClick={() => setExpanded((value) => !value)}><span className="pay-chevron">{expanded ? "⌄" : "›"}</span><strong>{currentPayPeriod}</strong><span className={`history-status ${allPaid ? "paid" : "pending"}`}>{allPaid ? "Paid" : "Unpaid"}</span><b>{money(estimatedCost)}</b><span>{expanded ? "Hide details" : "View details"}</span></button>{expanded && <div className="pay-period-details"><div className="pay-history-table pay-history-table-head"><span>Employee</span><span>Hours</span><span>Pay rate</span><span>Amount</span><span>Status</span></div>{rows.map((row) => <div className="pay-history-table" key={row.employee.id}><div className="pay-history-person"><span className={`avatar ${row.employee.color}`}>{row.employee.initials}</span><strong>{row.employee.name}<small>{row.employee.role}</small></strong></div><span>{formatHours(row.totalMinutes)}</span><span>{money(row.employee.hourlyRateCents ?? 0)} / hr</span><strong>{money(row.estimatedCents)}</strong><span className={`history-status ${paidRows.some((paid) => paid.employee.id === row.employee.id) ? "paid" : "pending"}`}>{paidRows.some((paid) => paid.employee.id === row.employee.id) ? "Paid" : "Unpaid"}</span></div>)}</div>}</div>{!rows.length && <EmptyState title="No payroll history" message="Recorded payroll periods will appear here." />}</article><aside className="pay-history-summary panel"><h2>Payroll summary</h2><div><span>Total payroll</span><strong>{money(estimatedCost)}</strong></div><div><span>Employees paid</span><strong>{paidRows.length} / {rows.length}</strong></div><div><span>Total hours</span><strong>{formatHours(totalHours)}</strong></div><button className="secondary-button" type="button" onClick={onDownload}>⇩ Download payroll report</button></aside></div>
  </section>;
}

function PayrollEmployeesView({ rows, money, onDownload }: { rows: Array<{ employee: Employee; regularMinutes: number; overtimeMinutes: number; totalMinutes: number; estimatedCents: number }>; money: (cents: number) => string; onDownload: () => void }) {
  const [period, setPeriod] = useState("All time"); const [query, setQuery] = useState("");
  const filtered = rows.filter((row) => row.employee.name.toLowerCase().includes(query.toLowerCase()));
  const total = filtered.reduce((sum, row) => sum + row.estimatedCents, 0); const hours = filtered.reduce((sum, row) => sum + row.totalMinutes, 0); const average = hours ? Math.round(total / (hours / 60)) : 0;
  return <section className="payroll-employees-view"><div className="payroll-employees-title"><div><h1>Employees</h1><p>View your team members and their payroll information.</p></div><button className="primary-button" type="button" onClick={onDownload}>⇩ Export payroll data</button></div><div className="employee-period-bar">{["All time", "Year", "Month", "Weekly", "Custom"].map((item) => <button type="button" className={period === item ? "active" : ""} onClick={() => setPeriod(item)} key={item}>{item}</button>)}</div><div className="payroll-kpis employee-payroll-kpis"><article className="panel payroll-kpi"><span className="payroll-icon green">$</span><small>Total payroll</small><strong>{money(total)}</strong><em>{period}</em></article><article className="panel payroll-kpi"><span className="payroll-icon purple">♙</span><small>Total employees</small><strong>{filtered.length}</strong><em>Active team members</em></article><article className="panel payroll-kpi"><span className="payroll-icon blue">◷</span><small>Total hours paid</small><strong>{formatHours(hours)}</strong><em>{period}</em></article><article className="panel payroll-kpi"><span className="payroll-icon orange">↗</span><small>Average labor cost</small><strong>{money(average)} / hr</strong><em>Based on recorded hours</em></article></div><article className="panel employee-payroll-table"><div className="employee-payroll-toolbar"><label className="documents-search">⌕<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search employees..." /></label><select defaultValue="All Status"><option>All Status</option><option>Active</option></select><select defaultValue="All Departments"><option>All Departments</option></select><button className="secondary-button" type="button" onClick={onDownload}>⇩ Export</button></div><div className="employee-payroll-grid employee-payroll-head"><span>Employee</span><span>Role</span><span>Status</span><span>Pay rate</span><span>Total pay</span><span>Total hours</span></div>{filtered.map((row) => <div className="employee-payroll-grid" key={row.employee.id}><div className="pay-history-person"><span className={`avatar ${row.employee.color}`}>{row.employee.initials}</span><strong>{row.employee.name}<small>{row.employee.email ?? "Employee"}</small></strong></div><span>{row.employee.role}</span><span><i className="employee-active-dot" />Active</span><span>{money(row.employee.hourlyRateCents ?? 0)} / hr</span><strong>{money(row.estimatedCents)}</strong><span>{formatHours(row.totalMinutes)}</span></div>)}{!filtered.length && <EmptyState title="No employees found" message="Try a different search." />}<div className="payroll-table-footer">Showing {filtered.length} employees <span>‹　<b>1</b>　›</span></div></article><div className="employee-payroll-bottom"><article className="panel"><h2>Top earners</h2>{[...filtered].sort((a,b)=>b.estimatedCents-a.estimatedCents).slice(0,3).map((row,index)=><div className="employee-payroll-rank" key={row.employee.id}><b>{index+1}</b><span>{row.employee.name}</span><strong>{money(row.estimatedCents)}</strong></div>)}</article><article className="panel"><h2>Payroll overview</h2><p>Totals are calculated from recorded hours and employee pay rates for the selected period.</p><button className="text-button" type="button" onClick={onDownload}>Download full report →</button></article></div></section>;
}

function ExpenseReport({ totals, error, range, setRange }: {
  totals: ExpenseTotals | null;
  error: string;
  range: ExpenseRange;
  setRange: (range: ExpenseRange) => void;
}) {
  // Keep legacy callers safe while all dashboard routes migrate to PayrollSummary.
  return <PayrollSummary />;

  const money = (cents: number) => (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
  const ranges: Array<[ExpenseRange, string, keyof ExpenseTotals]> = [
    ["day", "Day", "dayCents"],
    ["week", "Week", "weekCents"],
    ["month", "Month", "monthCents"],
    ["year", "Year", "yearCents"],
    ["all", "All time", "allTimeCents"],
  ];
  const selectedLabel = ranges.find(([key]) => key === range)?.[1] ?? "Week";
  const maxEmployeeTotal = Math.max(1, ...(totals?.selected.byEmployee.map((employee) => employee.totalCents) ?? []));
  return <article className="panel expense-report">
    <PanelHead
      title="Expense report"
      subtitle="Explore payroll payments marked as paid"
      action={<Link className="text-button" href="/reports">Open reports →</Link>}
    />
    {error
      ? <div className="expense-report-error">{error}</div>
      : <>
          <div className="expense-range-tabs" role="tablist" aria-label="Expense report period">
            {ranges.map(([key, label, totalKey]) => <button
              type="button"
              role="tab"
              aria-selected={range === key}
              className={range === key ? "active" : ""}
              onClick={() => setRange(key)}
              key={key}
            ><span>{label}</span><strong>{totals ? money(Number(totals[totalKey])) : "—"}</strong></button>)}
          </div>
          <div className="expense-detail-head">
            <div><span>{selectedLabel} expenses</span><strong>{totals ? money(totals.selected.totalCents) : "—"}</strong><small>Payroll payments recorded as paid</small></div>
            <i aria-hidden="true">↗</i>
          </div>
          <div className="expense-insights">
            <div><span>Payments</span><strong>{totals?.selected.paymentCount ?? "—"}</strong><small>Transactions recorded</small></div>
            <div><span>Money owed</span><strong>{totals ? money(totals.selected.owedCents) : "—"}</strong><small>Recorded earnings not yet paid</small></div>
            <div><span>Owed + paid</span><strong>{totals ? money(totals.selected.combinedCents) : "—"}</strong><small>Total labor value</small></div>
          </div>
          <div className="expense-breakdown">
            <div className="expense-breakdown-title"><div><strong>Spending by employee</strong><span>{selectedLabel} breakdown</span></div><small>{totals?.selected.byEmployee.length ?? 0} employees</small></div>
            {totals?.selected.byEmployee.map((employee) => <div className="expense-employee-row" key={employee.id}>
              <div className={`avatar ${employee.color}`}>{employee.initials}</div>
              <div className="expense-employee-bar"><div><strong>{employee.name}</strong><span>{employee.paymentCount} payment{employee.paymentCount === 1 ? "" : "s"}</span></div><i><b style={{ width: `${Math.max(5, (employee.totalCents / maxEmployeeTotal) * 100)}%` }} /></i></div>
              <strong>{money(employee.totalCents)}</strong>
            </div>)}
            {totals && !totals.selected.byEmployee.length && <div className="expense-empty">No payments were recorded for this period.</div>}
          </div>
          <div className="expense-payment-history">
            <div className="expense-history-title">
              <div><strong>Every payment</strong><span>Complete {selectedLabel.toLowerCase()} payment history</span></div>
              <small>{totals?.selected.payments.length ?? 0} records</small>
            </div>
            <div className="expense-history-table">
              <div className="expense-history-row expense-history-header"><span>Employee</span><span>Date paid</span><span>Note</span><span>Amount</span></div>
              {totals?.selected.payments.map((payment) => <div className="expense-history-row" key={payment.id}>
                <div className="expense-history-person"><div className={`avatar ${payment.color}`}>{payment.initials}</div><strong>{payment.employeeName}</strong></div>
                <span>{new Date(payment.paidAt).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}</span>
                <span className="expense-history-note">{payment.note || "No note"}</span>
                <strong>{money(payment.amountCents)}</strong>
              </div>)}
              {totals && !totals.selected.payments.length && <div className="expense-empty">No individual payments to show for this period.</div>}
            </div>
          </div>
        </>}
    <div className="expense-report-foot"><span><i /> Recorded payments only</span><strong>Select a period to explore its details</strong></div>
  </article>;
}

function TimeClock({ employees, working, now, toggleClock, employeeMode = false, onEditTime }: { employees: Employee[]; working: Employee[]; now: Date; toggleClock: (employee: Employee) => void; employeeMode?: boolean; onEditTime?: (employee: Employee) => void }) {
  const totalToday = employees.reduce((sum, employee) => sum + employee.weeklyMinutes, 0);
  const laborCost = employees.reduce((sum, employee) => sum + Math.round(employee.weeklyMinutes / 60 * (employee.hourlyRateCents ?? 0)), 0);
  const [gpsStatus, setGpsStatus] = useState("Checking GPS…");
  function requestGps() {
    if (typeof navigator === "undefined" || !navigator.geolocation) { setGpsStatus("GPS unavailable"); return; }
    setGpsStatus("Requesting GPS…");
    navigator.geolocation.getCurrentPosition(() => setGpsStatus("GPS active"), () => setGpsStatus("GPS permission needed"), { enableHighAccuracy: true, maximumAge: 30000, timeout: 8000 });
  }
  useEffect(() => {
    requestGps();
  }, []);
  return <section className="timeclock-reference">
    <div className="timeclock-kpis"><article><span className="kpi-icon green">♙</span><small>Employees Clocked In</small><strong>{working.length} <em>/ {employees.length}</em></strong><p>{employees.length ? Math.round(working.length / employees.length * 100) : 0}% of your team</p><Link href="/time-clock">View all clocked in →</Link></article><article><span className="kpi-icon purple">◷</span><small>Total Hours Today</small><strong>{formatHours(totalToday)}</strong><p>Recorded hours</p><Link href="/reports">View hours report →</Link></article><article><span className="kpi-icon orange">$</span><small>Total Labor Cost</small><strong>{moneyValue(laborCost)}</strong><p>Based on recorded time</p><Link href="/reports">View labor report →</Link></article><article><span className="kpi-icon coral">◷</span><small>Overtime Today</small><strong>0h 00m</strong><p>0 employees</p><Link href="/reports">View overtime →</Link></article></div>
  <section className="clock-reference-main">
    <div className="clock-reference-left">
      <article className="panel clock-team clock-table-panel"><div className="reference-table-head"><div><h3>Employees Clocked In ({working.length})</h3><p>Monitor active shifts and locations</p></div><div className="clock-table-tools"><label>⌕ <input placeholder="Search employees" /></label><button className="secondary-button">All locations⌄</button><button className="secondary-button">☷</button></div></div><div className="clock-table-columns"><span>Employee</span><span>Role</span><span>Shift</span><span>Clocked in</span><span>Location</span><span>Duration</span></div><EmployeeRows employees={working} toggleClock={toggleClock} onEditTime={onEditTime} /><Link className="clock-table-link" href="/time-clock">View all clocked in employees →</Link></article>
      <article className="panel clock-table-panel not-clocked-panel"><PanelHead title={`Not Clocked In (${Math.max(0, employees.length - working.length)})`} subtitle="Employees scheduled but not currently working" /><EmployeeRows employees={employees.filter((employee) => employee.status !== "clocked_in")} toggleClock={toggleClock} onEditTime={onEditTime} /></article>
    </div>
    <div className="clock-reference-right">
      <article className="panel clock-map-panel"><div className="map-head"><div><h3>Live GPS Clock In Map</h3><small className="gps-status">● {gpsStatus} <button className="gps-enable-button" type="button" onClick={requestGps}>Enable GPS</button></small></div><Link className="text-button" href="/time-clock">View full map →</Link></div><div className="clock-map"><span className="map-road road-a" /><span className="map-road road-b" /><span className="map-pin pin-a">{working[0]?.initials ?? ""}</span><span className="map-pin pin-b">{working[1]?.initials ?? ""}</span><span className="map-pin pin-c">{working[2]?.initials ?? ""}</span><span className="map-center">⌖</span></div><div className="map-legend"><span><i className="online" />GPS clocked in</span><span><i className="break" />On break</span><span><i className="offline" />Clocked out</span></div></article>
      <article className="panel recent-activity"><PanelHead title="Recent Activity" action={<Link className="text-button" href="/time-clock">View all activity →</Link>} />{working.map((person, index) => <div className="timeline-row" key={person.id}><span className="timeline-mark" /><div><strong>{person.name} clocked in</strong><p>Main Street Café</p></div><small>{person.clockIn ?? (index === 0 ? "Now" : "Recently")}</small></div>)}{!working.length && <EmptyState title="No activity recorded" message="Clock-ins and clock-outs will appear here." />}</article>
    </div>
  </section>
  </section>;
}

function Timesheets({ employees, approved, setApproved, flash }: { employees: Employee[]; approved: number[]; setApproved: (ids: number[]) => void; flash: (message: string) => void }) {
  const pending = employees.filter((person) => person.weeklyMinutes > 0 && !approved.includes(person.id));
  return <>
    <section className="page-stats">
      <Stat icon="◷" theme="green" label="Total recorded" value={formatHours(employees.reduce((sum, person) => sum + person.weeklyMinutes, 0))} note="This pay period" />
      <Stat icon="!" theme="coral" label="Needs review" value={String(Math.min(2, pending.length))} note="Missing note or long shift" />
      <Stat icon="✓" theme="blue" label="Approved" value={String(approved.length)} note={`of ${employees.length} timesheets`} />
    </section>
    <article className="panel table-panel">
      <div className="table-toolbar"><div><button className="date-button">←</button><strong>Current week</strong><button className="date-button">→</button></div><button className="secondary-button" onClick={() => { setApproved(employees.map((person) => person.id)); flash("All timesheets approved."); }}>Approve all</button></div>
      <div className="data-table">
        <div className="table-row table-header"><span>Employee</span><span>Regular</span><span>Breaks</span><span>Total</span><span>Status</span><span /></div>
        {employees.map((person) => {
          const isApproved = approved.includes(person.id);
          return <div className="table-row" key={person.id}>
            <div className="table-person"><div className={`avatar ${person.color}`}>{person.initials}</div><div><strong>{person.name}</strong><small>{person.role}</small></div></div>
            <span>{formatHours(person.weeklyMinutes)}</span><span>0h 00m</span><strong>{formatHours(person.weeklyMinutes)}</strong>
            <span><i className={isApproved ? "status-chip approved" : "status-chip ready"}>{isApproved ? "Approved" : person.weeklyMinutes ? "Ready" : "No entries"}</i></span>
            <button className="row-action" disabled={isApproved || !person.weeklyMinutes} onClick={() => setApproved([...approved, person.id])}>{isApproved ? "✓" : "Approve"}</button>
          </div>;
        })}
        {!employees.length && <EmptyState title="No timesheets yet" message="Add an employee and record time to create a timesheet." />}
      </div>
    </article>
  </>;
}

function Schedule({ employees, ownerName, flash, openNewShiftTick, demo = false }: { employees: Employee[]; ownerName: string; flash: (message: string) => void; openNewShiftTick?: number; demo?: boolean }) {
  const [view, setView] = useState<ScheduleView>("week");
  const [offset, setOffset] = useState(0);
  const [draft, setDraft] = useState<ScheduleDraft>({ shifts: [], templates: [], nextShiftId: 1, nextTemplateId: 1 });
  const [publishedSnapshot, setPublishedSnapshot] = useState<ScheduleDraft | null>(null);
  const [lastDraftSavedAt, setLastDraftSavedAt] = useState<number | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [workedEntries, setWorkedEntries] = useState<Array<{ id: number; employeeId: number; employeeName: string; clockIn: number; clockOut: number | null }>>([]);
  const [scheduleSearch, setScheduleSearch] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [editor, setEditor] = useState<ShiftEditorState | null>(null);
  const [selectedShiftId, setSelectedShiftId] = useState<number | null>(null);
  const [dragOverDate, setDragOverDate] = useState<string | null>(null);
  const [resizing, setResizing] = useState<null | {
    shiftId: number;
    edge: "start" | "end";
    pointerY: number;
    startMinutes: number;
    endMinutes: number;
  }>(null);
  const storedDraftRef = useRef(false);

  const { payments, days, start, end } = usePaymentSchedule(view, offset);
  const gridStyle = { gridTemplateColumns: `minmax(190px, 1.05fr) repeat(${days.length}, minmax(92px, 1fr))` };
  const activeDate = dateKey(days[0] ?? start);
  const activeWeekStart = view === "week" ? start : weekStartForDate(new Date());
  const dayKeys = useMemo(() => new Set(days.map((date) => dateKey(date))), [days]);
  useEffect(() => {
    if (demo) { setWorkedEntries([]); return; }
    fetch(`/api/schedule/worked?start=${start.getTime()}&end=${end.getTime()}`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as { entries?: Array<{ id: number; employeeId: number; employeeName: string; clockIn: number; clockOut: number | null }> };
        if (!response.ok) throw new Error("Worked shifts could not be loaded.");
        setWorkedEntries(payload.entries ?? []);
      })
      .catch(() => setWorkedEntries([]));
  }, [start.getTime(), end.getTime(), demo]);
  const shiftsByDate = useMemo(() => {
    const grouped = new Map<string, ScheduledShift[]>();
    for (const shift of draft.shifts) {
      if (!dayKeys.has(shift.date)) continue;
      const current = grouped.get(shift.date) ?? [];
      current.push(shift);
      grouped.set(shift.date, current);
    }
    for (const [key, shifts] of grouped) {
      grouped.set(key, shifts.sort((left, right) => left.startMinutes - right.startMinutes));
    }
    return grouped;
  }, [dayKeys, draft.shifts]);
  const shiftsInView = draft.shifts.filter((shift) => dayKeys.has(shift.date));
  const unscheduledWorkedEntries = useMemo(() => workedEntries.map((entry) => {
    const clockIn = new Date(entry.clockIn);
    const clockOut = new Date(entry.clockOut ?? Date.now());
    const date = dateKey(clockIn);
    const startMinutes = clockIn.getHours() * 60 + clockIn.getMinutes();
    const endMinutes = dateKey(clockOut) === date ? clockOut.getHours() * 60 + clockOut.getMinutes() : 24 * 60;
    return { ...entry, date, startMinutes, endMinutes: Math.max(startMinutes + 1, endMinutes), active: entry.clockOut == null };
  }).filter((entry) => dayKeys.has(entry.date) && !draft.shifts.some((shift) =>
    shift.employeeId === entry.employeeId &&
    shift.date === entry.date &&
    entry.endMinutes > shift.startMinutes &&
    entry.startMinutes < shift.endMinutes
  )), [workedEntries, draft.shifts, dayKeys]);
  const unscheduledWorkedByEmployeeDate = useMemo(() => {
    const grouped = new Map<string, typeof unscheduledWorkedEntries>();
    for (const entry of unscheduledWorkedEntries) {
      const key = `${entry.employeeId}:${entry.date}`;
      grouped.set(key, [...(grouped.get(key) ?? []), entry]);
    }
    return grouped;
  }, [unscheduledWorkedEntries]);
  const totalScheduledMinutes = shiftsInView.reduce((sum, shift) => sum + shiftMinutes(shift), 0);
  // Keep a stable, high-contrast color per employee in the planner. This is
  // intentionally separate from the employee's profile color so a roster with
  // the default profile color still gets an easy-to-scan schedule.
  const scheduleColorByEmployee = useMemo(() => {
    const palette = ["violet", "blue", "green", "coral", "teal", "gold", "lilac"];
    return new Map(employees.map((employee, index) => [employee.id, palette[index % palette.length]]));
  }, [employees]);
  const scheduleColor = (employeeId: number, fallback?: string) => scheduleColorByEmployee.get(employeeId) ?? fallback ?? "green";
  const searchMatchesEmployee = (name: string) => {
    const query = scheduleSearch.trim().toLowerCase();
    return Boolean(query) && name.toLowerCase().includes(query);
  };
  const ownerEmployee: Employee = { id: 0, name: ownerName || "Owner", role: "Owner", initials: (ownerName || "Owner").split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase(), color: "violet", status: "clocked_out", clockIn: null, weeklyMinutes: 0 };
  const scheduleEmployees = useMemo(() => [ownerEmployee, ...employees], [ownerName, employees]);
  const employeeRows = useMemo(() => scheduleEmployees.map((employee) => {
    const employeeShifts = shiftsInView.filter((shift) => shift.employeeId === employee.id);
    const workedMinutes = unscheduledWorkedEntries.filter((entry) => entry.employeeId === employee.id)
      .reduce((sum, entry) => sum + Math.max(0, entry.endMinutes - entry.startMinutes), 0);
    return {
      employee,
      shifts: employeeShifts,
      minutes: employeeShifts.reduce((sum, shift) => sum + shiftMinutes(shift), 0) + workedMinutes,
    };
  }), [scheduleEmployees, shiftsInView, unscheduledWorkedEntries]);
  const selectedShift = selectedShiftId == null ? null : draft.shifts.find((shift) => shift.id === selectedShiftId) ?? null;
  const scheduleVersion = JSON.stringify({ shifts: draft.shifts, templates: draft.templates });
  const publishedVersion = publishedSnapshot ? JSON.stringify({ shifts: publishedSnapshot.shifts, templates: publishedSnapshot.templates }) : null;
  const hasUnpublishedChanges = publishedSnapshot ? scheduleVersion !== publishedVersion : draft.shifts.length > 0;

  function isShiftPublished(shift: ScheduledShift) {
    const published = publishedSnapshot?.shifts.find((candidate) => candidate.id === shift.id);
    return Boolean(published && JSON.stringify({ ...published, id: undefined }) === JSON.stringify({ ...shift, id: undefined }));
  }
  const monthGridDays = useMemo(() => {
    const gridStart = weekStartForDate(start);
    return Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
  }, [start]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (demo) { setDraft(defaultScheduleDraft(employees, activeWeekStart)); setHydrated(true); return; }
    try {
      const raw = window.localStorage.getItem(scheduleStorageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<ScheduleDraft>;
        if (Array.isArray(parsed.shifts) && Array.isArray(parsed.templates)) {
          setDraft(isSeededSchedule(parsed)
            ? { shifts: [], templates: [], nextShiftId: 1, nextTemplateId: 1 }
            : {
                shifts: parsed.shifts.map((shift) => normalizeShiftDraft(shift)),
                templates: parsed.templates,
                nextShiftId: Number(parsed.nextShiftId ?? 1),
                nextTemplateId: Number(parsed.nextTemplateId ?? 1),
              });
          storedDraftRef.current = true;
        }
      }
      const publishedRaw = window.localStorage.getItem(publishedScheduleStorageKey);
      if (publishedRaw) {
        const published = JSON.parse(publishedRaw) as Partial<ScheduleDraft>;
        if (Array.isArray(published.shifts) && Array.isArray(published.templates)) {
          if (!isSeededSchedule(published)) {
            setPublishedSnapshot({
              shifts: published.shifts.map((shift) => normalizeShiftDraft(shift)),
              templates: published.templates,
              nextShiftId: Number(published.nextShiftId ?? 1),
              nextTemplateId: Number(published.nextTemplateId ?? 1),
            });
          } else {
            window.localStorage.removeItem(publishedScheduleStorageKey);
          }
        }
      }
    } catch {
      storedDraftRef.current = false;
    } finally {
      setHydrated(true);
    }
  }, [demo, employees, activeWeekStart]);

  useEffect(() => {
    if (!hydrated || storedDraftRef.current || !employees.length) return;
    // A real account starts with an empty schedule. Sample shifts are only
    // created for the explicit demo experience.
    if (draft.shifts.length || draft.templates.length) return;
    storedDraftRef.current = true;
  }, [activeWeekStart, draft.shifts.length, draft.templates.length, employees, hydrated]);

  useEffect(() => {
    if (demo || !hydrated || typeof window === "undefined") return;
    window.localStorage.setItem(scheduleStorageKey, JSON.stringify(draft));
    storedDraftRef.current = true;
  }, [draft, hydrated, demo]);

  useEffect(() => {
    if (!openNewShiftTick) return;
    setEditor({
      id: null,
      employeeId: 0,
      date: activeDate,
      start: "08:00",
      end: "16:00",
      breakMinutes: 30,
      templateId: null,
      note: "",
    });
  }, [activeDate, employees, openNewShiftTick]);

  useEffect(() => {
    if (!resizing) return;
    const onMove = (event: PointerEvent) => {
      const deltaSteps = Math.round((event.clientY - resizing.pointerY) / pixelsPerStep);
      const deltaMinutes = deltaSteps * shiftStepMinutes;
      setDraft((current) => ({
        ...current,
        shifts: current.shifts.map((shift) => {
          if (shift.id !== resizing.shiftId) return shift;
          if (resizing.edge === "start") {
            const nextStart = Math.max(0, Math.min(resizing.startMinutes + deltaMinutes, resizing.endMinutes - shift.breakMinutes - minShiftMinutes));
            return normalizeShiftDraft({ ...shift, startMinutes: nextStart });
          }
          const nextEnd = Math.min(24 * 60, Math.max(resizing.endMinutes + deltaMinutes, resizing.startMinutes + shift.breakMinutes + minShiftMinutes));
          return normalizeShiftDraft({ ...shift, endMinutes: nextEnd });
        }),
      }));
    };
    const onUp = () => setResizing(null);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [resizing]);

  function openShiftEditor(shift: ScheduledShift) {
    setEditor({
      id: shift.id,
      employeeId: shift.employeeId,
      date: shift.date,
      start: minutesToTime(shift.startMinutes),
      end: minutesToTime(shift.endMinutes),
      breakMinutes: shift.breakMinutes,
      templateId: shift.templateId,
      note: shift.note,
    });
  }

  function saveEditor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const employee = scheduleEmployees.find((person) => person.id === editor?.employeeId);
    if (!editor || !employee) {
      flash("Add an employee before creating schedule shifts.");
      return;
    }
    const startMinutes = timeToMinutes(editor.start);
    let endMinutes = timeToMinutes(editor.end);
    if (endMinutes <= startMinutes) endMinutes = startMinutes + minShiftMinutes + editor.breakMinutes;
    const nextShift = normalizeShiftDraft({
      id: editor.id ?? draft.nextShiftId,
      employeeId: employee.id,
      employeeName: employee.name,
      employeeInitials: employee.initials,
      employeeColor: employee.color,
      date: editor.date,
      startMinutes,
      endMinutes,
      breakMinutes: Math.max(0, editor.breakMinutes),
      note: editor.note.trim(),
      templateId: editor.templateId,
    });
    setDraft((current) => {
      const shifts = editor.id
        ? current.shifts.map((shift) => shift.id === editor.id ? nextShift : shift)
        : [...current.shifts, nextShift];
      return { ...current, shifts, nextShiftId: editor.id ? current.nextShiftId : current.nextShiftId + 1 };
    });
    setEditor(null);
    flash(editor.id ? "Shift updated." : "Shift added.");
  }

  function deleteShift(shiftId: number) {
    setDraft((current) => ({ ...current, shifts: current.shifts.filter((shift) => shift.id !== shiftId) }));
    setEditor((current) => current?.id === shiftId ? null : current);
    flash("Shift removed.");
  }

  function duplicateShift(shift: ScheduledShift) {
    setDraft((current) => ({
      ...current,
      shifts: [...current.shifts, normalizeShiftDraft(cloneShiftForDate(shift, dateKey(addDays(dateFromKey(shift.date), 1)), current.nextShiftId))],
      nextShiftId: current.nextShiftId + 1,
    }));
    flash("Shift duplicated to the next day.");
  }

  function moveShift(shiftId: number, date: string) {
    setDraft((current) => ({
      ...current,
      shifts: current.shifts.map((shift) => shift.id === shiftId ? { ...shift, date } : shift),
    }));
    setDragOverDate(null);
    flash("Shift moved.");
  }

  function copyWeek(sourceStart: Date, targetStart: Date, replaceTargetWeek: boolean) {
    const sourceWeekDates = new Set(Array.from({ length: 7 }, (_, index) => dateKey(addDays(sourceStart, index))));
    const targetWeekDates = new Set(Array.from({ length: 7 }, (_, index) => dateKey(addDays(targetStart, index))));
    setDraft((current) => {
      const sourceShifts = current.shifts.filter((shift) => sourceWeekDates.has(shift.date));
      const preserved = current.shifts.filter((shift) => !replaceTargetWeek || !targetWeekDates.has(shift.date));
      let nextId = current.nextShiftId;
      const clones = sourceShifts.map((shift) => {
        const sourceDate = dateFromKey(shift.date);
        const targetDate = addDays(targetStart, Math.round((sourceDate.getTime() - sourceStart.getTime()) / (24 * 60 * 60 * 1000)));
        return normalizeShiftDraft({
          ...shift,
          id: nextId++,
          date: dateKey(targetDate),
        });
      });
      return { ...current, shifts: [...preserved, ...clones], nextShiftId: nextId };
    });
    flash(replaceTargetWeek ? "Previous week copied into this week." : "This week duplicated to next week.");
  }

  function addNewShiftForDate(date: string, template?: ShiftTemplate) {
    if (demo) { flash("Demo mode is read-only — shifts are not saved."); return; }
    const employee = employees[0];
    if (!employee) {
      flash("Add an employee before creating schedule shifts.");
      return;
    }
    setEditor({
      id: null,
      employeeId: employee.id,
      date,
      start: template ? minutesToTime(template.startMinutes) : "08:00",
      end: template ? minutesToTime(template.endMinutes) : "16:00",
      breakMinutes: template?.breakMinutes ?? 30,
      templateId: template?.id ?? null,
      note: template?.name ?? "",
    });
  }

  function saveDraft() {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(scheduleStorageKey, JSON.stringify(draft));
    }
    setView("month");
    setOffset(0);
    setLastDraftSavedAt(Date.now());
    flash("Monthly schedule draft saved.");
  }

  function cancelDrafts() {
    if (typeof window !== "undefined" && !window.confirm("Cancel all unpublished schedule changes?")) return;
    const restored = publishedSnapshot ?? { shifts: [], templates: draft.templates, nextShiftId: draft.nextShiftId, nextTemplateId: draft.nextTemplateId };
    setDraft(restored);
    setSelectedShiftId(null);
    if (typeof window !== "undefined") window.localStorage.setItem(scheduleStorageKey, JSON.stringify(restored));
    setLastDraftSavedAt(Date.now());
    flash(publishedSnapshot ? "Unpublished changes canceled." : "Draft schedule cleared.");
  }

  async function publishSchedule() {
    if (publishing) return;
    setPublishing(true);
    const employeeById = new Map(employees.map((employee) => [employee.id, employee]));
    const employeeByName = new Map(employees.map((employee) => [employee.name.trim().toLowerCase(), employee]));
    const publishableShifts = draft.shifts.map((shift) => {
      if (shift.employeeId === 0) return { ...shift, employeeId: 0, employeeName: ownerName, employeeInitials: ownerEmployee.initials, employeeColor: ownerEmployee.color };
      const employee = employeeById.get(shift.employeeId) ?? employeeByName.get(shift.employeeName.trim().toLowerCase());
      return employee ? { ...shift, employeeId: employee.id, employeeName: employee.name, employeeInitials: employee.initials, employeeColor: employee.color } : shift;
    });
    if (publishableShifts.some((shift) => shift.employeeId !== 0 && !employeeById.has(shift.employeeId) && !employeeByName.has(shift.employeeName.trim().toLowerCase()))) {
      flash("Refresh the employee list before publishing this schedule.");
      setPublishing(false);
      return;
    }
    const response = await fetch("/api/schedule/publish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ shifts: publishableShifts.filter((shift) => shift.employeeId !== 0), ownerShifts: publishableShifts.filter((shift) => shift.employeeId === 0) }),
    }).catch(() => null);
    const result = response ? await response.json().catch(() => null) as { error?: string; count?: number } | null : null;
    if (!response?.ok) {
      flash(result?.error ?? "The schedule could not be published.");
      setPublishing(false);
      return;
    }
    if (typeof window !== "undefined") {
      window.localStorage.setItem(scheduleStorageKey, JSON.stringify({ ...draft, shifts: publishableShifts }));
      window.localStorage.setItem(publishedScheduleStorageKey, JSON.stringify({ ...draft, shifts: publishableShifts }));
    }
    const publishedDraft = { ...draft, shifts: publishableShifts };
    setDraft(publishedDraft);
    setPublishedSnapshot(publishedDraft);
    setLastDraftSavedAt(Date.now());
    setPublishing(false);
    flash(`Schedule published to employees with ${result?.count ?? draft.shifts.length} shift${(result?.count ?? draft.shifts.length) === 1 ? "" : "s"}.`);
  }

  function editShift(shift: ScheduledShift) {
    setSelectedShiftId(shift.id);
    openShiftEditor(shift);
  }

  function renderShiftCard(shift: ScheduledShift) {
    const template = shift.templateId ? draft.templates.find((item) => item.id === shift.templateId) : null;
    return <article
      className={`schedule-shift-card ${scheduleColor(shift.employeeId, shift.employeeColor)} ${searchMatchesEmployee(shift.employeeName) ? "search-highlight" : ""} ${selectedShiftId === shift.id ? "selected" : ""} ${isShiftPublished(shift) ? "" : "draft-shift"}`}
      key={shift.id}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData("text/plain", String(shift.id));
        event.dataTransfer.effectAllowed = "move";
      }}
      onClick={() => setSelectedShiftId(shift.id)}
      style={{ minHeight: `${Math.min(116, shiftCardHeight(shift))}px`, ...(isShiftPublished(shift) ? {} : { background: "#e7eae8", borderLeftColor: "#aeb8b3", color: "#69746e" }) }}
    >
      <div className="schedule-shift-top">
        <div>
          <strong>{minutesToDisplayTime(shift.startMinutes)} - {minutesToDisplayTime(shift.endMinutes)}</strong>
          <span>{shift.note || template?.name || shift.employeeName}</span>
        </div>
      </div>
          <small>{isShiftPublished(shift) ? formatHours(shiftMinutes(shift)) : `DRAFT · ${formatHours(shiftMinutes(shift))}`}</small>
      <div className="schedule-shift-actions">
        <button type="button" onClick={(event) => { event.stopPropagation(); editShift(shift); }}>Edit</button>
        <button type="button" onClick={(event) => { event.stopPropagation(); deleteShift(shift.id); setSelectedShiftId(null); }}>Delete</button>
      </div>
      <span className="schedule-resize-handle top" onPointerDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setResizing({ shiftId: shift.id, edge: "start", pointerY: event.clientY, startMinutes: shift.startMinutes, endMinutes: shift.endMinutes });
      }} />
      <span className="schedule-resize-handle bottom" onPointerDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setResizing({ shiftId: shift.id, edge: "end", pointerY: event.clientY, startMinutes: shift.startMinutes, endMinutes: shift.endMinutes });
      }} />
    </article>;
  }

  function renderWorkedCard(entry: (typeof unscheduledWorkedEntries)[number]) {
    const minutes = Math.max(0, entry.endMinutes - entry.startMinutes);
    return <article className="schedule-worked-card" key={`worked-${entry.id}`}>
      <div><strong>{minutesToDisplayTime(entry.startMinutes)} - {entry.active ? "Now" : minutesToDisplayTime(entry.endMinutes)}</strong><span>Worked, unscheduled</span></div>
      <small>{entry.active ? "CLOCKED IN" : formatHours(minutes)}</small>
    </article>;
  }

  const scheduleLabel = formatScheduleLabel(view, start, end, offset);
  const coverageRows = days.map((date) => {
    const dayShifts = shiftsByDate.get(dateKey(date)) ?? [];
    const minutes = dayShifts.reduce((sum, shift) => sum + shiftMinutes(shift), 0);
    return { date, dayShifts, minutes };
  });

  return <>
    <section className="schedule-reference-head">
      <div className="schedule-reference-title">
        <span className="eyebrow">PLANNER</span>
        <h1>Schedule</h1>
        <p>Manage shifts, view availability, and build the perfect schedule.</p>
      </div>
      <div className="schedule-reference-tabs" role="tablist" aria-label="Schedule sections">
        <button className={view === "week" ? "active" : ""} type="button" onClick={() => { setView("week"); setOffset(0); }}>Week</button>
        <button className={view === "month" ? "active" : ""} type="button" onClick={() => { setView("month"); setOffset(0); }}>Month</button>
        <button className={view === "list" ? "active" : ""} type="button" onClick={() => { setView("list"); setOffset(0); }}>List</button>
      </div>
      <div className="schedule-reference-actions">
        <button type="button" className="secondary-button" onClick={() => flash("Auto-schedule is ready to help fill open shifts.")}>✧ Auto-schedule</button>
        <button type="button" className="secondary-button" onClick={() => flash("Filters can be applied from the employee search.")}>☷ Filters</button>
        <button type="button" className="primary-button schedule-publish" onClick={publishSchedule} disabled={publishing}>{publishing ? "Publishing…" : "Publish"}</button>
      </div>
    </section>
    <div className="schedule-toolbar">
      <div className="schedule-toolbar-left">
        <button className="date-button schedule-nav-button" onClick={() => setOffset((value) => value - 1)} aria-label={`Previous ${view}`}>← <span>Previous</span></button>
        <button className="secondary-button" onClick={() => setOffset(0)}>{scheduleLabel}</button>
        <button className="date-button schedule-nav-button" onClick={() => setOffset((value) => value + 1)} aria-label={`Next ${view}`}><span>Next</span> →</button>
        {view === "week" && <>
          <button className="secondary-button" type="button" onClick={() => copyWeek(addDays(activeWeekStart, -7), activeWeekStart, true)}>Copy previous week</button>
          <button className="secondary-button" type="button" onClick={() => copyWeek(activeWeekStart, addDays(activeWeekStart, 7), false)}>Duplicate week</button>
        </>}
      </div>
      <div className="schedule-toolbar-right">
        <label className="schedule-search"><span aria-hidden="true">⌕</span><input placeholder="Search employees" aria-label="Search employees" value={scheduleSearch} onChange={(event) => setScheduleSearch(event.target.value)} /></label>
        <button type="button" className="secondary-button schedule-cancel-draft" onClick={cancelDrafts} disabled={!hasUnpublishedChanges}>Cancel drafts</button>
        <button type="button" className="secondary-button schedule-save-draft" onClick={saveDraft}>Save monthly draft</button>
      </div>
    </div>
    <div className={`schedule-layout-shell ${selectedShift ? "with-schedule-details" : ""}`}>
    <article className="panel schedule-board">
      <div className="schedule-constraints"><div><strong>Availability &amp; time off</strong><span>Use employee availability when assigning shifts. Approved time-off requests will appear here.</span></div><div className="schedule-constraints-list">{employees.length ? employees.map((employee) => <span key={employee.id}><b>{employee.initials}</b><strong>{employee.name}</strong><small>{employee.availability || "Availability not set"}</small></span>) : <span>No team availability has been entered yet.</span>}</div></div>
      {view === "month" ? <div className="month-planner">
        <div className="month-weekdays">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((label) => <span key={label}>{label}</span>)}</div>
        <div className="month-calendar-grid">
          {monthGridDays.map((date) => {
            const dateString = dateKey(date);
            const inMonth = date.getMonth() === start.getMonth();
            const dayShifts = shiftsByDate.get(dateString) ?? [];
            const minutes = dayShifts.reduce((sum, shift) => sum + shiftMinutes(shift), 0);
            const dayPayments = payments.filter((payment) => dateKey(new Date(payment.paidAt)) === dateString);
            const dayWorked = unscheduledWorkedEntries.filter((entry) => entry.date === dateString);
            const employeeGroups = employees.map((employee) => ({
              employee,
              shifts: dayShifts.filter((shift) => shift.employeeId === employee.id),
            })).filter((group) => group.shifts.length);
            return <div
              className={`month-day-cell ${inMonth ? "" : "outside-month"} ${dragOverDate === dateString ? "drag-over" : ""}`}
              key={dateString}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                const shiftId = Number(event.dataTransfer.getData("text/plain"));
                if (Number.isFinite(shiftId)) moveShift(shiftId, dateString);
              }}
              onDragEnter={() => setDragOverDate(dateString)}
              onDragLeave={() => setDragOverDate((current) => current === dateString ? null : current)}
            >
              <div className="month-day-head"><strong>{date.getDate()}</strong><span>{minutes ? formatHours(minutes) : ""}</span></div>
              {dayPayments.map((payment) => <span className="month-payment-chip" key={payment.id}>Paid {moneyValue(payment.amountCents)}</span>)}
              {dayWorked.map((entry) => <span className="month-worked-chip" key={`worked-${entry.id}`}><b>{entry.employeeName}</b> · Worked {minutesToDisplayTime(entry.startMinutes)}-{entry.active ? "Now" : minutesToDisplayTime(entry.endMinutes)}</span>)}
              <div className="month-shift-list">
                {employeeGroups.map(({ employee, shifts: employeeDayShifts }) => <div className="month-employee-group" key={employee.id}>
                  <div className="month-employee-name"><span className={`avatar ${scheduleColor(employee.id, employee.color)}`}>{employee.initials}</span><strong>{employee.name}</strong></div>
                  {employeeDayShifts.map((shift) => <button
                    type="button"
                    className={`month-shift-chip ${shift.employeeColor} ${searchMatchesEmployee(shift.employeeName) ? "search-highlight" : ""} ${selectedShiftId === shift.id ? "selected" : ""} ${isShiftPublished(shift) ? "" : "draft-shift"}`}
                    key={shift.id}
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.setData("text/plain", String(shift.id));
                      event.dataTransfer.effectAllowed = "move";
                    }}
                    onClick={() => setSelectedShiftId(shift.id)}
                  ><b>{minutesToDisplayTime(shift.startMinutes)}–{minutesToDisplayTime(shift.endMinutes)}</b><span>{shift.note || "Shift"}</span></button>)}
                  {employeeDayShifts.length > 1 && <small>{employeeDayShifts.length} shifts</small>}
                </div>)}
                </div>
              {inMonth && <button type="button" className="month-empty-add" onClick={() => addNewShiftForDate(dateString)}>Add shift</button>}
            </div>;
          })}
        </div>
      </div> : view === "list" ? <div className="schedule-list-view">
        <div className="schedule-list-head"><strong>Scheduled shifts</strong><span>{shiftsInView.length} shifts · {formatHours(totalScheduledMinutes)}</span></div>
        {days.map((date) => {
          const dateString = dateKey(date);
          const dayShifts = (shiftsByDate.get(dateString) ?? []).slice().sort((a, b) => a.startMinutes - b.startMinutes);
          return <section className="schedule-list-day" key={dateString}>
            <header><div><strong>{date.toLocaleDateString([], { weekday: "long" })}</strong><span>{date.toLocaleDateString([], { month: "short", day: "numeric" })}</span></div><b>{formatHours(dayShifts.reduce((sum, shift) => sum + shiftMinutes(shift), 0))}</b></header>
            {dayShifts.length ? dayShifts.map((shift) => <button type="button" className={`schedule-list-row ${selectedShiftId === shift.id ? "selected" : ""}`} key={shift.id} onClick={() => setSelectedShiftId(shift.id)}>
              <span className={`avatar ${scheduleColor(shift.employeeId, shift.employeeColor)}`}>{(shift.employeeName || "Team member").split(" ").map((part) => part[0]).join("").slice(0, 2)}</span>
              <span className="schedule-list-person"><strong>{shift.employeeName}</strong><small>{employees.find((employee) => employee.id === shift.employeeId)?.role ?? "Team member"}</small></span>
              <span className="schedule-list-time"><strong>{minutesToDisplayTime(shift.startMinutes)} – {minutesToDisplayTime(shift.endMinutes)}</strong><small>{formatHours(shiftMinutes(shift))}</small></span>
              <span className={`schedule-list-status ${isShiftPublished(shift) ? "published" : "draft"}`}>{isShiftPublished(shift) ? "Published" : "Draft"}</span>
              <span className="schedule-list-note">{shift.note || "Scheduled shift"}</span><span className="schedule-list-arrow">›</span>
            </button>) : <p className="schedule-list-empty">No shifts scheduled</p>}
          </section>;
        })}
      </div> : <>
      <div className="schedule-grid schedule-days" style={gridStyle}>
        <div className="schedule-employee schedule-employee-heading">
          <div><strong>Employees</strong><span>{employees.length} team members</span></div>
        </div>
        {days.map((date, index) => <div key={dateKey(date)} className={index > 0 && date.getMonth() !== days[index - 1].getMonth() ? "schedule-month-start" : ""}>
          <div className="schedule-day-head">
            <div>
              <span>{date.toLocaleDateString([], { weekday: "short" })}</span>
              <strong>{date.getDate()}</strong>
            </div>
          </div>
          <small>{formatHours(coverageRows[index]?.minutes ?? 0)} scheduled</small>
        </div>)}
      </div>
      <div className="schedule-grid schedule-payment-row" style={gridStyle}>
        <div className="schedule-employee"><span className="payday-calendar-icon">$</span><div><strong>Paydays</strong><span>Recorded payments</span></div></div>
        {days.map((date) => {
          const dayPayments = payments.filter((payment) => dateKey(new Date(payment.paidAt)) === dateKey(date));
          return <div className="schedule-payment-day" key={dateKey(date)}>
            {dayPayments.map((payment) => <div className="schedule-payment-chip" key={payment.id}><strong>{payment.employeeName}</strong><span>{moneyValue(payment.amountCents)}</span></div>)}
            {!dayPayments.length && <span className="schedule-no-payment">—</span>}
          </div>;
        })}
      </div>
      {employeeRows.map(({ employee, shifts: employeeShifts, minutes }) => <div className="schedule-grid schedule-employee-row" style={gridStyle} key={employee.id}>
        <div className="schedule-employee employee-row-label">
          <div className={`avatar ${scheduleColor(employee.id, employee.color)}`}>{employee.initials}</div>
          <div><strong>{employee.name}</strong><span>{formatHours(minutes)}</span></div>
        </div>
        {days.map((date) => {
          const dateString = dateKey(date);
          const dayShifts = employeeShifts.filter((shift) => shift.date === dateString);
          const availabilityState = availabilityStateForDay(employee, date);
          return <div
            className={`schedule-day-cell ${dragOverDate === dateString ? "drag-over" : ""} availability-${availabilityState}`}
            title={availabilityState === "unavailable" ? `${employee.name} is unavailable on this day` : availabilityState === "available" ? `${employee.name} is available` : "Availability not set"}
            key={dateString}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              const shiftId = Number(event.dataTransfer.getData("text/plain"));
              if (Number.isFinite(shiftId)) moveShift(shiftId, dateString);
            }}
            onDragEnter={() => setDragOverDate(dateString)}
            onDragLeave={() => setDragOverDate((current) => current === dateString ? null : current)}
          >
            {availabilityState === "unavailable" && <span className="schedule-availability-blocked">Unavailable</span>}
            {dayShifts.map(renderShiftCard)}
            {(unscheduledWorkedByEmployeeDate.get(`${employee.id}:${dateString}`) ?? []).map(renderWorkedCard)}
            <button type="button" className="schedule-cell-add" onClick={() => addNewShiftForDate(dateString)}>＋</button>
          </div>;
        })}
      </div>)}
      <div className="schedule-grid coverage-row" style={gridStyle}>
        <div className="schedule-employee"><strong>Daily coverage</strong></div>
        {coverageRows.map((row) => <div className="low-coverage" key={dateKey(row.date)}>{row.dayShifts.length} shift{row.dayShifts.length === 1 ? "" : "s"} · {formatHours(row.minutes)}</div>)}
      </div>
      </>}
    </article>
    {selectedShift && <aside className="panel schedule-details" aria-label="Shift details">
      <div className="schedule-details-head"><div><span>Shift details</span><strong>{selectedShift.note || "Scheduled shift"}</strong></div><button type="button" onClick={() => setSelectedShiftId(null)} aria-label="Close shift details">×</button></div>
      <div className={`schedule-detail-card ${scheduleColor(selectedShift.employeeId, selectedShift.employeeColor)}`}>
        <strong>{selectedShift.note || draft.templates.find((template) => template.id === selectedShift.templateId)?.name || "Shift"}</strong>
        <span>{dateFromKey(selectedShift.date).toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })}</span>
        <span>{minutesToDisplayTime(selectedShift.startMinutes)} – {minutesToDisplayTime(selectedShift.endMinutes)} ({formatHours(shiftMinutes(selectedShift))})</span>
        <b>{selectedShift.employeeName}</b>
      </div>
      <div className="schedule-detail-actions">
        <button type="button" onClick={() => editShift(selectedShift)}>Edit shift</button>
        <button type="button" onClick={() => duplicateShift(selectedShift)}>Duplicate</button>
        <button type="button" className="danger" onClick={() => { deleteShift(selectedShift.id); setSelectedShiftId(null); }}>Delete shift</button>
      </div>
      <div className="schedule-detail-section"><span>Employee</span><strong>{selectedShift.employeeName}</strong></div>
      <div className="schedule-detail-section"><span>Notes</span><p>{selectedShift.note || "Add a note when editing this shift."}</p></div>
      <div className="schedule-detail-total"><span>Daily total</span><strong>{formatHours((shiftsByDate.get(selectedShift.date) ?? []).reduce((sum, shift) => sum + shiftMinutes(shift), 0))}</strong></div>
    </aside>}
    </div>
    <section className="schedule-reference-bottom" aria-label="Schedule summary">
      <article className="schedule-summary-card schedule-shift-summary">
        <div className="schedule-summary-head"><h3>Shift details</h3><span className="summary-state"><i />{hasUnpublishedChanges ? "Draft" : "Published"}</span></div>
        {selectedShift ? <div className={`summary-shift ${scheduleColor(selectedShift.employeeId, selectedShift.employeeColor)}`}><strong>{selectedShift.note || "Scheduled shift"}</strong><span>{dateFromKey(selectedShift.date).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })} · {minutesToDisplayTime(selectedShift.startMinutes)} – {minutesToDisplayTime(selectedShift.endMinutes)}</span><b>{selectedShift.employeeName}</b></div> : <p className="summary-empty">Select a shift to see its details, edit it, or duplicate it.</p>}
        <div className="summary-actions"><button type="button" onClick={() => selectedShift ? editShift(selectedShift) : flash("Select a shift first.")}>✎ Edit shift</button><button type="button" onClick={() => selectedShift ? duplicateShift(selectedShift) : flash("Select a shift first.")}>▣ Duplicate</button></div>
      </article>
      <article className="schedule-summary-card coverage-summary"><div className="schedule-summary-head"><h3>Coverage</h3><span className="summary-state good"><i />Live</span></div><div className="coverage-meter"><div className="coverage-ring" style={{ "--coverage": `${employees.length ? Math.min(100, Math.round((employeeRows.filter((row) => row.shifts.length > 0).length / employees.length) * 100)) : 0}%` } as React.CSSProperties}><strong>{employees.length ? Math.min(100, Math.round((employeeRows.filter((row) => row.shifts.length > 0).length / employees.length) * 100)) : 0}%</strong></div><div><b>{employeeRows.filter((row) => row.shifts.length > 0).length} / {employees.length} employees scheduled</b><span>{coverageRows.reduce((sum, row) => sum + row.dayShifts.length, 0)} shifts across this view</span></div></div><button type="button" className="outline-summary-button" onClick={() => flash("Coverage looks good for the selected schedule.")}>View coverage</button></article>
      <article className="schedule-summary-card metrics-summary"><div className="schedule-summary-head"><h3>Schedule metrics</h3><select aria-label="Metrics period" defaultValue="this-week"><option value="this-week">This week</option><option value="this-month">This month</option></select></div><div className="metrics-grid"><div><span>Total hours</span><strong>{formatHours(totalScheduledMinutes)}</strong><small>Across scheduled shifts</small></div><div><span>Labor cost</span><strong>{moneyValue(employees.reduce((sum, employee) => sum + Math.round((employeeRows.find((row) => row.employee.id === employee.id)?.minutes ?? 0) / 60 * (employee.hourlyRateCents ?? 0)), 0))}</strong><small>Estimated pay</small></div><div><span>Overtime</span><strong>0h 00m</strong><small>Within weekly limits</small></div></div><button type="button" className="text-button" onClick={() => flash("Full schedule report opened.")}>View full report →</button></article>
    </section>
    {editor && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setEditor(null)}>
      <div className="modal schedule-editor-modal" role="dialog" aria-modal="true" aria-label="Edit shift">
        <div className="modal-head">
          <div><h2>{editor.id ? "Edit shift" : "Add shift"}</h2><p>Drag, resize, or duplicate shifts without leaving the schedule.</p></div>
          <button type="button" onClick={() => setEditor(null)} aria-label="Close shift editor">×</button>
        </div>
        <form className="modal-body schedule-editor-form" onSubmit={saveEditor}>
          <label>Assigned to<select value={editor.employeeId} onChange={(event) => setEditor((current) => current ? { ...current, employeeId: Number(event.target.value) } : current)}>{scheduleEmployees.map((employee) => <option value={employee.id} key={employee.id}>{employee.id === 0 ? `${employee.name} (owner)` : employee.name}</option>)}</select></label>
          <label>Date<input type="date" value={editor.date} onChange={(event) => setEditor((current) => current ? { ...current, date: event.target.value } : current)} /></label>
          <label>Start<input type="time" value={editor.start} onChange={(event) => setEditor((current) => current ? { ...current, start: event.target.value } : current)} /></label>
          <label>End<input type="time" value={editor.end} onChange={(event) => setEditor((current) => current ? { ...current, end: event.target.value } : current)} /></label>
          <label>Break<input type="number" min="0" step="15" value={editor.breakMinutes} onChange={(event) => setEditor((current) => current ? { ...current, breakMinutes: Number(event.target.value) } : current)} /></label>
          <label className="schedule-note-field">Note<textarea value={editor.note} onChange={(event) => setEditor((current) => current ? { ...current, note: event.target.value } : current)} rows={3} placeholder="Optional shift note" /></label>
          <div className="modal-actions">
            {editor.id && <button type="button" className="secondary-button" onClick={() => deleteShift(editor.id!)}>Delete shift</button>}
            <button type="button" className="secondary-button" onClick={() => setEditor(null)}>Cancel</button>
            <button type="submit" className="primary-button">{editor.id ? "Save changes" : "Add shift"}</button>
          </div>
        </form>
      </div>
    </div>}
  </>;
}

function Requests({ employees, flash }: { employees: Employee[]; flash: (message: string) => void }) {
  const rows: Employee[] = [];
  const types = ["Time Off", "Shift Swap", "Availability", "Open Shift"];
  const [statuses, setStatuses] = useState<Record<number, "pending" | "approved" | "denied">>(() => Object.fromEntries(rows.map((person, index) => [person.id, index > 3 ? "approved" : "pending"])));
  const [openMenu, setOpenMenu] = useState<number | null>(null);
  const [requestCategory, setRequestCategory] = useState("All Requests");
  const actOnRequest = (id: number, name: string, action: "approved" | "denied" | "pending") => {
    setStatuses((current) => ({ ...current, [id]: action }));
    setOpenMenu(null);
    flash(`${name}’s request ${action === "approved" ? "was approved" : action === "denied" ? "was denied" : "was returned to pending"}.`);
  };
  useEffect(() => {
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>(".request-row > button"));
    const statusElements = Array.from(document.querySelectorAll<HTMLElement>(".request-row .request-status"));
    statusElements.forEach((element, index) => {
      const status = statuses[rows[index]?.id] ?? "pending";
      element.classList.remove("approved", "pending", "denied");
      element.classList.add(status);
      element.textContent = status === "approved" ? "✓ Approved" : status === "denied" ? "× Denied" : "◷ Pending";
    });
    const cleanups = buttons.map((button, index) => {
      const person = rows[index];
      if (!person) return () => undefined;
      const handler = (event: Event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
        document.querySelector(".request-action-menu-floating")?.remove();
        const menu = document.createElement("div");
        menu.className = "request-action-menu request-action-menu-floating";
        const actions: Array<[string, () => void]> = [["View details", () => flash(`${person.name}’s request details opened.`)], ["✓ Approve", () => actOnRequest(person.id, person.name, "approved")], ["× Deny", () => actOnRequest(person.id, person.name, "denied")], ["Request changes", () => flash(`${person.name}’s request changes were requested.`)]];
        actions.forEach(([label, action]) => { const item = document.createElement("button"); item.type = "button"; item.textContent = label; item.onclick = () => { menu.remove(); action(); }; menu.appendChild(item); });
        const rect = button.getBoundingClientRect();
        menu.style.position = "fixed";
        menu.style.top = `${rect.bottom + 6}px`;
        menu.style.left = `${Math.max(8, rect.right - 160)}px`;
        document.body.appendChild(menu);
        window.setTimeout(() => { const close = (closeEvent: Event) => { if (!menu.contains(closeEvent.target as Node) && closeEvent.target !== button) { menu.remove(); document.removeEventListener("click", close, true); } }; document.addEventListener("click", close, true); }, 0);
      };
      button.addEventListener("click", handler, true);
      return () => button.removeEventListener("click", handler, true);
    });
    return () => cleanups.forEach((cleanup) => cleanup());
  }, [rows, statuses]);
  useEffect(() => {
    const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>(".request-tabs button"));
    const requestRows = Array.from(document.querySelectorAll<HTMLElement>(".request-row"));
    tabs.forEach((tab) => {
      const label = tab.textContent?.trim() ?? "";
      tab.classList.toggle("active", label === requestCategory);
      const handler = () => setRequestCategory(label);
      tab.addEventListener("click", handler);
      (tab as HTMLButtonElement & { _coreShiftRequestHandler?: () => void })._coreShiftRequestHandler = handler;
    });
    requestRows.forEach((row) => {
      const type = row.querySelector<HTMLElement>(".request-type")?.textContent?.trim() ?? "";
      row.style.display = requestCategory === "All Requests" || type === requestCategory.replace("Shift Swaps", "Shift Swap") ? "grid" : "none";
    });
    return () => tabs.forEach((tab) => { const handler = (tab as HTMLButtonElement & { _coreShiftRequestHandler?: () => void })._coreShiftRequestHandler; if (handler) tab.removeEventListener("click", handler); });
  }, [requestCategory, rows]);
  useEffect(() => {
    document.querySelectorAll<HTMLElement>(".request-kpis article strong").forEach((item) => { item.textContent = "0"; });
    document.querySelectorAll<HTMLElement>(".request-kpis article p").forEach((item) => { item.textContent = "No pending requests"; });
    const summary = document.querySelector<HTMLElement>(".request-summary");
    if (summary) {
      const total = summary.querySelector<HTMLElement>(".request-donut strong");
      if (total) total.textContent = "0";
      summary.querySelectorAll<HTMLElement>(".request-legend span").forEach((item) => { item.textContent = "●　0　No requests"; });
    }
    const calendar = document.querySelector<HTMLElement>(".request-calendar");
    if (calendar) calendar.innerHTML = "<h2>Time Off Calendar</h2><p class=\"empty-state-message\">No time-off requests yet.</p>";
    const dateFilter = document.querySelectorAll<HTMLButtonElement>(".request-filters .secondary-button")[2];
    if (dateFilter) dateFilter.textContent = formatDateRange(weekStartForDate(new Date()), addDays(weekStartForDate(new Date()), 6));
  }, []);
  return <section className="requests-page"><div className="request-kpis">{[[6,"Pending Requests","Needs your review","orange"],[4,"Time Off Requests","Pending approval","green"],[1,"Shift Swap Requests","Pending approval","purple"],[3,"Open Shifts","Need to be filled","blue"],[2,"Availability Updates","Pending review","teal"]].map(([value,label,note,tone]) => <article key={String(label)}><span className={`request-icon ${tone}`}>◷</span><small>{label}</small><strong>{value}</strong><p>{note}</p><button type="button" onClick={() => flash(`${label} opened.`)}>View {String(label).toLowerCase()} →</button></article>)}</div><div className="requests-main"><article className="panel requests-table-panel"><div className="request-tabs"><button className="active" type="button">All Requests</button><button type="button">Time Off</button><button type="button">Shift Swaps</button><button type="button">Availability</button><button type="button">Open Shifts</button></div><div className="request-filters"><label>⌕ <input placeholder="Search requests..." /></label><button className="secondary-button">All Request Types⌄</button><button className="secondary-button">All Statuses⌄</button><button className="secondary-button">May 19 – May 25　▣</button><button className="secondary-button">☷ Filters</button></div><div className="request-table-head"><span>Employee</span><span>Request</span><span>Date / Shift</span><span>Details</span><span>Status</span><span>Submitted</span><span>Actions</span></div>{rows.map((person,index) => <div className="request-row" key={person.id}><div className="request-person"><span className={`avatar ${person.color}`}>{person.initials}</span><div><strong>{person.name}</strong><small>{person.role}</small></div></div><span className={`request-type ${types[index % types.length].toLowerCase().replace(" ", "-")}`}>{types[index % types.length]}</span><span>May {19 + index}, 2024<br /><small>{index % 2 ? "10:00 AM – 6:00 PM" : "All day"}</small></span><span>{index % 2 ? "Open shift" : "Vacation"}</span><i className={`request-status ${index > 3 ? "approved" : "pending"}`}>{index > 3 ? "✓ Approved" : "◷ Pending"}</i><span>May {19 + index}, 2:10 PM</span><button type="button" onClick={() => flash(`${person.name}’s request opened.`)}>•••</button></div>)}{!rows.length && <EmptyState title="No requests yet" message="New team requests will appear here." />}<div className="request-table-foot">Showing 1 to {rows.length} of {rows.length} requests <span>‹　<span className="current-page">1</span>　›</span></div></article><aside className="request-side"><article className="panel request-summary"><PanelHead title="Request Summary" /><div className="request-donut"><strong>12</strong><span>Total</span></div><div className="request-legend"><span>●　4　Time Off</span><span>●　1　Shift Swaps</span><span>●　3　Open Shifts</span><span>●　2　Availability</span><span>●　2　Other</span></div><button className="full-button" type="button" onClick={() => flash("Full request report opened.")}>View full report →</button></article><article className="panel request-calendar"><PanelHead title="Time Off Calendar" /><strong>May 2024</strong><div className="calendar-mini">{Array.from({ length: 35 }, (_, index) => <span className={index === 17 ? "today" : ""} key={index}>{index + 1 > 31 ? "" : index + 1}</span>)}</div><button className="text-button" type="button" onClick={() => flash("Calendar opened.")}>View full calendar →</button></article><article className="panel request-activity"><PanelHead title="Recent Activity" />{rows.slice(0,3).map((person,index) => <div key={person.id}><span className="activity-dot">✓</span><span>{person.name}’s request was {index ? "submitted" : "approved"}</span></div>)}</article></aside></div></section>;
}

function Team({ employees, toggleClock, setShowAddEmployee, updateEmployeeEmail, updateEmployeeRate, shareEmployeeLogin, onEmployeeDeleted, onRecordsChanged, flash }: { employees: Employee[]; toggleClock: (employee: Employee) => void; setShowAddEmployee: (show: boolean) => void; updateEmployeeEmail: (employee: Employee, email: string) => void; updateEmployeeRate: (employee: Employee, dollars: string) => void; shareEmployeeLogin: (employee: Employee) => void; onEmployeeDeleted: (id: number) => void; onRecordsChanged: () => Promise<void>; flash: (message: string) => void }) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<EmployeeDetail | null>(null);
  const [detailError, setDetailError] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);
  const [showAddTime, setShowAddTime] = useState(false);
  const [showPayment, setShowPayment] = useState(false);

  useEffect(() => {
    const employeeId = Number(new URLSearchParams(window.location.search).get("employee"));
    if (Number.isInteger(employeeId) && employeeId > 0) void loadDetail(employeeId);
  }, []);

  async function loadDetail(id: number) {
    setSelectedId(id);
    setDetailLoading(true);
    setDetailError("");
    const response = await fetch(`/api/employees/${id}`).catch(() => null);
    const result = response ? await response.json().catch(() => null) as (EmployeeDetail & { error?: string }) | null : null;
    if (!response?.ok || !result?.employee) {
      setDetailError(result?.error ?? "Employee details could not be loaded.");
      setDetail(null);
    } else {
      setDetail(result);
    }
    setDetailLoading(false);
  }

  async function saveTimeEntry(event: FormEvent<HTMLFormElement>, entryId?: number) {
    event.preventDefault();
    if (!selectedId) return;
    const form = new FormData(event.currentTarget);
    const clockIn = new Date(`${String(form.get("clockInDate"))}T${String(form.get("clockInTime"))}`).getTime();
    const clockOutDate = String(form.get("clockOutDate") ?? "").trim();
    const clockOutTime = String(form.get("clockOutTime") ?? "").trim();
    const clockOut = clockOutDate && clockOutTime ? new Date(`${clockOutDate}T${clockOutTime}`).getTime() : null;
    const response = await fetch(entryId ? `/api/time-entries/${entryId}` : `/api/employees/${selectedId}/time-entries`, {
      method: entryId ? "PATCH" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clockIn, clockOut }),
    }).catch(() => null);
    if (!response?.ok) {
      const result = response ? await response.json().catch(() => null) as { error?: string } | null : null;
      setDetailError(result?.error ?? "That time entry could not be saved.");
      return;
    }
    setShowAddTime(false);
    await loadDetail(selectedId);
    await onRecordsChanged();
    flash(entryId ? "Time entry updated." : "Time entry added.");
  }

  async function deleteTimeEntry(entryId: number) {
    if (!selectedId || !window.confirm("Delete this time entry? This cannot be undone.")) return;
    const response = await fetch(`/api/time-entries/${entryId}`, { method: "DELETE" }).catch(() => null);
    if (!response?.ok) return setDetailError("That time entry could not be deleted.");
    await loadDetail(selectedId);
    await onRecordsChanged();
    flash("Time entry deleted.");
  }

  async function deleteEmployee() {
    if (!detail || !window.confirm(`Delete ${detail.employee.name} and all of their time entries? This cannot be undone.`)) return;
    const response = await fetch(`/api/employees/${detail.employee.id}`, { method: "DELETE" }).catch(() => null);
    if (!response?.ok) { const result = await response?.json().catch(() => null) as { error?: string } | null; return setDetailError(result?.error ?? "That employee could not be deleted."); }
    onEmployeeDeleted(detail.employee.id);
    setSelectedId(null);
    setDetail(null);
    flash(`${detail.employee.name} was deleted.`);
  }

  async function recordPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedId) return;
    const form = new FormData(event.currentTarget);
    const amountCents = Math.round(Number(form.get("amount")) * 100);
    const paidAt = new Date(`${String(form.get("paidAt"))}T12:00:00`).getTime();
    const response = await fetch(`/api/employees/${selectedId}/payments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ amountCents, paidAt, note: form.get("note") }),
    }).catch(() => null);
    if (!response?.ok) {
      const result = response ? await response.json().catch(() => null) as { error?: string } | null : null;
      setDetailError(result?.error ?? "That payment could not be recorded.");
      return;
    }
    setShowPayment(false);
    await loadDetail(selectedId);
    flash("Payment recorded.");
  }

  async function deletePayment(paymentId: number) {
    if (!selectedId || !window.confirm("Delete this payment record? This cannot be undone.")) return;
    const response = await fetch(`/api/payments/${paymentId}`, { method: "DELETE" }).catch(() => null);
    if (!response?.ok) return setDetailError("That payment record could not be deleted.");
    await loadDetail(selectedId);
    flash("Payment record deleted.");
  }

  const entryMinutes = (entry: TimeEntryDetail) => entry.clockOut ? Math.max(0, Math.round((entry.clockOut - entry.clockIn) / 60_000)) : 0;
  const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
  const totalMinutes = detail?.entries.reduce((sum, entry) => sum + entryMinutes(entry), 0) ?? 0;
  const totalPayCents = Math.round(totalMinutes / 60 * (detail?.employee.hourlyRateCents ?? 0));
  const totalPaidCents = detail?.payments.reduce((sum, payment) => sum + payment.amountCents, 0) ?? 0;
  const unpaidCents = Math.max(0, totalPayCents - totalPaidCents);

  return <>
    <section className="team-stats"><div><strong>{employees.length}</strong><span>Total employees</span><Link href="/team">View all employees →</Link></div><div><strong>{employees.filter((person) => person.status === "clocked_in").length}</strong><span>Active today</span><Link href="/time-clock">View time clock →</Link></div><div><strong>0</strong><span>On leave</span><small>Today</small></div><div><strong>{new Set(employees.map((person) => person.role)).size}</strong><span>Open roles</span><small>Need to be filled</small></div></section>
    <article className="panel table-panel">
      <div className="table-toolbar"><div className="search-box">⌕ <input aria-label="Search employees" placeholder="Search team" /></div><button className="secondary-button" onClick={() => setShowAddEmployee(true)}>＋ Add employee</button></div>
      <div className="data-table team-table">
        <div className="table-row team-row table-header"><span>Employee</span><span>Role</span><span>Hourly rate</span><span>This week</span><span>Status</span><span /></div>
        {employees.map((person, index) => <div className="table-row team-row" key={person.id}>
          <div className="table-person"><div className={`avatar ${teamAvatarColor(index)}`}>{person.initials}<span className={person.status === "clocked_in" ? "status-dot online" : "status-dot"} /></div><div><button className="employee-name-button" type="button" onClick={() => loadDetail(person.id)}>{person.name}</button><input className="login-email" type="email" aria-label={`${person.name} login email`} defaultValue={person.email ?? ""} placeholder="Add login email" onBlur={(event) => updateEmployeeEmail(person, event.target.value)} /><button className="invite-link-button" onClick={() => shareEmployeeLogin(person)}>↗ Send login</button></div></div>
          <span>{savedAccessRole(person.id, person.role)}</span><label className="rate-field"><span>$</span><input type="number" min="0" step="0.01" aria-label={`${person.name} hourly rate`} defaultValue={((person.hourlyRateCents ?? 0) / 100).toFixed(2)} onBlur={(event) => updateEmployeeRate(person, event.target.value)} /><small>/hr</small></label><strong>{formatHours(person.weeklyMinutes)}</strong><span><i className={person.status === "clocked_in" ? "status-chip approved" : "status-chip ready"}>{person.status === "clocked_in" ? "Working" : "Off"}</i></span>
          <button className={person.status === "clocked_in" ? "clock-button out" : "clock-button"} onClick={() => toggleClock(person)}>{person.status === "clocked_in" ? "Clock out" : "Clock in"}</button>
        </div>)}
        {!employees.length && <EmptyState title="No employees yet" message="Choose Add employee to enter your first team member." />}
      </div>
    </article>
    {selectedId && <div className="modal-backdrop employee-detail-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setSelectedId(null)}>
      <section className="employee-detail-modal" role="dialog" aria-modal="true" aria-labelledby="employee-detail-title">
        <div className="employee-detail-head">
          <div><p className="eyebrow">Employee record</p><h2 id="employee-detail-title">{detail?.employee.name ?? "Loading employee…"}</h2><span>{detail?.employee.role}{detail && <i className={unpaidCents > 0 ? "pay-status unpaid" : "pay-status paid"}>{unpaidCents > 0 ? "Unpaid balance" : "Paid"}</i>}</span></div>
          <button type="button" onClick={() => setSelectedId(null)} aria-label="Close employee details">×</button>
        </div>
        {detailLoading && <div className="employee-detail-loading">Loading time entries…</div>}
        {detail && !detailLoading && <>
          <div className="pay-summary">
            <div><span>Total recorded</span><strong>{formatHours(totalMinutes)}</strong></div>
            <div><span>Estimated earned</span><strong>{money(totalPayCents)}</strong></div>
            <div><span>Total paid</span><strong>{money(totalPaidCents)}</strong></div>
            <div className="pay-total"><span>Still unpaid</span><strong>{money(unpaidCents)}</strong></div>
          </div>
          <p className="pay-note">Estimated earnings use the current {money(detail.employee.hourlyRateCents ?? 0)}/hour rate and recorded hours, before taxes or deductions. CoreShift records payments but does not send funds.</p>
          <div className="employee-profile-summary"><div><span>Displayed name</span><strong>{detail.employee.displayName || detail.employee.name}</strong></div><div><span>Email</span><strong>{detail.employee.email || "Not provided"}</strong></div><div><span>Phone</span><strong>{detail.employee.phone || "Not provided"}</strong></div><div><span>Desired hours</span><strong>{detail.employee.desiredHours ? `${detail.employee.desiredHours} hrs / week` : "Not provided"}</strong></div><div className="profile-summary-wide"><span>Availability</span><strong>{detail.employee.availability || "Not provided"}</strong></div><div className="profile-summary-wide"><span>Address</span><strong>{detail.employee.address || "Not provided"}</strong></div></div>
          <div className="payment-toolbar"><div><strong>Payment history</strong><span>{detail.payments.length} recorded payments</span></div><button className="primary-button detail-add-button" type="button" onClick={() => setShowPayment(!showPayment)}>＋ Mark paid</button></div>
          {showPayment && <form className="payment-form" onSubmit={recordPayment}>
            <label>Amount paid<div className="payment-money"><span>$</span><input name="amount" type="number" min="0.01" step="0.01" defaultValue={(unpaidCents / 100).toFixed(2)} required /></div></label>
            <label>Date paid<input name="paidAt" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required /></label>
            <label>Note<input name="note" maxLength={200} placeholder="Optional note or method" /></label>
            <button className="primary-button" type="submit">Record payment</button>
          </form>}
          <div className="payment-history">
            {detail.payments.map((payment) => <div className="payment-row" key={payment.id}><span className="payment-check">✓</span><div><strong>{money(payment.amountCents)}</strong><span>{new Date(payment.paidAt).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}{payment.note ? ` · ${payment.note}` : ""}</span></div><button type="button" onClick={() => deletePayment(payment.id)}>Delete</button></div>)}
            {!detail.payments.length && <p>No payments recorded yet.</p>}
          </div>
          <div className="employee-detail-toolbar"><div><strong>Time worked</strong><span>{detail.entries.length} entries</span></div><button className="primary-button detail-add-button" type="button" onClick={() => setShowAddTime(!showAddTime)}>＋ Add time</button></div>
          {showAddTime && <form className="time-entry-form add-time-entry" onSubmit={(event) => saveTimeEntry(event)}>
            <label>Start date<input name="clockInDate" type="date" required /></label><label>Start time<input name="clockInTime" type="time" required /></label>
            <label>End date<input name="clockOutDate" type="date" required /></label><label>End time<input name="clockOutTime" type="time" required /></label>
            <button className="primary-button" type="submit">Save</button>
          </form>}
          <div className="time-entry-list">
            {detail.entries.map((entry) => {
              const minutes = entryMinutes(entry);
              const payCents = Math.round(minutes / 60 * detail.employee.hourlyRateCents);
              return <form className="time-entry-form" key={entry.id} onSubmit={(event) => saveTimeEntry(event, entry.id)}>
                <label>Start date<input name="clockInDate" type="date" defaultValue={localDateTimeParts(entry.clockIn).date} required /></label><label>Start time<input name="clockInTime" type="time" defaultValue={localDateTimeParts(entry.clockIn).time} required /></label>
                <label>End date<input name="clockOutDate" type="date" defaultValue={entry.clockOut ? localDateTimeParts(entry.clockOut).date : ""} /></label><label>End time<input name="clockOutTime" type="time" defaultValue={entry.clockOut ? localDateTimeParts(entry.clockOut).time : ""} /></label>
                <div className="entry-total"><span>{entry.clockOut ? formatHours(minutes) : "Working now"}</span><strong>{money(payCents)}</strong></div>
                <button className="secondary-button" type="submit">Save</button>
                <button className="entry-delete-button" type="button" onClick={() => deleteTimeEntry(entry.id)}>Delete</button>
              </form>;
            })}
            {!detail.entries.length && <EmptyState title="No time entries" message="Clock activity and manually added time appear here." />}
          </div>
          <div className="employee-danger-zone"><div><strong>Delete employee</strong><span>Removes this employee, their login, and all recorded time.</span></div><button type="button" onClick={deleteEmployee}>Delete employee</button></div>
        </>}
        {detailError && <p className="employee-detail-error" role="alert">{detailError}</p>}
      </section>
    </div>}
  </>;
}

function PaymentsExport() {
  const year = new Date().getFullYear();
  return <section className="panel report-export-bar"><div><strong>Yearly payment export</strong><span>Download every payment recorded for a calendar year.</span></div><label>Year<input id="payment-export-year" type="number" min="2000" max="2100" defaultValue={year} /></label><button className="secondary-button" type="button" onClick={() => { const value = (document.getElementById("payment-export-year") as HTMLInputElement)?.value || String(year); window.location.href = `/api/reports/payments-export?year=${encodeURIComponent(value)}`; }}>↓ Export payments CSV</button></section>;
}

type StoredDocument = { id: string; name: string; category: string; type: string; size: string; uploadedAt: number; uploadedBy: string };

function DocumentsLive({ flash }: { flash: (message: string) => void }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All Categories");
  const [type, setType] = useState("All Types");
  const [documents, setDocuments] = useState<StoredDocument[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    try { const saved = window.localStorage.getItem("coreshift-documents"); if (saved) setDocuments(JSON.parse(saved) as StoredDocument[]); } catch { /* ignore malformed local data */ }
  }, []);
  function persist(next: StoredDocument[]) { setDocuments(next); window.localStorage.setItem("coreshift-documents", JSON.stringify(next)); }
  function uploadDocuments(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (!files.length) return;
    const uploaded = files.map((file) => ({ id: `${Date.now()}-${file.name}`, name: file.name, category: "Company Policies", type: (file.name.split(".").pop() || "FILE").toUpperCase(), size: file.size < 1024 * 1024 ? `${Math.max(1, Math.round(file.size / 1024))} KB` : `${(file.size / (1024 * 1024)).toFixed(1)} MB`, uploadedAt: Date.now(), uploadedBy: "You" }));
    persist([...uploaded, ...documents]);
    flash(`${files.length} document${files.length === 1 ? "" : "s"} uploaded.`);
    event.target.value = "";
  }
  const visible = documents.filter((doc) => (category === "All Categories" || doc.category === category) && (type === "All Types" || doc.type === type) && doc.name.toLowerCase().includes(query.toLowerCase()));
  const count = (name: string) => documents.filter((doc) => doc.category === name).length;
  return <section className="documents-page"><div className="documents-actions"><label className="documents-search">⌕<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search documents..." /></label><button className="secondary-button" type="button" onClick={() => flash("New folder creation is ready.")}>▱　New Folder</button><input ref={fileInput} className="documents-file-input" type="file" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt" onChange={uploadDocuments} /><button className="primary-button" type="button" onClick={() => fileInput.current?.click()}>＋　Upload Document</button></div><div className="documents-kpis"><article className="selected"><span className="doc-icon purple">▱</span><small>All Documents</small><strong>{documents.length}</strong><em>{documents.length ? "Team library" : "No documents uploaded"}</em></article><article><span className="doc-icon green">◇</span><small>Company Policies</small><strong>{count("Company Policies")}</strong></article><article><span className="doc-icon orange">♙</span><small>Employee Forms</small><strong>{count("Employee Forms")}</strong></article><article><span className="doc-icon purple">⌂</span><small>Training &amp; Resources</small><strong>{count("Training &amp; Resources")}</strong></article><article><span className="doc-icon blue">▤</span><small>Tax &amp; Payroll</small><strong>{count("Tax &amp; Payroll")}</strong></article></div><div className="documents-main"><article className="panel documents-table-panel"><div className="documents-filter-row"><label className="documents-search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search documents..." /></label><select value={category} onChange={(event) => setCategory(event.target.value)}><option>All Categories</option><option>Company Policies</option><option>Employee Forms</option><option>Training &amp; Resources</option><option>Tax &amp; Payroll</option></select><select value={type} onChange={(event) => setType(event.target.value)}><option>All Types</option><option>PDF</option><option>DOC</option><option>DOCX</option><option>XLS</option><option>XLSX</option><option>CSV</option><option>TXT</option></select></div><div className="documents-table-head"><span>Name</span><span>Category</span><span>Type</span><span>Uploaded By</span><span>Uploaded</span><span>Actions</span></div>{visible.length ? visible.map((doc) => <div className="document-row" key={doc.id}><span className={`file-icon ${doc.type.toLowerCase()}`}>{doc.type}</span><strong>{doc.name}<small>{doc.size}</small></strong><em className={`category-pill ${doc.type.toLowerCase()}`}>{doc.category}</em><span className="doc-type">{doc.type}<small>{doc.size}</small></span><span>{doc.uploadedBy}<small>Uploader</small></span><span>{new Date(doc.uploadedAt).toLocaleDateString()}<small>{new Date(doc.uploadedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</small></span><button className="icon-button" type="button" onClick={() => { persist(documents.filter((item) => item.id !== doc.id)); flash("Document removed."); }} aria-label={`Delete ${doc.name}`}>×</button></div>) : <div className="documents-empty"><strong>No documents yet</strong><span>Upload a document to start building your team library.</span><button className="primary-button" type="button" onClick={() => fileInput.current?.click()}>Upload your first document</button></div>}<div className="documents-table-footer">{visible.length ? `Showing 1 to ${visible.length} of ${visible.length} documents` : "No documents uploaded"}<span>‹　 <b>1</b>　›</span></div></article><aside className="documents-side"><article className="panel storage-card"><PanelHead title="Storage Usage" /><span>Local document storage</span><div className="storage-bar"><i style={{ width: "0%" }} /></div><b>0%</b><button className="secondary-button" type="button" onClick={() => flash("Storage is managed in this browser.")}>Manage Storage</button></article><article className="panel recent-docs"><PanelHead title="Recent Activity" /><p className="documents-empty-note">{documents.length ? `${documents[0].name} uploaded recently.` : "No recent document activity."}</p></article><article className="panel quick-doc-actions"><PanelHead title="Quick Actions" />{["Upload Document","Create Folder","Request Document","Document Templates"].map((item) => <button key={item} type="button" onClick={() => item === "Upload Document" ? fileInput.current?.click() : flash(`${item} opened.`)}>{item}<span>›</span></button>)}</article></aside></div></section>;
}

function Documents({ flash }: { flash: (message: string) => void }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All Categories");
  type DocumentRecord = { id: string; name: string; category: string; type: string; size: string; uploadedAt: number; uploadedBy: string };
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    try { const saved = window.localStorage.getItem("coreshift-documents"); if (saved) setDocuments(JSON.parse(saved) as DocumentRecord[]); } catch { /* ignore malformed local data */ }
  }, []);
  function persist(next: DocumentRecord[]) { setDocuments(next); window.localStorage.setItem("coreshift-documents", JSON.stringify(next)); }
  function uploadDocuments(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (!files.length) return;
    const next = files.map((file) => ({ id: `${Date.now()}-${file.name}`, name: file.name, category: "Company Policies", type: (file.name.split(".").pop() || "FILE").toUpperCase(), size: file.size < 1024 * 1024 ? `${Math.max(1, Math.round(file.size / 1024))} KB` : `${(file.size / (1024 * 1024)).toFixed(1)} MB`, uploadedAt: Date.now(), uploadedBy: "You" }));
    persist([...next, ...documents]);
    flash(`${files.length} document${files.length === 1 ? "" : "s"} uploaded.`);
    event.target.value = "";
  }
  const visible = documents.filter((doc) => (category === "All Categories" || doc.category === category) && doc.name.toLowerCase().includes(query.toLowerCase()));
  return <section className="documents-page"><div className="documents-actions"><label className="documents-search">⌕<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search documents..." /></label><button className="secondary-button" type="button" onClick={() => flash("New folder creation is ready.")}>▱　New Folder</button><button className="primary-button" type="button" onClick={() => flash("Choose a document to upload.")}>＋　Upload Document</button></div><div className="documents-kpis"><article className="selected"><span className="doc-icon purple">▱</span><small>All Documents</small><strong>0</strong><em>No documents uploaded</em></article><article><span className="doc-icon green">◇</span><small>Company Policies</small><strong>0</strong></article><article><span className="doc-icon orange">♙</span><small>Employee Forms</small><strong>0</strong></article><article><span className="doc-icon purple">⌂</span><small>Training &amp; Resources</small><strong>0</strong></article><article><span className="doc-icon blue">▤</span><small>Tax &amp; Payroll</small><strong>0</strong></article></div><div className="documents-main"><article className="panel documents-table-panel"><div className="documents-filter-row"><label className="documents-search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search documents..." /></label><select value={category} onChange={(event) => setCategory(event.target.value)}><option>All Categories</option><option>Company Policies</option><option>Employee Forms</option><option>Training &amp; Resources</option><option>Tax &amp; Payroll</option></select><select defaultValue="All Types"><option>All Types</option><option>PDF</option><option>DOCX</option><option>XLSX</option></select><button className="secondary-button" type="button">☷　Filters</button></div><div className="documents-table-head"><span>Name</span><span>Category</span><span>Type</span><span>Uploaded By</span><span>Uploaded</span><span>Actions</span></div>{visible.length ? visible.map((doc) => <div className="document-row" key={doc[0]}><span className={`file-icon ${doc[6]}`}>{doc[2]}</span><strong>{doc[0]}<small>{doc[2] === "PDF" ? "v2.1" : "IRS Document"}</small></strong><em className={`category-pill ${doc[6]}`}>{doc[1]}</em><span className="doc-type">{doc[2]}<small>{doc[5]}</small></span><span>{doc[3]}<small>Owner</small></span><span>{doc[4]}<small>2:30 PM</small></span><button className="icon-button" type="button">•••</button></div>) : <div className="documents-empty"><strong>No documents yet</strong><span>Upload a document to start building your team library.</span><button className="primary-button" type="button" onClick={() => flash("Choose a document to upload.")}>Upload your first document</button></div>}<div className="documents-table-footer">{visible.length ? `Showing 1 to ${visible.length} of ${visible.length} documents` : "No documents uploaded"}<span>‹　 <b>1</b>　›</span></div></article><aside className="documents-side"><article className="panel storage-card"><PanelHead title="Storage Usage" /><span>0 GB of 10 GB used</span><div className="storage-bar"><i style={{width:"0%"}} /></div><b>0%</b><button className="secondary-button" type="button" onClick={() => flash("Storage management opened.")}>Manage Storage</button></article><article className="panel recent-docs"><PanelHead title="Recent Activity" action={<button className="text-button">View all</button>} /><p className="documents-empty-note">No recent document activity.</p></article><article className="panel quick-doc-actions"><PanelHead title="Quick Actions" />{["Upload Document","Create Folder","Request Document","Document Templates"].map((item) => <button key={item} type="button" onClick={() => flash(`${item} opened.`)}>{item}<span>›</span></button>)}</article></aside></div></section>;
}

function Reports({ employees, totalMinutes }: { employees: Employee[]; totalMinutes: number }) {
  const averageMinutes = employees.length ? Math.round(totalMinutes / employees.length) : 0;
  type ReportWidgetId = "payroll" | "pay-summary" | "employees" | "team" | "hours" | "attendance" | "payments" | "owed" | "top-earners" | "leaderboard" | "pay-rates" | "payment-stats";
  const widgetLabels: Record<ReportWidgetId, string> = { payroll: "Payroll report", "pay-summary": "Pay summary", employees: "Employee hours", team: "Team snapshot", hours: "Hours overview", attendance: "Attendance", payments: "Payment history", owed: "Outstanding pay", "top-earners": "Top earners", leaderboard: "Hours leaderboard", "pay-rates": "Pay rates", "payment-stats": "Payment stats" };
  const defaultWidgets: ReportWidgetId[] = ["pay-summary", "employees", "team", "hours", "attendance"];
  const [widgetOrder, setWidgetOrder] = useState<ReportWidgetId[]>(defaultWidgets);
  const [widgetMenuOpen, setWidgetMenuOpen] = useState(false);
  const [draggingWidget, setDraggingWidget] = useState<ReportWidgetId | null>(null);
  const [reportRange, setReportRange] = useState<"last-week" | "two-weeks" | "month" | "year" | "all" | "custom">("last-week");
  const [customStart, setCustomStart] = useState(() => { const date = new Date(); date.setDate(1); return date.toISOString().slice(0, 10); });
  const [customEnd, setCustomEnd] = useState(() => new Date().toISOString().slice(0, 10));
  const [report, setReport] = useState<ExpenseTotals | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const now = new Date();
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(dayStart);
    weekStart.setDate(dayStart.getDate() - ((dayStart.getDay() + 6) % 7));
    const lastWeekStart = new Date(weekStart);
    lastWeekStart.setDate(lastWeekStart.getDate() - 7);
    const twoWeeksStart = new Date(weekStart);
    twoWeeksStart.setDate(twoWeeksStart.getDate() - 14);
    const periodStart = reportRange === "last-week" ? lastWeekStart.getTime() : reportRange === "two-weeks" ? twoWeeksStart.getTime() : reportRange === "custom" ? new Date(`${customStart}T00:00:00`).getTime() : 0;
    const periodEnd = reportRange === "custom" ? new Date(`${customEnd}T23:59:59`).getTime() : 0;
    const query = new URLSearchParams({
      dayStart: String(dayStart.getTime()), weekStart: String(weekStart.getTime()),
      monthStart: String(new Date(now.getFullYear(), now.getMonth(), 1).getTime()),
      yearStart: String(new Date(now.getFullYear(), 0, 1).getTime()), range: reportRange,
      periodStart: String(periodStart), periodEnd: String(periodEnd),
    });
    setLoading(true);
    fetch(`/api/reports/expenses?${query}`).then((response) => response.ok ? response.json() as Promise<ExpenseTotals> : Promise.reject()).then(setReport).catch(() => setReport(null)).finally(() => setLoading(false));
  }, [reportRange, customStart, customEnd]);
  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem("coreshift-report-widgets") ?? "null") as ReportWidgetId[] | null;
      if (Array.isArray(saved)) setWidgetOrder(saved.filter((id): id is ReportWidgetId => id in widgetLabels && id !== "payroll"));
    } catch { /* use defaults */ }
  }, []);
  useEffect(() => { window.localStorage.setItem("coreshift-report-widgets", JSON.stringify(widgetOrder)); }, [widgetOrder]);
  const reportRows = report?.selected.employeeReport ?? [];
  const reportMinutes = reportRows.length ? reportRows.reduce((sum, row) => sum + row.minutes, 0) : totalMinutes;
  const reportLaborCostCents = reportRows.length
    ? reportRows.reduce((sum, row) => sum + row.earnedCents, 0)
    : employees.reduce((sum, employee) => sum + Math.round((employee.weeklyMinutes / 60) * (employee.hourlyRateCents ?? 0)), 0);
  const reportAverageCostCents = reportMinutes ? Math.round((reportLaborCostCents / reportMinutes) * 60) : 0;
  const reportLabel = reportRange === "last-week" ? "Last week" : reportRange === "two-weeks" ? "Last 2 weeks" : reportRange === "month" ? "This month" : reportRange === "year" ? "Year to date" : reportRange === "custom" ? `${customStart} – ${customEnd}` : "All time";
  const money = (cents: number) => moneyValue(cents);
  const removeWidget = (id: ReportWidgetId) => setWidgetOrder((current) => current.filter((item) => item !== id));
  const addWidget = (id: ReportWidgetId) => { setWidgetOrder((current) => current.includes(id) ? current : [...current, id]); setWidgetMenuOpen(false); };
  const downloadEmployeePayroll = () => {
    const header = ["Employee", "Hours", "Earned", "Paid", "Owed", "Period"];
    const lines = reportRows.map((row) => [row.name, formatHours(row.minutes), money(row.earnedCents), money(row.paidCents), money(row.owedCents), reportLabel]);
    const csv = [header, ...lines].map((line) => line.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `employee-payroll-${reportRange}-${new Date().toISOString().slice(0, 10)}.csv`; link.click(); URL.revokeObjectURL(url);
  };
  const moveWidget = (target: ReportWidgetId) => {
    if (!draggingWidget || draggingWidget === target) return;
    setWidgetOrder((current) => { const next = [...current]; const from = next.indexOf(draggingWidget); const to = next.indexOf(target); next.splice(from, 1); next.splice(to, 0, draggingWidget); return next; });
    setDraggingWidget(null);
  };
  const renderWidget = (id: ReportWidgetId) => {
    if (id === "payroll") return <article className="panel payroll-report-panel"><div className="payroll-report-head"><div><h3>Employee payroll report</h3><p>Hours worked and payments by employee</p></div><div className="report-period-switcher" role="tablist" aria-label="Report period">{([["last-week", "Last week"], ["two-weeks", "Last 2 weeks"], ["month", "This month"], ["year", "Year to date"], ["all", "All time"]] as const).map(([value, label]) => <button type="button" role="tab" aria-selected={reportRange === value} className={reportRange === value ? "active" : ""} onClick={() => setReportRange(value)} key={value}>{label}</button>)}</div></div><div className="payroll-report-period">{reportLabel}</div><div className="payroll-report-table"><div className="payroll-report-row payroll-report-header"><span>Employee</span><span>Hours</span><span>Earned</span><span>Paid</span><span>Owed</span></div>{loading && <div className="payroll-report-empty">Loading report…</div>}{!loading && reportRows.map((row) => <div className="payroll-report-row" key={row.id}><div className="report-person"><span className={`avatar ${row.color}`}>{row.initials}</span><Link className="report-link" href="/team">{row.name}</Link></div><span>{formatHours(row.minutes)}</span><strong>{money(row.earnedCents)}</strong><span>{money(row.paidCents)}</span><strong className={row.owedCents ? "report-owed" : "report-paid"}>{money(row.owedCents)}</strong></div>)}{!loading && !reportRows.length && <div className="payroll-report-empty">No employees found for this report.</div>}</div></article>;
    if (id === "pay-summary") return <article className="panel report-summary-widget"><PanelHead title="Pay summary" subtitle={reportLabel} /><div className="report-summary-grid"><div><span>Earned</span><strong>{money(report?.selected.earnedCents ?? 0)}</strong></div><div><span>Paid</span><strong>{money(report?.selected.totalCents ?? 0)}</strong></div><div><span>Owed</span><strong className="report-owed">{money(report?.selected.owedCents ?? 0)}</strong></div></div></article>;
    if (id === "employees") return <article className="panel report-employee-widget"><PanelHead title="Employee hours" subtitle={`${reportLabel} · ${reportRows.length} employees`} action={<Link className="text-button" href="/team">Open team →</Link>} />{reportRows.map((row) => <div className="report-employee-line" key={row.id}><div className="report-person"><span className={`avatar ${row.color}`}>{row.initials}</span><Link className="report-link" href="/team">{row.name}</Link></div><span>{formatHours(row.minutes)}</span><strong>{money(row.earnedCents)}</strong></div>)}{!reportRows.length && <EmptyState title="No employee hours" message="Hours appear once time is recorded." />}</article>;
    if (id === "team") return <article className="panel report-summary-widget"><PanelHead title="Team snapshot" subtitle="Current recorded totals" /><div className="report-summary-grid"><div><span>Employees</span><strong>{employees.length}</strong></div><div><span>Total hours</span><strong>{formatHours(totalMinutes)}</strong></div><div><span>Average</span><strong>{formatHours(averageMinutes)}</strong></div></div></article>;
    if (id === "hours") return <section className="reports-grid"><article className="panel report-chart"><PanelHead title="Hours over time" subtitle="Last 6 weeks" action={<span className="quiet-pill">Weekly</span>} /><div className="chart-area">{[0, 0, 0, 0, 0, 0].map((height, index) => <div className="chart-column" key={index}><span className={index === 5 ? "current" : ""} style={{ height: `${height}%` }} /><small>W{index + 1}</small></div>)}</div></article><article className="panel role-report"><PanelHead title="Hours by role" subtitle="This week" /><EmptyState title="No role totals yet" message="Role totals appear after hours are recorded." /></article></section>;
    if (id === "payments") return <article className="panel report-list-widget"><PanelHead title="Payment history" subtitle={`${reportLabel} · ${report?.selected.payments.length ?? 0} payments`} action={<Link className="text-button" href="/team">Open team →</Link>} />{(report?.selected.payments ?? []).slice(0, 8).map((payment) => <div className="report-list-line" key={payment.id}><div><Link className="report-link" href="/team">{payment.employeeName}</Link><span>{new Date(payment.paidAt).toLocaleDateString([], { month: "short", day: "numeric" })}{payment.note ? ` · ${payment.note}` : ""}</span></div><b>{money(payment.amountCents)}</b></div>)}{!report?.selected.payments.length && <EmptyState title="No payments yet" message="Payments recorded in this period will appear here." />}</article>;
    if (id === "owed") return <article className="panel report-list-widget"><PanelHead title="Outstanding pay" subtitle="Employees with an unpaid balance" action={<Link className="text-button" href="/team">Review team →</Link>} />{reportRows.filter((row) => row.owedCents > 0).map((row) => <div className="report-list-line" key={row.id}><div><Link className="report-link" href="/team">{row.name}</Link><span>{formatHours(row.minutes)} · earned {money(row.earnedCents)}</span></div><b className="report-owed">{money(row.owedCents)}</b></div>)}{!reportRows.some((row) => row.owedCents > 0) && <EmptyState title="All caught up" message="No outstanding balances in this period." />}</article>;
    if (id === "top-earners") return <article className="panel report-list-widget"><PanelHead title="Top earners" subtitle={reportLabel} action={<Link className="text-button" href="/team">Open team →</Link>} />{[...reportRows].sort((a, b) => b.earnedCents - a.earnedCents).slice(0, 5).map((row, index) => <div className="report-list-line" key={row.id}><div><Link className="report-link" href="/team"><i className="rank-number">{index + 1}</i>{row.name}</Link><span>{formatHours(row.minutes)} worked</span></div><b>{money(row.earnedCents)}</b></div>)}</article>;
    if (id === "leaderboard") return <article className="panel report-list-widget"><PanelHead title="Hours leaderboard" subtitle={reportLabel} action={<Link className="text-button" href="/team">Open team →</Link>} />{[...reportRows].sort((a, b) => b.minutes - a.minutes).map((row) => <div className="report-list-line" key={row.id}><div><Link className="report-link" href="/team">{row.name}</Link><span>{money(row.earnedCents)} earned</span></div><b>{formatHours(row.minutes)}</b></div>)}</article>;
    if (id === "pay-rates") return <article className="panel report-list-widget"><PanelHead title="Pay rates" subtitle="Current hourly rates" action={<Link className="text-button" href="/team">Manage rates →</Link>} />{reportRows.map((row) => <div className="report-list-line" key={row.id}><div><Link className="report-link" href="/team">{row.name}</Link><span>{formatHours(row.minutes)} this period</span></div><b>{money(row.hourlyRateCents)}<small>/hr</small></b></div>)}</article>;
    if (id === "payment-stats") return <article className="panel report-summary-widget"><PanelHead title="Payment stats" subtitle={reportLabel} /><div className="report-summary-grid"><div><span>Transactions</span><strong>{report?.selected.paymentCount ?? 0}</strong></div><div><span>Average payment</span><strong>{money(report?.selected.averageCents ?? 0)}</strong></div><div><span>Largest payment</span><strong>{money(report?.selected.largestCents ?? 0)}</strong></div></div></article>;
    return <article className="panel attendance-panel"><PanelHead title="Attendance highlights" subtitle="Patterns worth knowing" /><div className="highlight-grid"><div><span className="highlight-icon positive">0</span><strong>On-time starts</strong><p>0 recorded</p></div><div><span className="highlight-icon">◷</span><strong>Busiest day</strong><p>0h recorded</p></div><div><span className="highlight-icon coral-note">0</span><strong>Needs attention</strong><p>0 recorded items</p></div></div></article>;
  };
  return <>
    <section className="reports-pinned-payroll" aria-label="Payroll report">{renderWidget("payroll")}</section>
    <div className="reports-custom-toolbar"><strong>Employee payroll export</strong><label>From <input type="date" value={customStart} onChange={(event) => { setCustomStart(event.target.value); setReportRange("custom"); }} /></label><label>To <input type="date" value={customEnd} onChange={(event) => { setCustomEnd(event.target.value); setReportRange("custom"); }} /></label><button className="secondary-button" type="button" onClick={downloadEmployeePayroll}>⇩ Export employee payroll</button></div>
    <section className="reports-reference-kpis"><article><span className="report-kpi-icon purple">◷</span><small>Total Hours</small><strong>{formatHours(reportMinutes)}</strong><em>Recorded hours in selected period</em></article><article><span className="report-kpi-icon green">$</span><small>Total Labor Cost</small><strong>{money(reportLaborCostCents)}</strong><em>Hours × employee pay rates</em></article><article><span className="report-kpi-icon orange">%</span><small>Labor % of Sales</small><strong>—</strong><em>Sales data not entered</em></article><article><span className="report-kpi-icon blue">♙</span><small>Avg. Cost per Hour</small><strong>{money(reportAverageCostCents)}</strong><em>Labor cost ÷ recorded hours</em></article></section>
    <section className="reports-reference-chart-grid"><article className="panel reports-reference-chart"><PanelHead title="Hours & Labor Cost Over Time" subtitle="Weekly trend" action={<div className="report-chart-key" aria-label="Chart key"><span><i className="key-bar" />Hours worked</span><span><i className="key-dot" />Labor cost</span></div>} /><div className="report-chart-legend" aria-label="Chart legend"><span><i className="legend-swatch hours" />Hours worked</span><span><i className="legend-swatch labor" />Labor cost</span></div><div className="report-bars"><svg className="report-line" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polyline points="4,62 19,43 34,50 49,38 64,25 79,67 94,76" fill="none" stroke="#35a66a" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>{[38,56,50,62,78,31,23].map((height,index) => <div key={index}><i style={{height:`${height}%`}} /><span style={{bottom:`${Math.min(92,height+8)}%`}} /><small>{["Mon","Tue","Wed","Thu","Fri","Sat","Sun"][index]}</small></div>)}</div></article><article className="panel reports-reference-breakdown"><PanelHead title="Labor Cost Breakdown" action={<button className="text-button">View details</button>} /><div className="report-breakdown-donut"><strong>{money(report?.selected.totalCents ?? 0)}</strong><span>Total</span></div><div className="report-breakdown-list"><span><i className="breakdown-key wages" />Wages</span><span><i className="breakdown-key overtime" />Overtime</span><span><i className="breakdown-key taxes" />Taxes</span><span><i className="breakdown-key benefits" />Benefits</span></div></article></section>
    <section className="reports-reference-lower"><article className="panel attendance-summary"><PanelHead title="Attendance Summary" action={<button className="text-button">View full report</button>} /><div><span>♙　Total Shifts</span><strong>{employees.length * 6}</strong></div><div><span>▣　Completed</span><strong className="good">{Math.max(0, employees.length * 5)} (93.0%)</strong></div><div><span>◷　Late</span><strong className="warn">0 (0.0%)</strong></div><div><span>♧　No Call / No Show</span><strong className="bad">0 (0.0%)</strong></div></article><article className="panel scheduled-actual"><PanelHead title="Schedule vs Actual Hours" action={<button className="text-button">View full report</button>} /><div className="scheduled-gauge"><strong>{formatHours(totalMinutes)}</strong><span>Actual Hours</span></div><div className="scheduled-values"><span>Scheduled Hours <b>{formatHours(totalMinutes)}</b></span><span>Actual Hours <b>{formatHours(totalMinutes)}</b></span><span>Difference <b>0h 00m</b></span></div></article><article className="panel top-hours"><PanelHead title="Top Employees by Hours" action={<button className="text-button">View all</button>} />{[...employees].sort((a,b)=>b.weeklyMinutes-a.weeklyMinutes).slice(0,5).map((person)=><div key={person.id}><span className={`avatar ${person.color}`}>{person.initials}</span><strong>{person.name}<small>{person.role}</small></strong><b>{formatHours(person.weeklyMinutes)}</b></div>)}<button className="full-button" type="button">View full report</button></article></section>
    <section className="report-builder"><div className="report-builder-toolbar"><div><p className="eyebrow">Customize your report</p><h2>Report widgets</h2><span>Drag widgets to reorder them, or remove the ones you don’t need.</span></div><div className="widget-add-wrap"><button className="primary-button" type="button" onClick={() => setWidgetMenuOpen((open) => !open)}>＋ Add widget</button>{widgetMenuOpen && <div className="widget-menu">{(Object.keys(widgetLabels) as ReportWidgetId[]).filter((id) => id !== "payroll" && !widgetOrder.includes(id)).map((id) => <button type="button" key={id} onClick={() => addWidget(id)}>＋ {widgetLabels[id]}</button>)}{widgetOrder.filter((id) => id !== "payroll").length === Object.keys(widgetLabels).length - 1 && <span>All widgets are already added.</span>}</div>}</div></div><div className="report-widget-grid">{widgetOrder.map((id) => <div className={`report-widget ${draggingWidget === id ? "dragging" : ""}`} key={id} draggable onDragStart={() => setDraggingWidget(id)} onDragOver={(event) => event.preventDefault()} onDrop={() => moveWidget(id)}><div className="report-widget-bar"><span>⠿</span><strong>{widgetLabels[id]}</strong><button type="button" onClick={() => removeWidget(id)} aria-label={`Remove ${widgetLabels[id]}`}>×</button></div>{renderWidget(id)}</div>)}{!widgetOrder.length && <div className="report-widget-empty">No widgets on this report. Use Add widget to build your view.</div>}</div></section>
  </>;
}

type AiMessage = {
  role: "user" | "assistant";
  content: string;
};

type WorkspaceMessage = { id: number; conversationId?: string; senderType: "owner" | "employee"; senderId: number; senderName: string; body: string; imageData?: string | null; imageName?: string | null; createdAt: number; sentByViewer?: boolean; replyTo?: { id: number; senderName: string; body: string } | null; reactions?: Array<{ emoji: string; count: number; reactedByViewer: boolean }>; readBy?: Array<{ readerType: string; readerId: number; readerName: string; readAt: number }> };

const MESSAGE_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🎉"] as const;

function messagePreview(message: WorkspaceMessage, _viewerAccess: Viewer["access"]) {
  return `${message.sentByViewer ? "You" : message.senderName}: ${message.body || (message.imageData ? "Photo" : "Message")}`;
}

function messageSentTime(timestamp?: number) {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  const now = new Date();
  return date.toDateString() === now.toDateString()
    ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function Messages({ viewer, employees }: { viewer: Viewer; employees: Employee[] }) {
  const [messages, setMessages] = useState<WorkspaceMessage[]>([]);
  const [activeConversation, setActiveConversation] = useState(viewer.access === "employee" && viewer.employeeId ? `direct-${viewer.employeeId}` : "");
  const [conversationFilter, setConversationFilter] = useState<"all" | "direct" | "groups" | "unread">("all");
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeMode, setComposeMode] = useState<"direct" | "group">("direct");
  const [composeName, setComposeName] = useState("");
  const [composeMembers, setComposeMembers] = useState<number[]>([]);
  const [conversations, setConversations] = useState<Array<{ id: string; name: string; kind: "direct" | "group"; memberCount: number; unread: boolean; preview?: string; lastMessageAt?: number; archived?: boolean }>>(viewer.access === "employee" && viewer.employeeId ? [{ id: `direct-${viewer.employeeId}`, name: "Owner", kind: "direct" as const, memberCount: 2, unread: false }] : []);
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [body, setBody] = useState("");
  const [imageData, setImageData] = useState<string | null>(null);
  const [imageName, setImageName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ownerPhoto, setOwnerPhoto] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const gestureRef = useRef<{ id: string; startX: number; distance: number } | null>(null);
  const ignoreClickRef = useRef(false);
  const [swipingId, setSwipingId] = useState<string | null>(null);
  const [reactionMessageId, setReactionMessageId] = useState<number | null>(null);
  const [replyingTo, setReplyingTo] = useState<WorkspaceMessage | null>(null);
  const [onlinePeople, setOnlinePeople] = useState<Array<{ userType: "owner" | "employee"; userId: number; userName: string; lastSeen: number }>>([]);
  const reactionHoldRef = useRef<{ timer: number; x: number; y: number } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const activeConversationRef = useRef(activeConversation);
  const hydratedConversationsRef = useRef(new Set<string>());
  const messageLoadsInFlightRef = useRef(new Set<string>());
  activeConversationRef.current = activeConversation;
  function archiveConversation(conversationId: string) {
    setConversations((current) => current.map((conversation) => conversation.id === conversationId ? { ...conversation, archived: true } : conversation));
    if (activeConversation === conversationId) {
      const next = conversations.find((conversation) => conversation.id !== conversationId && !conversation.archived);
      setActiveConversation(next?.id ?? "");
    }
    ignoreClickRef.current = true;
    setSwipingId(null);
  }
  function restoreConversation(conversationId: string) {
    setConversations((current) => current.map((conversation) => conversation.id === conversationId ? { ...conversation, archived: false } : conversation));
  }
  function beginConversationSwipe(event: React.PointerEvent<HTMLButtonElement>, id: string) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    gestureRef.current = { id, startX: event.clientX, distance: 0 };
    setSwipingId(id);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }
  function moveConversationSwipe(event: React.PointerEvent<HTMLButtonElement>, id: string) {
    const gesture = gestureRef.current;
    if (!gesture || gesture.id !== id) return;
    gesture.distance = Math.max(0, Math.min(110, event.clientX - gesture.startX));
    setSwipingId(id);
  }
  function endConversationSwipe(event: React.PointerEvent<HTMLButtonElement>, id: string) {
    const gesture = gestureRef.current;
    if (!gesture || gesture.id !== id) return;
    const shouldArchive = gesture.distance >= 78;
    gestureRef.current = null;
    if (shouldArchive) archiveConversation(id);
    else setSwipingId(null);
  }
  useEffect(() => {
    try { setOwnerPhoto(window.localStorage.getItem("coreshift-owner-photo")); } catch { /* storage may be unavailable */ }
  }, []);
  useEffect(() => {
    if (!ownerPhoto) return;
    document.querySelectorAll<HTMLElement>(".conversation-avatar").forEach((element) => {
      element.style.backgroundImage = `url(${ownerPhoto})`;
      element.style.backgroundSize = "cover";
      element.style.backgroundPosition = "center";
      element.style.color = "transparent";
    });
  }, [ownerPhoto, activeConversation]);
  const avatarFor = (employeeId?: number, isOwner = false) => {
    const employee = employeeId ? employees.find((person) => person.id === employeeId) : undefined;
    const photo = isOwner ? ownerPhoto : (employee?.profilePhoto ?? (employeeId && typeof window !== "undefined" ? window.localStorage.getItem(`coreshift-employee-photo:${employeeId}`) : null));
    return photo ? <img className="conversation-avatar-image" src={photo} alt="" /> : (isOwner ? "♙" : employee ? nameInitials(employee.displayName ?? employee.name) : "♧");
  };
  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(`coreshift-conversations:${viewer.businessId}:${viewer.actorId}`) ?? "[]") as typeof conversations;
      if (Array.isArray(saved)) setConversations((current) => [...current, ...saved.filter((item) => item?.id && item.id !== "managers" && !current.some((existing) => existing.id === item.id))].sort((a, b) => b.memberCount - a.memberCount || a.name.localeCompare(b.name)));
    } catch { /* keep the default conversation */ }
  }, []);
  useEffect(() => { try { window.localStorage.setItem(`coreshift-conversations:${viewer.businessId}:${viewer.actorId}`, JSON.stringify(conversations)); } catch { /* storage may be unavailable */ } }, [conversations]);
  // Restore previews from the local cache without making one network request
  // per conversation. The active thread is refreshed in the background below.
  useEffect(() => {
    setConversations((current) => current.map((conversation) => {
      try {
        const cached = JSON.parse(window.localStorage.getItem(`coreshift-messages:${viewer.businessId}:${viewer.actorId}:${conversation.id}`) ?? "null") as WorkspaceMessage[] | null;
        const latest = cached?.at(-1);
        return latest ? { ...conversation, preview: messagePreview(latest, viewer.access), lastMessageAt: latest.createdAt } : conversation;
      } catch { return conversation; }
    }));
  }, []);
  async function loadRecentConversations() {
    const response = await fetch("/api/messages?list=1", { cache: "no-store" }).catch(() => null);
    const result = response ? await response.json().catch(() => null) as { recentConversations?: Array<{ id: string; senderType: "owner" | "employee"; senderId: number; senderName: string; body: string; lastMessageAt: number; unread: number | boolean; sentByViewer: boolean }>; onlinePeople?: Array<{ userType: "owner" | "employee"; userId: number; userName: string; lastSeen: number }> } | null : null;
    if (!response?.ok || !result?.recentConversations) return;
    setOnlinePeople(result.onlinePeople ?? []);
    setConversations((current) => {
      const merged = [...current];
      for (const recent of result.recentConversations ?? []) {
        const existingIndex = merged.findIndex((conversation) => conversation.id === recent.id);
        const kind = recent.id.startsWith("group-") ? "group" as const : "direct" as const;
        const employeeId = Number(recent.id.replace("direct-", ""));
        const employee = employees.find((person) => person.id === employeeId);
        const fallbackName = kind === "group" ? "Group conversation" : viewer.access === "employee" ? "Owner" : employee?.name ?? recent.senderName;
        const update = { id: recent.id, name: fallbackName, kind, memberCount: kind === "group" ? 3 : 2, unread: Boolean(recent.unread), preview: `${recent.sentByViewer ? "You" : recent.senderName}: ${recent.body}`, lastMessageAt: recent.lastMessageAt };
        if (existingIndex >= 0) merged[existingIndex] = { ...update, ...merged[existingIndex], preview: update.preview, lastMessageAt: update.lastMessageAt, unread: update.unread };
        else merged.push(update);
      }
      return merged.sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0) || a.name.localeCompare(b.name));
    });
  }
  async function loadMessages() {
    const conversationId = activeConversationRef.current;
    if (!conversationId) { setMessages([]); setLoading(false); return; }
    if (messageLoadsInFlightRef.current.has(conversationId)) return;
    messageLoadsInFlightRef.current.add(conversationId);
    if (!hydratedConversationsRef.current.has(conversationId)) {
      hydratedConversationsRef.current.add(conversationId);
      try {
        const cached = JSON.parse(window.localStorage.getItem(`coreshift-messages:${viewer.businessId}:${viewer.actorId}:${conversationId}`) ?? "null") as WorkspaceMessage[] | null;
        if (Array.isArray(cached)) { setMessages(cached); setLoading(false); }
      } catch { /* use the server copy */ }
    }
    const response = await fetch(`/api/messages?conversationId=${encodeURIComponent(conversationId)}&refresh=${Date.now()}`, { cache: "no-store" }).catch(() => null);
    const result = response ? await response.json().catch(() => null) as { enabled?: boolean; messages?: WorkspaceMessage[] } | null : null;
    if (!response?.ok) { messageLoadsInFlightRef.current.delete(conversationId); setError("Messages could not be loaded."); return; }
    if (activeConversationRef.current !== conversationId) { messageLoadsInFlightRef.current.delete(conversationId); return; }
    setEnabled(result?.enabled !== false); setMessages(result?.messages ?? []); setLoading(false);
    const latest = result?.messages?.at(-1);
    if (latest) {
      setConversations((current) => current.map((conversation) => conversation.id === conversationId ? { ...conversation, preview: messagePreview(latest, viewer.access), lastMessageAt: latest.createdAt, unread: false } : conversation));
      fetch("/api/messages", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ conversationId, throughMessageId: latest.id }) }).catch(() => undefined);
    }
    try { window.localStorage.setItem(`coreshift-messages:${viewer.businessId}:${viewer.actorId}:${conversationId}`, JSON.stringify(result?.messages ?? [])); } catch { /* storage may be unavailable */ }
    messageLoadsInFlightRef.current.delete(conversationId);
  }
  function prefetchConversation(conversationId: string) {
    if (typeof window === "undefined" || window.localStorage.getItem(`coreshift-messages:${viewer.businessId}:${viewer.actorId}:${conversationId}`)) return;
    fetch(`/api/messages?conversationId=${encodeURIComponent(conversationId)}`, { cache: "default" })
      .then((response) => response.ok ? response.json() as Promise<{ messages?: WorkspaceMessage[] }> : null)
      .then((result) => { if (result?.messages) window.localStorage.setItem(`coreshift-messages:${viewer.businessId}:${viewer.actorId}:${conversationId}`, JSON.stringify(result.messages)); })
      .catch(() => undefined);
  }
  useEffect(() => {
    const refreshVisibleMessages = () => { if (document.visibilityState === "visible") loadMessages(); };
    loadMessages();
    const timer = window.setInterval(refreshVisibleMessages, 1500);
    window.addEventListener("focus", refreshVisibleMessages);
    document.addEventListener("visibilitychange", refreshVisibleMessages);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refreshVisibleMessages); document.removeEventListener("visibilitychange", refreshVisibleMessages); };
  }, []);
  useEffect(() => { loadRecentConversations(); const timer = window.setInterval(loadRecentConversations, 3000); return () => window.clearInterval(timer); }, []);
  useEffect(() => {
    const heartbeat = () => fetch("/api/messages", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "presence" }) }).catch(() => undefined);
    const refreshWhenVisible = () => { if (document.visibilityState === "visible") heartbeat(); };
    heartbeat();
    const timer = window.setInterval(heartbeat, 20_000);
    window.addEventListener("focus", heartbeat);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", heartbeat); document.removeEventListener("visibilitychange", refreshWhenVisible); };
  }, []);
  useEffect(() => {
    const start = () => conversations.forEach((conversation) => prefetchConversation(conversation.id));
    const requestIdle = (window as Window & { requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number }).requestIdleCallback;
    const idle = requestIdle ? requestIdle(start, { timeout: 1200 }) : window.setTimeout(start, 800);
    return () => { if (typeof idle === "number") window.clearTimeout(idle); };
  }, [conversations.length]);
  useEffect(() => { if (listRef.current) listRef.current.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" }); }, [messages.length]);
  useEffect(() => { const openComposer = () => { setComposeMode("direct"); setComposeOpen(true); }; window.addEventListener("coreshift:new-message", openComposer); return () => window.removeEventListener("coreshift:new-message", openComposer); }, []);
  useEffect(() => {
    setMessages([]);
    setReplyingTo(null);
    setImageData(null);
    setImageName("");
    loadMessages();
  }, [activeConversation]);
  useEffect(() => {
    const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>(".conversation-tabs button"));
    const items = Array.from(document.querySelectorAll<HTMLElement>(".conversation-item"));
    tabs.forEach((tab) => { tab.onclick = () => { const label = tab.textContent?.toLowerCase() ?? "all"; setConversationFilter(label.startsWith("direct") ? "direct" : label.startsWith("group") ? "groups" : label.startsWith("unread") ? "unread" : "all"); }; });
    tabs.forEach((tab) => { const label = tab.textContent?.toLowerCase() ?? "all"; const selected = conversationFilter === "direct" ? label.startsWith("direct") : conversationFilter === "groups" ? label.startsWith("group") : conversationFilter === "unread" ? label.startsWith("unread") : label.startsWith("all"); tab.classList.toggle("active", selected); });
    items.forEach((item, index) => { item.style.display = visibleConversations.some((conversation) => conversation.id === conversations[index]?.id) ? "grid" : "none"; });
  }, [conversationFilter, conversations]);
  async function chooseMessagePhoto(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/") || file.size > 10 * 1024 * 1024) { setError("Choose a photo smaller than 10 MB."); return; }
    setError("");
    const objectUrl = URL.createObjectURL(file);
    try {
      const image = await new Promise<HTMLImageElement>((resolve, reject) => { const item = new Image(); item.onload = () => resolve(item); item.onerror = reject; item.src = objectUrl; });
      const limit = 1280; const scale = Math.min(1, limit / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement("canvas"); canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
      setImageData(canvas.toDataURL("image/jpeg", 0.82)); setImageName(file.name.slice(0, 120)); composerRef.current?.focus();
    } catch { setError("That photo could not be prepared. Try another image."); }
    finally { URL.revokeObjectURL(objectUrl); }
  }
  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if ((!body.trim() && !imageData) || busy) return; setBusy(true); setError("");
    const response = await fetch("/api/messages", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ body, imageData, imageName, conversationId: activeConversation, replyToId: replyingTo?.id }) }).catch(() => null);
    const result = response ? await response.json().catch(() => null) as WorkspaceMessage & { error?: string } | null : null;
    setBusy(false); if (!response?.ok) { setError(result?.error ?? "Message could not be sent."); return; }
    if (result) { setMessages((current) => { const next = [...current, result]; try { window.localStorage.setItem(`coreshift-messages:${viewer.businessId}:${viewer.actorId}:${activeConversation}`, JSON.stringify(next)); } catch { /* storage may be unavailable */ } return next; }); setConversations((current) => current.map((conversation) => conversation.id === activeConversation ? { ...conversation, preview: messagePreview(result, viewer.access), lastMessageAt: result.createdAt } : conversation)); } setBody(""); setImageData(null); setImageName(""); setReplyingTo(null);
  }
  function beginReactionHold(event: React.PointerEvent<HTMLDivElement>, messageId: number) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (reactionHoldRef.current) window.clearTimeout(reactionHoldRef.current.timer);
    const timer = window.setTimeout(() => { setReactionMessageId(messageId); reactionHoldRef.current = null; }, 480);
    reactionHoldRef.current = { timer, x: event.clientX, y: event.clientY };
  }
  function moveReactionHold(event: React.PointerEvent<HTMLDivElement>) {
    const hold = reactionHoldRef.current;
    if (!hold || Math.hypot(event.clientX - hold.x, event.clientY - hold.y) < 10) return;
    window.clearTimeout(hold.timer);
    reactionHoldRef.current = null;
  }
  function endReactionHold() {
    if (!reactionHoldRef.current) return;
    window.clearTimeout(reactionHoldRef.current.timer);
    reactionHoldRef.current = null;
  }
  function startReply(message: WorkspaceMessage) {
    setReactionMessageId(null);
    setReplyingTo(message);
    window.setTimeout(() => composerRef.current?.focus(), 0);
  }
  async function toggleReaction(messageId: number, emoji: string) {
    setReactionMessageId(null);
    const response = await fetch("/api/messages", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ messageId, emoji }) }).catch(() => null);
    const result = response ? await response.json().catch(() => null) as { active?: boolean; count?: number; error?: string } | null : null;
    if (!response?.ok || typeof result?.active !== "boolean") { setError(result?.error ?? "Reaction could not be saved."); return; }
    setMessages((current) => {
      const next = current.map((message) => {
        if (message.id !== messageId) return message;
        const reactions = [...(message.reactions ?? [])];
        const index = reactions.findIndex((reaction) => reaction.emoji === emoji);
        if (Number(result.count) < 1) { if (index >= 0) reactions.splice(index, 1); }
        else if (index >= 0) reactions[index] = { ...reactions[index], count: Number(result.count), reactedByViewer: result.active };
        else reactions.push({ emoji, count: Number(result.count), reactedByViewer: result.active });
        return { ...message, reactions };
      });
      try { window.localStorage.setItem(`coreshift-messages:${viewer.businessId}:${viewer.actorId}:${activeConversation}`, JSON.stringify(next)); } catch { /* storage may be unavailable */ }
      return next;
    });
  }
  const visibleConversations = conversations.filter((conversation) => Boolean(conversation.archived) === showArchived && (conversationFilter === "all" || (conversationFilter === "direct" && conversation.kind === "direct") || (conversationFilter === "groups" && conversation.memberCount >= 3) || (conversationFilter === "unread" && conversation.unread)));
  const active = conversations.find((conversation) => conversation.id === activeConversation && Boolean(conversation.archived) === showArchived) ?? visibleConversations[0];
  useEffect(() => {
    if (visibleConversations.length && !visibleConversations.some((conversation) => conversation.id === activeConversation)) setActiveConversation(visibleConversations[0].id);
  }, [showArchived, conversationFilter, conversations]);
  const conversationAvatar = (conversation: typeof conversations[number]) => {
    if (conversation.kind === "group") return "♧";
    const employeeId = viewer.access === "employee" ? undefined : Number(conversation.id.replace("direct-", ""));
    const employee = employeeId ? employees.find((person) => person.id === employeeId) : undefined;
    const photo = viewer.access === "employee" ? ownerPhoto : employee?.profilePhoto ?? (employeeId && typeof window !== "undefined" ? window.localStorage.getItem(`coreshift-employee-photo:${employeeId}`) : null);
    return photo ? <img className="conversation-avatar-image" src={photo} alt="" /> : viewer.access === "employee" ? avatarFor(undefined, true) : nameInitials(employee?.displayName ?? employee?.name ?? conversation.name);
  };
  const conversationPresence = (conversation?: typeof conversations[number]) => {
    if (!conversation || conversation.kind !== "direct") return undefined;
    if (viewer.access === "employee") return onlinePeople.find((person) => person.userType === "owner");
    const employeeId = Number(conversation.id.replace("direct-", ""));
    return onlinePeople.find((person) => person.userType === "employee" && person.userId === employeeId);
  };
  const isConversationOnline = (conversation?: typeof conversations[number]) => {
    const presence = conversationPresence(conversation);
    return Boolean(presence && Date.now() - presence.lastSeen < 45_000);
  };
  const conversationPresenceText = (conversation?: typeof conversations[number]) => {
    const presence = conversationPresence(conversation);
    if (!presence) return "Offline";
    if (Date.now() - presence.lastSeen < 45_000) return "Online";
    const lastSeen = new Date(presence.lastSeen);
    const elapsed = Date.now() - presence.lastSeen;
    if (elapsed < 60_000) return "Last seen just now";
    if (elapsed < 3_600_000) return `Last seen ${Math.floor(elapsed / 60_000)}m ago`;
    if (lastSeen.toDateString() === new Date().toDateString()) return `Last seen at ${lastSeen.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
    if (lastSeen.toDateString() === yesterday.toDateString()) return `Last seen yesterday at ${lastSeen.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
    return `Last seen ${lastSeen.toLocaleDateString([], { month: "short", day: "numeric" })}`;
  };
  const createConversation = (event: FormEvent) => { event.preventDefault(); const name = composeMode === "group" ? composeName.trim() : employees.find((employee) => employee.id === composeMembers[0])?.name; if (!name || (composeMode === "group" && composeMembers.length < 2)) return; const conversation = { id: composeMode === "direct" ? `direct-${composeMembers[0]}` : `group-${Date.now()}`, name, kind: composeMode, memberCount: composeMode === "group" ? composeMembers.length + 1 : 2, unread: false }; setConversations((current) => (current.some((item) => item.id === conversation.id) ? current : [...current, conversation]).sort((a, b) => b.memberCount - a.memberCount || a.name.localeCompare(b.name))); setActiveConversation(conversation.id); setMessages([]); setComposeOpen(false); setComposeName(""); setComposeMembers([]); };
  return <section className="messages-reference"><aside className="panel conversation-list"><div className="conversation-search">⌕ <input placeholder="Search messages..." /></div><div className="conversation-tabs"><button className="active" type="button">All</button><button type="button">Direct</button><button type="button">Groups</button><button type="button">Unread</button></div>{visibleConversations.map((conversation) => { const distance = swipingId === conversation.id ? gestureRef.current?.distance ?? 0 : 0; return <div className="conversation-swipe-wrap" key={conversation.id}><button className={`conversation-item ${conversation.id === activeConversation ? "active" : ""}`} style={{ transform: `translateX(${distance}px)` }} type="button" onClick={() => { if (ignoreClickRef.current) { ignoreClickRef.current = false; return; } if (!distance) { showArchived ? restoreConversation(conversation.id) : setActiveConversation(conversation.id); } }} onPointerDown={(event) => beginConversationSwipe(event, conversation.id)} onPointerMove={(event) => moveConversationSwipe(event, conversation.id)} onPointerUp={(event) => endConversationSwipe(event, conversation.id)} onPointerCancel={(event) => endConversationSwipe(event, conversation.id)} onMouseEnter={() => prefetchConversation(conversation.id)}><span className={`conversation-avatar ${isConversationOnline(conversation) ? "online" : ""}`}>{conversationAvatar(conversation)}</span><div><strong>{conversation.name}</strong><p>{conversation.preview ?? (conversation.kind === "group" ? "Group conversation" : "Direct message")}</p>{conversation.kind === "direct" && <small className="conversation-presence-label">{conversationPresenceText(conversation)}</small>}</div><time>{messageSentTime(conversation.lastMessageAt)}</time></button><span className="conversation-swipe-action">{showArchived ? "Restore" : "Archive"}</span></div>; })}<button className="conversation-archive" type="button" onClick={() => setShowArchived((value) => !value)}>▣　{showArchived ? "View active conversations" : "View archived conversations"} {showArchived ? "" : `(${conversations.filter((conversation) => conversation.archived).length})`} →</button></aside><article className="panel active-conversation"><header className="conversation-head"><div><span className={`conversation-avatar large ${isConversationOnline(active) ? "online" : ""}`}>{active ? conversationAvatar(active) : "♧"}</span><div><h3>{active?.name ?? (showArchived ? "Archived conversations" : "No conversation selected")}</h3><small>{active?.kind === "group" ? `Group conversation · ${messages.length || employees.length} members` : active ? conversationPresenceText(active) : "Swipe right on a conversation to archive it"}</small></div></div></header><div className="messages-list reference-message-list" ref={listRef}><div className="message-day-divider">Today</div>{loading && active && <div className="messages-empty">Loading messages…</div>}{!loading && active && !messages.length && <div className="messages-empty"><strong>No messages yet</strong><span>Start the conversation with your team.</span></div>}{active && messages.map((message, index) => { const previousMessage = messages[index - 1]; const grouped = Boolean(previousMessage && previousMessage.senderType === message.senderType && previousMessage.senderId === message.senderId); const readNames = [...new Set((message.readBy ?? []).map((receipt) => receipt.readerName))]; return <div className={`message-bubble ${message.sentByViewer ? "mine" : ""} ${grouped ? "grouped" : ""}`} key={message.id} onPointerDown={(event) => beginReactionHold(event, message.id)} onPointerMove={moveReactionHold} onPointerUp={endReactionHold} onPointerCancel={endReactionHold} onPointerLeave={endReactionHold} onContextMenu={(event) => { event.preventDefault(); setReactionMessageId(message.id); }} title="Press and hold for message options">{!grouped && <div><span className="message-sender-avatar">{avatarFor(message.senderType === "employee" ? message.senderId : undefined, message.senderType === "owner")}</span><strong>{message.senderName}</strong>{message.senderType === "owner" && <em>Owner</em>}</div>}{message.replyTo && <div className="message-reply-quote"><strong>Replying to {message.replyTo.senderName}</strong><span>{message.replyTo.body}</span></div>}{message.imageData && <a className="message-photo-link" href={message.imageData} target="_blank" rel="noreferrer" onPointerDown={(event) => event.stopPropagation()}><img className="message-photo" src={message.imageData} alt={message.imageName || "Shared photo"} /></a>}{message.body && <p>{message.body}</p>}<time className="message-full-date">{new Date(message.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}</time>{Boolean(message.reactions?.length) && <div className="message-reaction-row">{message.reactions?.map((reaction) => <button className={reaction.reactedByViewer ? "mine" : ""} type="button" key={reaction.emoji} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); toggleReaction(message.id, reaction.emoji); }} aria-label={`${reaction.emoji} reaction, ${reaction.count}`}>{reaction.emoji}<span>{reaction.count}</span></button>)}</div>}{reactionMessageId === message.id && <div className="message-reaction-picker" role="menu" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}><button className="message-reply-action" type="button" role="menuitem" onClick={() => startReply(message)} aria-label="Reply to message">Reply</button>{MESSAGE_REACTIONS.map((emoji) => <button type="button" role="menuitem" key={emoji} onClick={() => toggleReaction(message.id, emoji)} aria-label={`React with ${emoji}`}>{emoji}</button>)}</div>}{message.sentByViewer && <span className={`message-read-receipt ${readNames.length ? "read" : ""}`}>{readNames.length ? `✓✓ Read by ${readNames.length > 2 ? `${readNames.length} people` : readNames.join(", ")}` : "✓ Sent"}</span>}</div>; })}</div>{enabled && active && <form className="message-composer reference-composer" onSubmit={sendMessage}><div className="message-attachment-controls"><input ref={photoInputRef} className="message-photo-input" type="file" accept="image/*" onChange={chooseMessagePhoto} /><button className="message-photo-button" type="button" onClick={() => photoInputRef.current?.click()}>Photo</button></div>{replyingTo && <div className="message-composer-reply"><strong>Replying to {replyingTo.senderName}</strong><span>{replyingTo.body}</span><button type="button" onClick={() => setReplyingTo(null)} aria-label="Cancel reply">x</button></div>}{imageData && <div className="message-photo-preview"><img src={imageData} alt={imageName || "Photo ready to send"} /><button type="button" onClick={() => { setImageData(null); setImageName(""); }} aria-label="Remove photo">x</button></div>}<textarea ref={composerRef} value={body} onChange={(event) => setBody(event.target.value)} rows={2} maxLength={2000} placeholder={`Message ${active.name}...`} /><div><span>⌕ Attach　 GIF　☺</span><button className="primary-button" type="submit" disabled={busy || (!body.trim() && !imageData)}>➤ {busy ? "Sending…" : "Send"}</button></div></form>}{error && <p className="messages-error" role="alert">{error}</p>}</article>{composeOpen && <div className="modal-backdrop" role="presentation"><form className="modal-card message-compose-card" onSubmit={createConversation}><div className="modal-head"><div><p className="eyebrow">{viewer.access === "employee" ? "Message your team" : "Team messaging"}</p><h2>{composeMode === "group" ? "Create a group" : "New message"}</h2></div><div className="compose-mode-switch"><button className={composeMode === "direct" ? "active" : ""} type="button" onClick={() => setComposeMode("direct")}>Direct</button><button className={composeMode === "group" ? "active" : ""} type="button" onClick={() => setComposeMode("group")}>Group</button></div><button type="button" onClick={() => setComposeOpen(false)}>×</button></div>{composeMode === "group" && <label>Group name<input value={composeName} onChange={(event) => setComposeName(event.target.value)} placeholder="e.g. Friday closers" required /></label>}<div className="message-member-picker"><strong>{composeMode === "group" ? "Add members" : "Choose an employee"}</strong>{employees.map((employee) => <label key={employee.id}><input type={composeMode === "group" ? "checkbox" : "radio"} name="members" checked={composeMembers.includes(employee.id)} onChange={() => setComposeMembers((current) => composeMode === "group" ? current.includes(employee.id) ? current.filter((id) => id !== employee.id) : [...current, employee.id] : [employee.id])} />{employee.name}<small>{employee.role}</small></label>)}</div><div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setComposeOpen(false)}>Cancel</button><button className="primary-button" type="submit">Start conversation</button></div></form></div>}</section>;
}

function AiAssistant({ viewer }: { viewer: Viewer }) {
  const isOwner = viewer.access === "owner";
  const welcome = isOwner
    ? "I can build reports from your team’s recorded hours and payments, spot patterns, and help you use CoreShift."
    : "I can summarize your hours and payments, explain your schedule, and help you use CoreShift. I can only see your own records.";
  const [messages, setMessages] = useState<AiMessage[]>([{ role: "assistant", content: welcome }]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const suggestions = isOwner
    ? ["Build my weekly labor report", "Summarize payroll expenses", "Who may need attention?", "Compare employee hours"]
    : ["Summarize my hours this week", "When was I last paid?", "Explain my recent pay", "Help me check my schedule"];

  async function ask(event?: FormEvent<HTMLFormElement>, suggestedQuestion?: string) {
    event?.preventDefault();
    const prompt = (suggestedQuestion ?? question).trim();
    if (!prompt || busy) return;
    const history = messages.slice(-6);
    setMessages((current) => [...current, { role: "user", content: prompt }]);
    setQuestion("");
    setError("");
    setBusy(true);
    const response = await fetch("/api/ai/assistant", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: prompt, history }),
    }).catch(() => null);
    const result = response ? await response.json().catch(() => null) as { answer?: string; error?: string } | null : null;
    if (!response?.ok || !result?.answer) {
      setError(result?.error ?? "CoreShift AI could not answer right now.");
      setBusy(false);
      return;
    }
    setMessages((current) => [...current, { role: "assistant", content: result.answer! }]);
    setBusy(false);
  }

  return <section className="ai-workspace">
    <aside className="panel ai-guide">
      <div className="ai-orb">✦</div>
      <p className="eyebrow">Role-aware assistance</p>
      <h2>{isOwner ? "Your business copilot" : "Your workday copilot"}</h2>
      <p>{isOwner ? "Ask for reports, payroll summaries, team patterns, and practical next steps." : "Ask about your own time, payments, schedule, or how to use the app."}</p>
      <div className="ai-privacy-note"><span>⌾</span><div><strong>Private by role</strong><p>{isOwner ? "Uses only this business’s CoreShift records." : "Uses only your personal employee records."}</p></div></div>
      <div className="ai-suggestions">
        <strong>Try asking</strong>
        {suggestions.map((suggestion) => <button type="button" key={suggestion} onClick={() => ask(undefined, suggestion)} disabled={busy}>{suggestion}<span>→</span></button>)}
      </div>
    </aside>
    <article className="panel ai-chat">
      <header className="ai-chat-head"><div><span className="ai-status-dot" /><div><strong>CoreShift AI</strong><small>Ready to help</small></div></div><button type="button" onClick={() => { setMessages([{ role: "assistant", content: welcome }]); setError(""); }}>Clear chat</button></header>
      <div className="ai-messages" aria-live="polite">
        {messages.map((message, index) => <div className={`ai-message ${message.role}`} key={`${message.role}-${index}`}>
          {message.role === "assistant" && <span className="ai-message-avatar">✦</span>}
          <div><small>{message.role === "assistant" ? "CoreShift AI" : "You"}</small><p>{message.content}</p></div>
        </div>)}
        {busy && <div className="ai-message assistant"><span className="ai-message-avatar">✦</span><div><small>CoreShift AI</small><p className="ai-thinking"><i /><i /><i /></p></div></div>}
        {error && <p className="ai-error" role="alert">{error}</p>}
      </div>
      <form className="ai-composer" onSubmit={(event) => ask(event)}>
        <textarea value={question} onChange={(event) => setQuestion(event.target.value)} placeholder={isOwner ? "Ask for a report or business insight…" : "Ask about your hours, pay, or schedule…"} maxLength={1200} rows={3} />
        <div><span>AI can make mistakes. Verify important payroll decisions.</span><button type="submit" disabled={busy || !question.trim()}>Send <i>↑</i></button></div>
      </form>
    </article>
  </section>;
}

function AccessPending({ viewer }: { viewer: Viewer }) {
  return <main className="access-page">
    <div className="access-card">
      <span className="brand-mark access-mark"><i /><i /><i /></span>
      <p className="eyebrow">CoreShift access</p>
      <h1>Sign in to continue</h1>
      <p>Use your owner login or the employee access details provided by your business.</p>
      <a className="primary-button access-button" href="/login">Open sign in</a>
    </div>
  </main>;
}

function EmployeeHome({ employee, now, toggleClock }: { employee?: Employee; now: Date; toggleClock: (employee: Employee) => void }) {
  if (!employee) return <EmployeeLoading />;
  const working = employee.status === "clocked_in";
  const workedSinceClockIn = working && employee.clockInTimestamp ? Math.max(0, Math.floor((now.getTime() - employee.clockInTimestamp) / 60000)) : 0;
  const estimatedClockInPayCents = Math.round((workedSinceClockIn / 60) * (employee.hourlyRateCents ?? 0));
  const scheduledHours = 0;
  const workedHours = Math.round(employee.weeklyMinutes / 60 * 100) / 100;
  // The API stores the current week Monday-first; show the employee's
  // timesheet in the familiar Sunday-to-Saturday order.
  const weekMinutes = employee.dailyMinutes ?? [0, 0, 0, 0, 0, 0, 0];
  const dailyWeek = [
    ["Sun", weekMinutes[6] ?? 0], ["Mon", weekMinutes[0] ?? 0], ["Tue", weekMinutes[1] ?? 0],
    ["Wed", weekMinutes[2] ?? 0], ["Thu", weekMinutes[3] ?? 0], ["Fri", weekMinutes[4] ?? 0], ["Sat", weekMinutes[5] ?? 0],
  ] as const;
  const completion = scheduledHours > 0 ? Math.min(100, Math.round(workedHours / scheduledHours * 100)) : 0;
  const payPeriodMinutes = employee.currentPayPeriodMinutes ?? employee.weeklyMinutes;
  const payFrequency = employee.payFrequency ?? "Weekly";
  const payPeriodLabel = employee.currentPayPeriodStart != null && employee.currentPayPeriodEnd != null
    ? formatDateRange(new Date(employee.currentPayPeriodStart), new Date(employee.currentPayPeriodEnd), true)
    : "Current pay period";
  const nextPayDay = employee.nextPayDate
    ? new Date(employee.nextPayDate).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })
    : "Not set";
  return <>
    <EmployeeClockAction employee={employee} now={now} toggleClock={toggleClock} />
    <section className="employee-dashboard-grid">
      <article className="panel employee-week-card"><PanelHead title="This Week" subtitle="Current week" /><div className="employee-week-metrics"><span>Hours Scheduled<strong>{scheduledHours.toFixed(2)}</strong></span><span>Hours Worked<strong>{workedHours.toFixed(2)}</strong></span><span>Overtime<strong>0.00</strong></span></div><div className="employee-completion"><div style={{background:`conic-gradient(#5732dd ${completion}%,#e6e9f2 0)`}}><b>{completion}%</b></div><span>Hours Completed<strong>{workedHours.toFixed(2)} / {scheduledHours.toFixed(2)}</strong><Link href="/my-hours">View Timesheet →</Link></span></div></article>
      <article className="panel employee-upcoming-card"><PanelHead title="Upcoming Shifts" /><div className="employee-upcoming-list"><div className="employee-upcoming-empty">No upcoming shifts scheduled.</div></div><Link className="text-button" href="/my-schedule">View full schedule →</Link></article>
      <article className="panel employee-pay-card"><PanelHead title="Next Pay Stub" subtitle={`${payFrequency} payroll`} /><div><span>Next Pay Day<strong>{nextPayDay}</strong><small>{payPeriodLabel}</small></span><span>Estimated Gross Pay<strong className="pay-green">{moneyValue(employee.currentPayPeriodEarningsCents ?? 0)}</strong><small>{formatHours(payPeriodMinutes)} recorded in this {payFrequency.toLowerCase()} period</small><Link href="/my-hours">View Pay Stubs →</Link></span></div></article>
      <article className="panel employee-timesheet-card"><PanelHead title="My Timesheet" action={<Link className="text-button" href="/my-hours">View full timesheet →</Link>} /><strong>Current week · hours worked each day</strong><div className="employee-day-grid">{dailyWeek.map(([day, minutes]) => <div key={day} className={minutes ? "has-hours" : ""}><span>{day}</span><b>{minutes ? formatHours(minutes) : "–"}</b><small>hrs</small></div>)}</div><div className="employee-total-row"><span>Total Hours <b>{formatHours(employee.weeklyMinutes)}</b></span><span>Regular Hours <b>{formatHours(employee.weeklyMinutes)}</b></span><span>Overtime <b>0.00</b></span></div></article>
      <aside className="employee-right-stack"><article className="panel employee-clock-card"><PanelHead title="Time Clock" /><p>You're currently</p><h3>{working ? "Clocked In" : "Clocked Out"}</h3><small>{working ? `Working for ${formatHours(workedSinceClockIn)} · ${moneyValue(estimatedClockInPayCents)} estimated` : "Recorded times will appear here."}</small><Link className="text-button" href="/my-hours">♧　View time details</Link></article><article className="panel employee-simple-card"><PanelHead title="Requests" action={<Link className="text-button" href="/requests">View all (2) →</Link>} /><p>◷　Time Off Request <em>Pending</em></p><p>♧　Schedule Swap <em className="approved">Approved</em></p></article><article className="panel employee-simple-card"><PanelHead title="Announcements" action={<button className="text-button" type="button">View all →</button>} /><strong>Team Meeting</strong><p>We'll be having a quick team meeting to discuss new summer drinks and updates!</p></article></aside>
      <article className="panel employee-availability-card"><PanelHead title="Availability" action={<Link className="text-button" href="/profile">Edit Availability →</Link>} /><div className="employee-availability-grid">{["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((day) => <div key={day}><span>{day}</span><small>Not set</small></div>)}</div></article>
    </section>
  </>;
}

function EmployeeClockAction({ employee, now, toggleClock }: { employee?: Employee; now: Date; toggleClock: (employee: Employee) => void }) {
  if (!employee) return <section className="employee-clock-banner" aria-live="polite" aria-busy="true"><button className="primary-button employee-clock-banner-button" type="button" disabled>◷　Clock in</button><div className="employee-clock-banner-copy"><p className="eyebrow">Time clock</p><h2>Ready to clock in?</h2><p>Loading your time clock…</p></div></section>;
  const working = employee.status === "clocked_in";
  const workedSinceClockIn = working && employee.clockInTimestamp ? Math.max(0, Math.floor((now.getTime() - employee.clockInTimestamp) / 60000)) : 0;
  const estimatedPayCents = Math.round((workedSinceClockIn / 60) * (employee.hourlyRateCents ?? 0));
  return <section className={`employee-clock-banner ${working ? "is-working" : ""}`} aria-live="polite">
    <button className="primary-button employee-clock-banner-button" type="button" onClick={() => toggleClock(employee)}>◷　{working ? "Clock out" : "Clock in"}</button>
    <div className="employee-clock-banner-copy"><p className="eyebrow">Time clock</p><h2>{working ? "You're currently working" : "Ready to clock in?"}</h2><p>{working ? `Started at ${employee.clockIn ?? "now"}` : "Start your shift to track hours and estimated pay."}</p></div>
    {working && <div className="employee-clock-live"><span>Working for<strong>{formatHours(workedSinceClockIn)}</strong></span><span>Estimated pay<strong>{moneyValue(estimatedPayCents)}</strong></span></div>}
  </section>;
}

function EmployeeTopClockButton({ employee, toggleClock }: { employee?: Employee; toggleClock: (employee: Employee) => void }) {
  if (!employee) return <button className="employee-top-clock" type="button" disabled aria-label="Loading time clock">◷ <span>Clock in</span></button>;
  const working = employee.status === "clocked_in";
  return <button className={`employee-top-clock ${working ? "is-working" : ""}`} type="button" onClick={() => toggleClock(employee)} aria-label={working ? "Clock out" : "Clock in"}>◷ <span>{working ? "Clock out" : "Clock in"}</span></button>;
}

function MyHours({ employee }: { employee?: Employee }) {
  if (!employee) return <EmployeeLoading />;
  const weekMinutes = employee.dailyMinutes ?? [0, 0, 0, 0, 0, 0, 0];
  const dailyWeek = [
    ["Sun", weekMinutes[6] ?? 0], ["Mon", weekMinutes[0] ?? 0], ["Tue", weekMinutes[1] ?? 0],
    ["Wed", weekMinutes[2] ?? 0], ["Thu", weekMinutes[3] ?? 0], ["Fri", weekMinutes[4] ?? 0], ["Sat", weekMinutes[5] ?? 0],
  ] as const;
  return <>
    <section className="employee-stats">
      <Stat icon="◷" theme="green" label="Recorded" value={formatHours(employee.weeklyMinutes)} note="This week" />
      <Stat icon="▦" theme="blue" label="Scheduled" value="0h 00m" note="0 scheduled shifts" />
      <Stat icon="✓" theme="violet" label="Entries" value="0" note="Nothing recorded yet" />
    </section>
    <article className="panel table-panel personal-table">
      <PanelHead title="Daily entries" subtitle="Only your time records are shown" />
      <div className="employee-day-grid personal-day-grid">{dailyWeek.map(([day, minutes]) => <div key={day} className={minutes ? "has-hours" : ""}><span>{day}</span><b>{minutes ? formatHours(minutes) : "–"}</b><small>hours worked</small></div>)}</div>
      <div className="data-table">
        <div className="table-row personal-row table-header"><span>Date</span><span>Clock in</span><span>Clock out</span><span>Break</span><span>Total</span></div>
        <EmptyState title="No time entries" message="Your clock-ins and clock-outs will appear here." />
      </div>
      <div className="personal-total"><span>Week total</span><strong>{formatHours(employee.weeklyMinutes)}</strong></div>
    </article>
  </>;
}

function MySchedule({ employee }: { employee?: Employee }) {
  const [scheduleView, setScheduleView] = useState<ScheduleView>("week");
  const [weekOffset, setWeekOffset] = useState(0);
  const [publishedShifts, setPublishedShifts] = useState<PublishedShift[]>([]);
  const [workedEntries, setWorkedEntries] = useState<Array<{ id: number; employeeId: number; employeeName: string; clockIn: number; clockOut: number | null }>>([]);
  const [loading, setLoading] = useState(true);
  const { payments, days } = usePaymentSchedule(scheduleView, weekOffset);
  useEffect(() => {
    const start = dateKey(days[0]);
    const end = dateKey(addDays(days[days.length - 1], 1));
    setLoading(true);
    fetch(`/api/schedule/published?start=${start}&end=${end}`)
      .then((response) => response.ok ? response.json() as Promise<PublishedShift[]> : Promise.reject())
      .then(setPublishedShifts)
      .catch(() => setPublishedShifts([]))
      .finally(() => setLoading(false));
  }, [days]);
  useEffect(() => {
    const rangeStart = days[0].getTime();
    const rangeEnd = addDays(days[days.length - 1], 1).getTime() - 1;
    fetch(`/api/schedule/worked?start=${rangeStart}&end=${rangeEnd}`, { cache: "no-store" })
      .then((response) => response.ok ? response.json() as Promise<{ entries?: Array<{ id: number; employeeId: number; employeeName: string; clockIn: number; clockOut: number | null }> }> : Promise.reject())
      .then((payload) => setWorkedEntries(payload.entries ?? []))
      .catch(() => setWorkedEntries([]));
  }, [days]);
  if (!employee) return <EmployeeLoading />;
  return <>
    <div className="schedule-toolbar employee-schedule-toolbar">
      <div className="schedule-toolbar-left">
        <button type="button" className="date-button" onClick={() => setWeekOffset((value) => value - 1)} aria-label={`Previous ${scheduleView}`}>←</button>
        <button type="button" className="secondary-button" onClick={() => setWeekOffset(0)}>{weekOffset === 0 ? (scheduleView === "month" ? "This month" : "This week") : (scheduleView === "month" ? days[0].toLocaleDateString([], { month: "long", year: "numeric" }) : days[0].toLocaleDateString([], { month: "short", day: "numeric" }))}</button>
        <button type="button" className="date-button" onClick={() => setWeekOffset((value) => value + 1)} aria-label={`Next ${scheduleView}`}>→</button>
        <div className="schedule-view-switch" role="tablist" aria-label="My schedule view">
          {(["week", "month"] as const).map((option) => <button type="button" role="tab" aria-selected={scheduleView === option} className={scheduleView === option ? "active" : ""} onClick={() => { setScheduleView(option); setWeekOffset(0); }} key={option}>{option === "week" ? "Week" : "Month"}</button>)}
        </div>
      </div>
    </div>
    <section className="personal-schedule">
      {days.map((date) => {
        const dayKey = dateKey(date);
        const dayShifts = publishedShifts.filter((shift) => shift.date === dayKey);
        const dayPayments = payments.filter((payment) => dateKey(new Date(payment.paidAt)) === dateKey(date));
        const dayWorked = workedEntries.filter((entry) => entry.employeeId === employee.id && dateKey(new Date(entry.clockIn)) === dayKey).map((entry) => {
          const clockIn = new Date(entry.clockIn);
          const clockOut = new Date(entry.clockOut ?? Date.now());
          const startMinutes = clockIn.getHours() * 60 + clockIn.getMinutes();
          const endMinutes = dateKey(clockOut) === dayKey ? clockOut.getHours() * 60 + clockOut.getMinutes() : 24 * 60;
          return { ...entry, startMinutes, endMinutes: Math.max(startMinutes + 1, endMinutes), active: entry.clockOut == null };
        }).filter((entry) => !dayShifts.some((shift) => entry.endMinutes > shift.startMinutes && entry.startMinutes < shift.endMinutes));
        const workedMinutes = dayWorked.reduce((sum, entry) => sum + entry.endMinutes - entry.startMinutes, 0);
        return <article className={`personal-shift ${dayShifts.length ? "scheduled-shift" : dayWorked.length ? "worked-unscheduled" : dayPayments.length ? "payment-day" : "off"}`} key={dayKey}>
          <div className="shift-date"><span>{date.toLocaleDateString([], { weekday: "short" })}</span><strong>{date.getDate()}</strong></div>
          <div>{loading ? <><strong>Loading schedule…</strong><p>Checking published shifts</p></> : dayShifts.length
            ? <><strong>{dayShifts.map((shift) => `${minutesToDisplayTime(shift.startMinutes)} – ${minutesToDisplayTime(shift.endMinutes)}`).join(" · ")}</strong><p>{dayShifts.map((shift) => shift.note || shift.employeeName || shift.role || "Scheduled shift").join(" · ")}</p>{dayPayments.length > 0 && <span>Payment received: {dayPayments.map((payment) => moneyValue(payment.amountCents)).join(" · ")}</span>}</>
            : dayWorked.length
              ? <><strong>{dayWorked.map((entry) => `${minutesToDisplayTime(entry.startMinutes)} - ${entry.active ? "Now" : minutesToDisplayTime(entry.endMinutes)}`).join(" · ")}</strong><p>Worked, unscheduled</p><span>{dayWorked.some((entry) => entry.active) ? `Currently clocked in · ${formatHours(workedMinutes)} so far` : `${formatHours(workedMinutes)} recorded`}</span></>
            : dayPayments.length
              ? <><strong>Payment received</strong><p>{dayPayments.map((payment) => moneyValue(payment.amountCents)).join(" · ")}</p><span>{dayPayments.map((payment) => payment.note).filter(Boolean).join(" · ") || "Recorded by your owner"}</span></>
              : <><strong>No shift or payment entered</strong><p>0 hours scheduled</p></>}</div>
          {dayShifts.length > 0 && dayWorked.length > 0 && <div className="employee-unscheduled-note"><strong>Worked, unscheduled</strong><span>{dayWorked.map((entry) => `${minutesToDisplayTime(entry.startMinutes)}-${entry.active ? "Now" : minutesToDisplayTime(entry.endMinutes)}`).join(" · ")}</span></div>}
          <i className="shift-state">{dayWorked.length ? `Worked ${formatHours(workedMinutes)}` : dayShifts.length ? formatHours(dayShifts.reduce((sum, shift) => sum + shiftMinutes(shift), 0)) : dayPayments.length ? "Paid" : "0h"}</i>
        </article>;
      })}
    </section>
  </>;
}

function Profile({ employee, viewer, logOut, flash }: { employee?: Employee; viewer: Viewer; logOut: () => Promise<void>; flash: (message: string) => void }) {
  if (!employee) return <EmployeeLoading />;
  return <ProfileEditor employee={employee} viewer={viewer} logOut={logOut} flash={flash} />;
}

function ProfileEditor({ employee, viewer, logOut, flash }: { employee: Employee; viewer: Viewer; logOut: () => Promise<void>; flash: (message: string) => void }) {
  const [saving, setSaving] = useState(false);
  const [profilePhoto, setProfilePhoto] = useState<string | null>(null);
  const [form, setForm] = useState({
    email: employee.email ?? viewer.email,
    displayName: employee.displayName ?? employee.name,
    phone: employee.phone ?? "",
    availability: employee.availability ?? "",
    desiredHours: String(employee.desiredHours ?? 0),
    address: employee.address ?? "",
  });
  const [fontSize, setFontSize] = useState<AppFontSize>("large");
  const [timeZone, setTimeZone] = useState("America/Chicago");
  const [notifications, setNotifications] = useState({ schedule: true, reminders: true, messages: true, payments: true });
  useEffect(() => {
    try {
      const localPhoto = window.localStorage.getItem(`coreshift-employee-photo:${employee.id}`);
      setProfilePhoto(employee.profilePhoto ?? localPhoto);
      if (!employee.profilePhoto && localPhoto?.startsWith("data:image/")) {
        void fetch(`/api/employees/${employee.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ profilePhoto: localPhoto }) });
      }
    } catch { setProfilePhoto(employee.profilePhoto ?? null); }
    const savedFont = window.localStorage.getItem("coreshift-font-size") as AppFontSize | null;
    const savedZone = window.localStorage.getItem("coreshift-time-zone");
    const savedNotifications = window.localStorage.getItem("coreshift-employee-notifications");
    if (savedFont && ["standard", "large", "larger", "largest"].includes(savedFont)) setFontSize(savedFont);
    if (savedZone) setTimeZone(savedZone);
    if (savedNotifications) {
      try { setNotifications((current) => ({ ...current, ...JSON.parse(savedNotifications) })); } catch { /* ignore stale preference data */ }
    }
    applyAppFontSize(savedFont ?? "large");
  }, [employee.id]);
  function chooseProfilePhoto(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { flash("Choose an image file."); return; }
    if (file.size > 2 * 1024 * 1024) { flash("That image is too large. Choose one under 2 MB."); return; }
    const reader = new FileReader();
    reader.onload = async () => {
      const source = String(reader.result);
      const image = new Image();
      image.onload = async () => {
        const size = Math.min(640, Math.max(image.width, image.height));
        const scale = size / Math.max(image.width, image.height, 1);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
        const value = canvas.toDataURL("image/jpeg", 0.82);
        setProfilePhoto(value);
        try { window.localStorage.setItem(`coreshift-employee-photo:${employee.id}`, value); } catch { /* storage may be unavailable */ }
        const response = await fetch(`/api/employees/${employee.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ profilePhoto: value }) }).catch(() => null);
        flash(response?.ok ? "Profile photo updated." : "Photo saved on this device, but could not sync to the company profile.");
      };
      image.onerror = () => flash("That image could not be read.");
      image.src = source;
    };
    reader.readAsDataURL(file);
    event.currentTarget.value = "";
  }
  function updateEmployeePreferences(next: Partial<typeof notifications>) {
    const updated = { ...notifications, ...next };
    setNotifications(updated);
    window.localStorage.setItem("coreshift-employee-notifications", JSON.stringify(updated));
  }
  function updateEmployeeFontSize(value: AppFontSize) {
    setFontSize(value);
    window.localStorage.setItem("coreshift-font-size", value);
    applyAppFontSize(value);
    window.setTimeout(() => applyAppFontSize(value), 0);
  }
  function updateEmployeeTimeZone(value: string) {
    setTimeZone(value);
    window.localStorage.setItem("coreshift-time-zone", value);
    flash("Time zone updated.");
  }
  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    const response = await fetch(`/api/employees/${employee.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...form, desiredHours: Number(form.desiredHours) }),
    }).catch(() => null);
    const result = response ? await response.json().catch(() => null) as { error?: string } | null : null;
    setSaving(false);
    if (!response?.ok) { flash(result?.error ?? "Profile could not be saved."); return; }
    flash("Profile updated.");
    window.location.reload();
  }
  const totalShifts = employee.totalShifts ?? 0;
  const averageShiftMinutes = totalShifts ? Math.round((employee.totalMinutes ?? 0) / totalShifts) : 0;
  const memberSince = employee.createdAt
    ? new Date(employee.createdAt).toLocaleDateString("en-US", { month: "long", year: "numeric" })
    : "Recently joined";
  const earnings = ((employee.currentPayPeriodEarningsCents ?? 0) / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
  return <section className="profile-layout">
    <article className="panel profile-hero-card">
      <div className={`avatar ${employee.color} profile-avatar profile-photo-preview`}>{profilePhoto ? <img src={profilePhoto} alt={`${employee.name} profile`} /> : nameInitials(employee.displayName ?? employee.name)}<label className="profile-photo-upload" title="Upload profile photo"><span>＋</span><input type="file" accept="image/*" capture="user" onChange={chooseProfilePhoto} /></label></div>
      <div className="profile-identity">
        <span className="profile-kicker">Employee profile</span>
        <h2>{employee.displayName ?? employee.name}</h2>
        <p>{employee.role || "Employee"}</p>
      </div>
      <div className="profile-meta">
        <span className={`profile-shift-status ${employee.status === "clocked_in" ? "on-shift" : ""}`}>
          {employee.status === "clocked_in" ? "🟢 On Shift" : "⚪ Off Shift"}
        </span>
        <span className="profile-member-since">Member since <strong>{memberSince}</strong></span>
      </div>
    </article>
    <article className="panel profile-stats-card">
      <PanelHead title="Personal stats" subtitle="A snapshot of your work activity" />
      <div className="profile-stats-grid">
        <div className="profile-stat"><span>Hours this week</span><strong>{formatHours(employee.weeklyMinutes)}</strong><small>Current 7 days</small></div>
        <div className="profile-stat"><span>Hours this month</span><strong>{formatHours(employee.monthMinutes ?? 0)}</strong><small>Since the 1st</small></div>
        <div className="profile-stat"><span>Total shifts</span><strong>{totalShifts}</strong><small>Completed shifts</small></div>
        <div className="profile-stat"><span>Average shift length</span><strong>{formatHours(averageShiftMinutes)}</strong><small>Completed shifts</small></div>
        <div className="profile-stat profile-stat-earnings"><span>Current pay period earnings</span><strong>{earnings}</strong><small>Estimated from recorded hours</small></div>
      </div>
    </article>
    <article className="panel profile-details"><PanelHead title="Personal details" subtitle={`Your ${viewer.businessName} employee account`} /><form className="profile-edit-form" onSubmit={saveProfile}><div className="profile-photo-mobile-field"><span>Profile photo</span><label className="secondary-button">{profilePhoto ? "Change photo" : "Upload photo"}<input type="file" accept="image/*" capture="user" onChange={chooseProfilePhoto} /></label><small>Choose a photo from your phone or take a new one. JPG, PNG, or GIF up to 2 MB.</small></div><label>Email address<input type="email" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} required /></label><label>Displayed name<input value={form.displayName} onChange={(event) => setForm((current) => ({ ...current, displayName: event.target.value }))} required /></label><label>Phone number<input type="tel" value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} placeholder="(555) 123-4567" /></label><label>Desired hours per week<input type="number" min="0" max="168" step="1" value={form.desiredHours} onChange={(event) => setForm((current) => ({ ...current, desiredHours: event.target.value }))} /></label><label className="profile-edit-wide">Availability<textarea rows={3} value={form.availability} onChange={(event) => setForm((current) => ({ ...current, availability: event.target.value }))} placeholder="Example: Monday–Friday, 9 AM–5 PM" /></label><label className="profile-edit-wide">Address<textarea rows={2} value={form.address} onChange={(event) => setForm((current) => ({ ...current, address: event.target.value }))} placeholder="Street, city, state, ZIP" /></label><div className="profile-edit-actions"><button className="primary-button" type="submit" disabled={saving}>{saving ? "Saving…" : "Save profile"}</button><button className="secondary-button signout-button" type="button" onClick={logOut}>Log out</button></div></form></article>
    <article className="panel profile-preferences"><PanelHead title="Your preferences" subtitle="Personal settings for this employee account" /><div className="profile-preference-grid"><label><span>Text size</span><select value={fontSize} onChange={(event) => updateEmployeeFontSize(event.target.value as AppFontSize)}><option value="standard">Standard</option><option value="large">Large</option><option value="larger">Very large</option><option value="largest">Extra large</option></select></label><label><span>Time zone</span><select value={timeZone} onChange={(event) => updateEmployeeTimeZone(event.target.value)}><option value="America/Chicago">Central Time</option><option value="America/New_York">Eastern Time</option><option value="America/Denver">Mountain Time</option><option value="America/Los_Angeles">Pacific Time</option></select></label></div><div className="profile-notification-options"><strong>Notifications</strong><label><input type="checkbox" checked={notifications.payments} onChange={(event) => updateEmployeePreferences({ payments: event.target.checked })} /> Payments received</label><label><input type="checkbox" checked={notifications.schedule} onChange={(event) => updateEmployeePreferences({ schedule: event.target.checked })} /> Schedule changes</label><label><input type="checkbox" checked={notifications.reminders} onChange={(event) => updateEmployeePreferences({ reminders: event.target.checked })} /> Clock reminders</label><label><input type="checkbox" checked={notifications.messages} onChange={(event) => updateEmployeePreferences({ messages: event.target.checked })} /> Team messages</label></div></article>
    <article className="panel profile-schedule-card"><PanelHead title="My schedule" subtitle="Your published shifts and payments" /><MySchedule employee={employee} /></article>
  </section>;
}

function EmployeeLoading() {
  return <div className="panel employee-loading" role="status"><span className="brand-mark"><i /><i /><i /></span><strong>Loading your workspace…</strong></div>;
}

function PayOvertimeSettingsPage({ flash, onNavigate }: { flash: (message: string) => void; onNavigate: (target: "general" | "time" | "access" | "owners" | "notifications" | "billing" | "scheduling" | "pay") => void }) {
  const [payPeriod, setPayPeriod] = useState("Weekly (Sunday - Saturday)");
  const [payDay, setPayDay] = useState("Friday");
  const [frequency, setFrequency] = useState("Weekly");
  const [rounding, setRounding] = useState("15 minutes (0.25)");
  const [rule, setRule] = useState("Time and a half (1.5x)");
  const [threshold, setThreshold] = useState("40");
  const [dailyThreshold, setDailyThreshold] = useState("8");
  const [dailyOvertime, setDailyOvertime] = useState(true);
  const [doubleTime, setDoubleTime] = useState(false);
  const [approval, setApproval] = useState(true);
  const [notify, setNotify] = useState(true);
  const [differentRates, setDifferentRates] = useState(true);
  const [individualRates, setIndividualRates] = useState(true);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const persistPaySettings = async (updates: Record<string, string | boolean>) => {
    setSaveStatus("saving");
    const response = await fetch("/api/settings/pay", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ settings: updates }),
    }).catch(() => null);
    const payload = response ? await response.json().catch(() => null) as { settings?: Record<string, unknown>; error?: string } | null : null;
    if (!response?.ok || !payload?.settings) {
      setSaveStatus("error");
      flash(payload?.error ?? "Pay settings could not be saved.");
      return false;
    }
    try { localStorage.setItem("coreshift-pay-overtime", JSON.stringify(payload.settings)); } catch {}
    setSaveStatus("saved");
    return true;
  };
  const saved = saveStatus === "saved";
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const root = document.querySelector('.pay-settings-page');
      const tabs = root?.querySelectorAll('.pay-settings-tabs button');
      if (!root || !tabs?.length || root.querySelector('.company-pay-panel')) return;
      const cards = Array.from(root.querySelectorAll('.pay-settings-card, .pay-info-banner')) as HTMLElement[];
      const readCompanySettings = () => {
        try {
          const raw = JSON.parse(localStorage.getItem('coreshift-pay-overtime') || '{}');
          if (raw.frequency) {
            const selectedFrequency = String(raw.frequency);
            setFrequency(selectedFrequency);
            const periodLabels: Record<string, string> = {
              Weekly: 'Weekly (Sunday - Saturday)',
              Biweekly: 'Biweekly (Sunday - Saturday)',
              'Semi-monthly': 'Semi-monthly',
              Monthly: 'Monthly',
            };
            // Prefer the exact saved pay-period label. Falling back to a
            // frequency-only value used to reset Biweekly/Monthly to the
            // first option after navigating between settings tabs.
            setPayPeriod(String(raw.payPeriod || periodLabels[selectedFrequency] || selectedFrequency));
          }
          if (raw.payDay) setPayDay(String(raw.payDay));
          if (raw.threshold !== undefined) setThreshold(String(raw.threshold));
          if (raw.dailyThreshold !== undefined) setDailyThreshold(String(raw.dailyThreshold));
        } catch {}
      };
      const overtimeCard = cards.find((card) => card.textContent?.includes('Overtime Settings'));
      if (overtimeCard && !overtimeCard.querySelector('[data-company-overtime-toggle]')) {
        const grid = overtimeCard.querySelector('.pay-settings-grid');
        if (grid) {
          const wrap = document.createElement('label');
          wrap.className = 'pay-toggle company-overtime-toggle';
          wrap.innerHTML = '<input type="checkbox" data-company-overtime-toggle checked/><span class="pay-switch"></span><span><strong>Overtime enabled</strong><small>Turn off to stop overtime from being calculated.</small></span>';
          grid.prepend(wrap);
          const master = wrap.querySelector('input') as HTMLInputElement | null;
          const syncOvertimeFields = () => {
            const enabled = !!master?.checked;
            wrap.classList.toggle('overtime-master-on', enabled);
            overtimeCard.querySelectorAll('input,select').forEach((control) => {
              if (control !== master) (control as HTMLInputElement | HTMLSelectElement).disabled = !enabled;
            });
          };
          try { const saved = JSON.parse(localStorage.getItem('coreshift-pay-overtime') || '{}'); if (saved.overtimeEnabled !== undefined && master) master.checked = saved.overtimeEnabled !== false; } catch {}
          syncOvertimeFields();
          master?.addEventListener('change', (event) => {
            void persistPaySettings({ overtimeEnabled: (event.target as HTMLInputElement).checked });
            syncOvertimeFields();
          });
        }
      }
      const panel = document.createElement('div');
      panel.className = 'company-pay-panel';
      panel.innerHTML = `<div class="company-pay-main"><section class="company-pay-card"><h2>▣　Company Pay Settings</h2><div class="company-pay-fields"><label>Default Pay Frequency<select data-company="frequency"><option>Weekly</option><option>Biweekly</option><option>Semi-monthly</option><option>Monthly</option></select></label><label>Pay Period Starts<select data-company="starts"><option>Sunday</option><option>Monday</option><option>Saturday</option></select></label><label>Pay Day<select data-company="day"><option>Friday</option><option>Thursday</option><option>Wednesday</option></select></label><label>Default Currency<select><option>USD ($)</option><option>CAD ($)</option><option>EUR (€)</option></select></label><label>Time Zone<select><option>Central Time (CT)</option><option>Eastern Time (ET)</option><option>Mountain Time (MT)</option><option>Pacific Time (PT)</option></select></label></div></section><section class="company-pay-card"><h2>◷　Overtime Rules</h2><div class="company-overtime-grid"><div><strong>Weekly Overtime</strong><input data-company="weekly" type="number" value="40" min="0"/><small>hours / week</small></div><div><strong>Daily Overtime</strong><input data-company="daily" type="number" value="8" min="0"/><small>hours / day</small></div><div><strong>Double Time</strong><input data-company="double" type="number" value="12" min="0"/><small>hours / day</small></div></div><label class="company-check"><input type="checkbox" data-company="disable"/> Disable overtime entirely</label></section><section class="company-pay-card"><h2>♙　Employee Eligibility</h2><div class="company-radio"><label><input type="radio" name="company-eligibility" checked/> Hourly employees</label><label><input type="radio" name="company-eligibility"/> Salary employees</label><label><input type="radio" name="company-eligibility"/> Both hourly and salary employees</label><label><input type="radio" name="company-eligibility"/> Custom (select roles)</label></div></section><section class="company-pay-card"><h2>✦　Premium Pay</h2><div class="company-overtime-grid"><label>Holiday Pay<select><option>2x</option><option>1.5x</option><option>None</option></select></label><label>Weekend Premium<select><option>None</option><option>1.5x</option></select></label><label>Night Shift Differential<input value="$2.00 / hr"/></label></div></section></div><aside class="company-pay-side"><section class="company-live-card"><h2>Live Example <span>Live</span></h2><p>See how these settings affect pay.</p><hr/><b>Regular Pay</b><strong>$600.00</strong><b>Overtime (1.5x)</b><strong>$78.75</strong><hr/><h3>Gross Pay <strong>$678.75</strong></h3></section><section class="company-summary-card"><h2>Summary</h2><p>Pay Frequency <b>Weekly</b></p><p>Pay Day <b>Friday</b></p><p>Overtime (Weekly) <b>40 hrs at 1.5x</b></p><p>Overtime (Daily) <b>8 hrs at 1.5x</b></p></section></aside>`;
      const syncPanelFromReact = () => {
        let values: Record<string, string> = { frequency, payDay, threshold, dailyThreshold };
        try {
          const stored = JSON.parse(localStorage.getItem('coreshift-pay-overtime') || '{}');
          values = { ...values, ...Object.fromEntries(Object.entries(stored).map(([key, value]) => [key, String(value)])) };
        } catch {}
        panel.querySelectorAll('input,select').forEach((control) => {
          const label = control.closest('label')?.textContent?.trim().toLowerCase() || '';
          const legacyKey = control.getAttribute('data-company');
          const key = control.getAttribute('name') === 'company-eligibility' ? 'eligibility'
            : legacyKey === 'starts' ? 'payPeriodStarts'
            : legacyKey === 'day' ? 'payDay'
            : legacyKey === 'weekly' ? 'threshold'
            : legacyKey === 'daily' ? 'dailyThreshold'
            : legacyKey === 'double' ? 'doubleTimeThreshold'
            : legacyKey === 'disable' ? 'overtimeDisabled'
            : legacyKey || (label.includes('default currency') ? 'currency'
            : label.includes('time zone') ? 'timeZone'
            : label.includes('holiday pay') ? 'holidayPay'
            : label.includes('weekend premium') ? 'weekendPremium'
            : label.includes('night shift differential') ? 'nightShiftDifferential' : '');
          if (!key || values[key] === undefined) return;
          const eligibilityValue = label.startsWith('hourly') ? 'hourly' : label.startsWith('salary') ? 'salary' : label.startsWith('both') ? 'both' : label.startsWith('custom') ? 'custom' : '';
          if ((control as HTMLInputElement).type === 'checkbox') (control as HTMLInputElement).checked = values[key] === 'true';
          else if ((control as HTMLInputElement).type === 'radio') (control as HTMLInputElement).checked = values[key] === eligibilityValue;
          else (control as HTMLInputElement | HTMLSelectElement).value = values[key];
        });
      };
      const showCompany = () => { readCompanySettings(); syncPanelFromReact(); cards.forEach((card) => card.style.display = 'none'); panel.style.display = 'grid'; root.insertBefore(panel, root.querySelector('.pay-settings-card')); tabs.forEach((tab) => tab.classList.remove('active')); tabs[0].classList.add('active'); };
      const showPay = () => { readCompanySettings(); panel.style.display = 'none'; cards.forEach((card) => card.style.display = ''); tabs.forEach((tab) => tab.classList.remove('active')); tabs[1]?.classList.add('active'); };
      tabs[0].addEventListener('click', showCompany); tabs[1]?.addEventListener('click', showPay);
      tabs[0].style.pointerEvents = 'auto'; tabs[0].style.position = 'relative'; tabs[0].style.zIndex = '3';
      const delegatedCompanyClick = (event: Event) => { const target = event.target as HTMLElement | null; const tab = target?.closest('.pay-settings-tabs button'); if (tab === tabs[0]) showCompany(); };
      document.addEventListener('click', delegatedCompanyClick);
      panel.querySelectorAll('input,select').forEach((control) => {
        const label = control.closest('label')?.textContent?.trim().toLowerCase() || '';
        const legacyKey = control.getAttribute('data-company');
        const key = control.getAttribute('name') === 'company-eligibility' ? 'eligibility'
          : legacyKey === 'starts' ? 'payPeriodStarts'
          : legacyKey === 'day' ? 'payDay'
          : legacyKey === 'weekly' ? 'threshold'
          : legacyKey === 'daily' ? 'dailyThreshold'
          : legacyKey === 'double' ? 'doubleTimeThreshold'
          : legacyKey === 'disable' ? 'overtimeDisabled'
          : legacyKey || (label.includes('default currency') ? 'currency'
          : label.includes('time zone') ? 'timeZone'
          : label.includes('holiday pay') ? 'holidayPay'
          : label.includes('weekend premium') ? 'weekendPremium'
          : label.includes('night shift differential') ? 'nightShiftDifferential' : '');
        if (!key) return;
        const eligibilityValue = label.startsWith('hourly') ? 'hourly' : label.startsWith('salary') ? 'salary' : label.startsWith('both') ? 'both' : label.startsWith('custom') ? 'custom' : '';
        try {
          const saved = JSON.parse(localStorage.getItem('coreshift-pay-overtime') || '{}');
          if (saved[key] !== undefined) {
            if ((control as HTMLInputElement).type === 'checkbox') (control as HTMLInputElement).checked = saved[key] === true;
            else if ((control as HTMLInputElement).type === 'radio') (control as HTMLInputElement).checked = saved[key] === eligibilityValue;
            else (control as HTMLInputElement).value = String(saved[key]);
          }
        } catch {}
        control.addEventListener('change', () => {
          if ((control as HTMLInputElement).type === 'radio' && !(control as HTMLInputElement).checked) return;
          const value = (control as HTMLInputElement).type === 'checkbox' ? (control as HTMLInputElement).checked : (control as HTMLInputElement).type === 'radio' ? eligibilityValue : (control as HTMLInputElement).value;
          void persistPaySettings({ [key]: value });
        });
      });
      (root as HTMLElement & { _companyCleanup?: () => void })._companyCleanup = () => { tabs[0].removeEventListener('click', showCompany); tabs[1]?.removeEventListener('click', showPay); document.removeEventListener('click', delegatedCompanyClick); panel.remove(); };
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => {
    const root = document.querySelector('.pay-settings-page');
    if (!root) return;
    const saveControl = (event: Event) => {
      const target = event.target as HTMLInputElement | HTMLSelectElement | null;
      if (!target) return;
      const isOvertimeGroup = target.name === 'overtime-applies';
      const isApprovalMode = target.classList.contains('pay-approval-select');
      if (!isOvertimeGroup && !isApprovalMode) return;
      if (isOvertimeGroup && !(target as HTMLInputElement).checked) return;
      const radios = Array.from(root.querySelectorAll<HTMLInputElement>('input[name="overtime-applies"]'));
      const overtimeValue = ['all', 'nonExempt', 'custom'][radios.indexOf(target as HTMLInputElement)] || 'all';
      void persistPaySettings({ [isOvertimeGroup ? 'overtimeApplies' : 'approvalMode']: isOvertimeGroup ? overtimeValue : target.value });
    };
    root.addEventListener('change', saveControl);
    return () => root.removeEventListener('change', saveControl);
  }, []);
  useEffect(() => {
    const setters = ({ payPeriod, payDay, frequency, rounding, rule, threshold, dailyThreshold, dailyOvertime, doubleTime, approval, notify, differentRates, individualRates } as Record<string, React.Dispatch<React.SetStateAction<any>>>);
    const apply = (raw: Record<string, unknown>) => Object.entries(raw).forEach(([key, value]) => { const setter = setters[key]; if (setter && value !== undefined) setter(value); });
    const applyUncontrolled = (raw: Record<string, unknown>) => {
      const root = document.querySelector('.pay-settings-page');
      const radios = Array.from(root?.querySelectorAll<HTMLInputElement>('input[name="overtime-applies"]') || []);
      const overtimeIndex = ['all', 'nonExempt', 'custom'].indexOf(String(raw.overtimeApplies || 'all'));
      radios.forEach((radio, index) => { radio.checked = index === Math.max(0, overtimeIndex); });
      const approvalSelect = root?.querySelector<HTMLSelectElement>('.pay-approval-select');
      if (approvalSelect && raw.approvalMode) approvalSelect.value = String(raw.approvalMode);
    };
    let localSettings: Record<string, unknown> = {};
    try { localSettings = JSON.parse(localStorage.getItem("coreshift-pay-overtime") || "{}"); } catch {}
    fetch("/api/settings/pay", { cache: "no-store" }).then((response) => response.ok ? response.json() as Promise<{ settings?: Record<string, unknown> }> : Promise.reject()).then((payload) => { if (payload.settings) { apply(payload.settings); applyUncontrolled(payload.settings); try { localStorage.setItem("coreshift-pay-overtime", JSON.stringify(payload.settings)); } catch {} } }).catch(() => { apply(localSettings); applyUncontrolled(localSettings); });
  }, []);
  const field = <T,>(key: string, value: T, setter: React.Dispatch<React.SetStateAction<T>>) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => { const next = (event.target.type === "checkbox" ? (event.target as HTMLInputElement).checked : event.target.value) as T; setter(next); if (key === "frequency") { const periodLabels: Record<string, string> = { Weekly: "Weekly (Sunday - Saturday)", Biweekly: "Biweekly (Sunday - Saturday)", "Semi-monthly": "Semi-monthly", Monthly: "Monthly" }; const nextPeriod = periodLabels[String(next)] || String(next); setPayPeriod(nextPeriod); void persistPaySettings({ frequency: String(next), payPeriod: nextPeriod }); return; } void persistPaySettings({ [key]: next as string | boolean }); };
  const nav = [["▥", "Organization", "general"], ["▣", "Billing & Subscription", "billing"], ["⌖", "Locations", "general"], ["♙", "Roles & Permissions", "access"], ["◷", "Time & Attendance", "time"], ["▦", "Scheduling", "scheduling"], ["$", "Pay & Overtime", "pay"], ["♧", "Notifications", "notifications"], ["✣", "Integrations", "general"], ["♙", "Account", "owners"], ["▣", "Security", "access"]] as const;
  const Toggle = ({ label, description, value, onChange }: { label: string; description: string; value: boolean; onChange: (event: React.ChangeEvent<HTMLInputElement>) => void }) => <label className="pay-toggle"><input type="checkbox" checked={value} onChange={onChange} /><span className="pay-switch" /><span><strong>{label}</strong><small>{description}</small></span></label>;
  return <div className="settings-reference"><aside className="settings-reference-nav"><div className="settings-ref-nav-list">{nav.map(([icon, title, target]) => <button type="button" className={target === "pay" ? "active" : ""} key={title} onClick={() => onNavigate(target)}><span>{icon}</span><div><strong>{title}</strong><small>{title === "Pay & Overtime" ? "Pay rates and overtime rules" : "Settings and preferences"}</small></div></button>)}</div><div className="settings-ref-promo"><strong>Pay your team with confidence</strong><p>Keep rates, pay periods, and overtime rules in one place.</p><button type="button" onClick={() => flash("Payroll help opened.")}>Learn more</button></div></aside><main className="settings-reference-main pay-settings-page"><header className="pay-settings-header"><div><h1>Pay &amp; Overtime</h1><p>Manage pay rates, overtime rules, and related settings for your team.</p></div><button className="secondary-button" type="button" onClick={() => flash("Pay settings export is ready.")}>⇩ Export Settings</button></header><div className="pay-settings-tabs"><button className="active" type="button">Company</button><button className="active" type="button">Pay &amp; Overtime</button><button type="button" onClick={() => onNavigate("billing")}>Payroll</button><button type="button" onClick={() => onNavigate("time")}>Time &amp; Attendance</button><button type="button" onClick={() => onNavigate("general")}>Integrations</button></div><section className="pay-settings-card"><h2>Pay Settings</h2><div className="pay-settings-grid"><label>Default Pay Period<select value={payPeriod} onChange={field("payPeriod", payPeriod, setPayPeriod)}><option>Weekly (Sunday - Saturday)</option><option>Biweekly (Sunday - Saturday)</option><option>Semi-monthly</option><option>Monthly</option></select></label><label>Rounding<select value={rounding} onChange={field("rounding", rounding, setRounding)}><option>Exact time</option><option>5 minutes (0.08)</option><option>15 minutes (0.25)</option><option>30 minutes (0.5)</option></select></label><label>Pay Day<select value={payDay} onChange={field("payDay", payDay, setPayDay)}>{["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"].map(day => <option key={day}>{day}</option>)}</select></label><Toggle label="Allow different rates by role / position" description="Enable custom pay rates for different roles." value={differentRates} onChange={field("differentRates", differentRates, setDifferentRates)} /><label>Pay Frequency<select value={frequency} onChange={field("frequency", frequency, setFrequency)}><option>Weekly</option><option>Biweekly</option><option>Semi-monthly</option><option>Monthly</option></select></label><Toggle label="Allow individual pay rate overrides" description="Managers can set custom rates per employee." value={individualRates} onChange={field("individualRates", individualRates, setIndividualRates)} /></div><div className="pay-rate-table"><h3>Pay Rates</h3><div className="pay-rate-head"><span>Role / Position</span><span>Type</span><span>Rate</span><span>Actions</span></div>{[["Barista","Hourly","$15.00 / hr"],["Shift Lead","Hourly","$16.50 / hr"],["Cashier","Hourly","$14.00 / hr"],["Manager","Salary","$52,000 / yr"]].map(([role, type, rate]) => <div className="pay-rate-row" key={role}><strong>{role}</strong><span>{type}</span><span>{rate}</span><span>✎　▢</span></div>)}<button type="button" className="pay-add-rate" onClick={() => flash("Add pay rate opened.")}>＋ Add Pay Rate</button></div></section><section className="pay-settings-card"><h2>Overtime Settings</h2><div className="pay-settings-grid"><label>Overtime Rule<select value={rule} onChange={field("rule", rule, setRule)}><option>Time and a half (1.5x)</option><option>Double time (2x)</option><option>Custom multiplier</option></select></label><label>Overtime Threshold<div className="pay-input-suffix"><input value={threshold} onChange={field("threshold", threshold, setThreshold)} /><span>hours / week</span></div></label><Toggle label="Daily Overtime" description="Enable daily overtime after a set number of hours." value={dailyOvertime} onChange={field("dailyOvertime", dailyOvertime, setDailyOvertime)} /><label>Daily Threshold<div className="pay-input-suffix"><input value={dailyThreshold} onChange={field("dailyThreshold", dailyThreshold, setDailyThreshold)} /><span>hours / day</span></div></label><Toggle label="Double Time" description="Enable double time after the daily overtime threshold." value={doubleTime} onChange={field("doubleTime", doubleTime, setDoubleTime)} /><div className="pay-note">ⓘ Double time will be applied after the daily overtime threshold.</div><fieldset><legend>Overtime Applies To</legend><label><input type="radio" name="overtime-applies" defaultChecked /> All employees</label><label><input type="radio" name="overtime-applies" /> Non-exempt employees only</label><label><input type="radio" name="overtime-applies" /> Custom</label></fieldset><div><Toggle label="Overtime Approval" description="Require approval for overtime hours." value={approval} onChange={field("approval", approval, setApproval)} /><select className="pay-approval-select" defaultValue="Manager approval required"><option>Manager approval required</option><option>Owner approval required</option><option>No approval required</option></select><label className="pay-check"><input type="checkbox" checked={notify} onChange={field("notify", notify, setNotify)} /> Notify when overtime is worked</label></div></div></section><div className="pay-info-banner"><div><strong>Need to make advanced payroll changes?</strong><p>Visit Payroll Settings to manage taxes, deductions, and other payroll preferences.</p></div><button type="button" onClick={() => onNavigate("billing")}>Go to Payroll Settings　→</button></div>{saved && <span className="pay-auto-save">Saved</span>}</main></div>;
}

type SettingsSection = "general" | "time" | "access" | "owners" | "notifications" | "billing" | "scheduling" | "pay" | "locations" | "integrations" | "security";
type WorkspaceLocation = { id: string; name: string; address: string; timeZone: string; geofenceMeters: number; active: boolean; primary: boolean };
type IntegrationState = { status: "not_connected" | "setup_requested"; syncEmployees: boolean; syncTime: boolean };
type SecurityState = { loginAlerts: boolean; requireTwoFactor: boolean; rememberDevices: boolean; restrictUnknownDevices: boolean; sessionTimeoutMinutes: number };

const settingsNavItems: [SettingsSection, string, string, string][] = [
  ["general", "Organization", "Company profile and details", "OR"], ["billing", "Billing & Subscription", "Manage your plan and billing", "BI"],
  ["locations", "Locations", "Manage your locations", "LO"], ["access", "Roles & Permissions", "Control access and permissions", "RO"],
  ["time", "Time & Attendance", "Rules and time tracking", "TI"], ["scheduling", "Scheduling", "Scheduling preferences", "SC"],
  ["pay", "Pay & Overtime", "Pay rates and overtime rules", "PA"], ["notifications", "Notifications", "Notification preferences", "NO"],
  ["integrations", "Integrations", "Connected apps and services", "IN"], ["owners", "Account", "Your account settings", "AC"],
  ["security", "Security", "Password and security", "SE"],
];

function SettingsSectionNav({ active, onNavigate }: { active: SettingsSection; onNavigate: (section: SettingsSection) => void }) {
  return <aside className="settings-reference-nav"><div className="settings-ref-nav-list">{settingsNavItems.map(([key, title, description, icon]) => <button type="button" className={active === key ? "active" : ""} key={key} onClick={() => onNavigate(key)}><span>{icon}</span><div><strong>{title}</strong><small>{description}</small></div></button>)}</div><div className="settings-ref-promo"><strong>Workspace controls</strong><p>Keep company operations organized and secure.</p><button type="button" onClick={() => onNavigate("security")}>Review security</button></div></aside>;
}

async function saveWorkspaceSettings(update: Record<string, unknown>) {
  const response = await fetch("/api/settings/workspace", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(update) });
  const payload = await response.json().catch(() => null) as { settings?: Record<string, unknown>; error?: string } | null;
  if (!response.ok || !payload?.settings) throw new Error(payload?.error || "Settings could not be saved.");
  return payload.settings;
}

function LocationsSettingsPage({ flash, onNavigate }: { flash: (message: string) => void; onNavigate: (section: SettingsSection) => void }) {
  const emptyDraft = { name: "", address: "", timeZone: "America/Chicago", geofenceMeters: "150" };
  const [locations, setLocations] = useState<WorkspaceLocation[]>([]);
  const [draft, setDraft] = useState(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  useEffect(() => { fetch("/api/settings/workspace", { cache: "no-store" }).then((response) => response.ok ? response.json() as Promise<{ settings: { locations: WorkspaceLocation[] } }> : Promise.reject()).then((payload) => setLocations(payload.settings.locations || [])).catch(() => flash("Locations could not be loaded.")).finally(() => setLoading(false)); }, []);
  const persist = async (next: WorkspaceLocation[], message: string) => { const previous = locations; setLocations(next); setSaving(true); try { await saveWorkspaceSettings({ locations: next }); flash(message); } catch (error) { setLocations(previous); flash(error instanceof Error ? error.message : "Locations could not be saved."); } finally { setSaving(false); } };
  const openEditor = (location?: WorkspaceLocation) => { if (location) { setEditingId(location.id); setDraft({ name: location.name, address: location.address, timeZone: location.timeZone, geofenceMeters: String(location.geofenceMeters) }); } else { setEditingId(null); setDraft(emptyDraft); } setShowForm(true); };
  const submit = (event: React.FormEvent) => { event.preventDefault(); const name = draft.name.trim(); const address = draft.address.trim(); if (!name || !address) { flash("Enter a location name and address."); return; } const updated: WorkspaceLocation = { id: editingId || `location-${Date.now()}`, name, address, timeZone: draft.timeZone, geofenceMeters: Math.max(25, Number(draft.geofenceMeters) || 150), active: editingId ? locations.find((item) => item.id === editingId)?.active !== false : true, primary: editingId ? locations.find((item) => item.id === editingId)?.primary === true : locations.length === 0 }; const next = editingId ? locations.map((item) => item.id === editingId ? updated : item) : [...locations, updated]; setShowForm(false); void persist(next, editingId ? "Location updated." : "Location added."); };
  return <div className="settings-reference settings-feature-page"><SettingsSectionNav active="locations" onNavigate={onNavigate} /><main className="settings-reference-main"><header className="settings-feature-head"><div><p className="eyebrow">WORKPLACES</p><h1>Locations</h1><p>Manage where employees work, clock in, and appear on schedules.</p></div><button className="primary-button" type="button" onClick={() => openEditor()}>+ Add location</button></header><section className="settings-feature-summary"><article><strong>{locations.length}</strong><span>Total locations</span></article><article><strong>{locations.filter((item) => item.active).length}</strong><span>Active</span></article><article><strong>{locations.find((item) => item.primary)?.name || "Not set"}</strong><span>Primary location</span></article></section><section className="settings-location-list">{loading && <div className="settings-feature-empty">Loading locations...</div>}{!loading && !locations.length && <div className="settings-feature-empty"><strong>No locations yet</strong><span>Add the first place where your team works.</span></div>}{locations.map((location) => <article className="settings-location-card" key={location.id}><span className="settings-location-pin">LO</span><div><h3>{location.name}{location.primary && <em>Primary</em>}{!location.active && <em className="inactive">Inactive</em>}</h3><p>{location.address}</p><small>{location.timeZone} | {location.geofenceMeters} m clock-in radius</small></div><div className="settings-location-actions"><button type="button" onClick={() => openEditor(location)}>Edit</button>{!location.primary && <button type="button" onClick={() => void persist(locations.map((item) => ({ ...item, primary: item.id === location.id })), `${location.name} is now the primary location.`)}>Make primary</button>}<button type="button" onClick={() => void persist(locations.map((item) => item.id === location.id ? { ...item, active: !item.active } : item), location.active ? "Location deactivated." : "Location activated.")}>{location.active ? "Deactivate" : "Activate"}</button>{!location.primary && <button className="danger-link" type="button" onClick={() => void persist(locations.filter((item) => item.id !== location.id), "Location removed.")}>Remove</button>}</div></article>)}</section>{saving && <span className="settings-save-state">Saving...</span>}</main>{showForm && <div className="modal-backdrop"><form className="modal-card settings-location-modal" onSubmit={submit}><div className="modal-head"><div><p className="eyebrow">LOCATION</p><h2>{editingId ? "Edit location" : "Add location"}</h2></div><button type="button" aria-label="Close" onClick={() => setShowForm(false)}>x</button></div><div className="modal-body settings-location-form"><label>Location name<input autoFocus value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Downtown store" /></label><label>Street address<input value={draft.address} onChange={(event) => setDraft({ ...draft, address: event.target.value })} placeholder="123 Main Street, City, State" /></label><label>Time zone<select value={draft.timeZone} onChange={(event) => setDraft({ ...draft, timeZone: event.target.value })}><option value="America/Chicago">Central Time</option><option value="America/New_York">Eastern Time</option><option value="America/Denver">Mountain Time</option><option value="America/Los_Angeles">Pacific Time</option></select></label><label>Clock-in radius (meters)<input type="number" min="25" value={draft.geofenceMeters} onChange={(event) => setDraft({ ...draft, geofenceMeters: event.target.value })} /></label><div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setShowForm(false)}>Cancel</button><button className="primary-button" type="submit">Save location</button></div></div></form></div>}</div>;
}

function IntegrationsSettingsPage({ flash, onNavigate }: { flash: (message: string) => void; onNavigate: (section: SettingsSection) => void }) {
  const defaults: Record<string, IntegrationState> = { quickbooks: { status: "not_connected", syncEmployees: false, syncTime: false }, gusto: { status: "not_connected", syncEmployees: false, syncTime: false }, googleCalendar: { status: "not_connected", syncEmployees: false, syncTime: false }, slack: { status: "not_connected", syncEmployees: false, syncTime: false } };
  const providers = [{ id: "quickbooks", badge: "QB", name: "QuickBooks Online", description: "Prepare approved hours for accounting and payroll." }, { id: "gusto", badge: "GU", name: "Gusto", description: "Prepare employee and time data for payroll." }, { id: "googleCalendar", badge: "GC", name: "Google Calendar", description: "Keep published schedules alongside calendar events." }, { id: "slack", badge: "SL", name: "Slack", description: "Plan schedule and attendance notifications for channels." }];
  const [integrations, setIntegrations] = useState(defaults);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  useEffect(() => { fetch("/api/settings/workspace", { cache: "no-store" }).then((response) => response.ok ? response.json() as Promise<{ settings: { integrations: Record<string, IntegrationState> } }> : Promise.reject()).then((payload) => setIntegrations({ ...defaults, ...(payload.settings.integrations || {}) })).catch(() => flash("Integrations could not be loaded.")).finally(() => setLoading(false)); }, []);
  const update = async (id: string, next: IntegrationState, message: string) => { const previous = integrations; const updated = { ...integrations, [id]: next }; setIntegrations(updated); setSavingId(id); try { await saveWorkspaceSettings({ integrations: updated }); flash(message); } catch (error) { setIntegrations(previous); flash(error instanceof Error ? error.message : "Integration settings could not be saved."); } finally { setSavingId(null); } };
  return <div className="settings-reference settings-feature-page"><SettingsSectionNav active="integrations" onNavigate={onNavigate} /><main className="settings-reference-main"><header className="settings-feature-head"><div><p className="eyebrow">CONNECTED TOOLS</p><h1>Integrations</h1><p>Prepare the services CoreShift can exchange data with. Provider authorization is completed separately.</p></div></header><div className="settings-integration-note"><strong>Connections stay honest</strong><span>Requesting setup does not mark a provider connected. OAuth credentials and provider approval are still required.</span></div><section className="settings-integration-grid">{providers.map((provider) => { const state = integrations[provider.id] || defaults[provider.id]; const requested = state.status === "setup_requested"; return <article className="settings-integration-card" key={provider.id}><div className="integration-card-head"><span>{provider.badge}</span><div><h3>{provider.name}</h3><em className={requested ? "requested" : ""}>{requested ? "Setup requested" : "Not connected"}</em></div></div><p>{provider.description}</p><label><input type="checkbox" checked={state.syncEmployees} disabled={!requested} onChange={(event) => void update(provider.id, { ...state, syncEmployees: event.target.checked }, "Employee sync preference saved.")} /> Prepare employee data</label><label><input type="checkbox" checked={state.syncTime} disabled={!requested} onChange={(event) => void update(provider.id, { ...state, syncTime: event.target.checked }, "Time sync preference saved.")} /> Prepare approved time</label><button className={requested ? "secondary-button" : "primary-button"} type="button" disabled={loading || savingId === provider.id} onClick={() => void update(provider.id, { ...state, status: requested ? "not_connected" : "setup_requested" }, requested ? "Integration setup request canceled." : "Integration setup request saved.")}>{savingId === provider.id ? "Saving..." : requested ? "Cancel request" : "Request setup"}</button></article>; })}</section></main></div>;
}

type LiveIntegrationStatus = { id: string; configured: boolean; missing: string[]; connected: boolean; accountName: string | null; accountId: string | null; connectedAt: number | null; callbackUrl: string };

function LiveIntegrationsSettingsPage({ flash, onNavigate }: { flash: (message: string) => void; onNavigate: (section: SettingsSection) => void }) {
  const providers = [{ id: "quickbooks", badge: "QB", name: "QuickBooks Online", description: "Authorize a QuickBooks company and verify accounting API access." }, { id: "gusto", badge: "GU", name: "Gusto", description: "Authorize an approved Gusto Embedded Payroll company." }, { id: "googleCalendar", badge: "GC", name: "Google Calendar", description: "Authorize Calendar event access for published schedules." }, { id: "slack", badge: "SL", name: "Slack", description: "Authorize a Slack workspace for schedule and attendance messages." }];
  const [statuses, setStatuses] = useState<Record<string, LiveIntegrationStatus>>({});
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<string | null>(null);
  const load = () => fetch("/api/integrations/status", { cache: "no-store" }).then((response) => response.ok ? response.json() as Promise<{ providers: LiveIntegrationStatus[] }> : Promise.reject()).then((payload) => setStatuses(Object.fromEntries(payload.providers.map((item) => [item.id, item])))).catch(() => flash("Integration status could not be loaded.")).finally(() => setLoading(false));
  useEffect(() => { void load(); }, []);
  const connect = async (id: string) => { setWorking(id); const response = await fetch(`/api/integrations/${id}/connect`, { cache: "no-store" }).catch(() => null); const payload = response ? await response.json().catch(() => null) as { authorizationUrl?: string; error?: string; missing?: string[] } | null : null; if (!response?.ok || !payload?.authorizationUrl) { flash(payload?.missing?.length ? `Add these private environment variables: ${payload.missing.join(", ")}` : payload?.error || "The provider connection could not start."); setWorking(null); return; } window.location.assign(payload.authorizationUrl); };
  const disconnect = async (id: string) => { setWorking(id); const response = await fetch(`/api/integrations/${id}/disconnect`, { method: "DELETE" }).catch(() => null); if (!response?.ok) flash("The integration could not be disconnected."); else { flash("Integration disconnected."); await load(); } setWorking(null); };
  const test = async (id: string) => { setWorking(id); const response = await fetch(`/api/integrations/${id}/test`, { method: "POST" }).catch(() => null); const payload = response ? await response.json().catch(() => null) as { error?: string; accountName?: string } | null : null; flash(response?.ok ? `${payload?.accountName || "Provider"} connection verified.` : payload?.error || "Connection test failed."); setWorking(null); };
  const gustoFlow = async (flowType: "company_onboarding" | "employee_management" | "run_payroll" | "payroll_history") => { setWorking("gusto"); await openGustoFlow(flowType, flash); setWorking(null); };
  return <div className="settings-reference settings-feature-page"><SettingsSectionNav active="integrations" onNavigate={onNavigate} /><main className="settings-reference-main"><header className="settings-feature-head"><div><p className="eyebrow">LIVE CONNECTIONS</p><h1>Integrations</h1><p>Authorize providers securely, verify access, and disconnect accounts from one place.</p></div></header><div className="settings-integration-note"><strong>Secure OAuth</strong><span>Provider passwords never pass through CoreShift. Access and refresh tokens are encrypted before storage and isolated by business.</span></div><section className="settings-integration-grid">{providers.map((provider) => { const status = statuses[provider.id]; const connected = status?.connected; const configured = status?.configured; return <article className="settings-integration-card live" key={provider.id}><div className="integration-card-head"><span>{provider.badge}</span><div><h3>{provider.name}</h3><em className={connected ? "connected" : configured ? "ready" : ""}>{loading ? "Checking" : connected ? "Connected" : configured ? "Ready to connect" : "Configuration needed"}</em></div></div><p>{provider.description}</p>{connected ? <div className="integration-account"><strong>{status.accountName || provider.name}</strong><span>Connected {status.connectedAt ? new Date(status.connectedAt).toLocaleDateString() : "recently"}</span></div> : <div className="integration-requirements"><strong>{configured ? "Provider app is configured" : "Private credentials required"}</strong><span>{configured ? "Continue to the provider consent screen." : status?.missing?.join(", ") || "Loading configuration..."}</span>{status?.callbackUrl && <small>Callback: {status.callbackUrl}</small>}</div>}<div className="integration-live-actions">{connected ? provider.id === "gusto" ? <><button className="primary-button" type="button" disabled={working === provider.id} onClick={() => void gustoFlow("company_onboarding")}>{working === provider.id ? "Opening..." : "Company setup"}</button><button className="secondary-button" type="button" disabled={working === provider.id} onClick={() => void gustoFlow("employee_management")}>Employees</button><button className="secondary-button" type="button" disabled={working === provider.id} onClick={() => void gustoFlow("run_payroll")}>Run payroll</button><button className="text-button" type="button" disabled={working === provider.id} onClick={() => void gustoFlow("payroll_history")}>History</button><button className="text-button" type="button" disabled={working === provider.id} onClick={() => void test(provider.id)}>Test</button><button className="text-button" type="button" disabled={working === provider.id} onClick={() => void disconnect(provider.id)}>Disconnect</button></> : <><button className="primary-button" type="button" disabled={working === provider.id} onClick={() => void test(provider.id)}>{working === provider.id ? "Checking..." : "Test connection"}</button><button className="secondary-button" type="button" disabled={working === provider.id} onClick={() => void disconnect(provider.id)}>Disconnect</button></> : <button className="primary-button" type="button" disabled={loading || working === provider.id} onClick={() => void connect(provider.id)}>{working === provider.id ? "Opening..." : configured ? `Connect ${provider.name}` : "Show required setup"}</button>}</div></article>; })}</section><section className="panel integration-launch-note"><h2>Provider setup</h2><p>Gusto Flows securely handle company onboarding, bank verification, tax setup, employees, payroll review, direct deposits, and payroll history. Demo mode never moves real money; production requires Gusto approval.</p></section></main></div>;
}

function SecuritySettingsPage({ flash, onNavigate }: { flash: (message: string) => void; onNavigate: (section: SettingsSection) => void }) {
  const defaults: SecurityState = { loginAlerts: true, requireTwoFactor: false, rememberDevices: true, restrictUnknownDevices: false, sessionTimeoutMinutes: 60 };
  const [security, setSecurity] = useState(defaults);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  useEffect(() => { fetch("/api/settings/workspace", { cache: "no-store" }).then((response) => response.ok ? response.json() as Promise<{ settings: { security: SecurityState } }> : Promise.reject()).then((payload) => setSecurity({ ...defaults, ...(payload.settings.security || {}) })).catch(() => flash("Security settings could not be loaded.")).finally(() => setLoading(false)); }, []);
  const update = async (changes: Partial<SecurityState>, message: string) => { const previous = security; const next = { ...security, ...changes }; setSecurity(next); setSaving(true); try { await saveWorkspaceSettings({ security: next }); flash(message); } catch (error) { setSecurity(previous); flash(error instanceof Error ? error.message : "Security settings could not be saved."); } finally { setSaving(false); } };
  const toggle = (key: keyof SecurityState, title: string, description: string) => <label className="settings-security-control"><div><strong>{title}</strong><span>{description}</span></div><input type="checkbox" checked={Boolean(security[key])} disabled={loading} onChange={(event) => void update({ [key]: event.target.checked }, `${title} ${event.target.checked ? "enabled" : "disabled"}.`)} /><i /></label>;
  return <div className="settings-reference settings-feature-page"><SettingsSectionNav active="security" onNavigate={onNavigate} /><main className="settings-reference-main"><header className="settings-feature-head"><div><p className="eyebrow">ACCOUNT PROTECTION</p><h1>Security</h1><p>Control sign-in policies, trusted devices, and owner alerts for this business.</p></div><span className="security-health">Good standing</span></header><section className="security-overview"><article><span>01</span><div><strong>Business data isolation</strong><p>Settings are stored separately for this business account.</p></div><em>Active</em></article><article><span>02</span><div><strong>Owner-only changes</strong><p>Only an owner can update workspace security policies.</p></div><em>Active</em></article><article><span>03</span><div><strong>Two-step verification</strong><p>Require an additional verification step for owner and manager access.</p></div><em className={security.requireTwoFactor ? "active" : "attention"}>{security.requireTwoFactor ? "Required" : "Optional"}</em></article></section><section className="panel security-policy-card"><div className="settings-feature-section-head"><div><h2>Sign-in policies</h2><p>Changes save automatically for this workspace.</p></div>{saving && <span>Saving...</span>}</div>{toggle("loginAlerts", "Login alerts", "Notify owners when a new device signs in.")}{toggle("requireTwoFactor", "Require two-step verification", "Set the workspace policy for owners and managers.")}{toggle("rememberDevices", "Allow remembered devices", "Let approved devices reduce repeated sign-in prompts.")}{toggle("restrictUnknownDevices", "Review unknown devices", "Flag new devices for owner review before they are trusted.")}<div className="security-session-row"><div><strong>Automatic sign-out</strong><span>End inactive owner sessions after this amount of time.</span></div><select value={security.sessionTimeoutMinutes} disabled={loading} onChange={(event) => void update({ sessionTimeoutMinutes: Number(event.target.value) }, "Session timeout updated.")}><option value={15}>15 minutes</option><option value={30}>30 minutes</option><option value={60}>1 hour</option><option value={240}>4 hours</option><option value={480}>8 hours</option></select></div></section><section className="panel security-actions-card"><div><h2>Security actions</h2><p>Use these tools when access to the business changes.</p></div><button type="button" onClick={() => flash("Active session review opened.")}>Review active sessions<span>View</span></button><button type="button" onClick={() => flash("Security activity report is ready.")}>Download security activity<span>Export</span></button><button type="button" onClick={() => flash("Owner access is managed from Account settings.")}>Manage owner access<span>Open Account</span></button></section></main></div>;
}

function Settings({ flash, businessName, ownerName, ownerEmail }: { flash: (message: string) => void; businessName: string; ownerName: string; ownerEmail: string }) {
  const [rounding, setRounding] = useState("Exact time");
  const [timeFormat, setTimeFormat] = useState<"24" | "12">("24");
  const [fontSize, setFontSize] = useState<AppFontSize>("large");
  const [section, setSection] = useState<SettingsSection>("general");
  const [editingSetting, setEditingSetting] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [organizationDraft, setOrganizationDraft] = useState({ name: businessName || "Main Street Café", address: "123 Main Street\nLeague City, TX 77573", email: "hello@mainstreetcafe.com", timeZone: "Central Time (CT)", industry: "Food & Beverage", companySize: "Team workspace", weekStarts: "Sunday" });
  useEffect(() => { const params = new URLSearchParams(window.location.search); if (params.get("section") === "integrations") setSection("integrations"); const connected = params.get("integration_connected"); const error = params.get("integration_error"); if (connected) flash(`${connected} connected successfully.`); if (error) flash(error); if (connected || error) window.history.replaceState({}, "", window.location.pathname); }, []);
  useEffect(() => {
    if (editingSetting !== "organization-info") return;
    const timer = window.setTimeout(() => {
      const select = Array.from(document.querySelectorAll(".organization-edit-modal select")).find((node) => node.parentElement?.textContent?.toLowerCase().includes("week starts")) as HTMLSelectElement | undefined;
      if (!select) return;
      const value = select.value;
      select.innerHTML = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((day) => `<option>${day}</option>`).join("");
      select.value = value || "Sunday";
    }, 0);
    return () => window.clearTimeout(timer);
  }, [editingSetting]);
  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem("coreshift-organization") || "null") as Partial<typeof organizationDraft> | null;
      if (saved) setOrganizationDraft((current) => ({ ...current, ...saved }));
    } catch { /* use defaults when storage is unavailable */ }
  }, []);
  useEffect(() => {
    if (typeof window !== "undefined") {
      if (window.localStorage.getItem("coreshift-time-format") === "12") setTimeFormat("12");
      const saved = window.localStorage.getItem("coreshift-font-size") as AppFontSize | null;
      if (saved && ["standard", "large", "larger", "largest"].includes(saved)) { setFontSize(saved); applyAppFontSize(saved); }
    }
  }, []);
  function updateTimeFormat(value: "24" | "12") {
    setTimeFormat(value);
    if (typeof window !== "undefined") window.localStorage.setItem("coreshift-time-format", value);
    flash(value === "12" ? "12-hour time enabled." : "24-hour time enabled.");
  }
  function updateFontSize(value: AppFontSize) {
    setFontSize(value);
    if (typeof window !== "undefined") window.localStorage.setItem("coreshift-font-size", value);
    applyAppFontSize(value);
    window.setTimeout(() => applyAppFontSize(value), 0);
    flash(value === "standard" ? "Standard text size enabled." : "Larger text enabled across the workspace.");
  }
  const navigate = (target: SettingsSection) => setSection(target);
  const settingsFlash = (message: string) => { const match = message.match(/^(Organization|Billing & Subscription|Locations|Departments|Roles & Permissions|Time & Attendance|Scheduling|Pay & Overtime|Notifications|Integrations|Account|Security) settings opened\.$/); const routes: Record<string, SettingsSection> = { Organization: "general", "Billing & Subscription": "billing", Locations: "locations", Departments: "general", "Roles & Permissions": "access", "Time & Attendance": "time", Scheduling: "scheduling", "Pay & Overtime": "pay", Notifications: "notifications", Integrations: "integrations", Account: "owners", Security: "security" }; if (match) setSection(routes[match[1]]); flash(message); };
  useEffect(() => {
    const handleSettingsButton = (event: MouseEvent) => {
      const button = (event.target as HTMLElement | null)?.closest("button");
      if (!button || !button.closest(".settings-reference")) return;
      const label = button.textContent?.trim().toLowerCase() ?? "";
      if (label.includes("edit organization info")) { setEditingSetting("organization-info"); return; }
      // Pay & Overtime must always have its own settings route.  Keep this
      // exact-match guard ahead of the broader `time` check because labels
      // from nested controls can otherwise be interpreted as Time & Attendance.
      if (label.includes("pay & overtime")) {
        // Some legacy panels still invoke their own navigation callback. Queue
        // the final state update so it runs after that callback and cannot be
        // overwritten by the old target.
        window.setTimeout(() => setSection("pay"), 0);
        if (/^pay\s*&\s*overtime(?:\s*[›→])?$/.test(label)) return;
      }
      const route: SettingsSection | null = label.includes("billing") ? "billing" : label.includes("notification") ? "notifications" : label.includes("pay") ? "pay" : label.includes("schedule") ? "scheduling" : label.includes("time") || label.includes("attendance") ? "time" : label.includes("security") ? "security" : label.includes("role") || label.includes("permission") ? "access" : label.includes("account") ? "owners" : label.includes("location") ? "locations" : label.includes("integration") ? "integrations" : label.includes("organization") ? "general" : null;
      if (button.closest(".settings-reference-nav")) {
        if (route) setSection(route);
        return;
      }
      if (button.closest(".roles-list")) return;
      if (route) setSection(route);
      // Only secondary edit controls should open the generic editor. Save buttons
      // submit their own forms and must never be intercepted by this listener.
      const editable = /edit|manage|update|add new|upgrade|downgrade|pause|cancel|change plan/.test(label) && !label.includes("view") && !label.startsWith("save");
      if (editable && typeof window !== "undefined") {
        const key = `coreshift-setting-${label.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
        setEditingSetting(key);
        setEditingValue(window.localStorage.getItem(key) ?? "");
      }
    };
    document.addEventListener("click", handleSettingsButton);
    return () => document.removeEventListener("click", handleSettingsButton);
  }, []);
  let settingsPage: ReactNode;
  if (section === "billing") settingsPage = <BillingPage flash={settingsFlash} onNavigate={navigate} />;
  else if (section === "access") settingsPage = <RolesDataVisibilityV8 flash={settingsFlash} onNavigate={navigate} />;
  else if (section === "time") settingsPage = <TimeAttendancePolished flash={settingsFlash} onNavigate={navigate} />;
  else if (section === "scheduling") settingsPage = <SchedulingSettingsFixed flash={settingsFlash} onNavigate={navigate} />;
  else if (section === "owners") settingsPage = <AccountSettingsExact flash={settingsFlash} onNavigate={navigate} ownerName={ownerName} ownerEmail={ownerEmail} />;
  else if (section === "notifications") settingsPage = <NotificationsSettingsExact flash={settingsFlash} onNavigate={navigate} />;
  else if (section === "pay") settingsPage = <PersistentPayOvertimeSettingsPage flash={settingsFlash} onNavigate={navigate} />;
  else if (section === "locations") settingsPage = <LocationsSettingsPage flash={settingsFlash} onNavigate={navigate} />;
  else if (section === "integrations") settingsPage = <LiveIntegrationsSettingsPage flash={settingsFlash} onNavigate={navigate} />;
  else if (section === "security") settingsPage = <SecuritySettingsPage flash={settingsFlash} onNavigate={navigate} />;
  else settingsPage = <SettingsReference businessName={businessName} organization={organizationDraft} flash={flash} section={section} setSection={setSection} rounding={rounding} timeFormat={timeFormat} updateTimeFormat={updateTimeFormat} fontSize={fontSize} updateFontSize={updateFontSize} />;
  return <>{settingsPage}{editingSetting === "organization-info" && <div className="modal-backdrop settings-action-backdrop" role="presentation"><form className="modal-card organization-edit-modal" onSubmit={(event) => { event.preventDefault(); window.localStorage.setItem("coreshift-organization", JSON.stringify(organizationDraft)); setEditingSetting(null); flash("Organization information saved."); }}><div className="modal-head"><div><p className="eyebrow">Organization profile</p><h2>Edit organization info</h2><p>Update your company details in one organized form.</p></div><button type="button" onClick={() => setEditingSetting(null)} aria-label="Close">×</button></div><div className="modal-body organization-edit-grid"><label>Company name<input autoFocus value={organizationDraft.name} onChange={(event) => setOrganizationDraft((draft) => ({ ...draft, name: event.target.value }))} /></label><label>Business email<input type="email" value={organizationDraft.email} onChange={(event) => setOrganizationDraft((draft) => ({ ...draft, email: event.target.value }))} /></label><label className="organization-edit-wide">Business address<textarea rows={2} value={organizationDraft.address} onChange={(event) => setOrganizationDraft((draft) => ({ ...draft, address: event.target.value }))} /></label><label>Time zone<select value={organizationDraft.timeZone} onChange={(event) => setOrganizationDraft((draft) => ({ ...draft, timeZone: event.target.value }))}><option>Central Time (CT)</option><option>Eastern Time (ET)</option><option>Mountain Time (MT)</option><option>Pacific Time (PT)</option></select></label><label>Industry<input value={organizationDraft.industry} onChange={(event) => setOrganizationDraft((draft) => ({ ...draft, industry: event.target.value }))} /></label><label>Company size<input value={organizationDraft.companySize} onChange={(event) => setOrganizationDraft((draft) => ({ ...draft, companySize: event.target.value }))} /></label><label>Week starts on<select value={organizationDraft.weekStarts} onChange={(event) => setOrganizationDraft((draft) => ({ ...draft, weekStarts: event.target.value }))}><option>Sunday</option><option>Monday</option></select></label><div className="modal-actions organization-edit-actions"><button type="button" className="secondary-button" onClick={() => setEditingSetting(null)}>Cancel</button><button type="submit" className="primary-button">Save organization</button></div></div></form></div>}{editingSetting && editingSetting !== "organization-info" && <div className="modal-backdrop settings-action-backdrop" role="presentation"><form className="modal-card settings-action-modal" onSubmit={(event) => { event.preventDefault(); window.localStorage.setItem(editingSetting, editingValue); setEditingSetting(null); flash("Draft saved."); }}><div className="modal-head"><div><p className="eyebrow">Settings draft</p><h2>Edit setting</h2><p>Your changes are a draft until you save them.</p></div><button type="button" onClick={() => setEditingSetting(null)} aria-label="Close">×</button></div><div className="modal-body"><label>Draft value<textarea autoFocus value={editingValue} onChange={(event) => setEditingValue(event.target.value)} rows={4} /></label><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => { setEditingSetting(null); flash("Draft discarded."); }}>Discard draft</button><button type="submit" className="primary-button">Save draft</button></div></div></form></div>}</>;
  return <div className="settings-layout">
    <aside className="settings-nav" aria-label="Settings sections">
      <button className={section === "general" ? "active" : ""} onClick={() => setSection("general")}>General</button>
      <button className={section === "time" ? "active" : ""} onClick={() => setSection("time")}>Time & breaks</button>
      <button className={section === "access" ? "active" : ""} onClick={() => setSection("access")}>Worker access</button>
      <button className={section === "owners" ? "active" : ""} onClick={() => setSection("owners")}>Owners</button>
      <button className={section === "notifications" ? "active" : ""} onClick={() => setSection("notifications")}>Notifications</button>
    </aside>
    <section className="panel settings-card">
      {section === "general" && <div className="settings-section"><h2>Business & calendar</h2><p>The basics used on schedules, timesheets, and worker screens.</p><div className="form-grid"><label>Business name<input defaultValue={businessName} readOnly /></label><label>Work location<input placeholder="Enter work location" /></label><label>Time zone<select defaultValue="America/Chicago"><option value="America/Chicago">Central Time (US)</option><option>Eastern Time (US)</option><option>Mountain Time (US)</option><option>Pacific Time (US)</option></select></label><label>Work week starts<select defaultValue="Monday"><option>Monday</option><option>Sunday</option><option>Saturday</option></select></label></div><div className="setting-row accessibility-setting"><div><strong>Workspace text size</strong><span>Increase labels, buttons, schedules, and reports while preserving the layout</span></div><select value={fontSize} onChange={(event) => updateFontSize(event.target.value as AppFontSize)}><option value="standard">Standard</option><option value="large">Large</option><option value="larger">Very large</option><option value="largest">Extra large</option></select></div></div>}
      {section === "time" && <div className="settings-section"><h2>Clock rules & breaks</h2><p>Controls for how workers record time. CoreShift tracks hours only and never moves funds.</p><div className="setting-row"><div><strong>Time display</strong><span>Choose whether schedules show AM/PM or 24-hour time</span></div><select value={timeFormat} onChange={(event) => updateTimeFormat(event.target.value as "24" | "12")}><option value="24">24-hour (14:00)</option><option value="12">12-hour (2:00 PM)</option></select></div><div className="setting-row"><div><strong>Timesheet rounding</strong><span>Keep exact punches or round the displayed total</span></div><select value={rounding} onChange={(event) => setRounding(event.target.value)}><option>Exact time</option><option>Nearest 5 minutes</option><option>Nearest 15 minutes</option></select></div><div className="setting-row"><div><strong>Unpaid meal break</strong><span>Default break length for a full shift</span></div><select defaultValue="No automatic break"><option>No automatic break</option><option>30 minutes</option><option>45 minutes</option><option>60 minutes</option></select></div><ToggleSetting title="Allow workers to clock from their phones" description="Workers can use their private link on any phone" defaultChecked /><ToggleSetting title="Require a clock-out note" description="Ask for a short note before ending a shift" /><ToggleSetting title="Flag shifts over 10 hours" description="Show long shifts as needing review" defaultChecked /></div>}
      {section === "access" && <EmployeeAccessSettings flash={flash} />}
      {section === "owners" && <OwnersSettings flash={flash} />}
      {section === "notifications" && <div className="settings-section"><h2>Owner notifications</h2><p>Choose the items CoreShift should bring to your attention.</p><ToggleSetting title="Missed clock-out reminders" description="Notify me when a shift stays open longer than scheduled" defaultChecked /><ToggleSetting title="Schedule changes" description="Notify me when a published shift is changed" defaultChecked /><ToggleSetting title="Weekly hours summary" description="Send a recap after the work week ends" defaultChecked /><MessagingSetting flash={flash} /></div>}
      {section !== "owners" && <div className="settings-footer"><button className="primary-button" type="button" onClick={() => flash("Settings saved.")}>Save changes</button></div>}
    </section>
  </div>;
}

function SchedulingSettingsFixed({ flash, onNavigate }: { flash: (message: string) => void; onNavigate: (target: "general" | "time" | "access" | "owners" | "notifications" | "billing" | "scheduling") => void }) {
  const nav = [["▥", "Organization", "general"], ["▣", "Billing & Subscription", "billing"], ["⌖", "Locations", "general"], ["♙", "Roles & Permissions", "access"], ["◷", "Time & Attendance", "time"], ["▦", "Scheduling", "scheduling"], ["$", "Pay & Overtime", "pay"], ["♧", "Notifications", "notifications"], ["✣", "Integrations", "general"], ["♙", "Account", "owners"], ["▣", "Security", "access"]] as const;
  return <div className="settings-reference"><aside className="settings-reference-nav"><div className="settings-ref-nav-list">{nav.map(([icon,title,target]) => <button type="button" className={target === "scheduling" ? "active" : ""} key={title} onClick={() => onNavigate(target)}><span>{icon}</span><div><strong>{title}</strong><small>{title === "Scheduling" ? "Scheduling preferences" : "Settings and preferences"}</small></div></button>)}</div><div className="settings-ref-promo"><strong>Build better schedules</strong><p>Use advanced scheduling tools to save time and avoid conflicts.</p><button type="button" onClick={() => flash("Settings help opened.")}>Learn More</button></div></aside><div className="settings-reference-main"><section className="time-reference"><div className="roles-reference-head"><div><h2>Scheduling</h2><p>Configure scheduling settings, shift rules, and availability preferences.</p></div><button className="secondary-button" type="button" onClick={() => flash("Scheduling editor opened.")}>✎ Edit Settings</button></div><div className="roles-reference-tabs">{["Overview","Shift & Time Off","Availability","Shift Rules","Auto-Scheduling","Notifications"].map((tab,index) => <button className={index === 0 ? "active" : ""} type="button" key={tab} onClick={() => flash(`${tab} opened.`)}>{tab}</button>)}</div><div className="time-reference-grid"><div><article className="panel time-card"><h3>Scheduling Settings</h3><div className="time-tracking-grid">{[["▦","Schedule View","Week View","Set your default schedule view"],["◷","Schedule Period","Weekly","Create schedules one week at a time"],["↔","Auto-Scheduling","Enabled","Generate shifts based on availability and rules"],["♧","Publish & Notify","Enabled","Notify employees when schedules are published"]].map(([icon,title,value,detail]) => <div key={title}><span className="role-icon">{icon}</span><strong>{title}<b>{value}</b></strong><small>{detail}</small></div>)}</div></article><article className="panel time-card"><h3>Rules At A Glance</h3><div className="time-rules-grid">{[["♧","Minimum Coverage","2 Employees","Per shift"],["◷","Max Daily Hours","10 hours","Per employee"],["▦","Min. Shift Length","4 hours","Per shift"],["◷","Time Between Shifts","10 hours","Required rest time"]].map(([icon,title,value,detail]) => <div key={title}><span className="role-icon">{icon}</span><strong>{title}</strong><b>{value}</b><small>{detail}</small><button type="button" onClick={() => flash(`${title} opened.`)}>Manage →</button></div>)}</div></article></div><aside><article className="panel time-card"><h3>Scheduling Summary</h3>{[["Schedule Period","Weekly (Sun – Sat)"],["Week Starts On","Sunday"],["Default Start Time","8:00 AM"],["Default End Time","5:00 PM"],["Unpaid Break","30 minutes"],["Overnight Shifts","Allowed"]].map(([title,value]) => <div className="time-setting" key={title}><span className="role-icon">▣</span><div><strong>{title}</strong><b>{value}</b></div><button type="button" onClick={() => flash(`${title} opened.`)}>Edit</button></div>)}</article></aside></div></section></div></div>;
}

function AccountSettingsExact({ flash, onNavigate, ownerName, ownerEmail }: { flash: (message: string) => void; onNavigate: (target: "general" | "time" | "access" | "owners" | "notifications" | "billing" | "scheduling") => void; ownerName: string; ownerEmail: string }) {
  const [photo, setPhoto] = useState<string | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [editingProfile, setEditingProfile] = useState(false);
  const [profileDraft, setProfileDraft] = useState({ name: ownerName || "Sarah Johnson", email: ownerEmail || "sarah.johnson@mainstreetcafe.com", phone: "", jobTitle: "Owner" });
  useEffect(() => {
    const openEditor = (event: MouseEvent) => {
      const button = (event.target as HTMLElement | null)?.closest("button");
      if (!button || !button.textContent?.toLowerCase().includes("edit profile")) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      let values = [profileDraft.name, profileDraft.email, profileDraft.phone, profileDraft.jobTitle];
      try { values = JSON.parse(window.localStorage.getItem("coreshift-owner-profile") || "null") || values; } catch { /* defaults */ }
      const dialog = document.createElement("dialog");
      dialog.className = "modal-card account-profile-editor";
      dialog.innerHTML = `<div class="modal-head"><div><p class="eyebrow">Account profile</p><h2>Edit profile</h2><p>Update your information, then save all changes together.</p></div><button type="button" data-close aria-label="Close">×</button></div><div class="modal-body organization-edit-grid"><label>Full name<input data-field="0" value="${values[0] || ""}"></label><label>Email address<input data-field="1" type="email" value="${values[1] || ""}"></label><label>Phone number<input data-field="2" value="${values[2] || ""}"></label><label>Job title<input data-field="3" value="${values[3] || ""}"></label><div class="modal-actions organization-edit-actions"><button type="button" class="secondary-button" data-close>Cancel</button><button type="button" class="primary-button" data-save>Save profile</button></div></div>`;
      document.body.appendChild(dialog);
      const close = () => { dialog.close(); dialog.remove(); };
      dialog.querySelectorAll("[data-close]").forEach((node) => node.addEventListener("click", close));
      dialog.querySelector("[data-save]")?.addEventListener("click", () => { const next = Array.from(dialog.querySelectorAll<HTMLInputElement>("[data-field]")).map((input) => input.value); window.localStorage.setItem("coreshift-owner-profile", JSON.stringify(next)); setProfileDraft({ name: next[0], email: next[1], phone: next[2], jobTitle: next[3] }); close(); flash("Profile changes saved."); });
      dialog.addEventListener("close", () => dialog.remove(), { once: true });
      dialog.showModal();
    };
    document.addEventListener("click", openEditor, true);
    return () => document.removeEventListener("click", openEditor, true);
  }, [flash, profileDraft]);
  useEffect(() => {
    const root = document.querySelector(".account-exact-page");
    if (!root) return;
    const fields = Array.from(root.querySelectorAll<HTMLInputElement>(".account-form-fields input"));
    try {
      const saved = JSON.parse(window.localStorage.getItem("coreshift-owner-profile") || "null") as string[] | null;
      if (saved) fields.forEach((field, index) => { if (saved[index] !== undefined) field.value = saved[index]; });
      else { if (fields[0] && ownerName) fields[0].value = ownerName; if (fields[1] && ownerEmail) fields[1].value = ownerEmail; }
    } catch { /* use defaults */ }
    const save = () => window.localStorage.setItem("coreshift-owner-profile", JSON.stringify(fields.map((field) => field.value)));
    fields.forEach((field) => field.addEventListener("input", save));
    return () => fields.forEach((field) => field.removeEventListener("input", save));
  }, []);
  useEffect(() => {
    const next = window.localStorage.getItem("coreshift-theme") === "dark" ? "dark" : "light";
    setTheme(next);
    document.documentElement.dataset.theme = next;
  }, []);
  function updateTheme(next: "light" | "dark") {
    setTheme(next);
    window.localStorage.setItem("coreshift-theme", next);
    document.documentElement.dataset.theme = next;
    flash(next === "dark" ? "Dark mode enabled." : "Light mode enabled.");
  }
  useEffect(() => {
    const select = document.querySelector<HTMLSelectElement>(".account-exact-page .account-custom-grid select");
    if (!select) return;
    select.value = theme === "dark" ? "Dark" : "System (Light)";
    const handleChange = () => updateTheme(select.value === "Dark" ? "dark" : "light");
    select.addEventListener("change", handleChange);
    return () => select.removeEventListener("change", handleChange);
  }, [theme]);
  const nav = [["▥","Organization","general"],["▣","Billing & Subscription","billing"],["⌖","Locations","general"],["♙","Roles & Permissions","access"],["◷","Time & Attendance","time"],["▦","Scheduling","scheduling"],["$","Pay & Overtime","pay"],["♧","Notifications","notifications"],["✣","Integrations","general"],["♙","Account","owners"],["▣","Security","access"]] as const;
  function choosePhoto(event: React.ChangeEvent<HTMLInputElement>) { const file = event.target.files?.[0]; if (!file) return; const reader = new FileReader(); reader.onload = () => { const value = String(reader.result); setPhoto(value); try { window.localStorage.setItem("coreshift-owner-photo", value); } catch { /* storage may be unavailable */ } }; reader.readAsDataURL(file); flash("Profile photo updated."); }
  return <div className="settings-reference account-exact"><aside className="settings-reference-nav"><div className="settings-ref-nav-list">{nav.map(([icon,title,target]) => <button type="button" className={target === "owners" ? "active" : ""} key={title} onClick={() => onNavigate(target)}><span>{icon}</span><div><strong>{title}</strong><small>{title === "Account" ? "Your account settings" : "Settings and preferences"}</small></div></button>)}</div><div className="settings-ref-promo"><strong>Manage your account</strong><p>Update your account settings and security preferences.</p><button type="button" onClick={() => flash("Account help opened.")}>Learn More</button></div></aside><div className="settings-reference-main"><section className="account-exact-page"><header><h2>Account</h2><p>Manage your account information and preferences.</p></header><nav className="roles-reference-tabs"><button className="active" type="button">Profile</button><button type="button">Preferences</button><button type="button">Security</button><button type="button">Active Sessions</button></nav><div className="account-exact-grid"><div><article className="panel account-profile-card"><div className="account-card-title"><h3>Profile Information</h3><button className="secondary-button" type="button" onClick={() => flash("Profile editing enabled.")}>✎ Edit Profile</button></div><div className="account-profile-body"><div className="account-avatar-wrap">{photo ? <img src={photo} alt="Profile" /> : <span>SJ</span>}<label className="secondary-button">♙ Change Photo<input type="file" accept="image/png,image/jpeg,image/gif" onChange={choosePhoto} /></label><small>JPG, PNG or GIF. Max 2MB.</small></div><div className="account-form-fields">{[["Full Name","Sarah Johnson"],["Email Address","sarah.johnson@mainstreetcafe.com"],["Phone Number","(281) 555-0123"],["Job Title","Owner"]].map(([label,value]) => <label key={label}>{label}<input defaultValue={value} /></label>)}</div></div></article><article className="panel account-details-card"><h3>Account Details</h3>{[["Role","Owner"],["Account Type","Owner Account"],["Employee Access","Full access to all features"],["Account Created","Jan 15, 2024"],["Last Updated","May 10, 2024"]].map(([label,value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</article><article className="panel account-details-card"><h3>Customize Your Experience</h3><div className="account-custom-grid"><label>Theme<select><option>System (Light)</option><option>Dark</option></select></label><label>Language<select><option>English (US)</option><option>Spanish</option></select></label></div></article></div><aside><article className="panel account-side-card"><h3>◉　Account Summary</h3>{[["Account Status","Active"],["Plan","Pro Plan"],["Users","23 / Unlimited"],["Billing","Billed annually"],["Next Billing Date","June 15, 2025"]].map(([label,value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</article><article className="panel account-side-card"><h3>✉　Email Preferences</h3>{["Marketing Emails","Product Updates","Security Alerts","Weekly Summary"].map((item) => <div key={item}><span>{item}</span><strong>Enabled　›</strong></div>)}</article><article className="panel account-side-card"><h3>▣　Connected Login</h3><div><span>Google<br /><small>sar***@gmail.com</small></span><strong>Connected　›</strong></div><div><span>Apple<br /><small>sar***@icloud.com</small></span><strong>Not Connected　›</strong></div><button className="text-button" type="button" onClick={() => flash("Connected accounts opened.")}>Manage Connected Accounts →</button></article></aside></div></section></div></div>;
}

function NotificationsSettingsExact({ flash, onNavigate }: { flash: (message: string) => void; onNavigate: (target: "general" | "time" | "access" | "owners" | "notifications" | "billing" | "scheduling") => void }) {
  const nav = [["▥","Organization","general"],["▣","Billing & Subscription","billing"],["⌖","Locations","general"],["♙","Roles & Permissions","access"],["◷","Time & Attendance","time"],["▦","Scheduling","scheduling"],["$","Pay & Overtime","owners"],["♧","Notifications","notifications"],["✣","Integrations","general"],["♙","Account","owners"],["▣","Security","access"]] as const; const groups=["Time & Attendance","Scheduling","Team & Requests","Payroll & Approvals","System & Alerts"];
  return <div className="settings-reference"><aside className="settings-reference-nav"><div className="settings-ref-nav-list">{nav.map(([icon,title,target]) => <button type="button" className={target === "notifications" ? "active" : ""} key={title} onClick={() => onNavigate(target)}><span>{icon}</span><div><strong>{title}</strong><small>{title === "Notifications" ? "Notification preferences" : "Settings and preferences"}</small></div></button>)}</div><div className="settings-ref-promo"><strong>Stay in the know</strong><p>Customize notifications so you never miss what matters most.</p><button type="button" onClick={() => flash("Notification help opened.")}>Learn More</button></div></aside><div className="settings-reference-main"><section className="notification-exact"><header><h2>Notifications</h2><p>Manage how and when you receive alerts and notifications.</p></header><nav className="roles-reference-tabs"><button className="active" type="button">Overview</button><button type="button">Channels</button><button type="button">Notification Rules</button><button type="button">Quiet Hours</button><button type="button">Digest Settings</button></nav><div className="notification-grid"><div><article className="panel notification-card"><div className="account-card-title"><h3>Notification Channels</h3><button className="secondary-button" type="button" onClick={() => flash("Notification channels opened.")}>⚙ Manage Channels</button></div><div className="channel-grid">{[["✉","Email","Enabled"],["♧","Push Notifications","Updated 2 days ago"],["▤","In-App","Enabled"]].map(([icon,title,status]) => <div key={title}><span className="role-icon">{icon}</span><strong>{title}<small>{status}</small></strong><button type="button" onClick={() => flash(`${title} channel opened.`)}>›</button></div>)}</div></article><article className="panel notification-card"><div className="account-card-title"><h3>Notification Preferences</h3><button className="text-button" type="button" onClick={() => flash("All notification preferences expanded.")}>Expand All</button></div>{groups.map((group) => <div className="notification-row" key={group}><span className="role-icon">◷</span><div><strong>{group}</strong><small>Receive alerts and updates for {group.toLowerCase()}.</small></div><label><input type="checkbox" defaultChecked /><i /></label><label><input type="checkbox" defaultChecked /><i /></label><label><input type="checkbox" defaultChecked /><i /></label><button type="button">⌄</button></div>)}</article></div><aside><article className="panel notification-card"><h3>Notification Summary</h3>{[["Total Notifications","124"],["Unread","8"],["Delivered (This Week)","116"],["Channel Reliability","99%"]].map(([label,value]) => <div className="account-side-card-row" key={label}><span>{label}</span><strong>{value}</strong></div>)}<button className="text-button" type="button" onClick={() => flash("Notification log opened.")}>View Notification Log →</button></article><article className="panel notification-card"><h3>Quiet Hours</h3><ToggleSetting title="Pause non-urgent notifications" description="During quiet hours" defaultChecked /><div className="account-side-card-row"><span>Days</span><strong>Mon – Sun</strong></div><div className="account-side-card-row"><span>10:00 PM – 7:00 AM</span><strong>Enabled</strong></div><button className="text-button" type="button" onClick={() => flash("Quiet hours opened.")}>Manage Quiet Hours →</button></article><article className="panel notification-card"><h3>Digest Settings</h3><p>Get a summary of notifications you may have missed.</p><button className="text-button" type="button" onClick={() => flash("Digest settings opened.")}>Manage Digest Settings →</button></article></aside></div></section></div></div>;
}

function AccountSettingsFixed({ flash, onNavigate }: { flash: (message: string) => void; onNavigate: (target: "general" | "time" | "access" | "owners" | "notifications" | "billing" | "scheduling") => void }) {
  const nav = [["▥","Organization","general"],["▣","Billing & Subscription","billing"],["⌖","Locations","general"],["♙","Roles & Permissions","access"],["◷","Time & Attendance","time"],["▦","Scheduling","scheduling"],["$","Pay & Overtime","owners"],["♧","Notifications","notifications"],["✣","Integrations","general"],["♙","Account","owners"],["▣","Security","access"]] as const;
  return <div className="settings-reference"><aside className="settings-reference-nav"><div className="settings-ref-nav-list">{nav.map(([icon,title,target]) => <button type="button" className={target === "owners" ? "active" : ""} key={title} onClick={() => onNavigate(target)}><span>{icon}</span><div><strong>{title}</strong><small>{title === "Account" ? "Your account settings" : "Settings and preferences"}</small></div></button>)}</div><div className="settings-ref-promo"><strong>Manage your account</strong><p>Update your account settings and security preferences.</p><button type="button" onClick={() => flash("Account help opened.")}>Learn More</button></div></aside><div className="settings-reference-main"><section className="time-reference"><div className="roles-reference-head"><div><h2>Account</h2><p>Manage your account information and preferences.</p></div><button className="secondary-button" type="button" onClick={() => flash("Profile editing opened.")}>✎ Edit Profile</button></div><div className="roles-reference-tabs"><button className="active" type="button">Profile</button><button type="button" onClick={() => flash("Preferences opened.")}>Preferences</button><button type="button" onClick={() => flash("Security opened.")}>Security</button><button type="button" onClick={() => flash("Active sessions opened.")}>Active Sessions</button></div><div className="time-reference-grid"><div><article className="panel time-card"><h3>Profile Information</h3>{[["Full Name","Sarah Johnson"],["Email Address","sarah.johnson@mainstreetcafe.com"],["Phone Number","(281) 555-0123"],["Job Title","Owner"]].map(([label,value]) => <label className="time-setting" key={label}><div><strong>{label}</strong><b>{value}</b></div><button type="button" onClick={() => flash(`${label} editing opened.`)}>Edit</button></label>)}</article><article className="panel time-card"><h3>Account Details</h3>{[["Role","Owner"],["Account Type","Owner Account"],["Employee Access","Full access to all features"],["Account Created","Jan 15, 2024"],["Last Updated","May 10, 2024"]].map(([label,value]) => <div className="time-setting" key={label}><div><strong>{label}</strong><b>{value}</b></div></div>)}</article><article className="panel time-card"><h3>Customize Your Experience</h3><div className="time-rules-grid"><div><strong>Theme</strong><small>System (Light)</small></div><div><strong>Language</strong><small>English (US)</small></div></div></article></div><aside><article className="panel time-card"><h3>Account Summary</h3>{[["Account Status","Active"],["Plan","Pro Plan"],["Users","23 / Unlimited"],["Billing","Billed annually"],["Next Billing Date","June 15, 2025"]].map(([label,value]) => <div className="time-setting" key={label}><div><strong>{label}</strong><b>{value}</b></div></div>)}</article><article className="panel time-card"><h3>Email Preferences</h3>{["Marketing Emails","Product Updates","Security Alerts","Weekly Summary"].map((item) => <div className="attendance-row" key={item}><div><strong>{item}</strong><small>Enabled</small></div><button type="button" onClick={() => flash(`${item} opened.`)}>›</button></div>)}</article><article className="panel time-card"><h3>Connected Login</h3><div className="attendance-row"><div><strong>Google</strong><small>Connected</small></div><button type="button" onClick={() => flash("Connected accounts opened.")}>›</button></div><div className="attendance-row"><div><strong>Apple</strong><small>Not Connected</small></div><button type="button" onClick={() => flash("Connected accounts opened.")}>›</button></div></article></aside></div></section></div></div>;
}

function SchedulingSettingsPage({ flash, onNavigate }: { flash: (message: string) => void; onNavigate: (target: "general" | "time" | "access" | "owners" | "notifications" | "billing" | "scheduling") => void }) {
  const nav = [["▥", "Organization", "Company profile and details"], ["▣", "Billing & Subscription", "Manage your plan and billing"], ["⌖", "Locations", "Manage your locations"], ["♙", "Roles & Permissions", "Control access and permissions"], ["◷", "Time & Attendance", "Rules and time tracking"], ["▦", "Scheduling", "Scheduling preferences"], ["$", "Pay & Overtime", "Pay rates and overtime rules"], ["♧", "Notifications", "Notification preferences"], ["✣", "Integrations", "Connected apps and services"], ["♙", "Account", "Your account settings"], ["▣", "Security", "Password and security"]];
  const targets = ["general", "billing", "general", "general", "access", "time", "scheduling", "owners", "notifications", "general", "owners", "access"] as const;
  const card = (icon: string, title: string, value: string, detail: string) => <div className="time-setting"><span className="role-icon">{icon}</span><div><strong>{title}</strong><b>{value}</b><small>{detail}</small></div><button type="button" onClick={() => flash(`${title} settings opened.`)}>Edit</button></div>;
  return <div className="settings-reference"><aside className="settings-reference-nav"><div className="settings-ref-nav-list">{nav.map(([icon,title,desc], index) => <button type="button" className={index === 6 ? "active" : ""} key={title} onClick={() => onNavigate(targets[index])}><span>{icon}</span><div><strong>{title}</strong><small>{desc}</small></div></button>)}</div><div className="settings-ref-promo"><strong>Build better schedules</strong><p>Use advanced scheduling tools to save time and avoid conflicts.</p><button type="button" onClick={() => flash("Settings help opened.")}>Learn More</button></div></aside><div className="settings-reference-main"><section className="time-reference"><div className="roles-reference-head"><div><h2>Scheduling</h2><p>Configure scheduling settings, shift rules, and availability preferences.</p></div><button className="secondary-button" type="button" onClick={() => flash("Scheduling editor opened.")}>✎ Edit Settings</button></div><div className="roles-reference-tabs">{["Overview","Shift & Time Off","Availability","Shift Rules","Auto-Scheduling","Notifications"].map((tab, index) => <button className={index === 0 ? "active" : ""} type="button" key={tab} onClick={() => flash(`${tab} opened.`)}>{tab}</button>)}</div><div className="time-reference-grid"><div><article className="panel time-card"><h3>Scheduling Settings</h3><div className="time-tracking-grid">{[["▦","Schedule View","Week View","Set your default schedule view"],["◷","Schedule Period","Weekly","Create schedules one week at a time"],["↔","Auto-Scheduling","Enabled","Generate shifts based on availability & rules"],["♧","Publish & Notify","Enabled","Notify employees when schedules are published"]].map(([icon,title,value,detail]) => <div key={title}><span className="role-icon">{icon}</span><strong>{title}<b>{value}</b></strong><small>{detail}</small></div>)}</div></article><article className="panel time-card"><h3>Rules At A Glance</h3><div className="time-rules-grid">{[["♧","Minimum Coverage","2 Employees","Per shift"],["◷","Max Daily Hours","10 hours","Per employee"],["▦","Min. Shift Length","4 hours","Per shift"],["◷","Time Between Shifts","10 hours","Required rest time"]].map(([icon,title,value,detail]) => <div key={title}><span className="role-icon">{icon}</span><strong>{title}</strong><b>{value}</b><small>{detail}</small><button type="button" onClick={() => flash(`${title} opened.`)}>Manage →</button></div>)}</div></article><article className="panel time-card"><h3>Upcoming Time Off Requests</h3>{["Emily Davis　 Vacation　 May 24 – May 27, 2024", "Michael Brown　 Personal　 May 31, 2024", "Jessica Lee　 Vacation　 Jun 10 – Jun 14, 2024"].map((row) => <div className="holiday-row" key={row}><span>{row}</span><em>Pending</em></div>)}</article></div><aside><article className="panel time-card"><h3>Scheduling Summary</h3>{[card("▣","Schedule Period","Weekly (Sun – Sat)",""),card("▣","Week Starts On","Sunday",""),card("◷","Default Start Time","8:00 AM",""),card("◷","Default End Time","5:00 PM",""),card("◷","Unpaid Break","30 minutes",""),card("◷","Overnight Shifts","Allowed","")]}<button className="text-button" type="button" onClick={() => flash("All scheduling settings opened.")}>View all settings　→</button></article><article className="panel time-card"><h3>Scheduling Tools</h3>{["Templates","Shift Marketplace","Time Off Calendar","Labor Forecasting","Schedule Reports"].map((item) => <div className="attendance-row" key={item}><span className="role-icon">▦</span><div><strong>{item}</strong><small>Manage scheduling tools and preferences.</small></div><button type="button" onClick={() => flash(`${item} opened.`)}>›</button></div>)}</article></aside></div><footer className="time-footer">▣　All scheduling data is stored securely and cannot be edited.</footer></section></div></div>;
}

function AttendancePoliciesView({ flash, onNavigate, onBack, onBreak }: { flash: (message: string) => void; onNavigate: (target: "general" | "time" | "access" | "owners" | "notifications" | "billing" | "scheduling") => void; onBack: () => void; onBreak: () => void }) {
  const [grace, setGrace] = useState("5");
  const [late, setLate] = useState("5");
  const [veryLate, setVeryLate] = useState("30");
  const [absent, setAbsent] = useState("2");
  const [saved, setSaved] = useState(false);
  useEffect(() => { try { localStorage.setItem("coreshift-attendance-policy", JSON.stringify({ grace, late, veryLate, absent })); } catch { /* storage may be unavailable */ } }, [grace, late, veryLate, absent]);
  const input = (value: string, setValue: (value: string) => void, unit: string) => <label className="policy-input"><input value={value} onChange={(event) => setValue(event.target.value)} inputMode="numeric" /><em>{unit}</em></label>;
  const row = (icon: string, title: string, detail: string, control: React.ReactNode) => <div className="policy-row"><span className="attendance-icon">{icon}</span><div><strong>{title}</strong><small>{detail}</small></div><div className="policy-control">{control}</div></div>;
  useEffect(() => { const tab = Array.from(document.querySelectorAll<HTMLButtonElement>(".attendance-policy-page .time-polished-tabs button")).find((button) => button.textContent?.trim() === "Break Rules"); if (!tab) return; const handle = (event: Event) => { event.preventDefault(); event.stopImmediatePropagation(); onBreak(); }; tab.addEventListener("click", handle, true); return () => tab.removeEventListener("click", handle, true); }, [onBreak]);
  return <div className="settings-reference attendance-polished"><aside className="settings-reference-nav"><div className="settings-ref-nav-list"><button type="button" onClick={onBack}><span>←</span><div><strong>Time &amp; Attendance</strong><small>Back to overview</small></div></button></div></aside><div className="settings-reference-main"><section className="time-polished attendance-policy-page"><header className="time-polished-head"><div><h2>Time &amp; Attendance</h2><p>Configure how time is tracked, attendance is recorded, and rules are applied.</p></div><div className="policy-header-actions"><button className="secondary-button" type="button" onClick={() => flash("Policy preview opened.")}>◉ Preview Policy</button><button className="primary-button" type="button" onClick={() => { setSaved(true); flash("Attendance policy saved."); setTimeout(() => setSaved(false), 1600); }}>✓ {saved ? "Saved" : "Save Changes"}</button></div></header><nav className="time-polished-tabs"><button type="button" onClick={onBack}>Overview</button><button className="active" type="button">Attendance Policies</button>{["Break Rules", "Overtime Rules", "Time Rounding", "Time Off", "Holidays"].map((tab) => <button type="button" key={tab} onClick={() => flash(`${tab} opened.`)}>{tab}</button>)}</nav><div className="policy-title"><span className="attendance-icon">♢</span><div><h3>Attendance Policies</h3><p>Set rules for lateness, absences, missed punches, and attendance management.</p></div><aside><strong>About Attendance Policies</strong><small>These rules determine how attendance events are calculated and when managers are notified.</small></aside></div><div className="policy-grid"><div><article className="attendance-card policy-card"><h3>1. Attendance Status</h3><p>Define when employees are considered late, very late, or absent.</p>{row("◷", "On Time", "Employees are on time within the grace period.", input(grace, setGrace, "min"))}{row("◷", "Late", "Employees are marked late after the grace period.", input(late, setLate, "min"))}{row("◷", "Very Late", "Employees are marked very late after this threshold.", input(veryLate, setVeryLate, "min"))}{row("♧", "Absent", "Employees are absent if they have not clocked in.", input(absent, setAbsent, "hours"))}</article><article className="attendance-card policy-card"><h3>2. Missed Punches</h3><p>Control how missed punches are handled.</p>{row("✎", "Allow punch corrections", "Employees can request corrections for missed punches.", <button type="button" className="switch on"><i /></button>)}{row("♢", "Require manager approval", "Corrections must be approved by a manager.", <button type="button" className="switch on"><i /></button>)}{row("▣", "Correction window", "How many days after a punch a correction can be requested.", input("7", () => {}, "days"))}</article><article className="attendance-card policy-card"><h3>3. No Call / No Show</h3><p>Define when an employee is considered a no-call/no-show.</p>{row("☎", "No call / No show threshold", "Time from scheduled start before the event is recorded.", input("60", () => {}, "minutes"))}{row("♧", "Notify managers", "Send a notification when detected.", <button type="button" className="switch on"><i /></button>)}</article></div><aside><article className="attendance-card policy-preview"><h3>Policy Preview</h3><p>Here’s how this policy will be applied.</p>{[["♢", "Clock In", "8:00 AM"], ["◷", "On Time", `Within ${grace} minutes`], ["◷", "Late", `After ${late} minutes`], ["◷", "Very Late", `After ${veryLate} minutes`], ["♧", "Absent", `After ${absent} hours`]].map(([icon,title,value]) => <div className="policy-preview-row" key={title}><span className="attendance-icon">{icon}</span><strong>{title}</strong><b>{value}</b></div>)}</article><article className="attendance-card policy-summary"><h3>Current Policy Summary</h3>{[["Grace Period", `${grace} minutes`], ["Late After", `${late} minutes`], ["Very Late After", `${veryLate} minutes`], ["Absent After", `${absent} hours`], ["Correction Window", "7 days"]].map(([title,value]) => <div key={title}><span>{title}</span><b>{value}</b></div>)}<button className="text-button" type="button" onClick={() => flash("Policy download started.")}>↓ Download Policy</button></article></aside></div></section></div></div>;
}

function BreakRulesView({ flash, onNavigate, onBack, onAttendance }: { flash: (message: string) => void; onNavigate: (target: "general" | "time" | "access" | "owners" | "notifications" | "billing" | "scheduling") => void; onBack: () => void; onAttendance: () => void }) {
  const [mealDuration, setMealDuration] = useState("30 min");
  const [restDuration, setRestDuration] = useState("15 min");
  const [flexible, setFlexible] = useState(true);
  const [deduction, setDeduction] = useState(true);
  const [acknowledgement, setAcknowledgement] = useState(true);
  const [saved, setSaved] = useState(false);
  useEffect(() => { try { localStorage.setItem("coreshift-break-rules", JSON.stringify({ mealDuration, restDuration, flexible, deduction, acknowledgement })); } catch { /* storage may be unavailable */ } }, [mealDuration, restDuration, flexible, deduction, acknowledgement]);
  const select = (value: string, setValue: (value: string) => void, options: string[]) => <select value={value} onChange={(event) => setValue(event.target.value)}>{options.map((option) => <option key={option}>{option}</option>)}</select>;
  const toggle = (value: boolean, setValue: (value: boolean) => void) => { const noop = setValue.toString().replace(/\s/g, "") === "()=>{}"; const current = noop ? acknowledgement : value; return <button type="button" className={`switch ${current ? "on" : "off"}`} aria-pressed={current} onClick={() => noop ? setAcknowledgement(!current) : setValue(!current)}><i /></button>; };
  const row = (icon: string, title: string, detail: string, control: React.ReactNode) => <div className="policy-row"><span className="attendance-icon">{icon}</span><div><strong>{title}</strong><small>{detail}</small></div><div className="policy-control">{control}</div></div>;
  useEffect(() => { const tab = Array.from(document.querySelectorAll<HTMLButtonElement>(".attendance-policy-page .time-polished-tabs button")).find((button) => button.textContent?.trim() === "Attendance Policies"); if (!tab) return; const handle = (event: Event) => { event.preventDefault(); event.stopImmediatePropagation(); onAttendance(); }; tab.addEventListener("click", handle, true); return () => tab.removeEventListener("click", handle, true); }, [onAttendance]);
  return <div className="settings-reference attendance-polished"><aside className="settings-reference-nav"><div className="settings-ref-nav-list"><button type="button" onClick={onBack}><span>←</span><div><strong>Time &amp; Attendance</strong><small>Back to overview</small></div></button></div></aside><div className="settings-reference-main"><section className="time-polished attendance-policy-page"><header className="time-polished-head"><div><h2>Time &amp; Attendance</h2><p>Configure how time is tracked, attendance is recorded, and rules are applied.</p></div><div className="policy-header-actions"><button className="secondary-button" type="button" onClick={() => flash("Break rules preview opened.")}>◉ Preview Rules</button><button className="primary-button" type="button" onClick={() => { setSaved(true); flash("Break rules saved."); setTimeout(() => setSaved(false), 1600); }}>✓ {saved ? "Saved" : "Save Changes"}</button></div></header><nav className="time-polished-tabs"><button type="button" onClick={onBack}>Overview</button><button type="button" onClick={() => flash("Attendance Policies opened.")}>Attendance Policies</button><button className="active" type="button">Break Rules</button>{["Overtime Rules", "Time Rounding", "Time Off", "Holidays"].map((tab) => <button type="button" key={tab} onClick={() => flash(`${tab} opened.`)}>{tab}</button>)}</nav><div className="policy-title"><span className="attendance-icon">▱</span><div><h3>Break Rules</h3><p>Set break entitlements, durations, and paid/unpaid rules.</p></div><aside><strong>About Break Rules</strong><small>These rules determine how and when employees receive breaks based on total work hours.</small></aside></div><div className="policy-grid"><div><article className="attendance-card policy-card"><h3>1. Break Entitlements</h3><p>Define when employees are entitled to breaks.</p>{row("▱", "Meal break", "When an employee works more than 4 hours.", <div className="policy-control-group">{select("More than 4 hours", () => {}, ["More than 4 hours", "More than 6 hours", "More than 8 hours"])}{select(mealDuration, setMealDuration, ["15 min", "30 min", "45 min"])}<em>Unpaid</em></div>)}{row("◷", "Rest break", "When an employee works more than 6 hours.", <div className="policy-control-group">{select("More than 6 hours", () => {}, ["More than 4 hours", "More than 6 hours", "More than 8 hours"])}{select(restDuration, setRestDuration, ["10 min", "15 min", "20 min"])}<em>Paid</em></div>)}<button className="text-button" type="button" onClick={() => flash("New break rule added.")}>＋ Add Break Rule</button></article><article className="attendance-card policy-card"><h3>2. Break Scheduling</h3><p>Control how breaks are scheduled and taken.</p>{row("◷", "Earliest meal break", "When the first meal break can be taken.", select("After 2 hours", () => {}, ["After 1 hour", "After 2 hours", "After 3 hours"]))}{row("◷", "Latest meal break", "When the meal break must be started.", select("Before 5 hours", () => {}, ["Before 4 hours", "Before 5 hours", "Before 6 hours"]))}{row("◷", "Allow flexible break times", "Managers can approve breaks outside scheduled windows.", toggle(flexible, setFlexible))}</article><article className="attendance-card policy-card"><h3>3. Break Options</h3><p>Additional settings that affect how breaks are managed.</p>{row("◉", "Automatic break deduction", "Automatically deduct breaks from employee time.", toggle(deduction, setDeduction))}{row("♢", "Require break acknowledgement", "Employees must acknowledge their breaks.", toggle(true, () => {}))}{row("◷", "Break rounding", "Round break times to the nearest.", select("5 minutes", () => {}, ["Exact time", "5 minutes", "10 minutes", "15 minutes"]))}</article></div><aside><article className="attendance-card policy-preview"><h3>Break Rules Preview</h3><p>See how these rules will be applied to employees.</p>{[["◷", "Clock In", "8:00 AM"], ["▱", "Rest Break", `${restDuration} paid`], ["▱", "Meal Break", `${mealDuration} unpaid`], ["◴", "Clock Out", "5:00 PM"]].map(([icon,title,value]) => <div className="policy-preview-row" key={title}><span className="attendance-icon">{icon}</span><strong>{title}</strong><b>{value}</b></div>)}</article><article className="attendance-card policy-summary"><h3>Summary</h3>{[["Meal Break", `${mealDuration} unpaid`], ["Rest Break", `${restDuration} paid`], ["Meal Break Window", "After 2h – Before 5h"], ["Automatic Deduction", deduction ? "Enabled" : "Disabled"], ["Flexible Breaks", flexible ? "Enabled" : "Disabled"]].map(([title,value]) => <div key={title}><span>{title}</span><b>{value}</b></div>)}<button className="text-button" type="button" onClick={() => flash("Break policy download started.")}>↓ Download Break Policy</button></article></aside></div></section></div></div>;
}

function OvertimeRulesView({ flash, onBack, onAttendance }: { flash: (message: string) => void; onBack: () => void; onAttendance: () => void }) {
  const [method, setMethod] = useState("Daily");
  const [threshold, setThreshold] = useState("40");
  const [rate, setRate] = useState("1.5x (Time and a half)");
  const [customMultiplier, setCustomMultiplier] = useState("1.50");
  const [includePto, setIncludePto] = useState(true);
  const [round, setRound] = useState(true);
  const [saved, setSaved] = useState(false);
  useEffect(() => { try { localStorage.setItem("coreshift-overtime-rules", JSON.stringify({ method, threshold, rate, customMultiplier, includePto, round })); } catch { /* storage may be unavailable */ } }, [method, threshold, rate, customMultiplier, includePto, round]);
  const toggle = (value: boolean, setValue: (next: boolean) => void) => <button type="button" className={`switch ${value ? "on" : "off"}`} aria-pressed={value} onClick={() => setValue(!value)}><i /></button>;
  useEffect(() => { const root = document.querySelector<HTMLElement>(".attendance-policy-page"); if (!root) return; const custom = Array.from(root.querySelectorAll<HTMLElement>(".overtime-radio")).find((el) => el.textContent?.includes("Custom multiplier")); if (custom) { let input = custom.querySelector<HTMLInputElement>("input[type=number]"); if (rate === "Custom multiplier") { if (!input) { input = document.createElement("input"); input.type = "number"; input.min = "1"; input.max = "5"; input.step = ".05"; input.className = "overtime-custom-input"; custom.appendChild(input); input.addEventListener("input", () => setCustomMultiplier(input!.value)); } input.value = customMultiplier; } else if (input) input.remove(); } const unit = root.querySelector<HTMLElement>(".overtime-inline > span"); if (unit) unit.textContent = method === "Daily" ? "hours per day" : "hours per week"; const summary = Array.from(root.querySelectorAll<HTMLElement>(".policy-summary > div")).find((el) => el.textContent?.includes("Overtime Threshold")); if (summary) { const value = summary.querySelector("b"); if (value) value.textContent = `${threshold} hours ${method === "Daily" ? "per day" : "per week"}`; } }, [rate, customMultiplier, method, threshold]);
  useEffect(() => { const root = document.querySelector<HTMLElement>(".attendance-policy-page"); if (!root) return; const summary = Array.from(root.querySelectorAll<HTMLElement>(".policy-summary > div")).find((el) => el.textContent?.includes("Overtime Pay Rate")); const value = summary?.querySelector("b"); if (value) value.textContent = rate === "Custom multiplier" ? `${customMultiplier}x custom multiplier` : rate; }, [rate, customMultiplier]);
  useEffect(() => { if (method === "Daily" && threshold === "40") setThreshold("8"); if (method !== "Daily" && threshold === "8") setThreshold("40"); }, [method]);
  return <div className="settings-reference attendance-polished"><aside className="settings-reference-nav"><div className="settings-ref-nav-list"><button type="button" onClick={onBack}><span>←</span><div><strong>Time &amp; Attendance</strong><small>Back to overview</small></div></button></div></aside><div className="settings-reference-main"><section className="time-polished attendance-policy-page"><header className="time-polished-head"><div><h2>Time &amp; Attendance</h2><p>Configure how time is tracked, attendance is recorded, and rules are applied.</p></div><div className="policy-header-actions"><button className="secondary-button" type="button" onClick={() => flash("Overtime preview opened.")}>◉ Preview Overtime</button><button className="primary-button" type="button" onClick={() => { setSaved(true); flash("Overtime rules saved."); setTimeout(() => setSaved(false), 1600); }}>✓ {saved ? "Saved" : "Save Changes"}</button></div></header><nav className="time-polished-tabs"><button type="button" onClick={onBack}>Overview</button><button type="button" onClick={onAttendance}>Attendance Policies</button><button type="button" onClick={() => flash("Break Rules opened.")}>Break Rules</button><button className="active" type="button">Overtime Rules</button>{["Time Rounding", "Time Off", "Holidays"].map((tab) => <button type="button" key={tab} onClick={() => flash(`${tab} opened.`)}>{tab}</button>)}</nav><div className="policy-title"><span className="attendance-icon">◷</span><div><h3>Overtime Rules</h3><p>Configure when overtime is earned and how it is calculated.</p></div><aside><strong>About Overtime</strong><small>Overtime rules determine when employees earn overtime and how it is paid.</small></aside></div><div className="policy-grid"><div><article className="attendance-card policy-card"><h3>1. Overtime Calculation</h3><p>Choose how overtime will be calculated.</p><div className="overtime-method-grid">{["Daily", "Weekly", "Daily & Weekly"].map((item) => <label className={method === item ? "selected" : ""} key={item}><input type="radio" checked={method === item} onChange={() => setMethod(item)} /> <strong>{item}</strong><small>{item === "Daily" ? "After a set number of hours in a day." : item === "Weekly" ? "After a set number of hours in a week." : "After daily and weekly thresholds."}</small></label>)}</div></article><article className="attendance-card policy-card"><h3>2. Overtime Threshold</h3><p>Set the number of hours before overtime is earned.</p><div className="overtime-inline"><label>Overtime after<input value={threshold} onChange={(e) => setThreshold(e.target.value)} /></label><span>hours per week</span><label>Calculate weekly overtime<select><option>Sunday – Saturday</option><option>Monday – Sunday</option></select></label></div></article><article className="attendance-card policy-card"><h3>3. Overtime Pay Rate</h3><p>Choose how overtime will be paid.</p>{["1.5x (Time and a half)", "2x (Double time)"].map((item) => <label className="overtime-radio" key={item}><input type="radio" checked={rate === item} onChange={() => setRate(item)} /> <strong>{item}</strong></label>)}<label className="overtime-radio"><input type="radio" checked={rate === "Custom multiplier"} onChange={() => setRate("Custom multiplier")} /> <strong>Custom multiplier</strong></label></article><article className="attendance-card policy-card"><h3>4. Overtime Rules</h3><p>Additional options for how overtime is applied.</p>{[["Include paid time off in overtime calculation", includePto, setIncludePto],["Round overtime to the nearest 15 minutes", round, setRound]].map(([title,value,setter]) => <div className="overtime-setting" key={title as string}><span>{title as string}</span>{toggle(value as boolean, setter as (next: boolean) => void)}</div>)}</article></div><aside><article className="attendance-card policy-preview"><h3>Overtime Preview</h3><p>See how overtime is calculated with these settings.</p>{[["Sun","8.00","$160.00"],["Mon","9.00","$180.00"],["Tue","8.50","$170.00"],["Wed","10.25","$245.00"],["Thu","8.00","$160.00"],["Fri","9.75","$217.50"],["Sat","6.00","$120.00"]].map(([day,hours,pay]) => <div className="overtime-preview-row" key={day}><strong>{day}</strong><span>{hours} hrs</span><b>{pay}</b></div>)}<div className="overtime-preview-total"><strong>Total</strong><span>59.50 hrs · 4.00 OT</span><b>$1,252.50</b></div></article><article className="attendance-card policy-summary"><h3>Overtime Rules Summary</h3>{[["Calculation Method",method],["Overtime Threshold",`${threshold} hours per week`],["Overtime Pay Rate",rate],["Include PTO",includePto ? "Yes" : "No"],["Round Overtime",round ? "Nearest 15 minutes" : "Exact time"]].map(([title,value]) => <div key={title}><span>{title}</span><b>{value}</b></div>)}<button className="text-button" type="button" onClick={() => flash("Overtime policy download started.")}>↓ Download Overtime Policy</button></article></aside></div></section></div></div>;
}

function TimeAttendancePolished({ flash, onNavigate }: { flash: (message: string) => void; onNavigate: (target: "general" | "time" | "access" | "owners" | "notifications" | "billing" | "scheduling") => void }) {
  const nav = [["▥", "Organization", "general"], ["▣", "Billing & Subscription", "billing"], ["⌖", "Locations", "general"], ["♙", "Roles & Permissions", "access"], ["◷", "Time & Attendance", "time"], ["▦", "Scheduling", "scheduling"], ["$", "Pay & Overtime", "owners"], ["♧", "Notifications", "notifications"], ["✣", "Integrations", "general"], ["♙", "Account", "owners"], ["▣", "Security", "access"]] as const;
  const tabs = ["Overview", "Attendance Policies", "Break Rules", "Overtime Rules", "Time Rounding", "Time Off", "Holidays"];
  const configTitles = ["Time Zone", "Pay Period", "Week Starts On", "Grace Period", "Auto Clock-Out"];
  const open = (label: string) => { if (label === "Week Starts On") return; if (configTitles.includes(label)) { const next = window.prompt(`Update ${label}`, configValues[label] || ""); if (next !== null && next.trim()) saveConfig(label, next.trim()); return; } flash(`${label} settings opened.`); };
  const [toggles, setToggles] = useState<Record<string, boolean>>({ "Time Tracking": true, "Location Tracking (GPS)": true, "Offline Time Clock": true, "Auto Reminders": true, "Auto Clock-Out": true });
  const [configValues, setConfigValues] = useState<Record<string, string>>({ "Time Zone": "Central Time (CT)", "Pay Period": "Weekly (Sun – Sat)", "Week Starts On": "Sunday", "Grace Period": "5 minutes", "Auto Clock-Out": "After 12 hours" });
  const [editingConfig, setEditingConfig] = useState<string | null>(null);
  const [autoSaveState, setAutoSaveState] = useState("Saved automatically");
  const [activeTab, setActiveTab] = useState("Overview");
  useEffect(() => { const bind = (label: string) => { const tab = Array.from(document.querySelectorAll<HTMLButtonElement>(".attendance-polished .time-polished-tabs button")).find((button) => button.textContent?.trim() === label); if (!tab) return () => {}; const handle = (event: Event) => { event.preventDefault(); event.stopImmediatePropagation(); setActiveTab(label); }; tab.addEventListener("click", handle, true); return () => tab.removeEventListener("click", handle, true); }; const cleanAttendance = bind("Attendance Policies"); const cleanBreaks = bind("Break Rules"); const cleanOvertime = bind("Overtime Rules"); return () => { cleanAttendance(); cleanBreaks(); cleanOvertime(); }; }, [activeTab]);
  useEffect(() => { fetch("/api/settings/time-attendance").then((response) => response.ok ? response.json() : null).then((payload) => { if (payload?.settings) setToggles(payload.settings); if (payload?.config) setConfigValues((current) => ({ ...current, ...payload.config })); }).catch(() => { try { const saved = localStorage.getItem("coreshift-time-attendance"); if (saved) setToggles(JSON.parse(saved)); const savedConfig = localStorage.getItem("coreshift-time-attendance-config"); if (savedConfig) setConfigValues((current) => ({ ...current, ...JSON.parse(savedConfig) })); } catch { /* defaults */ } }); }, []);
  const markAutoSaved = () => { setAutoSaveState("Saving…"); window.setTimeout(() => setAutoSaveState("Saved automatically"), 350); };
  const saveConfig = (title: string, value: string) => { const next = { ...configValues, [title]: value }; setConfigValues(next); setEditingConfig(null); try { localStorage.setItem("coreshift-time-attendance-config", JSON.stringify(next)); } catch { /* storage may be unavailable */ } fetch("/api/settings/time-attendance", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ config: next }) }).catch(() => {}); markAutoSaved(); flash(`${title} saved automatically.`); };
  const toggle = (label: string) => { const next = { ...toggles, [label]: !toggles[label] }; setToggles(next); try { localStorage.setItem("coreshift-time-attendance", JSON.stringify(next)); } catch { /* storage may be unavailable */ } fetch("/api/settings/time-attendance", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ settings: next }) }).catch(() => {}); markAutoSaved(); flash(`${label} ${next[label] ? "enabled" : "disabled"} and saved.`); };
  useEffect(() => { const labels = ["Time Tracking", "Location Tracking (GPS)", "Offline Time Clock", "Auto Reminders", "Auto Clock-Out"]; document.querySelectorAll<HTMLButtonElement>(".tracking-card .switch").forEach((button, index) => { const enabled = Boolean(toggles[labels[index]]); button.classList.toggle("on", enabled); button.classList.toggle("off", !enabled); button.setAttribute("aria-pressed", String(enabled)); }); }, [toggles]);
  useEffect(() => { const values = configValues; document.querySelectorAll<HTMLElement>(".config-card .attendance-config-row").forEach((row) => { const title = row.querySelector("strong")?.textContent?.trim(); const value = row.querySelector("b"); if (title && value && values[title]) value.textContent = values[title]; }); }, [configValues]);
  useEffect(() => { const head = document.querySelector<HTMLElement>(".time-polished:not(.attendance-policy-page) .time-polished-head"); if (!head) return; let status = head.querySelector<HTMLElement>(".auto-save-status"); if (!status) { status = document.createElement("span"); status.className = "auto-save-status"; head.appendChild(status); } status.textContent = `✓ ${autoSaveState}`; }, [autoSaveState]);
  useEffect(() => { const row = Array.from(document.querySelectorAll<HTMLElement>(".config-card .attendance-config-row")).find((item) => item.querySelector("strong")?.textContent?.trim() === "Week Starts On"); if (!row) return; const pencil = row.querySelector<HTMLButtonElement>("button"); if (pencil) pencil.style.display = "none"; const existing = row.querySelector<HTMLSelectElement>("select"); if (existing) { existing.value = configValues["Week Starts On"] || "Sunday"; return; } const value = row.querySelector("b"); if (!value) return; const select = document.createElement("select"); select.className = "config-inline-select"; ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].forEach((day) => { const option = document.createElement("option"); option.value = day; option.textContent = day; select.appendChild(option); }); select.value = configValues["Week Starts On"] || "Sunday"; select.addEventListener("change", () => saveConfig("Week Starts On", select.value)); value.replaceWith(select); }, [configValues]);
  useEffect(() => { const choices: Record<string, string[]> = { "Time Zone": ["Central Time (CT)", "Eastern Time (ET)", "Mountain Time (MT)", "Pacific Time (PT)"], "Pay Period": ["Weekly (Sun – Sat)", "Biweekly", "Semimonthly", "Monthly"], "Grace Period": ["0 minutes", "5 minutes", "10 minutes", "15 minutes"], "Auto Clock-Out": ["Never", ...Array.from({ length: 9 }, (_, index) => `After ${index + 4} hours`)] }; document.querySelectorAll<HTMLElement>(".config-card .attendance-config-row").forEach((row) => { const title = row.querySelector("strong")?.textContent?.trim(); const button = row.querySelector<HTMLButtonElement>("button"); if (!title || !button || !choices[title] || button.dataset.editorBound) return; button.dataset.editorBound = "true"; button.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); if (row.querySelector("select")) return; row.classList.add("editing"); const value = row.querySelector("b"); if (!value) return; const select = document.createElement("select"); select.className = "config-inline-select"; choices[title].forEach((item) => { const option = document.createElement("option"); option.value = item; option.textContent = item; select.appendChild(option); }); select.value = configValues[title] || choices[title][0]; const save = document.createElement("button"); save.className = "config-inline-action primary"; save.textContent = "Save"; const cancel = document.createElement("button"); cancel.className = "config-inline-action"; cancel.textContent = "Cancel"; save.addEventListener("click", () => saveConfig(title, select.value)); cancel.addEventListener("click", () => { select.replaceWith(value); save.remove(); cancel.remove(); row.classList.remove("editing"); button.style.display = ""; }); value.replaceWith(select); button.style.display = "none"; row.append(save, cancel); }); }); }, [configValues]);
  if (activeTab === "Attendance Policies") return <AttendancePoliciesView flash={flash} onNavigate={onNavigate} onBack={() => setActiveTab("Overview")} onBreak={() => setActiveTab("Break Rules")} />;
  if (activeTab === "Break Rules") return <BreakRulesView flash={flash} onNavigate={onNavigate} onBack={() => setActiveTab("Overview")} onAttendance={() => setActiveTab("Attendance Policies")} />;
  if (activeTab === "Overtime Rules") return <OvertimeRulesView flash={flash} onBack={() => setActiveTab("Overview")} onAttendance={() => setActiveTab("Attendance Policies")} />;
  const summary = [["◷", "Time Tracking", "Enabled", "Employees can clock in/out", "green"], ["⌖", "Location Tracking", "Required", "Clock in at approved locations", "purple"], ["ϟ", "Overtime", "Daily", "After 8 hours per day", "orange"], ["▣", "Time Off Policies", "2 Active", "No Call / No Show enabled", "blue"]] as const;
  const config = [["◉", "Time Zone", "Central Time (CT)"], ["▣", "Pay Period", "Weekly (Sun – Sat)"], ["◷", "Grace Period", "5 minutes"], ["◴", "Auto Clock-Out", "After 12 hours"]] as const;
  return <div className="settings-reference attendance-polished"><aside className="settings-reference-nav"><div className="settings-ref-nav-list">{nav.map(([icon, title, target]) => <button type="button" className={target === "time" ? "active" : ""} key={title} onClick={() => onNavigate(target)}><span>{icon}</span><div><strong>{title}</strong><small>{title === "Time & Attendance" ? "Rules and time tracking" : "Settings and preferences"}</small></div></button>)}</div><div className="settings-ref-promo"><strong>Track time smarter</strong><p>Set up advanced rules, attendance policies, and automations.</p><button type="button" onClick={() => flash("Settings help opened.")}>Learn More</button></div></aside><div className="settings-reference-main"><section className="time-polished"><header className="time-polished-head"><div><h2>Time &amp; Attendance</h2><p>Configure how time is tracked, attendance is recorded, and rules are applied.</p></div><button className="primary-button" type="button" onClick={() => open("Time & Attendance configuration")}>✎ Edit Configuration</button></header><nav className="time-polished-tabs">{tabs.map((tab, index) => <button type="button" className={index === 0 ? "active" : ""} key={tab} onClick={() => open(tab)}>{tab}</button>)}</nav><div className="attendance-kpis">{summary.map(([icon, title, value, detail, tone]) => <button className={`attendance-kpi ${tone}`} type="button" key={title} onClick={() => open(title)}><span>{icon}</span><div><strong>{title}</strong><b>{value}</b><small>{detail}</small></div><i>›</i></button>)}</div><div className="attendance-main-grid"><article className="attendance-card tracking-card"><div className="attendance-card-head"><div><h3>Tracking Settings</h3><p>Control how time is tracked and recorded</p></div><button className="text-button" type="button" onClick={() => open("Tracking settings")}>View all tracking settings →</button></div>{[["◷", "Time Tracking", "Allow employees to clock in and out"], ["⌖", "Location Tracking (GPS)", "Require employees to clock in at approved locations"], ["⌁", "Offline Time Clock", "Allow clock in/out when internet is unavailable"], ["♧", "Auto Reminders", "Send reminders to employees to clock in/out"], ["◴", "Auto Clock-Out", "Automatically clock out employees after threshold"]].map(([icon, title, detail]) => <div className="attendance-toggle-row" key={title}><span className="attendance-icon">{icon}</span><div><strong>{title}</strong><small>{detail}</small></div><button type="button" className="switch on" aria-label={`Toggle ${title}`} onClick={() => toggle(title)}><i /></button></div>)}</article><article className="attendance-card config-card"><div className="attendance-card-head"><div><h3>Company Configuration</h3><p>Basic time and attendance configuration</p></div></div>{config.map(([icon, title, value]) => <div className="attendance-config-row" key={title}><span className="attendance-icon">{icon}</span><strong>{title}</strong><b>{value}</b><button type="button" onClick={() => open(title)}>✎</button></div>)}<button className="text-button attendance-bottom-link" type="button" onClick={() => open("Configuration settings")}>View all configuration settings →</button></article></div><div className="attendance-bottom-grid"><article className="attendance-card rules-card"><div className="attendance-card-head"><div><h3>Rules At A Glance</h3><p>Quick overview of your active rules</p></div></div><div className="rule-mini-grid">{[["♧", "Attendance Policies", "2 Active", "No Call / No Show enabled", "green"], ["▱", "Break Rules", "1 Rule", "30 min unpaid break", "purple"], ["ϟ", "Overtime Rules", "1 Rule", "Daily overtime after 8 hours", "orange"], ["◷", "Time Rounding", "15 min", "Round to nearest 15 minutes", "blue"]].map(([icon, title, value, detail, tone]) => <button type="button" className={`rule-mini ${tone}`} key={title} onClick={() => open(title)}><span>{icon}</span><strong>{title}</strong><b>{value}</b><small>{detail}</small><em>Manage →</em></button>)}</div></article><article className="attendance-card changes-card"><div className="attendance-card-head"><div><h3>Recent Changes</h3><p>Latest updates to time &amp; attendance</p></div></div>{[["Grace period updated", "5 minutes → 10 minutes", "Yesterday"], ["Overtime rules updated", "Daily overtime after 8 hours", "2 days ago"], ["Holiday added", "Labor Day", "3 days ago"]].map(([title, detail, when]) => <div className="change-row" key={title}><i /><div><strong>{title}</strong><small>{detail}</small></div><span>{when}</span></div>)}<button className="text-button" type="button" onClick={() => open("All changes")}>View all changes →</button></article><article className="attendance-card preview-card"><div className="attendance-card-head"><div><h3>Employee Experience Preview</h3><p>What employees will experience</p></div></div>{[["⌖", "Clock In", "GPS Required", "green"], ["▱", "Break Rules", "30 min unpaid", "purple"], ["ϟ", "Overtime", "After 8 hours", "orange"], ["◴", "Auto Clock-Out", "After 12 hours", "pink"]].map(([icon, title, value, tone]) => <div className="preview-row" key={title}><span className={`attendance-icon ${tone}`}>{icon}</span><strong>{title}</strong><b className={tone}>{value}</b></div>)}<button className="text-button" type="button" onClick={() => open("Employee preview")}>View full preview →</button></article></div></section></div></div>;
}

function TimeAttendanceFixed({ flash, onNavigate }: { flash: (message: string) => void; onNavigate: (target: "general" | "time" | "access" | "owners" | "notifications" | "billing" | "scheduling") => void }) {
  const nav = [["▥", "Organization", "general"], ["▣", "Billing & Subscription", "billing"], ["⌖", "Locations", "general"], ["♙", "Roles & Permissions", "access"], ["◷", "Time & Attendance", "time"], ["▦", "Scheduling", "scheduling"], ["$", "Pay & Overtime", "owners"], ["♧", "Notifications", "notifications"], ["✣", "Integrations", "general"], ["♙", "Account", "owners"], ["▣", "Security", "access"]] as const;
  return <div className="settings-reference"><aside className="settings-reference-nav"><div className="settings-ref-nav-list">{nav.map(([icon,title,target]) => <button type="button" className={target === "time" ? "active" : ""} key={title} onClick={() => onNavigate(target)}><span>{icon}</span><div><strong>{title}</strong><small>{title === "Time & Attendance" ? "Rules and time tracking" : "Settings and preferences"}</small></div></button>)}</div><div className="settings-ref-promo"><strong>Track time smarter</strong><p>Set up advanced rules, attendance policies, and automations.</p><button type="button" onClick={() => flash("Settings help opened.")}>Learn More</button></div></aside><div className="settings-reference-main"><section className="time-reference"><div className="roles-reference-head"><div><h2>Time &amp; Attendance</h2><p>Configure how time is tracked, attendance is recorded, and rules are applied.</p></div><button className="secondary-button" type="button" onClick={() => flash("Time settings editor opened.")}>✎ Edit Settings</button></div><div className="roles-reference-tabs">{["Overview","Attendance Policies","Break Rules","Overtime Rules","Time Rounding","Time Off","Holidays"].map((tab,index) => <button className={index === 0 ? "active" : ""} type="button" key={tab} onClick={() => flash(`${tab} opened.`)}>{tab}</button>)}</div><div className="time-reference-grid"><div><article className="panel time-card"><h3>Tracking Settings</h3><div className="time-tracking-grid">{[["◷","Time Tracking","Enabled","Employees can clock in/out"],["⌖","Location Tracking","Required","Employees must clock in at approved locations"],["⌁","Offline Time Clock","Enabled","Allow clock in/out offline"],["♧","Auto Reminders","Enabled","Remind employees to clock in/out"]].map(([icon,title,value,detail]) => <div key={title}><span className="role-icon">{icon}</span><strong>{title}<b>{value}</b></strong><small>{detail}</small></div>)}</div></article><article className="panel time-card"><h3>Rules At A Glance</h3><div className="time-rules-grid">{[["♧","Attendance Policies","2 Policies","No Call / No Show"],["▱","Break Rules","1 Rule","30 min unpaid break"],["◷","Overtime Rules","1 Rule","Daily overtime after 8 hours"],["◴","Time Rounding","15 min","Round to nearest 15 minutes"]].map(([icon,title,value,detail]) => <div key={title}><span className="role-icon">{icon}</span><strong>{title}</strong><b>{value}</b><small>{detail}</small><button type="button" onClick={() => flash(`${title} opened.`)}>Manage →</button></div>)}</div></article></div><aside><article className="panel time-card"><h3>Time &amp; Attendance Summary</h3>{[["Time Zone","Central Time (CT)"],["Pay Period","Weekly (Sun – Sat)"],["Week Starts On","Sunday"],["Grace Period","5 minutes"],["Auto Clock-Out","After 12 hours"]].map(([title,value]) => <div className="time-setting" key={title}><span className="role-icon">▣</span><div><strong>{title}</strong><b>{value}</b></div><button type="button" onClick={() => flash(`${title} opened.`)}>Edit</button></div>)}</article></aside></div></section></div></div>;
}

function TimeAttendancePage({ flash, onNavigate, timeFormat, updateTimeFormat, rounding }: { flash: (message: string) => void; onNavigate: (target: "general" | "time" | "access" | "owners" | "notifications" | "billing" | "scheduling") => void; timeFormat: "24" | "12"; updateTimeFormat: (value: "24" | "12") => void; rounding: string }) {
  const onBack = () => onNavigate("general");
  const nav = [["▥", "Organization", "Company profile and details"], ["▣", "Billing & Subscription", "Manage your plan and billing"], ["⌖", "Locations", "Manage your locations"], ["♙", "Roles & Permissions", "Control access and permissions"], ["◷", "Time & Attendance", "Rules and time tracking"], ["▦", "Scheduling", "Scheduling preferences"], ["$", "Pay & Overtime", "Pay rates and overtime rules"], ["♧", "Notifications", "Notification preferences"], ["✣", "Integrations", "Connected apps and services"], ["♙", "Account", "Your account settings"], ["▣", "Security", "Password and security"]];
  const setting = (icon: string, title: string, value: string, detail: string) => <div className="time-setting"><span className="role-icon">{icon}</span><div><strong>{title}</strong><b>{value}</b><small>{detail}</small></div><button type="button" onClick={() => flash(`${title} settings opened.`)}>Edit</button></div>;
  return <div className="settings-reference"><aside className="settings-reference-nav"><div className="settings-ref-nav-list">{nav.map(([icon, title, desc], index) => <button type="button" className={index === 5 ? "active" : ""} key={title} onClick={() => index === 0 ? onBack() : flash(`${title} settings opened.`)}><span>{icon}</span><div><strong>{title}</strong><small>{desc}</small></div></button>)}</div><div className="settings-ref-promo"><strong>Track time smarter</strong><p>Set up advanced rules, attendance policies, and automations.</p><button type="button" onClick={() => flash("Settings help opened.")}>Learn More</button></div></aside><div className="settings-reference-main"><section className="time-reference"><div className="roles-reference-head"><div><h2>Time &amp; Attendance</h2><p>Configure how time is tracked, attendance is recorded, and rules are applied.</p></div><button className="secondary-button" type="button" onClick={() => flash("Time settings editor opened.")}>✎ Edit Settings</button></div><div className="roles-reference-tabs"><button className="active" type="button">Overview</button>{["Attendance Policies", "Break Rules", "Overtime Rules", "Time Rounding", "Time Off", "Holidays"].map((tab) => <button type="button" key={tab} onClick={() => flash(`${tab} opened.`)}>{tab}</button>)}</div><div className="time-reference-grid"><div><article className="panel time-card"><h3>Tracking Settings</h3><div className="time-tracking-grid">{[["◷", "Time Tracking", "Enabled", "Employees can clock in/out"], ["⌖", "Location Tracking", "Required", "Employees must clock in at approved locations"], ["⌁", "Offline Time Clock", "Enabled", "Allow clock in/out offline"], ["♧", "Auto Reminders", "Enabled", "Remind employees to clock in/out"]].map(([icon, title, value, detail]) => <div key={title}><span className="role-icon">{icon}</span><strong>{title}<b>{value}</b></strong><small>{detail}</small></div>)}</div></article><article className="panel time-card"><h3>Rules At A Glance</h3><div className="time-rules-grid">{[["♧", "Attendance Policies", "2 Policies", "No Call / No Show · Late Arrival"], ["▱", "Break Rules", "1 Rule", "30 min unpaid break for shifts > 6 hours"], ["◷", "Overtime Rules", "1 Rule", "Daily overtime after 8 hours"], ["◴", "Time Rounding", rounding, "Round to nearest 15 minutes"]].map(([icon, title, count, detail]) => <div key={title}><span className="role-icon">{icon}</span><strong>{title}</strong><b>{count}</b><small>{detail}</small><button type="button" onClick={() => flash(`${title} opened.`)}>Manage →</button></div>)}</div></article><article className="panel time-card"><h3>Upcoming Holidays <button className="text-button" type="button" onClick={() => flash("Holiday settings opened.")}>Manage Holidays →</button></h3>{["May 27, 2024　 Memorial Day", "Jul 4, 2024　 Independence Day", "Sep 2, 2024　 Labor Day"].map((holiday) => <div className="holiday-row" key={holiday}><span>{holiday}</span><em>Paid</em></div>)}</article></div><aside><article className="panel time-card"><h3>Time &amp; Attendance Summary</h3>{[setting("▣", "Time Zone", "Central Time (CT)", ""), setting("▤", "Pay Period", "Weekly (Sun – Sat)", ""), setting("▣", "Week Starts On", "Sunday", ""), setting("◌", "Grace Period", "5 minutes", ""), setting("↻", "Auto Clock-Out", "After 12 hours", "")].map((item, index) => <div key={index}>{item}</div>)}<button className="text-button" type="button" onClick={() => flash("All policies opened.")}>View all policies　→</button></article><article className="panel time-card"><h3>Attendance Tracking</h3>{[["♧", "Absence Tracking", "Enabled"], ["☆", "Points System", "Disabled"], ["▥", "Attendance Reports", "View reports"], ["⚑", "Exceptions", "Review exceptions"]].map(([icon, title, value]) => <div className="attendance-row" key={title}><span className="role-icon">{icon}</span><div><strong>{title}</strong><small>{value}</small></div><button type="button" onClick={() => flash(`${title} opened.`)}>›</button></div>)}<button className="text-button" type="button" onClick={() => flash("Reports opened.")}>Go to Reports　→</button></article></aside></div><footer className="time-footer">▣　All time tracking data is stored securely and cannot be edited.</footer></section></div></div>;
}

function RolesDataVisibilityV8({ flash, onNavigate }: { flash: (message: string) => void; onNavigate: (target: "general" | "time" | "access" | "owners" | "notifications" | "billing" | "scheduling") => void }) {
  const roles = ["Owner", "Manager", "Supervisor", "Employee", "Viewer"];
  const groups = [["Scheduling", ["Build and edit schedules", "View own schedule", "View everyone’s schedule", "Publish schedules", "Edit availability rules", "Manage time-off calendar"]], ["Requests", ["Approve time-off requests", "Approve shift swaps", "Approve availability changes", "Approve open shifts", "Deny requests", "Cancel approved requests"]], ["Time & attendance", ["View time clock", "Edit time entries", "Approve timesheets", "Manage breaks and overtime", "Export time records"]], ["Pay & earnings", ["View pay rates", "View payroll totals", "View employee earnings", "Run payroll", "Export payroll"]], ["Team & profiles", ["View team directory", "Add employees", "Edit employee profiles", "Deactivate employees", "Assign roles"]], ["Reports & exports", ["View reports", "Create reports", "Export reports", "View labor costs"]], ["Documents", ["View documents", "Upload documents", "Edit document details", "Download documents", "Create folders", "Delete documents"]], ["Messaging & notifications", ["View messages", "Send direct messages", "Create group messages", "Manage notifications"]], ["Administration", ["Manage settings", "Manage integrations", "Manage billing", "View audit log"]]] as const;
  const [role, setRole] = useState("Supervisor"); const [tab, setTab] = useState<"assignments" | "controls">("assignments"); const [employees, setEmployees] = useState<Employee[]>([]); const [assignments, setAssignments] = useState<Record<string, string>>({}); const [enabled, setEnabled] = useState<Record<string, Record<string, boolean>>>({});
  const nav = [["▥", "Organization", "general"], ["▣", "Billing & Subscription", "billing"], ["⌖", "Locations", "general"], ["♙", "Roles & Permissions", "access"], ["◷", "Time & Attendance", "time"], ["▦", "Scheduling", "scheduling"], ["$", "Pay & Overtime", "owners"], ["♧", "Notifications", "notifications"], ["✣", "Integrations", "general"], ["♙", "Account", "owners"], ["▣", "Security", "access"]] as const;
  useEffect(() => { fetch("/api/employees").then((r) => r.ok ? r.json() : []).then(setEmployees).catch(() => {}); try { const a = localStorage.getItem("coreshift-role-assignments"); if (a) setAssignments(JSON.parse(a)); const e = localStorage.getItem("coreshift-role-schedule-request-controls"); if (e) setEnabled(JSON.parse(e)); } catch {} }, []);
  const save = () => { try { localStorage.setItem("coreshift-role-assignments", JSON.stringify(assignments)); localStorage.setItem("coreshift-role-schedule-request-controls", JSON.stringify(enabled)); } catch {} fetch("/api/settings/role-permissions", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ permissions: enabled }) }).catch(() => {}); Object.entries(assignments).forEach(([id, assignedRole]) => fetch(`/api/employees/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ role: assignedRole }) }).catch(() => {})); flash("Role permissions saved."); };
  useEffect(() => { document.querySelectorAll<HTMLElement>(".roles-reference-tabs button").forEach((button) => { if (button.textContent?.trim() === "Scheduling & requests") button.textContent = "Access permissions"; }); }, []);
  useEffect(() => { document.querySelectorAll<HTMLElement>(".permission-group summary em").forEach((node, index) => { const items = groups[index]?.[1] ?? []; const active = role === "Owner" ? items.length : items.filter((item) => enabled[role]?.[item]).length; node.innerHTML = `<b>${items.length} permissions</b><i><span class="permission-enabled">${active} enabled</span> · <span class="permission-disabled">${items.length - active} disabled</span></i>`; }); document.querySelectorAll<HTMLInputElement>(".permission-group .approval-toggle input").forEach((input, index) => { const item = groups.flatMap(([, items]) => items)[index]; input.checked = role === "Owner" || Boolean(enabled[role]?.[item]); input.disabled = role === "Owner"; }); }, [enabled, role]);
  const totalPermissions = groups.reduce((sum, [, items]) => sum + items.length, 0); const enabledPermissions = role === "Owner" ? totalPermissions : groups.reduce((sum, [, items]) => sum + items.filter((item) => enabled[role]?.[item]).length, 0); const accessPercent = totalPermissions ? Math.round((enabledPermissions / totalPermissions) * 100) : 0;
  return <div className="settings-reference"><aside className="settings-reference-nav"><div className="settings-ref-nav-list">{nav.map(([icon, title, target]) => <button type="button" className={target === "access" ? "active" : ""} key={title} onClick={() => onNavigate(target)}><span>{icon}</span><div><strong>{title}</strong><small>Settings and preferences</small></div></button>)}</div></aside><div className="settings-reference-main"><section className="roles-reference"><div className="roles-reference-head"><div><h2>Roles &amp; Permissions</h2><p>Assign employees to roles and control access by category.</p></div><button className="primary-button" type="button" onClick={save}>Save changes</button></div><div className="roles-reference-tabs"><button type="button" className={tab === "assignments" ? "active" : ""} onClick={() => setTab("assignments")}>Team assignments</button><button type="button" className={tab === "controls" ? "active" : ""} onClick={() => setTab("controls")}>Scheduling &amp; requests</button></div>{tab === "assignments" ? <div className="panel role-members-panel"><h3>Team role assignments</h3>{employees.map((employee) => <div className="role-member-row" key={employee.id}><strong>{employee.name}</strong><select value={assignments[String(employee.id)] || employee.role || "Employee"} onChange={(e) => setAssignments((c) => ({ ...c, [String(employee.id)]: e.target.value }))}>{roles.map((r) => <option key={r}>{r}</option>)}</select></div>)}</div> : <div className="panel role-members-panel"><div className="role-members-head"><div><h3>Permissions by category</h3><p>Choose a role, then expand each category to set access.</p></div><div className="permission-progress"><strong>{role} access</strong><span>{accessPercent}%</span><i><b style={{ width: `${accessPercent}%` }} /></i></div><select value={role} onChange={(e) => setRole(e.target.value)}>{roles.map((r) => <option key={r}>{r}</option>)}</select></div>{groups.map(([title, items]) => { const activeCount = items.filter((item) => enabled[role]?.[item]).length; const descriptions: Record<string, string> = { Scheduling: "Create and manage schedules, shifts, and templates.", Requests: "Manage time off, availability, and other requests.", "Time & attendance": "View and manage clock-ins, timesheets and hours.", "Pay & earnings": "View payroll, wages, tips and compensation.", "Team & profiles": "Manage employee profiles and team information.", "Reports & exports": "View reports and export company data.", Documents: "Browse, upload, organize, and manage company documents.", "Messaging & notifications": "Send messages and manage notifications.", Administration: "Manage company settings and integrations." }; const icons: Record<string, string> = { Scheduling: "▣", Requests: "⇄", "Time & attendance": "◷", "Pay & earnings": "$", "Team & profiles": "♙", "Reports & exports": "▥", "Messaging & notifications": "▱", Administration: "⚙" }; return <details className="permission-group" key={title} open={title === "Scheduling" || title === "Requests"}><summary><span className="permission-group-icon">{icons[title] || "•"}</span><strong><b>{title}</b><small>{descriptions[title]}</small></strong><em><b>{items.length} permissions</b><i>{activeCount} enabled · {items.length - activeCount} disabled</i></em><span className="permission-group-arrow">⌄</span></summary>{items.map((item) => <label className="approval-toggle" key={item}><span>{item}</span><input type="checkbox" checked={Boolean(enabled[role]?.[item])} onChange={() => setEnabled((current) => ({ ...current, [role]: { ...(current[role] || {}), [item]: !current[role]?.[item] } }))} /></label>)}</details>; })}</div>}</section></div></div>;
}

function RolesDataVisibilityV7({ flash, onNavigate }: { flash: (message: string) => void; onNavigate: (target: "general" | "time" | "access" | "owners" | "notifications" | "billing" | "scheduling") => void }) {
  const roles = ["Owner", "Manager", "Supervisor", "Employee", "Viewer"];
  const controls = ["Build and edit schedules", "View own schedule", "View everyone’s schedule", "Approve time-off requests", "Approve shift swaps", "Approve availability changes", "Approve open shifts"];
  const [role, setRole] = useState("Supervisor"); const [tab, setTab] = useState<"assignments" | "controls">("assignments"); const [employees, setEmployees] = useState<Employee[]>([]); const [assignments, setAssignments] = useState<Record<string, string>>({}); const [enabled, setEnabled] = useState<Record<string, Record<string, boolean>>>({});
  const nav = [["▥", "Organization", "general"], ["▣", "Billing & Subscription", "billing"], ["⌖", "Locations", "general"], ["♙", "Roles & Permissions", "access"], ["◷", "Time & Attendance", "time"], ["▦", "Scheduling", "scheduling"], ["$", "Pay & Overtime", "owners"], ["♧", "Notifications", "notifications"], ["✣", "Integrations", "general"], ["♙", "Account", "owners"], ["▣", "Security", "access"]] as const;
  useEffect(() => { fetch("/api/employees").then((r) => r.ok ? r.json() : []).then(setEmployees).catch(() => {}); try { const a = window.localStorage.getItem("coreshift-role-assignments"); if (a) setAssignments(JSON.parse(a)); const e = window.localStorage.getItem("coreshift-role-schedule-request-controls"); if (e) setEnabled(JSON.parse(e)); } catch {} }, []);
  const save = () => { try { localStorage.setItem("coreshift-role-assignments", JSON.stringify(assignments)); localStorage.setItem("coreshift-role-schedule-request-controls", JSON.stringify(enabled)); } catch {} Object.entries(assignments).forEach(([id, assignedRole]) => fetch(`/api/employees/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ role: assignedRole }) }).catch(() => {})); flash("Role and scheduling/request permissions saved."); };
  const toggle = (item: string) => setEnabled((current) => ({ ...current, [role]: { ...(current[role] || {}), [item]: !current[role]?.[item] } }));
  return <div className="settings-reference"><aside className="settings-reference-nav"><div className="settings-ref-nav-list">{nav.map(([icon, title, target]) => <button type="button" className={target === "access" ? "active" : ""} key={title} onClick={() => onNavigate(target)}><span>{icon}</span><div><strong>{title}</strong><small>Settings and preferences</small></div></button>)}</div></aside><div className="settings-reference-main"><section className="roles-reference"><div className="roles-reference-head"><div><h2>Roles &amp; Permissions</h2><p>Assign employees to roles and control scheduling and request access.</p></div><button className="primary-button" type="button" onClick={save}>Save changes</button></div><div className="roles-reference-tabs"><button type="button" className={tab === "assignments" ? "active" : ""} onClick={() => setTab("assignments")}>Team assignments</button><button type="button" className={tab === "controls" ? "active" : ""} onClick={() => setTab("controls")}>Scheduling &amp; requests</button></div>{tab === "assignments" ? <div className="panel role-members-panel"><h3>Team role assignments</h3>{employees.map((employee) => <div className="role-member-row" key={employee.id}><strong>{employee.name}</strong><select value={assignments[String(employee.id)] || employee.role || "Employee"} onChange={(e) => setAssignments((c) => ({ ...c, [String(employee.id)]: e.target.value }))}>{roles.map((r) => <option key={r}>{r}</option>)}</select></div>)}</div> : <div className="panel role-members-panel"><div className="role-members-head"><div><h3>Scheduling &amp; request permissions</h3><p>Each checkbox is an explicit permission for the selected role.</p></div><select value={role} onChange={(e) => setRole(e.target.value)}>{roles.map((r) => <option key={r}>{r}</option>)}</select></div>{controls.map((item) => <label className="approval-toggle" key={item}><span>{item}</span><input type="checkbox" checked={Boolean(enabled[role]?.[item])} onChange={() => toggle(item)} /></label>)}</div>}</section></div></div>;
}

function RolesDataVisibilityV6({ flash, onNavigate }: { flash: (message: string) => void; onNavigate: (target: "general" | "time" | "access" | "owners" | "notifications" | "billing" | "scheduling") => void }) {
  const roles = ["Owner", "Manager", "Supervisor", "Employee", "Viewer"];
  const scheduleOptions = ["Build and edit schedules", "View own schedule", "View everyone’s schedule"];
  const requestTypes = ["Time-off requests", "Shift swaps", "Availability changes", "Open shifts"];
  const nav = [["▥", "Organization", "general"], ["▣", "Billing & Subscription", "billing"], ["⌖", "Locations", "general"], ["♙", "Roles & Permissions", "access"], ["◷", "Time & Attendance", "time"], ["▦", "Scheduling", "scheduling"], ["$", "Pay & Overtime", "owners"], ["♧", "Notifications", "notifications"], ["✣", "Integrations", "general"], ["♙", "Account", "owners"], ["▣", "Security", "access"]] as const;
  const [employees, setEmployees] = useState<Employee[]>([]); const [assignments, setAssignments] = useState<Record<string, string>>({}); const [role, setRole] = useState("Supervisor"); const [tab, setTab] = useState<"assignments" | "controls">("assignments"); const [controls, setControls] = useState<Record<string, Record<string, boolean>>>({});
  useEffect(() => { fetch("/api/employees").then((response) => response.ok ? response.json() : []).then((items: Employee[]) => setEmployees(items)).catch(() => {}); try { const saved = window.localStorage.getItem("coreshift-role-assignments"); if (saved) setAssignments(JSON.parse(saved)); const savedControls = window.localStorage.getItem("coreshift-role-schedule-request-controls"); if (savedControls) setControls(JSON.parse(savedControls)); } catch { /* storage unavailable */ } }, []);
  const save = () => { try { window.localStorage.setItem("coreshift-role-assignments", JSON.stringify(assignments)); window.localStorage.setItem("coreshift-role-schedule-request-controls", JSON.stringify(controls)); } catch { /* storage unavailable */ } Object.entries(assignments).forEach(([employeeId, assignedRole]) => { fetch(`/api/employees/${employeeId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ role: assignedRole }) }).catch(() => {}); }); flash("Role, scheduling, and request settings saved."); };
  const toggle = (item: string) => setControls((current) => ({ ...current, [role]: { ...(current[role] || {}), [item]: !current[role]?.[item] } }));
  return <div className="settings-reference"><aside className="settings-reference-nav"><div className="settings-ref-nav-list">{nav.map(([icon, title, target]) => <button type="button" className={target === "access" ? "active" : ""} key={title} onClick={() => onNavigate(target)}><span>{icon}</span><div><strong>{title}</strong><small>Settings and preferences</small></div></button>)}</div><div className="settings-ref-promo"><strong>Customize your experience</strong><p>Assign roles and control scheduling and request access.</p></div></aside><div className="settings-reference-main"><section className="roles-reference"><div className="roles-reference-head"><div><h2>Roles &amp; Permissions</h2><p>Assign employees to roles, then control scheduling and request access.</p></div><button className="primary-button" type="button" onClick={save}>Save changes</button></div><div className="roles-reference-tabs"><button type="button" className={tab === "assignments" ? "active" : ""} onClick={() => setTab("assignments")}>Team assignments</button><button type="button" className={tab === "controls" ? "active" : ""} onClick={() => setTab("controls")}>Scheduling &amp; requests</button></div>{tab === "assignments" ? <div className="panel role-members-panel"><div className="role-members-head"><div><h3>Team role assignments</h3><p>Choose a role directly for each employee.</p></div><span>{employees.length} team members</span></div>{employees.length ? employees.map((employee) => <div className="role-member-row" key={employee.id}><div className="role-member-name"><span className="role-member-avatar">{employee.initials || employee.name.slice(0, 2).toUpperCase()}</span><strong>{employee.name}</strong></div><select value={assignments[String(employee.id)] || employee.role || "Employee"} onChange={(event) => setAssignments((current) => ({ ...current, [String(employee.id)]: event.target.value }))}>{roles.map((item) => <option key={item}>{item}</option>)}</select><small>{assignments[String(employee.id)] || employee.role || "Employee"}</small></div>) : <div className="role-members-empty">Loading team members…</div>}</div> : <div className="panel role-members-panel"><div className="role-members-head"><div><h3>Scheduling &amp; request permissions</h3><p>Select a role, then choose exactly what it can manage.</p></div><select value={role} onChange={(event) => setRole(event.target.value)}>{roles.map((item) => <option key={item}>{item}</option>)}</select></div><h3>Scheduling</h3>{scheduleOptions.map((item) => <label className="approval-toggle" key={item}><span>{item}</span><input type="checkbox" checked={role === "Owner" || Boolean(controls[role]?.[item])} disabled={role === "Owner"} onChange={() => toggle(item)} /></label>)}<h3>Requests</h3>{requestTypes.map((item) => <label className="approval-toggle" key={item}><span>Approve {item.toLowerCase()}</span><input type="checkbox" checked={role === "Owner" || Boolean(controls[role]?.[item])} disabled={role === "Owner"} onChange={() => toggle(item)} /></label>)}</div>}</section></div></div>;
}

function RolesDataVisibilityV5({ flash, onNavigate }: { flash: (message: string) => void; onNavigate: (target: "general" | "time" | "access" | "owners" | "notifications" | "billing" | "scheduling") => void }) {
  const roles = ["Owner", "Manager", "Supervisor", "Employee", "Viewer"];
  const areas = ["Dashboard", "Schedule", "Time Clock", "Team", "Requests", "Reports", "Payroll", "Documents", "Settings"];
  const actions = ["View", "Create", "Edit", "Approve", "Export", "Delete"];
  const scheduleOptions = ["Build and edit schedules", "View own schedule", "View everyone’s schedule"];
  const nav = [["▥", "Organization", "general"], ["▣", "Billing & Subscription", "billing"], ["⌖", "Locations", "general"], ["♙", "Roles & Permissions", "access"], ["◷", "Time & Attendance", "time"], ["▦", "Scheduling", "scheduling"], ["$", "Pay & Overtime", "owners"], ["♧", "Notifications", "notifications"], ["✣", "Integrations", "general"], ["♙", "Account", "owners"], ["▣", "Security", "access"]] as const;
  const [role, setRole] = useState("Supervisor");
  const [tab, setTab] = useState<"permissions" | "schedule">("permissions");
  const [permissions, setPermissions] = useState<Record<string, Record<string, boolean>>>({});
  const [schedulePermissions, setSchedulePermissions] = useState<Record<string, Record<string, boolean>>>({});
  const granted = (area: string) => role === "Owner" ? actions : (permissions[role]?.[area] ? actions : actions.filter((action) => action === "View"));
  const toggle = (area: string, action: string) => setPermissions((current) => ({ ...current, [role]: { ...(current[role] || {}), [area]: !(current[role]?.[area]) } }));
  const save = () => { try { window.localStorage.setItem("coreshift-role-permissions", JSON.stringify(permissions)); window.localStorage.setItem("coreshift-role-schedule-permissions", JSON.stringify(schedulePermissions)); } catch { /* storage unavailable */ } flash("Role and schedule permissions saved."); };
  return <div className="settings-reference"><aside className="settings-reference-nav"><div className="settings-ref-nav-list">{nav.map(([icon, title, target]) => <button type="button" className={target === "access" ? "active" : ""} key={title} onClick={() => onNavigate(target)}><span>{icon}</span><div><strong>{title}</strong><small>Settings and preferences</small></div></button>)}</div><div className="settings-ref-promo"><strong>Customize your experience</strong><p>Control access, visibility, and schedule permissions by role.</p></div></aside><div className="settings-reference-main"><section className="roles-reference"><div className="roles-reference-head"><div><h2>Roles &amp; Permissions</h2><p>Choose what each role can do and which schedule data they can access.</p></div><button className="primary-button" type="button" onClick={save}>Save changes</button></div><div className="roles-reference-tabs"><button type="button" className={tab === "permissions" ? "active" : ""} onClick={() => setTab("permissions")}>Role permissions</button><button type="button" className={tab === "schedule" ? "active" : ""} onClick={() => setTab("schedule")}>Schedule permissions</button></div><div className="panel role-members-panel"><div className="role-members-head"><div><h3>{tab === "permissions" ? "Role permissions" : "Schedule permissions"}</h3><p>{tab === "permissions" ? "Select a role and control actions by area." : "Let employees view their own schedule without granting editing access."}</p></div><select value={role} onChange={(event) => setRole(event.target.value)}>{roles.map((item) => <option key={item}>{item}</option>)}</select></div>{tab === "permissions" ? <div className="permission-editor-list">{areas.map((area) => <div className="permission-editor" key={area}><div className="permission-editor-head"><span>{area}</span><small>{granted(area).length} of {actions.length} enabled</small></div><div className="permission-actions">{actions.map((action) => <label key={action}><input type="checkbox" checked={role === "Owner" || (action === "View" ? true : Boolean(permissions[role]?.[area]))} disabled={role === "Owner"} onChange={() => toggle(area, action)} /><span>{action}</span></label>)}</div></div>)}</div> : <div>{scheduleOptions.map((item) => <label className="approval-toggle" key={item}><span>{item}</span><input type="checkbox" checked={role === "Owner" || Boolean(schedulePermissions[role]?.[item])} disabled={role === "Owner"} onChange={(event) => setSchedulePermissions((current) => ({ ...current, [role]: { ...(current[role] || {}), [item]: event.target.checked } }))} /></label>)}</div>}</div></section></div></div>;
}

function RolesDataVisibilityV4({ flash, onNavigate }: { flash: (message: string) => void; onNavigate: (target: "general" | "time" | "access" | "owners" | "notifications" | "billing" | "scheduling") => void }) {
  const roles = ["Owner", "Manager", "Supervisor", "Employee", "Viewer"];
  const options = ["Build and edit schedules", "View own schedule", "View everyone’s schedule"];
  const nav = [["▥", "Organization", "general"], ["▣", "Billing & Subscription", "billing"], ["⌖", "Locations", "general"], ["♙", "Roles & Permissions", "access"], ["◷", "Time & Attendance", "time"], ["▦", "Scheduling", "scheduling"], ["$", "Pay & Overtime", "owners"], ["♧", "Notifications", "notifications"], ["✣", "Integrations", "general"], ["♙", "Account", "owners"], ["▣", "Security", "access"]] as const;
  const [role, setRole] = useState("Supervisor"); const [permissions, setPermissions] = useState<Record<string, Record<string, boolean>>>({});
  const save = () => { try { window.localStorage.setItem("coreshift-role-schedule-permissions", JSON.stringify(permissions)); } catch { /* storage unavailable */ } flash("Schedule permissions saved."); };
  return <div className="settings-reference"><aside className="settings-reference-nav"><div className="settings-ref-nav-list">{nav.map(([icon, title, target]) => <button type="button" className={target === "access" ? "active" : ""} key={title} onClick={() => onNavigate(target)}><span>{icon}</span><div><strong>{title}</strong><small>Settings and preferences</small></div></button>)}</div><div className="settings-ref-promo"><strong>Customize your experience</strong><p>Control data and approvals by role.</p></div></aside><div className="settings-reference-main"><section className="roles-reference"><div className="roles-reference-head"><div><h2>Roles &amp; Permissions</h2><p>Choose exactly what each role can do with schedules.</p></div><button className="primary-button" type="button" onClick={save}>Save changes</button></div><div className="panel role-members-panel"><div className="role-members-head"><div><h3>Schedule permissions</h3><p>Employees can view their own schedule without gaining editing access.</p></div><select value={role} onChange={(event) => setRole(event.target.value)}>{roles.map((item) => <option key={item}>{item}</option>)}</select></div>{options.map((item) => <label className="approval-toggle" key={item}><span>{item}</span><input type="checkbox" checked={role === "Owner" || Boolean(permissions[role]?.[item])} disabled={role === "Owner"} onChange={(event) => setPermissions((current) => ({ ...current, [role]: { ...(current[role] || {}), [item]: event.target.checked } }))} /></label>)}</div></section></div></div>;
}

function RolesDataVisibilityV3({ flash, onNavigate }: { flash: (message: string) => void; onNavigate: (target: "general" | "time" | "access" | "owners" | "notifications" | "billing" | "scheduling") => void }) {
  const roles = ["Owner", "Manager", "Supervisor", "Employee", "Viewer"];
  const scheduleOptions = ["Build and edit schedules", "View own schedule", "View everyone’s schedule"];
  const [role, setRole] = useState("Supervisor");
  const [permissions, setPermissions] = useState<Record<string, Record<string, boolean>>>({});
  const enabled = (item: string) => role === "Owner" || permissions[role]?.[item] === true;
  const save = () => { try { window.localStorage.setItem("coreshift-role-schedule-permissions", JSON.stringify(permissions)); } catch { /* storage unavailable */ } flash("Schedule permissions saved."); };
  return <div className="settings-reference"><aside className="settings-reference-nav"><div className="settings-ref-nav-list"><button type="button" className="active"><span>♙</span><div><strong>Roles &amp; Permissions</strong><small>Data visibility and approvals</small></div></button><button type="button" onClick={() => onNavigate("general")}><span>▥</span><div><strong>Organization</strong><small>Company profile and details</small></div></button><button type="button" onClick={() => onNavigate("scheduling")}><span>▦</span><div><strong>Scheduling</strong><small>Scheduling preferences</small></div></button></div></aside><div className="settings-reference-main"><section className="roles-reference"><div className="roles-reference-head"><div><h2>Roles &amp; Permissions</h2><p>Choose exactly what each role can do with schedules.</p></div><button className="primary-button" type="button" onClick={save}>Save changes</button></div><div className="panel role-members-panel"><div className="role-members-head"><div><h3>Schedule permissions</h3><p>Employees can view their own schedule without gaining editing access.</p></div><select value={role} onChange={(event) => setRole(event.target.value)}>{roles.map((item) => <option key={item}>{item}</option>)}</select></div>{scheduleOptions.map((item) => <label className="approval-toggle" key={item}><span>{item}</span><input type="checkbox" checked={enabled(item)} disabled={role === "Owner"} onChange={(event) => setPermissions((current) => ({ ...current, [role]: { ...(current[role] || {}), [item]: event.target.checked } }))} /></label>)}</div></section></div></div>;
}

function RolesDataVisibilityV2({ flash, onNavigate }: { flash: (message: string) => void; onNavigate: (target: "general" | "time" | "access" | "owners" | "notifications" | "billing" | "scheduling") => void }) {
  const roles = ["Owner", "Manager", "Supervisor", "Employee", "Viewer"];
  const areas = ["Dashboard data", "Schedule data", "Hours & timesheets", "Pay & earnings", "Requests", "Team data"];
  const requestTypes = ["Time-off requests", "Shift swaps", "Availability changes", "Open shifts"];
  const [role, setRole] = useState("Supervisor");
  const [visibility, setVisibility] = useState<Record<string, string>>({});
  const [approvals, setApprovals] = useState<Record<string, boolean>>({});
  const defaultScope = (area: string) => role === "Owner" ? "Everyone" : role === "Manager" || role === "Supervisor" ? "Team" : area === "Pay & earnings" ? "Own only" : "Own only";
  const save = () => { try { window.localStorage.setItem("coreshift-role-data-visibility", JSON.stringify({ [role]: visibility })); window.localStorage.setItem("coreshift-role-request-approvals", JSON.stringify({ [role]: approvals })); } catch { /* storage unavailable */ } flash("Data visibility and approval settings saved."); };
  return <div className="settings-reference"><aside className="settings-reference-nav"><div className="settings-ref-nav-list"><button type="button" className="active"><span>♙</span><div><strong>Roles &amp; Permissions</strong><small>Data visibility and approvals</small></div></button><button type="button" onClick={() => onNavigate("general")}><span>▥</span><div><strong>Organization</strong><small>Company profile and details</small></div></button><button type="button" onClick={() => onNavigate("time")}><span>◷</span><div><strong>Time &amp; Attendance</strong><small>Rules and time tracking</small></div></button><button type="button" onClick={() => onNavigate("scheduling")}><span>▦</span><div><strong>Scheduling</strong><small>Scheduling preferences</small></div></button></div></aside><div className="settings-reference-main"><section className="roles-reference"><div className="roles-reference-head"><div><h2>Roles &amp; Permissions</h2><p>Control the data each role sees and the request types it can approve.</p></div><button className="primary-button" type="button" onClick={save}>Save changes</button></div><div className="panel role-members-panel"><div className="role-members-head"><div><h3>Role controls</h3><p>Select a role, then set data visibility and approval scope.</p></div><select value={role} onChange={(event) => setRole(event.target.value)}>{roles.map((item) => <option key={item}>{item}</option>)}</select></div><h3>Data visibility</h3>{areas.map((area) => <label className="visibility-setting-row" key={area}><div><strong>{area}</strong><small>Choose whose records this role can see.</small></div><select value={visibility[area] || defaultScope(area)} disabled={role === "Owner"} onChange={(event) => setVisibility((current) => ({ ...current, [area]: event.target.value }))}><option>Own only</option><option>Team</option><option>Everyone</option><option>Hidden</option></select></label>)}<div className="request-approval-settings"><h3>Request approval controls</h3><p>Allow this role to approve only selected request types.</p>{requestTypes.map((type) => <label className="approval-toggle" key={type}><span>{type}</span><input type="checkbox" checked={role === "Owner" || Boolean(approvals[type])} disabled={role === "Owner"} onChange={(event) => setApprovals((current) => ({ ...current, [type]: event.target.checked }))} /></label>)}</div></div></section></div></div>;
}

function RolesDataVisibility({ flash, onNavigate }: { flash: (message: string) => void; onNavigate: (target: "general" | "time" | "access" | "owners" | "notifications" | "billing" | "scheduling") => void }) {
  const roles = ["Owner", "Manager", "Supervisor", "Employee", "Viewer"]; const dataAreas = ["Dashboard data", "Schedule data", "Hours & timesheets", "Pay & earnings", "Requests", "Team data"]; const requestTypes = ["Time-off requests", "Shift swaps", "Availability changes", "Open shifts"];
  const nav = [["▥", "Organization", "general"], ["▣", "Billing & Subscription", "billing"], ["⌖", "Locations", "general"], ["♙", "Roles & Permissions", "access"], ["◷", "Time & Attendance", "time"], ["▦", "Scheduling", "scheduling"], ["$", "Pay & Overtime", "owners"], ["♧", "Notifications", "notifications"], ["✣", "Integrations", "general"], ["♙", "Account", "owners"], ["▣", "Security", "access"]] as const;
  const documentActions = ["View documents", "Upload documents", "Edit document details", "Download documents", "Create folders", "Delete documents"];
  const documentDefaults: Record<string, string[]> = { Owner: documentActions, Manager: documentActions.slice(0, 5), Supervisor: documentActions.slice(0, 4), Employee: ["View documents", "Download documents"], Viewer: ["View documents", "Download documents"] };
  const [tab, setTab] = useState<"members" | "visibility" | "documents">("members"); const [employees, setEmployees] = useState<Employee[]>([]); const [assignments, setAssignments] = useState<Record<string, string>>({}); const [role, setRole] = useState("Employee"); const [visibility, setVisibility] = useState<Record<string, Record<string, string>>>({}); const [approvals, setApprovals] = useState<Record<string, Record<string, boolean>>>({}); const [documentPermissions, setDocumentPermissions] = useState<Record<string, string[]>>(documentDefaults);
  useEffect(() => { fetch("/api/employees").then((response) => response.ok ? response.json() : []).then((items: Employee[]) => setEmployees(items)).catch(() => {}); try { const saved = window.localStorage.getItem("coreshift-role-assignments"); if (saved) setAssignments(JSON.parse(saved)); const savedVisibility = window.localStorage.getItem("coreshift-role-data-visibility"); if (savedVisibility) setVisibility(JSON.parse(savedVisibility)); const savedApprovals = window.localStorage.getItem("coreshift-role-request-approvals"); if (savedApprovals) setApprovals(JSON.parse(savedApprovals)); const savedDocuments = window.localStorage.getItem("coreshift-role-document-permissions"); if (savedDocuments) setDocumentPermissions({ ...documentDefaults, ...JSON.parse(savedDocuments) }); } catch { /* storage unavailable */ } }, []);
  const defaultValue = (area: string) => role === "Owner" ? "Everyone" : role === "Manager" || role === "Supervisor" ? "Team" : area === "Pay & earnings" ? "Own only" : "Own only"; const valueFor = (area: string) => visibility[role]?.[area] || defaultValue(area); const save = () => { try { window.localStorage.setItem("coreshift-role-assignments", JSON.stringify(assignments)); window.localStorage.setItem("coreshift-role-data-visibility", JSON.stringify(visibility)); window.localStorage.setItem("coreshift-role-request-approvals", JSON.stringify(approvals)); window.localStorage.setItem("coreshift-role-document-permissions", JSON.stringify(documentPermissions)); } catch { /* storage unavailable */ } Object.entries(assignments).forEach(([employeeId, assignedRole]) => { fetch(`/api/employees/${employeeId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ role: assignedRole }) }).catch(() => {}); }); flash("Role, document, and data settings saved."); };
  return <div className="settings-reference"><aside className="settings-reference-nav"><div className="settings-ref-nav-list">{nav.map(([icon, title, target]) => <button type="button" className={target === "access" ? "active" : ""} key={title} onClick={() => onNavigate(target)}><span>{icon}</span><div><strong>{title}</strong><small>Settings and preferences</small></div></button>)}</div></aside><div className="settings-reference-main"><section className="roles-reference"><div className="roles-reference-head"><div><h2>Roles &amp; Permissions</h2><p>Assign people to roles and control the data they can see.</p></div><button className="primary-button" type="button" onClick={save}>Save changes</button></div><div className="roles-reference-tabs"><button type="button" className={tab === "members" ? "active" : ""} onClick={() => setTab("members")}>Team assignments</button><button type="button" className={tab === "visibility" ? "active" : ""} onClick={() => setTab("visibility")}>Data visibility</button><button type="button" className={tab === "documents" ? "active" : ""} onClick={() => setTab("documents")}>Documents access</button></div>{tab === "members" ? <div className="panel role-members-panel"><div className="role-members-head"><div><h3>Team role assignments</h3><p>Choose a role directly for each person.</p></div><span>{employees.length} team members</span></div>{employees.length ? employees.map((employee) => <div className="role-member-row" key={employee.id}><div className="role-member-name"><span className="role-member-avatar">{employee.initials || employee.name.slice(0, 2)}</span><strong>{employee.name}</strong></div><select value={assignments[String(employee.id)] || "Employee"} onChange={(event) => setAssignments((current) => ({ ...current, [String(employee.id)]: event.target.value }))}>{roles.map((item) => <option key={item}>{item}</option>)}</select><small>{assignments[String(employee.id)] || "Employee"} role</small></div>) : <div className="role-members-empty">Loading team members…</div>}</div> : tab === "visibility" ? <div className="panel role-members-panel"><div className="role-members-head"><div><h3>Data visibility by role</h3><p>Employees can be limited to their own information while managers can see team data.</p></div><select value={role} onChange={(event) => setRole(event.target.value)}>{roles.map((item) => <option key={item}>{item}</option>)}</select></div>{dataAreas.map((area) => <label className="visibility-setting-row" key={area}><div><strong>{area}</strong><small>Choose whose data this role can see.</small></div><select value={valueFor(area)} disabled={role === "Owner"} onChange={(event) => setVisibility((current) => ({ ...current, [role]: { ...(current[role] || {}), [area]: event.target.value } }))}><option>Own only</option><option>Team</option><option>Everyone</option><option>Hidden</option></select></label>)}</div> : <div className="panel role-members-panel documents-permissions-panel"><div className="role-members-head"><div><h3>Documents access by role</h3><p>Choose which document actions each role can use. These settings control uploads, downloads, folders, and document management.</p></div><select value={role} onChange={(event) => setRole(event.target.value)}>{roles.map((item) => <option key={item}>{item}</option>)}</select></div><div className="documents-permission-list">{documentActions.map((action) => <label className="visibility-setting-row" key={action}><div><strong>{action}</strong><small>{action === "View documents" ? "Open and browse company documents." : action === "Upload documents" ? "Add PDFs, forms, spreadsheets, and other files." : action === "Edit document details" ? "Rename files and update category or notes." : action === "Download documents" ? "Save a document to the device." : action === "Create folders" ? "Organize documents into folders." : "Permanently remove a document."}</small></div><input className="document-permission-toggle" type="checkbox" checked={(documentPermissions[role] || documentDefaults[role]).includes(action)} disabled={role === "Owner"} onChange={() => setDocumentPermissions((current) => ({ ...current, [role]: (current[role] || documentDefaults[role]).includes(action) ? (current[role] || documentDefaults[role]).filter((item) => item !== action) : [...(current[role] || documentDefaults[role]), action] }))} /></label>)}</div></div>}</section></div></div>;
}

function RolesPermissionsAdvanced({ flash, onNavigate }: { flash: (message: string) => void; onNavigate: (target: "general" | "time" | "access" | "owners" | "notifications" | "billing" | "scheduling") => void }) {
  const roles = ["Owner", "Manager", "Supervisor", "Employee", "Viewer"]; const areas = ["Owner Dashboard", "Employee Home", "My Schedule", "My Hours", "Time Clock", "Team", "Requests", "Messages", "Profile", "Reports", "Payroll", "Documents", "Settings"]; const actions = ["View", "Create", "Edit", "Approve", "Export", "Delete"];
  const nav = [["▥", "Organization", "general"], ["▣", "Billing & Subscription", "billing"], ["⌖", "Locations", "general"], ["♙", "Roles & Permissions", "access"], ["◷", "Time & Attendance", "time"], ["▦", "Scheduling", "scheduling"], ["$", "Pay & Overtime", "owners"], ["♧", "Notifications", "notifications"], ["✣", "Integrations", "general"], ["♙", "Account", "owners"], ["▣", "Security", "access"]] as const;
  const [tab, setTab] = useState<"members" | "permissions">("members"); const [employees, setEmployees] = useState<Employee[]>([]); const [assignments, setAssignments] = useState<Record<string, string>>({}); const [role, setRole] = useState("Employee"); const [scope, setScope] = useState<Record<string, string>>({ Employee: "Own records", Supervisor: "Team records", Manager: "Team records", Viewer: "Own records", Owner: "Company records" }); const [payScope, setPayScope] = useState<Record<string, string>>({ Employee: "Own pay only", Supervisor: "Team pay", Manager: "Team pay", Viewer: "Hidden", Owner: "Company pay" }); const [grants, setGrants] = useState<Record<string, Record<string, string[]>>>({});
  useEffect(() => { fetch("/api/employees").then((response) => response.ok ? response.json() : []).then((items: Employee[]) => setEmployees(items)).catch(() => {}); try { const saved = window.localStorage.getItem("coreshift-role-assignments"); if (saved) setAssignments(JSON.parse(saved)); const savedScopes = window.localStorage.getItem("coreshift-role-visibility"); if (savedScopes) { const parsed = JSON.parse(savedScopes); setScope(parsed.scope || scope); setPayScope(parsed.payScope || payScope); } const savedGrants = window.localStorage.getItem("coreshift-role-grants"); if (savedGrants) setGrants(JSON.parse(savedGrants)); } catch { /* storage unavailable */ } }, []);
  const defaults = (area: string) => role === "Owner" ? actions : role === "Manager" ? actions.slice(0, 5) : role === "Supervisor" ? actions.slice(0, 4) : role === "Employee" ? ["View"] : ["View", "Export"]; const granted = (area: string) => grants[role]?.[area] || defaults(area); const toggle = (area: string, action: string) => setGrants((current) => ({ ...current, [role]: { ...(current[role] || {}), [area]: granted(area).includes(action) ? granted(area).filter((item) => item !== action) : [...granted(area), action] } }));
  const save = () => { try { window.localStorage.setItem("coreshift-role-assignments", JSON.stringify(assignments)); window.localStorage.setItem("coreshift-role-grants", JSON.stringify(grants)); window.localStorage.setItem("coreshift-role-visibility", JSON.stringify({ scope, payScope })); } catch { /* storage unavailable */ } flash("Role visibility and permissions saved."); };
  return <div className="settings-reference"><aside className="settings-reference-nav"><div className="settings-ref-nav-list">{nav.map(([icon, title, target]) => <button type="button" className={target === "access" ? "active" : ""} key={title} onClick={() => onNavigate(target)}><span>{icon}</span><div><strong>{title}</strong><small>Settings and preferences</small></div></button>)}</div></aside><div className="settings-reference-main"><section className="roles-reference"><div className="roles-reference-head"><div><h2>Roles &amp; Permissions</h2><p>Control role access, data visibility, and pay visibility from one place.</p></div><button className="primary-button" type="button" onClick={save}>Save changes</button></div><div className="roles-reference-tabs"><button type="button" className={tab === "members" ? "active" : ""} onClick={() => setTab("members")}>Team assignments</button><button type="button" className={tab === "permissions" ? "active" : ""} onClick={() => setTab("permissions")}>Role permissions</button></div>{tab === "members" ? <div className="panel role-members-panel"><div className="role-members-head"><div><h3>Team role assignments</h3><p>Choose a role directly for each person.</p></div><span>{employees.length} team members</span></div><div className="role-members-table">{employees.length ? employees.map((employee) => <div className="role-member-row" key={employee.id}><div className="role-member-name"><span className="role-member-avatar">{employee.initials || employee.name.slice(0, 2)}</span><strong>{employee.name}</strong></div><select value={assignments[String(employee.id)] || "Employee"} onChange={(event) => setAssignments((current) => ({ ...current, [String(employee.id)]: event.target.value }))}>{roles.map((item) => <option key={item}>{item}</option>)}</select><small>{assignments[String(employee.id)] || "Employee"} role</small></div>) : <div className="role-members-empty">Loading team members…</div>}</div></div> : <div className="panel role-members-panel"><div className="role-members-head"><div><h3>Role permissions</h3><p>Set what the selected role can see and do.</p></div><select value={role} onChange={(event) => setRole(event.target.value)}>{roles.map((item) => <option key={item}>{item}</option>)}</select></div><div className="visibility-settings"><label><strong>Data visibility</strong><span>What records can this role see?</span><select value={scope[role] || "Own records"} disabled={role === "Owner"} onChange={(event) => setScope((current) => ({ ...current, [role]: event.target.value }))}><option>Own records</option><option>Team records</option><option>Company records</option></select></label><label><strong>Pay visibility</strong><span>Who can this role see pay for?</span><select value={payScope[role] || "Hidden"} disabled={role === "Owner"} onChange={(event) => setPayScope((current) => ({ ...current, [role]: event.target.value }))}><option>Hidden</option><option>Own pay only</option><option>Team pay</option><option>Company pay</option></select></label></div>{areas.map((area) => <div className="permission-editor" key={area}><div className="permission-editor-head"><span>{area}</span><small>{granted(area).length} of {actions.length} enabled</small></div><div className="permission-actions">{actions.map((action) => <label key={action}><input type="checkbox" checked={granted(area).includes(action)} disabled={role === "Owner"} onChange={() => toggle(area, action)} /><span>{action}</span></label>)}</div></div>)}</div>}</section></div></div>;
}

function RolesPermissionsWorkspace({ flash, onNavigate }: { flash: (message: string) => void; onNavigate: (target: "general" | "time" | "access" | "owners" | "notifications" | "billing" | "scheduling") => void }) {
  const roles = ["Owner", "Manager", "Supervisor", "Employee", "Viewer"]; const areas = ["Dashboard", "Schedule", "Time Clock", "Team", "Requests", "Reports", "Payroll", "Documents", "Settings"]; const actions = ["View", "Create", "Edit", "Approve", "Export", "Delete"];
  const nav = [["▥", "Organization", "general"], ["▣", "Billing & Subscription", "billing"], ["⌖", "Locations", "general"], ["♙", "Roles & Permissions", "access"], ["◷", "Time & Attendance", "time"], ["▦", "Scheduling", "scheduling"], ["$", "Pay & Overtime", "owners"], ["♧", "Notifications", "notifications"], ["✣", "Integrations", "general"], ["♙", "Account", "owners"], ["▣", "Security", "access"]] as const;
  const [tab, setTab] = useState<"members" | "permissions">("members"); const [employees, setEmployees] = useState<Employee[]>([]); const [assignments, setAssignments] = useState<Record<string, string>>({}); const [role, setRole] = useState("Owner"); const [grants, setGrants] = useState<Record<string, Record<string, string[]>>>({});
  useEffect(() => { fetch("/api/employees").then((response) => response.ok ? response.json() : []).then((items: Employee[]) => setEmployees(items)).catch(() => {}); try { const saved = window.localStorage.getItem("coreshift-role-assignments"); if (saved) setAssignments(JSON.parse(saved)); const savedGrants = window.localStorage.getItem("coreshift-role-grants"); if (savedGrants) setGrants(JSON.parse(savedGrants)); } catch { /* storage unavailable */ } }, []);
  const defaultGrants = (area: string) => role === "Owner" ? actions : role === "Manager" ? actions.slice(0, 5) : role === "Supervisor" ? actions.slice(0, 4) : role === "Employee" ? ["View"] : ["View", "Export"];
  const granted = (area: string) => grants[role]?.[area] || defaultGrants(area); const toggle = (area: string, action: string) => setGrants((current) => ({ ...current, [role]: { ...(current[role] || {}), [area]: granted(area).includes(action) ? granted(area).filter((item) => item !== action) : [...granted(area), action] } }));
  const save = () => { try { window.localStorage.setItem("coreshift-role-assignments", JSON.stringify(assignments)); window.localStorage.setItem("coreshift-role-grants", JSON.stringify(grants)); } catch { /* storage unavailable */ } flash("Role settings saved."); };
  return <div className="settings-reference"><aside className="settings-reference-nav"><div className="settings-ref-nav-list">{nav.map(([icon, title, target]) => <button type="button" className={target === "access" ? "active" : ""} key={title} onClick={() => onNavigate(target)}><span>{icon}</span><div><strong>{title}</strong><small>Settings and preferences</small></div></button>)}</div></aside><div className="settings-reference-main"><section className="roles-reference"><div className="roles-reference-head"><div><h2>Roles &amp; Permissions</h2><p>Assign people to roles and control what each role can do.</p></div><button className="primary-button" type="button" onClick={save}>Save changes</button></div><div className="roles-reference-tabs"><button type="button" className={tab === "members" ? "active" : ""} onClick={() => setTab("members")}>Team assignments</button><button type="button" className={tab === "permissions" ? "active" : ""} onClick={() => setTab("permissions")}>Role permissions</button></div>{tab === "members" ? <div className="panel role-members-panel"><div className="role-members-head"><div><h3>Team role assignments</h3><p>Choose a role directly for each person.</p></div><span>{employees.length} team members</span></div><div className="role-members-table"><div className="role-member-row role-member-header"><span>Employee</span><span>Role</span><span>Access summary</span></div>{employees.length ? employees.map((employee) => { const assigned = assignments[String(employee.id)] || "Employee"; return <div className="role-member-row" key={employee.id}><div className="role-member-name"><span className="role-member-avatar">{employee.initials || employee.name.slice(0, 2)}</span><strong>{employee.name}</strong></div><select value={assigned} onChange={(event) => setAssignments((current) => ({ ...current, [String(employee.id)]: event.target.value }))}>{roles.map((item) => <option key={item}>{item}</option>)}</select><small>{assigned === "Owner" ? "Full access" : assigned === "Manager" ? "Team management" : assigned === "Supervisor" ? "Approvals and oversight" : assigned === "Viewer" ? "View-only access" : "Basic employee access"}</small></div>; }) : <div className="role-members-empty">Loading team members…</div>}</div></div> : <div className="panel role-members-panel"><div className="role-members-head"><div><h3>Role permissions</h3><p>Select a role, then turn each capability on or off by area.</p></div><select value={role} onChange={(event) => setRole(event.target.value)}>{roles.map((item) => <option key={item}>{item}</option>)}</select></div>{areas.map((area) => <div className="permission-editor" key={area}><div className="permission-editor-head"><span>{area}</span><small>{granted(area).length} of {actions.length} enabled</small></div><div className="permission-actions">{actions.map((action) => <label key={action}><input type="checkbox" checked={granted(area).includes(action)} disabled={role === "Owner"} onChange={() => toggle(area, action)} /><span>{action}</span></label>)}</div></div>)}</div>}</section></div></div>;
}

function RolesPermissionsMembers({ flash, onNavigate }: { flash: (message: string) => void; onNavigate: (target: "general" | "time" | "access" | "owners" | "notifications" | "billing" | "scheduling") => void }) {
  const roles = ["Owner", "Manager", "Supervisor", "Employee", "Viewer"];
  const nav = [["▥", "Organization", "general"], ["▣", "Billing & Subscription", "billing"], ["⌖", "Locations", "general"], ["♙", "Roles & Permissions", "access"], ["◷", "Time & Attendance", "time"], ["▦", "Scheduling", "scheduling"], ["$", "Pay & Overtime", "owners"], ["♧", "Notifications", "notifications"], ["✣", "Integrations", "general"], ["♙", "Account", "owners"], ["▣", "Security", "access"]] as const;
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  useEffect(() => { fetch("/api/employees").then((response) => response.ok ? response.json() : []).then((items: Employee[]) => { setEmployees(items); setAssignments((current) => { const saved = JSON.parse(window.localStorage.getItem("coreshift-role-assignments") || "{}"); return { ...Object.fromEntries(items.map((item) => [String(item.id), "Employee"])), ...saved, ...current }; }); }).catch(() => {}); }, []);
  const updateRole = (id: number, role: string) => setAssignments((current) => ({ ...current, [String(id)]: role }));
  const save = () => { try { window.localStorage.setItem("coreshift-role-assignments", JSON.stringify(assignments)); } catch { /* storage unavailable */ } flash("Team role assignments saved."); };
  return <div className="settings-reference"><aside className="settings-reference-nav"><div className="settings-ref-nav-list">{nav.map(([icon, title, target]) => <button type="button" className={target === "access" ? "active" : ""} key={title} onClick={() => onNavigate(target)}><span>{icon}</span><div><strong>{title}</strong><small>Settings and preferences</small></div></button>)}</div></aside><div className="settings-reference-main"><section className="roles-reference"><div className="roles-reference-head"><div><h2>Roles &amp; Permissions</h2><p>Assign each team member to the right role, then manage what that role can access.</p></div><button className="primary-button" type="button" onClick={save}>Save assignments</button></div><div className="panel role-members-panel"><div className="role-members-head"><div><h3>Team role assignments</h3><p>Choose a role directly for each person.</p></div><span>{employees.length} team members</span></div><div className="role-members-table"><div className="role-member-row role-member-header"><span>Employee</span><span>Current role</span><span>Access summary</span></div>{employees.length ? employees.map((employee) => { const assigned = assignments[String(employee.id)] || "Employee"; return <div className="role-member-row" key={employee.id}><div className="role-member-name"><span className="role-member-avatar">{employee.initials || employee.name.split(" ").map((part) => part[0]).join("").slice(0, 2)}</span><strong>{employee.name}</strong></div><select value={assigned} onChange={(event) => updateRole(employee.id, event.target.value)}>{roles.map((role) => <option key={role}>{role}</option>)}</select><small>{assigned === "Owner" ? "Full access" : assigned === "Manager" ? "Team management" : assigned === "Supervisor" ? "Approvals and oversight" : assigned === "Viewer" ? "View-only access" : "Basic employee access"}</small></div>; }) : <div className="role-members-empty">Loading team members…</div>}</div></div></section></div></div>;
}

function RolesPermissionsGranular({ flash, onNavigate }: { flash: (message: string) => void; onNavigate: (target: "general" | "time" | "access" | "owners" | "notifications" | "billing" | "scheduling") => void }) {
  const roles = ["Owner", "Manager", "Supervisor", "Employee", "Viewer"];
  const areas = ["Dashboard", "Schedule", "Time Clock", "Team", "Requests", "Reports", "Payroll", "Documents", "Settings"];
  const actions = ["View", "Create", "Edit", "Approve", "Export", "Delete"];
  const nav = [["▥", "Organization", "general"], ["▣", "Billing & Subscription", "billing"], ["⌖", "Locations", "general"], ["♙", "Roles & Permissions", "access"], ["◷", "Time & Attendance", "time"], ["▦", "Scheduling", "scheduling"], ["$", "Pay & Overtime", "owners"], ["♧", "Notifications", "notifications"], ["✣", "Integrations", "general"], ["♙", "Account", "owners"], ["▣", "Security", "access"]] as const;
  const [role, setRole] = useState("Owner");
  const [grants, setGrants] = useState<Record<string, Record<string, string[]>>>({});
  useEffect(() => { try { const saved = window.localStorage.getItem("coreshift-role-grants"); if (saved) setGrants(JSON.parse(saved)); } catch { /* storage unavailable */ } }, []);
  const granted = (area: string) => grants[role]?.[area] || (role === "Owner" ? actions : role === "Manager" ? actions.slice(0, 5) : role === "Supervisor" ? actions.slice(0, 4) : role === "Employee" ? ["View"] : ["View", "Export"]);
  const toggle = (area: string, action: string) => setGrants((current) => ({ ...current, [role]: { ...(current[role] || {}), [area]: granted(area).includes(action) ? granted(area).filter((item) => item !== action) : [...granted(area), action] } }));
  const save = () => { try { window.localStorage.setItem("coreshift-role-grants", JSON.stringify(grants)); } catch { /* storage unavailable */ } flash(`${role} permissions saved.`); };
  return <div className="settings-reference"><aside className="settings-reference-nav"><div className="settings-ref-nav-list">{nav.map(([icon, title, target]) => <button type="button" className={target === "access" ? "active" : ""} key={title} onClick={() => onNavigate(target)}><span>{icon}</span><div><strong>{title}</strong><small>Settings and preferences</small></div></button>)}</div></aside><div className="settings-reference-main"><section className="roles-reference"><div className="roles-reference-head"><div><h2>Roles &amp; Permissions</h2><p>Choose exactly what each role can see and do.</p></div><button className="primary-button" type="button" disabled={role === "Owner"} onClick={save}>Save changes</button></div><div className="roles-reference-columns"><div className="roles-list">{roles.map((item) => <button type="button" className={`role-list-item ${item === role ? "active" : ""}`} key={item} onClick={() => setRole(item)}><span className="role-icon">✦</span><div><strong>{item}</strong><small>{item === "Owner" ? "Full access" : "Custom access"}</small></div></button>)}</div><aside className="role-detail panel"><div className="role-detail-head"><div><h3>{role}</h3><p>{role === "Owner" ? "The owner always has full access." : "Toggle individual capabilities by area."}</p></div></div><div className="role-permissions"><strong>Detailed access</strong>{areas.map((area) => <div className="permission-editor" key={area}><div className="permission-editor-head"><span>{area}</span><small>{granted(area).length} of {actions.length} enabled</small></div><div className="permission-actions">{actions.map((action) => <label key={action}><input type="checkbox" checked={granted(area).includes(action)} disabled={role === "Owner"} onChange={() => toggle(area, action)} /><span>{action}</span></label>)}</div></div>)}</div></aside></div></section></div></div>;
}

function RolesPermissionsFixed({ flash, onNavigate }: { flash: (message: string) => void; onNavigate: (target: "general" | "time" | "access" | "owners" | "notifications" | "billing" | "scheduling") => void }) {
  const nav = [["▥", "Organization", "general"], ["▣", "Billing & Subscription", "billing"], ["⌖", "Locations", "general"], ["♙", "Roles & Permissions", "access"], ["◷", "Time & Attendance", "time"], ["▦", "Scheduling", "scheduling"], ["$", "Pay & Overtime", "owners"], ["♧", "Notifications", "notifications"], ["✣", "Integrations", "general"], ["♙", "Account", "owners"], ["▣", "Security", "access"]] as const;
  const roleNames = ["Owner", "Manager", "Supervisor", "Employee", "Viewer"];
  const permissionNames = ["Dashboard", "Schedule", "Time Clock", "Team", "Requests", "Reports", "Payroll", "Documents", "Settings"];
  const defaultAccess: Record<string, Record<string, string>> = { Owner: Object.fromEntries(permissionNames.map((item) => [item, "Full access"])), Manager: Object.fromEntries(permissionNames.map((item) => [item, ["Dashboard", "Schedule", "Time Clock", "Team", "Requests", "Reports"].includes(item) ? "Full access" : "View only"])), Supervisor: Object.fromEntries(permissionNames.map((item) => [item, ["Schedule", "Time Clock", "Team", "Requests"].includes(item) ? "Full access" : "View only"])), Employee: Object.fromEntries(permissionNames.map((item) => [item, ["Schedule", "Time Clock", "Requests"].includes(item) ? "View only" : "No access"])), Viewer: Object.fromEntries(permissionNames.map((item) => [item, ["Dashboard", "Reports", "Documents"].includes(item) ? "View only" : "No access"])) };
  const [selectedRole, setSelectedRole] = useState("Owner");
  const actions = ["View", "Create", "Edit", "Approve", "Export", "Delete"];
  const defaultDetails: Record<string, Record<string, string[]>> = Object.fromEntries(roleNames.map((role) => [role, Object.fromEntries(permissionNames.map((item) => [item, role === "Owner" ? actions : role === "Manager" ? ["View", "Create", "Edit", "Approve", "Export"] : role === "Supervisor" ? ["View", "Create", "Edit", "Approve"] : role === "Employee" ? ["View"] : ["View", "Export"]]))])) as Record<string, Record<string, string[]>>;
  const [permissions, setPermissions] = useState<Record<string, Record<string, string>>>(() => { try { return { ...defaultAccess, ...JSON.parse(window.localStorage.getItem("coreshift-role-permissions") || "{}")} } catch { return defaultAccess; } });
  const [details, setDetails] = useState<Record<string, Record<string, string[]>>>(() => { try { return { ...defaultDetails, ...JSON.parse(window.localStorage.getItem("coreshift-role-permission-details") || "{}")} } catch { return defaultDetails; } });
  const selected = permissions[selectedRole] || defaultAccess[selectedRole];
  const updatePermission = (permission: string, value: string) => setPermissions((current) => ({ ...current, [selectedRole]: { ...(current[selectedRole] || {}), [permission]: value } }));
  const toggleDetail = (permission: string, action: string) => setDetails((current) => { const existing = current[selectedRole]?.[permission] || []; const next = existing.includes(action) ? existing.filter((item) => item !== action) : [...existing, action]; return { ...current, [selectedRole]: { ...(current[selectedRole] || {}), [permission]: next } }; });
  const savePermissions = () => { try { window.localStorage.setItem("coreshift-role-permissions", JSON.stringify(permissions)); window.localStorage.setItem("coreshift-role-permission-details", JSON.stringify(details)); } catch { /* storage unavailable */ } flash(`${selectedRole} permissions saved.`); };
  return <div className="settings-reference"><aside className="settings-reference-nav"><div className="settings-ref-nav-list">{nav.map(([icon, title, target]) => <button type="button" className={target === "access" ? "active" : ""} key={title} onClick={() => onNavigate(target)}><span>{icon}</span><div><strong>{title}</strong><small>{title === "Roles & Permissions" ? "Control access and permissions" : title === "Organization" ? "Company profile and details" : "Settings and preferences"}</small></div></button>)}</div><div className="settings-ref-promo"><strong>Customize your experience</strong><p>Upgrade for advanced permissions and control.</p><button type="button" onClick={() => flash("Settings help opened.")}>Learn More</button></div></aside><div className="settings-reference-main"><section className="roles-reference"><div className="roles-reference-head"><div><h2>Roles &amp; Permissions</h2><p>Choose a role, change access by area, and save the role settings.</p></div><button className="secondary-button" type="button" onClick={() => flash("Create a role from your team settings.")}>＋ Create role</button></div><div className="roles-reference-columns"><div className="roles-list"><input placeholder="⌕  Search roles..." />{roleNames.map((role, index) => <button type="button" className={`role-list-item ${selectedRole === role ? "active" : ""}`} key={role} onClick={() => setSelectedRole(role)}><span className="role-icon">{index === 0 ? "✦" : index === 1 ? "⬡" : index === 2 ? "♧" : index === 3 ? "♙" : "◉"}</span><div><strong>{role}</strong><small>{role === "Owner" ? "Full access" : "Custom access"}</small></div><b>{[1,4,3,15,2][index]}<small>Users</small></b><p>Manage permissions and team access for this role.</p></button>)}</div><aside className="role-detail panel"><div className="role-detail-head"><span className="role-icon">✦</span><div><h3>{selectedRole}</h3><p>{selectedRole === "Owner" ? "Full access • All permissions" : "Edit access for this role"}</p></div><button className="primary-button" type="button" disabled={selectedRole === "Owner"} onClick={savePermissions}>Save changes</button></div><div className="role-permissions"><strong>Permissions</strong><small className="permission-help">{selectedRole === "Owner" ? "The owner role always has full access." : "Choose the access level for each area."}</small>{permissionNames.map((item) => <label className="permission-editor" key={item}><span>{item}</span><select value={selected[item] || "No access"} disabled={selectedRole === "Owner"} onChange={(event) => updatePermission(item, event.target.value)}><option>Full access</option><option>View only</option><option>No access</option></select></label>)}</div></aside></div></section></div></div>;
}

function RolesPermissionsPage({ flash, onNavigate }: { flash: (message: string) => void; onNavigate: (target: "general" | "time" | "access" | "owners" | "notifications" | "billing") => void }) {
  const onBack = () => onNavigate("general");
  const nav = [["▥", "Organization", "Company profile and details"], ["▣", "Billing & Subscription", "Manage your plan and billing"], ["⌖", "Locations", "Manage your locations"], ["♙", "Roles & Permissions", "Control access and permissions"], ["◷", "Time & Attendance", "Rules and time tracking"], ["▦", "Scheduling", "Scheduling preferences"], ["$", "Pay & Overtime", "Pay rates and overtime rules"], ["♧", "Notifications", "Notification preferences"], ["✣", "Integrations", "Connected apps and services"], ["♙", "Account", "Your account settings"], ["▣", "Security", "Password and security"]];
  const roles = [["✦", "Owner", "System Role", "Full access", "1", "Has full access to all features, settings, and data."], ["⬡", "Manager", "System Role", "Manage team and operations", "4", "Can manage teams, schedules, reports, and most settings."], ["♧", "Supervisor", "Custom Role", "Team oversight and approval", "3", "Can approve timesheets, manage requests, and view reports."], ["♙", "Employee", "System Role", "Basic access", "15", "Can clock in/out, view schedule, and submit requests."], ["◉", "Viewer", "Custom Role", "View only access", "2", "Can view reports and data but cannot make changes."]];
  return <div className="settings-reference"><aside className="settings-reference-nav"><div className="settings-ref-nav-list">{nav.map(([icon, title, desc], index) => <button type="button" className={index === 4 ? "active" : ""} key={title} onClick={() => index === 0 ? onBack() : flash(`${title} settings opened.`)}><span>{icon}</span><div><strong>{title}</strong><small>{desc}</small></div></button>)}</div><div className="settings-ref-promo"><strong>Customize your experience</strong><p>Upgrade for advanced permissions and control.</p><button type="button" onClick={() => flash("Settings help opened.")}>Learn More</button></div></aside><div className="settings-reference-main"><section className="roles-reference"><div className="roles-reference-head"><div><h2>Roles &amp; Permissions</h2><p>Manage user roles and control what each role can access.</p></div><button className="secondary-button" type="button" onClick={() => flash("Role editor opened.")}>＋ Create role</button></div><div className="roles-reference-tabs"><button className="active" type="button">Roles</button><button type="button" onClick={() => flash("Permission groups opened.")}>Permission Groups</button></div><div className="roles-reference-columns"><div className="roles-list"><input placeholder="⌕  Search roles..." />{roles.map(([icon, name, kind, desc, count, detail], index) => <button type="button" className={`role-list-item ${index === 0 ? "active" : ""}`} key={name} onClick={() => flash(`${name} role selected.`)}><span className="role-icon">{icon}</span><div><strong>{name} <em>{kind}</em></strong><small>{desc}</small></div><b>{count}<small>Users</small></b><p>{detail}</p></button>)}</div><aside className="role-detail panel"><div className="role-detail-head"><span className="role-icon">✦</span><div><h3>Owner <em>System Role</em></h3><p>Full access　•　All permissions</p></div><button className="secondary-button" type="button" onClick={() => flash("Owner role editing opened.")}>Edit Role</button></div><dl><dt>Description</dt><dd>Has full access to all features, settings, and data.</dd><dt>Users with this role</dt><dd>1 user</dd><dt>Created</dt><dd>Jan 15, 2024</dd><dt>Last updated</dt><dd>May 10, 2024</dd></dl><div className="role-permissions"><strong>Permissions (32)</strong><button className="text-button" type="button" onClick={() => flash("All permissions expanded.")}>Expand All</button>{["Dashboard","Schedule","Time Clock","Team","Requests","Reports","Payroll","Documents","Settings"].map((item) => <div key={item}><span>{item}</span><em>All Access　⌄</em></div>)}</div><button className="secondary-button role-audit" type="button" onClick={() => flash("Audit log opened.")}>▣　View Audit Log</button></aside></div></section></div></div>;
}

function BillingPage({ flash, onNavigate }: { flash: (message: string) => void; onNavigate: (target: "general" | "time" | "access" | "owners" | "notifications" | "billing" | "scheduling") => void }) {
  const onBack = () => onNavigate("general");
  const nav = [["⌖", "Locations", "general"], ["♙", "Roles & Permissions", "access"], ["◷", "Time & Attendance", "time"], ["▦", "Scheduling", "scheduling"], ["$", "Pay & Overtime", "owners"], ["♧", "Notifications", "notifications"], ["✣", "Integrations", "general"], ["♙", "Account", "owners"], ["▣", "Security", "access"]] as const;
  return <div className="settings-reference"><aside className="settings-reference-nav"><div className="settings-ref-nav-list"><button type="button" onClick={onBack}><span>▥</span><div><strong>Organization</strong><small>Company profile and details</small></div></button><button type="button" className="active"><span>▣</span><div><strong>Billing &amp; Subscription</strong><small>Manage your plan and billing</small></div></button>{nav.map(([icon, title, target]) => <button type="button" key={title} onClick={() => onNavigate(target)}><span>{icon}</span><div><strong>{title}</strong><small>Settings and preferences</small></div></button>)}</div><div className="settings-ref-promo"><strong>Customize your experience</strong><p>Adjust preferences and automate rules to save time.</p><button type="button" onClick={() => flash("Settings help opened.")}>Learn more</button></div></aside><div className="settings-reference-main"><BillingReference flash={flash} /></div></div>;
}

function BillingReference({ flash }: { flash: (message: string) => void }) {
  return <section className="billing-reference"><div className="panel billing-heading"><h2>Billing &amp; Subscriptions</h2><p>Manage your plan, payment methods, and subscription settings.</p></div><div className="billing-grid"><article className="panel billing-plan"><PanelHead title="Current Plan" action={<button className="text-button" onClick={() => flash("Plan options opened.")}>Change plan</button>} /><div className="billing-plan-main"><span className="billing-shield">✦</span><div><h3>CoreShift Pro <span>Active</span></h3><strong>$50 per user / month</strong><p>Billed annually</p></div></div><dl><dt>Users</dt><dd>Team workspace / Unlimited</dd><dt>Billing Cycle</dt><dd>Annual　<span className="billing-save">Save 20%</span></dd><dt>Next Billing Date</dt><dd>June 15, 2025</dd><dt>Next Billing Amount</dt><dd>$1,150.00 USD</dd></dl></article><article className="panel billing-features"><PanelHead title="Plan Features" />{["Unlimited users","Advanced scheduling","Time tracking","Overtime & break rules","Custom reports","Integrations","Priority support"].map((item) => <div key={item}>●　{item}</div>)}<button className="secondary-button" type="button" onClick={() => flash("Plan comparison opened.")}>Compare Plans</button></article><article className="panel billing-history"><PanelHead title="Billing History" action={<button className="text-button" onClick={() => flash("All invoices opened.")}>View all invoices →</button>} /><div className="billing-history-head"><span>Date</span><span>Description</span><span>Amount</span><span>Status</span></div>{["May 15, 2024","May 15, 2023","May 15, 2022","May 15, 2021"].map((date) => <div className="billing-history-row" key={date}><span>{date}</span><span>Pro Plan – Annual</span><strong>$1,150.00</strong><em>Paid</em></div>)}</article><article className="panel billing-methods"><PanelHead title="Payment Methods" action={<button className="text-button" onClick={() => flash("Add payment method opened.")}>＋ Add New</button>} /><div className="billing-method"><strong>VISA ending in 4242</strong><span>Default · Expires 08/26</span></div><div className="billing-method"><strong>Mastercard ending in 8888</strong><span>Expires 11/25</span></div><button className="text-button" type="button" onClick={() => flash("Payment methods opened.")}>Manage payment methods →</button></article><article className="panel billing-usage"><PanelHead title="Usage & Limits" />{[["Users","23 / Unlimited","purple"],["Time Clock Entries","1,248 / Unlimited","orange"],["Storage","2.4 GB / Unlimited","green"]].map(([label,value,color]) => <div className="billing-usage-item" key={label}><span className={`settings-ref-icon ${color}`}>◷</span><strong>{label}<small>{value}</small></strong><i className={color} /></div>)}</article><article className="panel billing-actions"><PanelHead title="Subscription Actions" />{["Upgrade Plan","Downgrade Plan","Pause Subscription","Cancel Subscription"].map((item) => <button type="button" key={item} onClick={() => flash(`${item} opened.`)}>{item}<span>›</span></button>)}</article></div></section>;
}

function SettingsReference({ businessName, flash, section, setSection, rounding, timeFormat, updateTimeFormat, fontSize, updateFontSize }: { businessName: string; flash: (message: string) => void; section: SettingsSection; setSection: (section: SettingsSection) => void; rounding: string; timeFormat: "24" | "12"; updateTimeFormat: (value: "24" | "12") => void; fontSize: AppFontSize; updateFontSize: (value: AppFontSize) => void }) {
  useEffect(() => {
    const renderOrganization = () => {
      try {
        const saved = JSON.parse(window.localStorage.getItem("coreshift-organization") || "null") as Partial<{ name: string; address: string; email: string; timeZone: string; industry: string; companySize: string; weekStarts: string }> | null;
        if (!saved) return;
        const root = document.querySelector(".settings-organization .organization-details");
        if (!root) return;
        const heading = root.querySelector("h3");
        if (heading && saved.name) heading.firstChild!.textContent = `${saved.name} `;
        const paragraphs = root.querySelectorAll("p");
        if (saved.address && paragraphs[0]) paragraphs[0].innerHTML = `⌖　${saved.address.replace(/\n/g, "<br />　　")}`;
        if (saved.email && paragraphs[1]) paragraphs[1].textContent = `✉　${saved.email}`;
        if (saved.timeZone && paragraphs[2]) paragraphs[2].textContent = `◉　${saved.timeZone}`;
        const values = root.querySelectorAll("dl dd");
        [saved.industry, saved.companySize, saved.weekStarts].forEach((value, index) => { if (value && values[index]) values[index].textContent = value; });
      } catch { /* keep defaults */ }
    };
    renderOrganization();
    window.addEventListener("coreshift-organization-updated", renderOrganization);
    const timer = window.setInterval(renderOrganization, 500);
    return () => { window.removeEventListener("coreshift-organization-updated", renderOrganization); window.clearInterval(timer); };
  }, []);
  const card = (icon: string, title: string, desc: string, color: string, items: string[], target: SettingsSection) => <article className="settings-ref-card"><div className="settings-ref-card-head"><span className={`settings-ref-icon ${color}`}>{icon}</span><div><strong>{title}</strong><p>{desc}</p></div></div>{items.map((item) => <button type="button" key={item} onClick={() => { setSection(title === "Pay & Overtime" ? "pay" : target); flash(`${item} settings opened.`); }}>{item}<span>›</span></button>)}</article>;
  return <div className="settings-reference"><SettingsSectionNav active={section} onNavigate={setSection} /><div className="settings-reference-main"><section className="panel settings-organization"><div className="settings-ref-panel-head"><div><h2>Organization Settings</h2><p>Company profile and details</p></div><button className="secondary-button" type="button" onClick={() => flash("Organization editing is ready.")}>✎　Edit Organization Info</button></div><div className="organization-details"><div className="organization-logo">▱</div><div><h3>{businessName || "Main Street Café"} <span>Active</span></h3><p>⌖　123 Main Street<br />　　League City, TX 77573</p><p>✉　hello@{(businessName || "mainstreetcafe").toLowerCase().replace(/[^a-z0-9]/g, "")}.com</p><p>◉　Central Time (CT)</p></div><dl><dt>Industry</dt><dd>Food &amp; Beverage</dd><dt>Company Size</dt><dd>Team workspace</dd><dt>Week Starts On</dt><dd>Sunday</dd></dl></div></section><div className="settings-ref-grid">{card("◷", "Time & Attendance", "Set clock in/out rules, breaks, overtime, and attendance policies.", "purple", ["Attendance Policies", "Break Rules", "Overtime Rules", `Time Rounding · ${rounding}`], "time")}{card("▦", "Scheduling", "Configure scheduling settings, shift rules, and availability.", "green", ["Schedule Preferences", "Shift & Time Off Settings", "Availability Rules", "Auto-Scheduling · Enabled"], "scheduling")}{card("$", "Pay & Overtime", "Manage pay rates, overtime, differentials, and pay periods.", "orange", ["Pay Rates", "Overtime & Differentials", "Pay Periods · Weekly", "Pay Day · Friday"], "pay")}{card("♧", "Notifications", "Control how and when you receive alerts and notifications.", "purple", ["Email Notifications", "Push Notifications", "Request Notifications", "Reminder Settings"], "notifications")}{card("♙", "Roles & Permissions", "Manage user roles and control what each role can access.", "green", ["User Roles", "Permission Groups", "Team Access", "Manage Admins"], "access")}{card("✣", "Integrations", "Connect with other tools and services you already use.", "purple", ["QuickBooks Online", "Gusto", "Google Calendar", "Slack"], "integrations")}</div><section className="panel settings-security"><div className="settings-ref-card-head"><span className="settings-ref-icon purple">▣</span><div><strong>Account &amp; Security</strong><p>Manage your account settings and keep your data secure.</p></div></div><div className="settings-security-grid"><button type="button" onClick={() => setSection("security")}>Security Policies　›</button><label>Time Display<select value={timeFormat} onChange={(event) => updateTimeFormat(event.target.value as "24" | "12")}><option value="12">12-hour</option><option value="24">24-hour</option></select></label><label>Workspace Text Size<select value={fontSize} onChange={(event) => updateFontSize(event.target.value as AppFontSize)}><option value="large">Large</option><option value="larger">Very large</option><option value="largest">Extra large</option><option value="standard">Standard</option></select></label><button type="button" onClick={() => flash("Data export is ready.")}>Data Export　›</button></div></section></div></div>;
}

function MessagingSetting({ flash }: { flash: (message: string) => void }) {
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  useEffect(() => { fetch("/api/settings/messaging").then((response) => response.ok ? response.json() as Promise<{ enabled: boolean }> : Promise.reject()).then((result) => setEnabled(result.enabled)).catch(() => {}).finally(() => setLoading(false)); }, []);
  async function update(value: boolean) {
    setEnabled(value);
    const response = await fetch("/api/settings/messaging", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled: value }) }).catch(() => null);
    if (!response?.ok) { setEnabled(!value); flash("Messaging setting could not be saved."); return; }
    flash(value ? "Messaging enabled." : "Messaging disabled.");
  }
  return <label className="setting-row toggle-setting"><div><strong>Team messaging</strong><span>{loading ? "Loading messaging setting…" : "Allow owners and employees to send shared team messages"}</span></div><input type="checkbox" checked={enabled} disabled={loading} onChange={(event) => update(event.target.checked)} /><i /></label>;
}

function EmployeeAccessSettings({ flash }: { flash: (message: string) => void }) {
  const [code, setCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/settings/employee-join-code")
      .then(async (response) => {
        if (!response.ok) throw new Error("The company code could not be loaded.");
        return response.json() as Promise<{ code: string | null }>;
      })
      .then((result) => setCode(result.code))
      .catch((reason: Error) => setError(reason.message))
      .finally(() => setLoading(false));
  }, []);

  async function generateCode() {
    setBusy(true);
    setError("");
    const response = await fetch("/api/settings/employee-join-code", { method: "POST" }).catch(() => null);
    const result = response ? await response.json().catch(() => null) as { code?: string; error?: string } | null : null;
    if (!response?.ok || !result?.code) {
      setError(result?.error ?? "A company code could not be created.");
      setBusy(false);
      return;
    }
    setCode(result.code);
    setBusy(false);
    flash("Your employee company code is ready.");
  }

  async function copyCode() {
    if (!code) return;
    await navigator.clipboard.writeText(code);
    flash("Company code copied.");
  }

  return <div className="settings-section">
    <h2>Employee login</h2>
    <p>Employees can create their own account with this 8-digit company code, their email, and a private password.</p>
    <div className="join-code-card">
      <div>
        <span className="join-code-label">Company code</span>
        <strong className="join-code-value">{loading ? "Loading…" : code ?? "Not created"}</strong>
        <small>Share this only with people who should be allowed to join your employee list.</small>
      </div>
      <div className="join-code-actions">
        {code && <button className="secondary-button" type="button" onClick={copyCode}>Copy code</button>}
        <button className="primary-button" type="button" onClick={generateCode} disabled={busy}>{busy ? "Creating…" : code ? "Create new code" : "Create code"}</button>
      </div>
    </div>
    {error && <p className="owner-form-error" role="alert">{error}</p>}
    <div className="access-settings-callout"><span>＋</span><div><strong>Employees can join themselves</strong><p>On the login screen, they choose Join a company and enter this code, their name, email, and a password. They appear in Employees automatically.</p></div></div>
    <div className="access-settings-callout legacy-access"><span>↗</span><div><strong>Individual logins still work</strong><p>You can still add someone yourself and choose Send login beside their name to create a private access code.</p></div><Link className="secondary-button" href="/team">Open Employees</Link></div>
    <ToggleSetting title="Keep hourly rates owner-only" description="Workers never see rate controls or another employee’s information" defaultChecked />
    <ToggleSetting title="Remember signed-in phones" description="Workers stay signed in for 30 days unless they log out" defaultChecked />
  </div>;
}

function OwnersSettings({ flash }: { flash: (message: string) => void }) {
  const [owners, setOwners] = useState<OwnerAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/owners")
      .then(async (response) => {
        if (!response.ok) throw new Error("Owners could not be loaded.");
        return response.json() as Promise<OwnerAccount[]>;
      })
      .then(setOwners)
      .catch((reason: Error) => setError(reason.message))
      .finally(() => setLoading(false));
  }, []);

  async function addOwner(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const response = await fetch("/api/owners", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: form.get("name"),
        email: form.get("email"),
        password: form.get("password"),
      }),
    }).catch(() => null);
    const result = response ? await response.json().catch(() => null) as (OwnerAccount & { error?: string }) | null : null;
    if (!response?.ok || !result?.id) {
      setError(result?.error ?? "That owner account could not be created.");
      setBusy(false);
      return;
    }
    setOwners((current) => [...current, result]);
    formElement.reset();
    setBusy(false);
    flash(`${result.name} can now sign in as an owner.`);
  }

  return <div className="settings-section owners-settings">
    <h2>Company owners</h2>
    <p>Every owner has full access to employees, hourly rates, hours, reports, and settings for this company.</p>
    <div className="owner-account-list">
      {loading && <div className="owner-account-empty">Loading owner accounts…</div>}
      {!loading && !owners.length && <div className="owner-account-empty">No owner accounts found.</div>}
      {owners.map((owner) => <div className="owner-account-row" key={owner.id}>
        <span className="owner-account-avatar">{owner.name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</span>
        <div><strong>{owner.name}</strong><span>{owner.email}</span></div>
        <i>Owner</i>
      </div>)}
    </div>
    <form className="owner-create-form" onSubmit={addOwner}>
      <div className="owner-form-heading"><strong>Add another owner</strong><span>Give them a separate login for the same company.</span></div>
      <div className="form-grid">
        <label>Full name<input name="name" autoComplete="name" placeholder="Enter their name" required /></label>
        <label>Email<input name="email" type="email" autoCapitalize="none" autoComplete="email" placeholder="name@example.com" required /></label>
        <label className="owner-password-field">Temporary password<input name="password" type="password" minLength={10} autoComplete="new-password" placeholder="At least 10 characters" required /><small>Share this privately. They can use it immediately.</small></label>
      </div>
      {error && <p className="owner-form-error" role="alert">{error}</p>}
      <button className="primary-button" type="submit" disabled={busy}>{busy ? "Adding owner…" : "Add owner"}</button>
    </form>
  </div>;
}

function ToggleSetting({ title, description, defaultChecked = false }: { title: string; description: string; defaultChecked?: boolean }) {
  return <label className="setting-row toggle-setting"><div><strong>{title}</strong><span>{description}</span></div><input type="checkbox" defaultChecked={defaultChecked} /><i /></label>;
}

function Stat({ icon, theme, label, value, note, pill }: { icon: string; theme: string; label: string; value: string; note: string; pill?: string }) {
  return <article className="stat-card"><div className="stat-top"><span className={`stat-icon ${theme}-icon`}>{icon}</span>{pill && <span className={theme === "coral" ? "trend" : "quiet-pill"}>{pill}</span>}</div><p>{label}</p><h2>{value}</h2><span className="stat-note">{note}</span></article>;
}

function PanelHead({ title, subtitle, action }: { title: string; subtitle: string; action?: React.ReactNode }) {
  return <div className="panel-head"><div><h3>{title}</h3><p>{subtitle}</p></div>{action}</div>;
}

function EmployeeRows({ employees, toggleClock, onEditTime }: { employees: Employee[]; toggleClock: (employee: Employee) => void; onEditTime?: (employee: Employee) => void }) {
  if (!employees.length) return <EmptyState title="No employees yet" message="Add an employee to begin tracking time." />;
  return <div className="employee-list">{employees.map((employee) => <div className="employee-row" key={employee.id}>
    <div className={`avatar ${employee.color}`}>{employee.initials}<span className={employee.status === "clocked_in" ? "status-dot online" : "status-dot"} /></div>
    <div className="employee-name"><strong>{employee.displayName ?? employee.name}</strong><span>{employee.role}</span></div>
    <div className="clock-detail">{employee.status === "clocked_in" ? <><strong>Clocked in</strong><span>Since {employee.clockIn}</span></> : <><strong>Not working</strong><span>{formatHours(employee.weeklyMinutes)} this week</span></>}</div>
    <div className="clock-row-actions">{onEditTime && <button className="clock-edit-button" type="button" onClick={() => onEditTime(employee)}>Edit time</button>}<button className={employee.status === "clocked_in" ? "clock-button out" : "clock-button"} onClick={() => toggleClock(employee)}>{employee.status === "clocked_in" ? "Clock out" : "Clock in"}</button></div>
  </div>)}</div>;
}

function WeekBars({ dailyMinutes }: { dailyMinutes: number[] }) {
  const days = [
    ["Mon", "violet", 1],
    ["Tue", "blue", .86],
    ["Wed", "mint", 1.08],
    ["Thu", "gold", .72],
    ["Fri", "coral", 1.16],
    ["Sat", "teal", .58],
    ["Sun", "lilac", .42],
  ] as const;
  return <div className="week-bars">{days.map(([day, tone], index) => {
    const minutes = dailyMinutes[index] ?? 0;
    const height = minutes > 0 ? Math.max(8, Math.min(100, minutes / 480 * 100)) : 0;
    return <div className={`day day-${tone}`} key={day} title={`${day}: ${formatHours(minutes)}`}><div className="bar-track"><span style={{ height: `${height}%` }} /></div><small>{day}</small></div>;
  })}</div>;
}

function EmptyState({ title, message }: { title: string; message: string }) {
  return <div className="empty-state"><strong>{title}</strong><p>{message}</p></div>;
}
