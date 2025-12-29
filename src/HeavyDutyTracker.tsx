import React, { useEffect, useMemo, useState } from "react";
import Papa from "papaparse";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import {
  TrendingUp,
  Target,
  Dumbbell,
  Activity,
  AlertCircle,
  CheckCircle2,
  MoreVertical,
  X,
  Award,
  Zap,
  Calendar,
  Flame,
  Battery,
  RefreshCw,
} from "lucide-react";

type WorkoutCategory = "push" | "pull" | "legs" | "conditioning";

type WorkoutEntry = {
  date: string;
  exerciseRaw?: string;
  exercise: string;
  sets: number;
  lowTarget: number;
  highTarget: number;
  tempo: string;
  rest: string;
  reps: number;
  weight: number;
  rpe: number;
  notes?: string;
  nextWeight?: string | number;
};

type WorkoutsState = Record<WorkoutCategory, WorkoutEntry[]>;

type MeasurementEntry = {
  n: number;
  ts: number;
  date: string;
  weightKg: number;
  fatPercent: number;
  chest: number;
  arms: number;
  waist: number;
  legs: number;
  calves: number;
  neck: number;
  forearms: number;
};

type MuscleGroup =
  | "Chest"
  | "Back"
  | "Legs"
  | "Shoulders"
  | "Arms"
  | "Core"
  | "Calves"
  | "Conditioning"
  | "Other";

type MuscleGroupOverride = Record<string, MuscleGroup>;

type ChartMode = "strength" | "measurements" | "volume" | "rpe" | "heatmap" | "compare";
type StrengthView = "overall" | "category" | "exercise";
type MeasureKey = "chest" | "arms" | "waist" | "legs" | "calves" | "neck" | "forearms" | "bmi" | "fatPercent";
type TimeRange = "1W" | "1M" | "3M" | "6M" | "1Y" | "ALL";

const STORAGE_KEY = "heavy-duty-tracker:v1";
const HEIGHT_M = 1.78;
const DAY_MS = 24 * 60 * 60 * 1000;

const MUSCLE_GROUPS: MuscleGroup[] = [
  "Chest", "Back", "Legs", "Shoulders", "Arms", "Core", "Calves", "Conditioning", "Other",
];

function safeJsonParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function toTs(d: string): number {
  if (!d) return Date.now();
  const cleaned = d.trim();

  // ISO format first (Hevy standard): yyyy-mm-dd
  const isoMatch = cleaned.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    const yyyy = Number(isoMatch[1]);
    const mm = Number(isoMatch[2]);
    const dd = Number(isoMatch[3]);
    return new Date(yyyy, mm - 1, dd).getTime();
  }

  // UK format: dd/mm/yyyy or dd-mm-yyyy
  const ukMatch = cleaned.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (ukMatch) {
    const dd = Number(ukMatch[1]);
    const mm = Number(ukMatch[2]);
    const yyyy = Number(ukMatch[3]);
    if (dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12) {
      return new Date(yyyy, mm - 1, dd).getTime();
    }
  }

  // Fallback
  const parsed = Date.parse(cleaned);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function startOfDay(ts: number) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function startOfWeek(ts: number) {
  const d = new Date(ts);
  const day = (d.getDay() + 6) % 7;
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - day);
  return d.getTime();
}

function weekOfMonth(date: Date) {
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7;
  return Math.ceil((date.getDate() + offset) / 7);
}

function formatTick(t: number, range: TimeRange) {
  const d = new Date(Number(t));
  if (range === "1W") return d.toLocaleDateString("en-GB", { weekday: "short" });
  if (range === "1M") return `Wk ${weekOfMonth(d)}`;
  if (range === "3M" || range === "6M") return d.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit" });
  return d.toLocaleDateString("en-GB", { month: "2-digit", year: "2-digit" });
}

function epley1RM(w: number, r: number) {
  return r > 0 ? w * (1 + r / 30) : w;
}

function tonnage(w: WorkoutEntry) {
  return (w.sets || 0) * (w.reps || 0) * (w.weight || 0);
}

function parseDateInputTs(v: string) {
  return v ? new Date(`${v}T00:00:00`).getTime() : 0;
}

function toDateLabel(d: string) {
  const t = Date.parse(d);
  const dt = Number.isFinite(t) ? new Date(t) : new Date();
  return dt.toLocaleDateString("en-GB");
}

function getRangeStart(range: TimeRange) {
  const now = Date.now();
  switch (range) {
    case "1W": return now - 7 * DAY_MS;
    case "1M": return now - 30 * DAY_MS;
    case "3M": return now - 90 * DAY_MS;
    case "6M": return now - 180 * DAY_MS;
    case "1Y": return now - 365 * DAY_MS;
    case "ALL":
    default: return 0;
  }
}

function calculateNextWeight(currentWeight: number, reps: number, lowTarget: number, highTarget: number, rpe: number) {
  if (reps >= highTarget && rpe >= 9) return (currentWeight * 1.025).toFixed(1);
  if (reps < lowTarget) return (currentWeight * 0.95).toFixed(1);
  return currentWeight.toFixed(1);
}

function detectCsvType(fieldsLower: string[]) {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_");
  const set = new Set(fieldsLower.map(norm));
  const hasAny = (...cands: string[]) => cands.some((c) => set.has(norm(c)));

  if (hasAny("exercise_title") && hasAny("weight_kg", "weight")) return "HEVY_WORKOUTS";
  if (hasAny("chest_in") && hasAny("waist_in", "abdomen_in")) return "HEVY_MEASUREMENTS";
  if (hasAny("steps") || (hasAny("value") && hasAny("date", "day", "start"))) return "STEPS";

  const looksLikeWorkout =
    hasAny("exercise", "exercise_name", "movement", "title") && 
    (hasAny("weight", "weight_kg", "load") || hasAny("reps", "rep"));
  if (looksLikeWorkout) return "GENERIC_WORKOUTS";
  return "UNKNOWN";
}

function parseHevyCSV(csvText: string) {
  const result = Papa.parse(csvText, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: true,
  });
  if (result.errors?.length) console.error("CSV parse errors:", result.errors);
  return result.data as Record<string, any>[];
}

function normalizeExercise(name: string) {
  const raw = (name || "").toString().trim();
  if (!raw) return "Unknown";
  if (/incline bench/i.test(raw)) return "Incline Bench";
  if (/shoulder press/i.test(raw)) return "Shoulder Press";
  if (/deadlift/i.test(raw)) return "Deadlift";
  if (/pulldown/i.test(raw)) return "Pulldown";
  if (/squat/i.test(raw)) return "Squat";
  return raw.replace(/\s*\(.*?\)\s*/g, "").trim();
}

function deduplicateWorkouts(workouts: WorkoutEntry[]): WorkoutEntry[] {
  const seen = new Set<string>();
  return workouts.filter((w) => {
    const key = `${w.date}-${w.exercise}-${w.weight}-${w.reps}-${w.rpe ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function StatCard({
  title,
  value,
  sub,
  tone = "blue",
}: {
  title: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: "blue" | "purple" | "green" | "orange" | "slate";
}) {
  const toneMap: Record<string, string> = {
    blue: "text-blue-300",
    purple: "text-purple-300",
    green: "text-green-300",
    orange: "text-orange-300",
    slate: "text-slate-200",
  };
  return (
    <div className="bg-slate-800/30 rounded-lg p-3">
      <div className="text-xs text-slate-400">{title}</div>
      <div className={`text-xl font-bold ${toneMap[tone]} mt-0.5`}>{value}</div>
      {sub && <div className="text-[11px] text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}

export default function HeavyDutyTracker() {
  const [chartMode, setChartMode] = useState<ChartMode>("strength");
  const [strengthView, setStrengthView] = useState<StrengthView>("overall");
  const [activeTab, setActiveTab] = useState<WorkoutCategory>("push");

  const [workouts, setWorkouts] = useState<WorkoutsState>({
    push: [], pull: [], legs: [], conditioning: [],
  });

  const [measurementHistory, setMeasurementHistory] = useState<MeasurementEntry[]>([]);
  const [measurements, setMeasurements] = useState({
    chest: 0, arms: 0, waist: 0, legs: 0, calves: 0, neck: 0, forearms: 0,
  });

  const [muscleGroupOverrides, setMuscleGroupOverrides] = useState<MuscleGroupOverride>({});

  const [progress, setProgress] = useState({
    inclineBench: { weight: 0, reps: 0, date: "" },
    squat: { weight: 0, reps: 0, date: "" },
    shoulderPress: { weight: 0, reps: 0, date: "" },
    pulldown: { weight: 0, reps: 0, date: "" },
    deadlift: { weight: 0, reps: 0, date: "" },
  });

  const [weeklySteps, setWeeklySteps] = useState(0);
  const [selectedExercise, setSelectedExercise] = useState<string>("Squat");
  const [selectedMeasureKey, setSelectedMeasureKey] = useState<MeasureKey>("waist");
  const [timeRange, setTimeRange] = useState<TimeRange>("3M");

  const [compareAStart, setCompareAStart] = useState<string>(() => 
    new Date(Date.now() - 60 * DAY_MS).toISOString().slice(0, 10)
  );
  const [compareAEnd, setCompareAEnd] = useState<string>(() => 
    new Date(Date.now() - 30 * DAY_MS).toISOString().slice(0, 10)
  );
  const [compareBStart, setCompareBStart] = useState<string>(() => 
    new Date(Date.now() - 30 * DAY_MS).toISOString().slice(0, 10)
  );
  const [compareBEnd, setCompareBEnd] = useState<string>(() => 
    new Date(Date.now()).toISOString().slice(0, 10)
  );

  const [isDragging, setIsDragging] = useState(false);
  const [showUploadGuide, setShowUploadGuide] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showInsights, setShowInsights] = useState(true);
  const [showOverridePanel, setShowOverridePanel] = useState(false);

  const [overrideExercise, setOverrideExercise] = useState<string>("");
  const [overrideMuscleGroup, setOverrideMuscleGroup] = useState<MuscleGroup>("Legs");

  const [lastSavedAt, setLastSavedAt] = useState<string>("");
  const [hydrated, setHydrated] = useState(false);
  
  // ✅ NEW: State for data version and upload status
  const [dataVersion, setDataVersion] = useState(0);
  const [uploadStatus, setUploadStatus] = useState<{
    type: 'success' | 'error' | 'info' | null;
    message: string;
    count?: number;
  }>({ type: null, message: '', count: 0 });

  const allWorkouts = useMemo(() => 
    [...workouts.push, ...workouts.pull, ...workouts.legs, ...workouts.conditioning], 
    [workouts, dataVersion]
  );

  const latestWorkoutTs = useMemo(() => {
    const timestamps = allWorkouts.map((w) => toTs(w.date));
    return timestamps.length ? Math.max(...timestamps) : 0;
  }, [allWorkouts]);

  const latestWorkoutDate = latestWorkoutTs
    ? new Date(latestWorkoutTs).toLocaleDateString('en-GB')
    : '—';

  const allExercises = useMemo(() => {
    const set = new Set<string>();
    for (const w of allWorkouts) set.add(w.exercise);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [allWorkouts]);

  useEffect(() => {
    if (!allExercises.length) return;
    if (!allExercises.includes(selectedExercise)) setSelectedExercise(allExercises[0]);
  }, [allExercises, selectedExercise]);

  const inferMuscleGroup = useMemo(() => {
    return (exercise: string): MuscleGroup => {
      const override = muscleGroupOverrides[exercise];
      if (override) return override;

      const x = (exercise || "").toLowerCase();
      if (/(squat|lunge|leg press|hack|deadlift|rdl|thigh|hamstring|quad)/.test(x)) return "Legs";
      if (/(bench|chest|fly|dip)/.test(x)) return "Chest";
      if (/(row|pulldown|pull-up|chin|lat|back)/.test(x)) return "Back";
      if (/(press|shoulder|lateral|rear delt|overhead)/.test(x)) return "Shoulders";
      if (/(curl|bicep|tricep|extension|pushdown)/.test(x)) return "Arms";
      if (/(calf)/.test(x)) return "Calves";
      if (/(abs|core|crunch|plank)/.test(x)) return "Core";
      if (/(run|bike|swim|conditioning|kettlebell|cardio)/.test(x)) return "Conditioning";
      return "Other";
    };
  }, [muscleGroupOverrides]);

  const earliestWorkoutTs = useMemo(() => {
    const ts = allWorkouts.map((w) => toTs(w.date)).filter(Number.isFinite);
    if (!ts.length) return 0;
    return Math.min(...ts);
  }, [allWorkouts]);

  const earliestMeasurementTs = useMemo(() => {
    const ts = measurementHistory.map((m) => m.ts).filter(Number.isFinite);
    if (!ts.length) return 0;
    return Math.min(...ts);
  }, [measurementHistory]);

  const availableRanges = useMemo(() => {
    const now = Date.now();
    const baseTs =
      chartMode === "measurements"
        ? earliestMeasurementTs
        : chartMode === "strength" || chartMode === "rpe" || chartMode === "heatmap"
        ? earliestWorkoutTs
        : 0;

    const spanDays = baseTs ? Math.floor((now - baseTs) / DAY_MS) : 0;
    const ranges: TimeRange[] = ["1W", "1M", "3M", "6M", "1Y", "ALL"];

    const ok = (r: TimeRange) => {
      if (r === "ALL") return true;
      if (!spanDays) return false;
      if (r === "1W") return spanDays >= 7;
      if (r === "1M") return spanDays >= 30;
      if (r === "3M") return spanDays >= 90;
      if (r === "6M") return spanDays >= 180;
      if (r === "1Y") return spanDays >= 365;
      return true;
    };

    const filtered = ranges.filter(ok);
    return filtered.length ? filtered : (["ALL"] as TimeRange[]);
  }, [chartMode, earliestWorkoutTs, earliestMeasurementTs]);

  useEffect(() => {
    if (chartMode === "volume" || chartMode === "compare") return;
    if (!availableRanges.includes(timeRange)) {
      const next = availableRanges.includes("ALL") ? "ALL" : availableRanges[availableRanges.length - 1];
      setTimeRange(next);
    }
  }, [availableRanges, timeRange, chartMode]);

  const rangeStartTs = useMemo(() => getRangeStart(timeRange), [timeRange]);

  const filterByRange = <T extends { ts: number }>(data: T[]) => {
    const start = rangeStartTs;
    if (!start) return data;
    return data.filter((d) => d.ts >= start);
  };

  const measurementsChartData = useMemo(() => {
    return measurementHistory
      .map((m) => {
        const bmi = m.weightKg > 0 ? +(m.weightKg / (HEIGHT_M * HEIGHT_M)).toFixed(1) : 0;
        const leanMass = m.weightKg > 0 && m.fatPercent > 0 ? +(m.weightKg * (1 - m.fatPercent / 100)).toFixed(1) : 0;
        return {
          ts: m.ts,
          label: m.date,
          weightKg: m.weightKg,
          bmi,
          fatPercent: m.fatPercent,
          leanMass,
          chest: m.chest,
          arms: m.arms,
          waist: m.waist,
          legs: m.legs,
          calves: m.calves,
          neck: m.neck,
          forearms: m.forearms,
        };
      })
      .sort((a, b) => a.ts - b.ts);
  }, [measurementHistory]);

  const latestWeightMeasurement = useMemo(() => {
    const arr = measurementHistory.filter((m) => m.weightKg > 0).sort((a, b) => a.ts - b.ts);
    return arr.length ? arr[arr.length - 1] : null;
  }, [measurementHistory]);

  const latestFatMeasurement = useMemo(() => {
    const arr = measurementHistory.filter((m) => m.fatPercent > 0).sort((a, b) => a.ts - b.ts);
    return arr.length ? arr[arr.length - 1] : null;
  }, [measurementHistory]);

  const latestWeight = latestWeightMeasurement?.weightKg ?? 0;
  const latestBmi = useMemo(() => (latestWeight > 0 ? +(latestWeight / (HEIGHT_M * HEIGHT_M)).toFixed(1) : 0), [latestWeight]);

  const latestFatPercent = useMemo(() => {
    const v = latestFatMeasurement?.fatPercent ?? 0;
    return v > 0 ? +Number(v).toFixed(1) : 0;
  }, [latestFatMeasurement]);

  const leanMass = useMemo(() => {
    if (!(latestWeight > 0) || !(latestFatPercent > 0)) return 0;
    return +(latestWeight * (1 - latestFatPercent / 100)).toFixed(1);
  }, [latestWeight, latestFatPercent]);

  const fatMass = useMemo(() => {
    if (!(latestWeight > 0) || !(latestFatPercent > 0)) return 0;
    return +(latestWeight * (latestFatPercent / 100)).toFixed(1);
  }, [latestWeight, latestFatPercent]);

  const strengthOverall = useMemo(() => {
    const lifts = [
      { key: "Incline Bench", color: "#a78bfa", outKey: "Incline", name: "Incline Bench" },
      { key: "Squat", color: "#60a5fa", outKey: "Squat", name: "Squat" },
      { key: "Shoulder Press", color: "#34d399", outKey: "Shoulders", name: "Shoulder Press" },
      { key: "Pulldown", color: "#fbbf24", outKey: "Pulldown", name: "Pulldown" },
      { key: "Deadlift", color: "#fb7185", outKey: "Deadlift", name: "Deadlift" },
    ] as const;

    const counts = {
      Incline: workouts.push.filter((w) => w.exercise === "Incline Bench").length,
      Squat: workouts.legs.filter((w) => w.exercise === "Squat").length,
      Shoulder: workouts.push.filter((w) => w.exercise === "Shoulder Press").length,
      Pulldown: workouts.pull.filter((w) => w.exercise === "Pulldown").length,
      Deadlift: workouts.pull.filter((w) => w.exercise === "Deadlift").length,
    };

    const map: Record<number, any> = {};
    for (const w of allWorkouts) {
      const ts = toTs(w.date);
      if (!map[ts]) map[ts] = { ts, label: new Date(ts).toLocaleDateString("en-GB") };
      const lift = lifts.find((l) => l.key === w.exercise);
      if (!lift) continue;
      map[ts][lift.outKey] = +epley1RM(w.weight, w.reps).toFixed(1);
    }

    const data = Object.values(map).sort((a, b) => a.ts - b.ts);
    return { data, lifts, counts };
  }, [allWorkouts, workouts]);

  const categoryAverageSeries = useMemo(() => {
    const list = workouts[activeTab] ?? [];
    const map: Record<number, { ts: number; vals: number[] }> = {};
    for (const w of list) {
      const ts = toTs(w.date);
      if (!map[ts]) map[ts] = { ts, vals: [] };
      map[ts].vals.push(+epley1RM(w.weight, w.reps).toFixed(1));
    }
    return Object.values(map)
      .map((x) => ({
        ts: x.ts,
        avg: +(x.vals.reduce((a, b) => a + b, 0) / Math.max(1, x.vals.length)).toFixed(1),
      }))
      .sort((a, b) => a.ts - b.ts);
  }, [workouts, activeTab]);

  const exerciseSeries = useMemo(() => {
    const filtered = allWorkouts.filter((w) => w.exercise === selectedExercise);
    return filtered
      .map((w) => ({
        ts: toTs(w.date),
        val: +epley1RM(w.weight, w.reps).toFixed(1),
      }))
      .sort((a, b) => a.ts - b.ts);
  }, [allWorkouts, selectedExercise]);

  const rpeDailySeries = useMemo(() => {
    const map: Record<number, { ts: number; rpeSum: number; count: number; fail: number }> = {};
    for (const w of allWorkouts) {
      if (!(w.rpe > 0)) continue;
      const ts = startOfDay(toTs(w.date));
      if (!map[ts]) map[ts] = { ts, rpeSum: 0, count: 0, fail: 0 };
      map[ts].rpeSum += w.rpe;
      map[ts].count += 1;
      if (w.rpe >= 9) map[ts].fail += 1;
    }

    return Object.values(map)
      .map((x) => ({
        ts: x.ts,
        avgRpe: x.count ? +(x.rpeSum / x.count).toFixed(2) : 0,
        failurePct: x.count ? +((x.fail / x.count) * 100).toFixed(0) : 0,
        n: x.count,
      }))
      .sort((a, b) => a.ts - b.ts);
  }, [allWorkouts]);

  const dailyWorkoutCounts = useMemo(() => {
    const counts: Record<number, number> = {};
    for (const w of allWorkouts) {
      const d0 = startOfDay(toTs(w.date));
      counts[d0] = (counts[d0] ?? 0) + 1;
    }
    return counts;
  }, [allWorkouts]);

  const heatmapWeeks = useMemo(() => {
    const now = startOfDay(Date.now());
    const startFromRange = rangeStartTs ? startOfDay(rangeStartTs) : 0;
    const startMin = now - 365 * DAY_MS;
    const start = startOfWeek(Math.max(startFromRange, startMin));
    const end = now;

    const days: Array<{ ts: number; count: number }> = [];
    for (let t = start; t <= end; t += DAY_MS) {
      days.push({ ts: t, count: dailyWorkoutCounts[t] ?? 0 });
    }

    const maxCount = Math.max(0, ...days.map((d) => d.count));
    const levelFor = (count: number) => {
      if (count <= 0) return 0;
      if (maxCount <= 1) return 2;
      const ratio = count / maxCount;
      if (ratio < 0.25) return 1;
      if (ratio < 0.5) return 2;
      if (ratio < 0.75) return 3;
      return 4;
    };

    const weeks: Array<{ weekTs: number; days: Array<{ ts: number; count: number; level: number }> }> = [];
    let curWeek = start;
    while (curWeek <= end) {
      const weekDays: Array<{ ts: number; count: number; level: number }> = [];
      for (let i = 0; i < 7; i++) {
        const ts = curWeek + i * DAY_MS;
        if (ts > end) break;
        const c = dailyWorkoutCounts[ts] ?? 0;
        weekDays.push({ ts, count: c, level: levelFor(c) });
      }
      weeks.push({ weekTs: curWeek, days: weekDays });
      curWeek += 7 * DAY_MS;
    }

    return { weeks, maxCount };
  }, [dailyWorkoutCounts, rangeStartTs]);

  // ---------- Volume (summary + muscle group pie) ----------

  const weeklyVolumeSeries = useMemo(() => {
    const map: Record<number, { ts: number; volume: number; rpeSum: number; rpeCount: number }> = {};
    for (const w of allWorkouts) {
      const ts = startOfWeek(toTs(w.date));
      if (!map[ts]) map[ts] = { ts, volume: 0, rpeSum: 0, rpeCount: 0 };
      map[ts].volume += tonnage(w);
      if (w.rpe > 0) {
        map[ts].rpeSum += w.rpe;
        map[ts].rpeCount += 1;
      }
    }
    return Object.values(map)
      .map((x) => ({
        ts: x.ts,
        volume: +x.volume.toFixed(0),
        avgRPE: x.rpeCount ? +(x.rpeSum / x.rpeCount).toFixed(2) : 0,
      }))
      .sort((a, b) => a.ts - b.ts);
  }, [allWorkouts]);

  const volumeDropWarning = useMemo(() => {
    const last4 = weeklyVolumeSeries.slice(-4);
    const prev4 = weeklyVolumeSeries.slice(-8, -4);
    if (last4.length < 4 || prev4.length < 4) return null;

    const lastSum = last4.reduce((s, x) => s + x.volume, 0);
    const prevSum = prev4.reduce((s, x) => s + x.volume, 0);
    if (prevSum === 0) return null;
    const pct = +(((lastSum - prevSum) / prevSum) * 100).toFixed(0);

    if (pct < -10) return { type: "drop" as const, pct };
    if (pct > 10) return { type: "increase" as const, pct };
    return null;
  }, [weeklyVolumeSeries]);

  const volumeSummary = useMemo(() => {
    const last4 = weeklyVolumeSeries.slice(-4);
    const last4Vol = last4.reduce((s, x) => s + x.volume, 0);
    const last4RpeWeeks = last4.filter((x) => x.avgRPE > 0);
    const avgWeeklyRPE = last4RpeWeeks.length
      ? +(last4RpeWeeks.reduce((s, x) => s + x.avgRPE, 0) / last4RpeWeeks.length).toFixed(2)
      : 0;
    return { last4Vol, avgWeeklyRPE };
  }, [weeklyVolumeSeries]);

  const muscleGroupTonnage = useMemo(() => {
    const map: Record<MuscleGroup, number> = {
      Chest: 0,
      Back: 0,
      Legs: 0,
      Shoulders: 0,
      Arms: 0,
      Core: 0,
      Calves: 0,
      Conditioning: 0,
      Other: 0,
    };
    for (const w of allWorkouts) {
      const g = inferMuscleGroup(w.exercise);
      map[g] += tonnage(w);
    }

    const palette: Record<MuscleGroup, string> = {
      Legs: "#34d399",
      Back: "#60a5fa",
      Chest: "#a78bfa",
      Shoulders: "#fbbf24",
      Arms: "#fb7185",
      Core: "#22c55e",
      Calves: "#eab308",
      Conditioning: "#38bdf8",
      Other: "#94a3b8",
    };

    const items = (Object.keys(map) as MuscleGroup[])
      .map((name) => ({ name, value: map[name], color: palette[name] }))
      .filter((x) => x.value > 0)
      .sort((a, b) => b.value - a.value);

    const total = items.reduce((s, x) => s + x.value, 0);
    return items.map((x) => ({
      ...x,
      pct: total ? +(x.value / total * 100).toFixed(1) : 0,
      total,
    }));
  }, [allWorkouts, inferMuscleGroup]);

  const muscleGroupPieData = useMemo(() => muscleGroupTonnage.slice(0, 9), [muscleGroupTonnage]);

  // ---------- Compare ----------
  const compareData = useMemo(() => {
    const aStart = parseDateInputTs(compareAStart);
    const aEnd = parseDateInputTs(compareAEnd);
    const bStart = parseDateInputTs(compareBStart);
    const bEnd = parseDateInputTs(compareBEnd);

    const inRange = (ts: number, s: number, e: number) => ts >= s && ts <= e;

    const aWorkouts = allWorkouts.filter((w) => inRange(toTs(w.date), aStart, aEnd));
    const bWorkouts = allWorkouts.filter((w) => inRange(toTs(w.date), bStart, bEnd));

    const calc = (arr: WorkoutEntry[]) => {
      const sessions = new Set(arr.map((w) => toDateLabel(w.date))).size;
      const ton = arr.reduce((s, w) => s + tonnage(w), 0);
      const rpes = arr.filter((w) => w.rpe > 0).map((w) => w.rpe);
      const avgRPE = rpes.length ? +(rpes.reduce((a, b) => a + b, 0) / rpes.length).toFixed(2) : 0;
      const failurePct = rpes.length ? +((rpes.filter((r) => r >= 9).length / rpes.length) * 100).toFixed(0) : 0;
      return { sessions, tonnage: ton, avgRPE, failurePct, entries: arr.length };
    };

    return { a: calc(aWorkouts), b: calc(bWorkouts) };
  }, [allWorkouts, compareAStart, compareAEnd, compareBStart, compareBEnd]);

  // ---------- Insights ----------
  const insights = useMemo(() => {
    const total = allWorkouts.length;
    const categoryWorkouts = {
      push: workouts.push.length,
      pull: workouts.pull.length,
      legs: workouts.legs.length,
    };

    const volumeByCategory = {
      push: workouts.push.reduce((s, w) => s + tonnage(w), 0),
      pull: workouts.pull.reduce((s, w) => s + tonnage(w), 0),
      legs: workouts.legs.reduce((s, w) => s + tonnage(w), 0),
    };

    const dates = allWorkouts.map((w) => toTs(w.date)).filter(Number.isFinite).sort((a, b) => a - b);
    const daysSinceLastWorkout =
      dates.length > 0 ? Math.floor((Date.now() - dates[dates.length - 1]) / DAY_MS) : null;

    const recent30 = dates.filter((d) => d > Date.now() - 30 * DAY_MS).length;
    const workoutFrequency = recent30 > 0 ? +(30 / recent30).toFixed(1) : null;

    const rpeValues = allWorkouts.filter((w) => w.rpe > 0).map((w) => w.rpe);
    const avgRPE = rpeValues.length ? +(rpeValues.reduce((a, b) => a + b, 0) / rpeValues.length).toFixed(1) : null;

    const repRangeDistribution = allWorkouts.reduce(
      (acc, w) => {
        if (w.reps <= 5) acc.low += 1;
        else if (w.reps <= 10) acc.target += 1;
        else acc.high += 1;
        return acc;
      },
      { low: 0, target: 0, high: 0 }
    );

    const trainingStreak = (() => {
      if (!dates.length) return 0;
      const unique = Array.from(new Set(dates.map((d) => new Date(d).toDateString())))
        .map((s) => new Date(s).getTime())
        .sort((a, b) => a - b);

      let streak = 1;
      for (let i = unique.length - 1; i > 0; i--) {
        const diff = Math.floor((unique[i] - unique[i - 1]) / DAY_MS);
        if (diff <= 7) streak += 1;
        else break;
      }
      return streak;
    })();

    const achievements: Array<{ title: string; icon: string }> = [];
    if (total >= 50) achievements.push({ title: "50 Workouts", icon: "🏆" });
    if (total >= 100) achievements.push({ title: "Century Club", icon: "💯" });
    if (progress.squat.weight >= 100) achievements.push({ title: "100kg Squat", icon: "🦵" });
    if (progress.deadlift.weight >= 100) achievements.push({ title: "100kg Deadlift", icon: "💪" });
    if (trainingStreak >= 4) achievements.push({ title: `${trainingStreak} Week Streak`, icon: "🔥" });

    const balanceIssue =
      Math.abs(categoryWorkouts.push - categoryWorkouts.pull) > 5
        ? categoryWorkouts.push > categoryWorkouts.pull
          ? "More push than pull"
          : "More pull than push"
        : null;

    const needsDeload = recent30 > 15 && avgRPE !== null && avgRPE < 8;

    const bodyweightRatios =
      latestWeight > 0
        ? {
            squatRatio: progress.squat.weight > 0 ? +(progress.squat.weight / latestWeight).toFixed(2) : 0,
            deadliftRatio: progress.deadlift.weight > 0 ? +(progress.deadlift.weight / latestWeight).toFixed(2) : 0,
            benchRatio: progress.inclineBench.weight > 0 ? +(progress.inclineBench.weight / latestWeight).toFixed(2) : 0,
          }
        : null;

    const measurementTrend =
      measurementHistory.length >= 2
        ? {
            weightChange: +(measurementHistory[measurementHistory.length - 1].weightKg - measurementHistory[0].weightKg).toFixed(1),
            waistChange: +(measurementHistory[measurementHistory.length - 1].waist - measurementHistory[0].waist).toFixed(1),
          }
        : null;

    return {
      totalWorkouts: total,
      categoryWorkouts,
      volumeByCategory,
      daysSinceLastWorkout,
      workoutFrequency,
      avgRPE,
      repRangeDistribution,
      trainingStreak,
      achievements,
      balanceIssue,
      needsDeload,
      bodyweightRatios,
      measurementTrend,
      leanMass,
      fatMass,
    };
  }, [allWorkouts, workouts, progress, latestWeight, measurementHistory, leanMass, fatMass]);

  // ---------- Persistence ----------
  useEffect(() => {
    const saved = safeJsonParse<{
      workouts?: WorkoutsState;
      measurements?: typeof measurements;
      measurementHistory?: MeasurementEntry[];
      weeklySteps?: number;
      progress?: typeof progress;
      muscleGroupOverrides?: MuscleGroupOverride;
      savedAt?: string;
    }>(localStorage.getItem(STORAGE_KEY));

    try {
      if (saved?.workouts) setWorkouts(saved.workouts);
      if (saved?.measurements) setMeasurements(saved.measurements);
      if (saved?.measurementHistory) setMeasurementHistory(saved.measurementHistory);
      if (typeof saved?.weeklySteps === "number") setWeeklySteps(saved.weeklySteps);
      if (saved?.progress) setProgress(saved.progress);
      if (saved?.muscleGroupOverrides) setMuscleGroupOverrides(saved.muscleGroupOverrides);
      if (saved?.savedAt) setLastSavedAt(saved.savedAt);
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      const payload = {
        workouts,
        measurements,
        measurementHistory,
        weeklySteps,
        progress,
        muscleGroupOverrides,
        savedAt: new Date().toISOString(),
      };
      setLastSavedAt(payload.savedAt);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (e) {
      console.error("Failed to save data", e);
    }
  }, [hydrated, workouts, measurements, measurementHistory, weeklySteps, progress, muscleGroupOverrides]);

  useEffect(() => {
    const onClick = () => setShowMoreMenu(false);
    if (showMoreMenu) window.addEventListener("click", onClick);
    return () => window.removeEventListener("click", onClick);
  }, [showMoreMenu]);

  // ---------- Export / Reset ----------
  const downloadJSON = () => {
    const payload = {
      workouts,
      measurements,
      measurementHistory,
      weeklySteps,
      progress,
      muscleGroupOverrides,
      savedAt: lastSavedAt,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `heavy-duty-backup-${new Date().toISOString().split("T")[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadWorkoutsCSV = () => {
    const flat = allWorkouts;
    if (!flat.length) {
      alert("No workout data to export");
      return;
    }
    const csv = Papa.unparse(flat);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `heavy-duty-workouts-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const resetAllData = () => {
    localStorage.removeItem(STORAGE_KEY);
    setWorkouts({ push: [], pull: [], legs: [], conditioning: [] });
    setProgress({
      inclineBench: { weight: 0, reps: 0, date: "" },
      squat: { weight: 0, reps: 0, date: "" },
      shoulderPress: { weight: 0, reps: 0, date: "" },
      pulldown: { weight: 0, reps: 0, date: "" },
      deadlift: { weight: 0, reps: 0, date: "" },
    });
    setMeasurements({ chest: 0, arms: 0, waist: 0, legs: 0, calves: 0, neck: 0, forearms: 0 });
    setMeasurementHistory([]);
    setWeeklySteps(0);
    setMuscleGroupOverrides({});
    setLastSavedAt("");
    setSelectedExercise("Squat");
  };

  const confirmAndReset = () => {
    const ok = window.confirm("Are you sure you want to reset? This will clear all saved data on this device.");
    if (ok) resetAllData();
  };

  // ---------- Overrides UI ----------
  const saveOverride = () => {
    if (!overrideExercise || !overrideMuscleGroup) return;
    setMuscleGroupOverrides((prev) => ({ ...prev, [overrideExercise]: overrideMuscleGroup }));
    setOverrideExercise("");
    setOverrideMuscleGroup("Legs");
  };

  const removeOverride = (exercise: string) => {
    setMuscleGroupOverrides((prev) => {
      const copy = { ...prev };
      delete copy[exercise];
      return copy;
    });
  };

  // ---------- Upload handlers ----------
  const updateProgress = (newWorkouts: WorkoutsState) => {
    const updateLift = (category: WorkoutCategory, exerciseName: string, stateKey: keyof typeof progress) => {
      const arr = newWorkouts[category].filter((w) => w.exercise === exerciseName);
      if (!arr.length) return;
      const latest = arr[arr.length - 1];
      setProgress((prev) => ({
        ...prev,
        [stateKey]: { weight: latest.weight, reps: latest.reps, date: latest.date },
      }));
    };

    updateLift("push", "Incline Bench", "inclineBench");
    updateLift("legs", "Squat", "squat");
    updateLift("push", "Shoulder Press", "shoulderPress");
    updateLift("pull", "Pulldown", "pulldown");
    updateLift("pull", "Deadlift", "deadlift");
  };

  const handleWorkoutUpload = (event: React.ChangeEvent<HTMLInputElement> | { target: { files: File[] } }) => {
    const file = (event as any).target.files?.[0] as File | undefined;
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e: ProgressEvent<FileReader>) => {
      const csvData = parseHevyCSV(String(e.target?.result ?? ""));
      const newWorkouts: WorkoutsState = { push: [], pull: [], legs: [], conditioning: [] };

      for (const row of csvData) {
        const title = (row["title"] ?? "").toString().toLowerCase();
        const category: WorkoutCategory =
          title.includes("push") ? "push" : title.includes("pull") ? "pull" : title.includes("legs") ? "legs" : "conditioning";

        const rawExercise = (row["exercise_title"] ?? row["exercise"] ?? row["exercise_name"] ?? "").toString();
        const exercise = normalizeExercise(rawExercise);

        const reps = Number(row["reps"] ?? row["rep"] ?? 0);
        const weight = Number(row["weight_kg"] ?? row["weight"] ?? 0);

        // Hevy typically has one set per row, but keep field for future
        const sets = Number(row["sets"] ?? 1) || 1;

        const rpe = Number(row["rpe"] ?? 9);
        const date = (row["start_time"] ?? row["date"] ?? "").toString() || new Date().toLocaleDateString("en-GB");

        const workout: WorkoutEntry = {
          date,
          exerciseRaw: rawExercise,
          exercise,
          sets,
          lowTarget: 6,
          highTarget: 10,
          tempo: "3010",
          rest: "120s",
          reps: Number.isFinite(reps) ? reps : 0,
          weight: Number.isFinite(weight) ? weight : 0,
          rpe: Number.isFinite(rpe) ? rpe : 9,
          notes: (row["exercise_notes"] ?? row["notes"] ?? "").toString(),
        };
        workout.nextWeight = calculateNextWeight(workout.weight, workout.reps, workout.lowTarget, workout.highTarget, workout.rpe);
        newWorkouts[category].push(workout);
      }

      setWorkouts((prev) => {
        const merged: WorkoutsState = {
          push: deduplicateWorkouts([...prev.push, ...newWorkouts.push]),
          pull: deduplicateWorkouts([...prev.pull, ...newWorkouts.pull]),
          legs: deduplicateWorkouts([...prev.legs, ...newWorkouts.legs]),
          conditioning: deduplicateWorkouts([...prev.conditioning, ...newWorkouts.conditioning]),
        };
        updateProgress(merged);
        
        // Show success message
        setUploadStatus({
          type: 'success',
          message: `Uploaded ${csvData.length} workout entries`,
          count: csvData.length
        });
        setTimeout(() => setUploadStatus({ type: null, message: '' }), 5000);
        
        // Force refresh
        setDataVersion(v => v + 1);
        
        return merged;
      });
    };
    reader.readAsText(file);
  };

  const handleMeasurementsUpload = (event: React.ChangeEvent<HTMLInputElement> | { target: { files: File[] } }) => {
    const file = (event as any).target.files?.[0] as File | undefined;
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e: ProgressEvent<FileReader>) => {
      const csvData = parseHevyCSV(String(e.target?.result ?? ""));

      const avg = (a: any, b: any) => {
        const A = Number(a);
        const B = Number(b);
        if (Number.isFinite(A) && Number.isFinite(B)) return +((A + B) / 2).toFixed(1);
        return Number.isFinite(A) ? A : Number.isFinite(B) ? B : 0;
      };

      const historyRaw = csvData
        .map((row) => {
          const rawDate = (row["date"] ?? row["start_time"] ?? row["Date"] ?? "").toString();
          const weightKg = Number(row["weight_kg"] ?? row["weight"] ?? 0);
          const fatPercent = Number(row["fat_percent"] ?? row["body_fat"] ?? row["fat%"] ?? 0);

          const chest = Number(row["chest_in"] ?? row["chest"] ?? 0);
          const arms = avg(row["left_bicep_in"] ?? row["left_arm_in"], row["right_bicep_in"] ?? row["right_arm_in"]);
          const waist = Number(row["waist_in"] ?? row["abdomen_in"] ?? row["waist"] ?? 0);
          const legs = avg(row["left_thigh_in"], row["right_thigh_in"]);
          const calves = avg(row["left_calf_in"], row["right_calf_in"]);
          const neck = Number(row["neck_in"] ?? row["neck"] ?? 0);
          const forearms = avg(row["left_forearm_in"], row["right_forearm_in"]);

          const hasAny =
            (Number.isFinite(weightKg) && weightKg > 0) ||
            (Number.isFinite(fatPercent) && fatPercent > 0) ||
            chest > 0 ||
            arms > 0 ||
            waist > 0 ||
            legs > 0 ||
            calves > 0 ||
            neck > 0 ||
            forearms > 0;

          return { rawDate, weightKg, fatPercent, chest, arms, waist, legs, calves, neck, forearms, hasAny };
        })
        .filter((r) => r.hasAny)
        .sort((a, b) => toTs(a.rawDate) - toTs(b.rawDate));

      const history: MeasurementEntry[] = historyRaw.map((r, i) => ({
        n: i + 1,
        ts: toTs(r.rawDate),
        date: toDateLabel(r.rawDate),
        weightKg: Number.isFinite(r.weightKg) ? r.weightKg : 0,
        fatPercent: Number.isFinite(r.fatPercent) ? r.fatPercent : 0,
        chest: r.chest,
        arms: r.arms,
        waist: r.waist,
        legs: r.legs,
        calves: r.calves,
        neck: r.neck,
        forearms: r.forearms,
      }));

      setMeasurementHistory(history);

      // update tape measurements from latest entry that has any tape values
      const latestTape = [...history].reverse().find((m) => m.chest || m.arms || m.waist || m.legs || m.calves || m.neck || m.forearms);
      if (latestTape) {
        setMeasurements({
          chest: latestTape.chest,
          arms: latestTape.arms,
          waist: latestTape.waist,
          legs: latestTape.legs,
          calves: latestTape.calves,
          neck: latestTape.neck,
          forearms: latestTape.forearms,
        });
      }
    };

    reader.readAsText(file);
  };

  const handleStepsUpload = (event: React.ChangeEvent<HTMLInputElement> | { target: { files: File[] } }) => {
    const file = (event as any).target.files?.[0] as File | undefined;
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e: ProgressEvent<FileReader>) => {
      const csvText = String(e.target?.result ?? "");
      const csvData = parseHevyCSV(csvText);
      const last7 = csvData.slice(-7);

      const total = last7.reduce((sum: number, row: any) => {
        const v = row["Steps"] ?? row["Value"] ?? row["steps"] ?? row["value"] ?? 0;
        const n = Number.parseInt(String(v ?? 0), 10);
        return sum + (Number.isFinite(n) ? n : 0);
      }, 0);

      setWeeklySteps(Math.round(total / 7));
    };
    reader.readAsText(file);
  };

  function processCsvFile(file: File) {
    const reader = new FileReader();
    reader.onload = (e: ProgressEvent<FileReader>) => {
      const csvText = String(e.target?.result ?? "");
      const parsed = Papa.parse(csvText, { header: true, preview: 1 });
      const fields = ((parsed.meta.fields ?? []) as string[]).map((f) => f.toLowerCase());
      const type = detectCsvType(fields);

      if (type === "HEVY_WORKOUTS" || type === "GENERIC_WORKOUTS") {
        handleWorkoutUpload({ target: { files: [file] } });
        return;
      }
      if (type === "HEVY_MEASUREMENTS") {
        handleMeasurementsUpload({ target: { files: [file] } });
        return;
      }
      if (type === "STEPS") {
        handleStepsUpload({ target: { files: [file] } });
        return;
      }

      alert(
        `Unknown CSV format.\n\nHeaders found:\n${fields.slice(0, 30).join(", ")}${fields.length > 30 ? "..." : ""}\n\nIf you tell me which app exported this CSV, I can add a mapping.`
      );
    };
    reader.readAsText(file);
  }

  const handleSmartUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    processCsvFile(file);
    event.target.value = "";
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };
  const onDragLeave = () => setIsDragging(false);
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processCsvFile(file);
  };

  // ---------- Render helpers ----------
  const renderWorkoutTable = (category: WorkoutCategory) => {
    const data = workouts[category] ?? [];
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-700">
              <th className="text-left py-3 px-2 text-slate-400 font-medium">Date</th>
              <th className="text-left py-3 px-2 text-slate-400 font-medium">Exercise</th>
              <th className="text-center py-3 px-2 text-slate-400 font-medium">Sets</th>
              <th className="text-center py-3 px-2 text-slate-400 font-medium">Target</th>
              <th className="text-center py-3 px-2 text-slate-400 font-medium">Tempo</th>
              <th className="text-center py-3 px-2 text-slate-400 font-medium">Rest</th>
              <th className="text-center py-3 px-2 text-slate-400 font-medium">Reps</th>
              <th className="text-center py-3 px-2 text-slate-400 font-medium">Weight</th>
              <th className="text-center py-3 px-2 text-slate-400 font-medium">RPE</th>
              <th className="text-center py-3 px-2 text-slate-400 font-medium">Est 1RM</th>
              <th className="text-center py-3 px-2 text-slate-400 font-medium">Next</th>
            </tr>
          </thead>
          <tbody>
            {data.length === 0 ? (
              <tr>
                <td colSpan={11} className="text-center py-8 text-slate-500">
                  No workouts yet. Upload a CSV to get started.
                </td>
              </tr>
            ) : (
              data.map((w, idx) => (
                <tr
                  key={idx}
                  onClick={() => {
                    setSelectedExercise(w.exercise);
                    setChartMode("strength");
                    setStrengthView("exercise");
                  }}
                  className="cursor-pointer border-b border-slate-800 hover:bg-slate-800/50 transition-colors"
                >
                  <td className="py-3 px-2 text-slate-300 text-xs">{toDateLabel(w.date)}</td>
                  <td className="py-3 px-2 text-slate-200 font-medium">{w.exercise}</td>
                  <td className="text-center py-3 px-2 text-slate-300">{w.sets}</td>
                  <td className="text-center py-3 px-2 text-slate-400 text-xs">
                    {w.lowTarget}-{w.highTarget}
                  </td>
                  <td className="text-center py-3 px-2 text-slate-400 text-xs">{w.tempo}</td>
                  <td className="text-center py-3 px-2 text-slate-400 text-xs">{w.rest}</td>
                  <td className="text-center py-3 px-2 text-slate-200 font-semibold">{w.reps}</td>
                  <td className="text-center py-3 px-2 text-blue-400 font-semibold">{w.weight}kg</td>
                  <td className="text-center py-3 px-2">
                    <span
                      className={`font-semibold ${
                        w.rpe >= 9 ? "text-red-400" : w.rpe >= 7.5 ? "text-orange-400" : "text-green-400"
                      }`}
                    >
                      {w.rpe}
                    </span>
                  </td>
                  <td className="text-center py-3 px-2 text-purple-400 font-semibold">
                    {epley1RM(w.weight, w.reps).toFixed(1)}kg
                  </td>
                  <td className="text-center py-3 px-2 text-green-400 font-semibold">
                    {w.nextWeight}
                    {"kg"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    );
  };

  const showRangePills = chartMode === "strength" || chartMode === "measurements" || chartMode === "rpe" || chartMode === "heatmap";

  // ---------- Main UI ----------
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-blue-950 to-slate-950 text-white p-4">
      {/* === Upload Status Banner (Step 7) === */}
      {uploadStatus.type && (
        <div className={`fixed top-4 right-4 z-50 rounded-lg p-4 shadow-lg max-w-md ${
          uploadStatus.type === 'success' ? 'bg-green-600' :
          uploadStatus.type === 'error' ? 'bg-red-600' : 'bg-blue-600'
        }`}>
          <div className="flex items-center gap-3">
            {uploadStatus.type === 'success' && <CheckCircle2 className="w-5 h-5" />}
            {uploadStatus.type === 'error' && <AlertCircle className="w-5 h-5" />}
            <p className="text-white font-medium">{uploadStatus.message}</p>
            <button
              onClick={() => setUploadStatus({ type: null, message: '' })}
              className="text-white/80 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600 to-indigo-700 rounded-2xl p-6 mb-6 shadow-2xl">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-4">
              <Dumbbell className="w-10 h-10" />
              <div>
                <h1 className="text-3xl font-bold">Heavy Duty Tracker</h1>
                <p className="text-blue-100 text-sm">Mike Mentzer Method — Train Hard, Not Long</p>
                <p className="text-blue-100 text-xs mt-1">
                  Last updated: {lastSavedAt ? new Date(lastSavedAt).toLocaleString("en-GB") : "—"}
                </p>
                <p style={{ fontSize: 12, color: '#93c5fd', marginTop: 4 }}>
                  Latest workout: {latestWorkoutDate}
                  {latestWorkoutTs && (Date.now() - latestWorkoutTs < 24 * 60 * 60 * 1000) && (
                    <span style={{
                      marginLeft: 8, background: '#22c55e', color: '#fff',
                      padding: '2px 6px', borderRadius: 999, fontSize: 10
                    }}>
                      TODAY
                    </span>
                  )}
                </p>
              </div>
            </div>

            <div className="relative">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowMoreMenu((s) => !s);
                }}
                className="bg-white/20 hover:bg-white/30 px-4 py-2 rounded-lg transition-colors flex items-center gap-2"
              >
                <MoreVertical className="w-4 h-4" />
                More
              </button>

              {showMoreMenu && (
                  <div
                  className="z-50 bg-slate-900 border border-slate-700 rounded-lg shadow-xl overflow-hidden
                            fixed left-4 right-4 mt-2
                            max-w-[calc(100vw-1rem)]
                            sm:absolute sm:left-auto sm:right-0 sm:w-44"
                  >
                  <button
                    onClick={() => {
                      setShowUploadGuide((v) => !v);
                      setShowMoreMenu(false);
                    }}
                    className="w-full text-left px-4 py-2 text-sm hover:bg-slate-800"
                  >
                    {showUploadGuide ? "Hide" : "Show"} Upload Panel
                  </button>

                  <button
                    onClick={() => {
                      setShowOverridePanel((v) => !v);
                      setShowMoreMenu(false);
                    }}
                    className="w-full text-left px-4 py-2 text-sm hover:bg-slate-800"
                  >
                    Muscle Group Overrides
                  </button>

                  <button
                    onClick={() => {
                      downloadJSON();
                      setShowMoreMenu(false);
                    }}
                    className="w-full text-left px-4 py-2 text-sm hover:bg-slate-800"
                  >
                    Export JSON
                  </button>

                  <button
                    onClick={() => {
                      downloadWorkoutsCSV();
                      setShowMoreMenu(false);
                    }}
                    className="w-full text-left px-4 py-2 text-sm hover:bg-slate-800"
                  >
                    Export CSV
                  </button>

                  <button
                    onClick={() => {
                      confirmAndReset();
                      setShowMoreMenu(false);
                    }}
                    className="w-full text-left px-4 py-2 text-sm hover:bg-slate-800 text-red-300"
                  >
                    Reset All Data
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        <button
          onClick={() => {
            setDataVersion(v => v + 1);
            setUploadStatus({
              type: 'info',
              message: 'Dashboard refreshed'
            });
            setTimeout(() => setUploadStatus({ type: null, message: '' }), 2000);
          }}
          className="bg-white/20 hover:bg-white/30 px-4 py-2 rounded-lg transition-colors flex items-center gap-2"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>

        {/* Upload Panel */}
        {showUploadGuide && (
          <div className="bg-slate-900/90 border border-blue-500/30 rounded-xl p-6 mb-6 relative">
            <button onClick={() => setShowUploadGuide(false)} className="absolute top-4 right-4 text-slate-400 hover:text-white">
              <X className="w-5 h-5" />
            </button>

            <div
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
              className={`border-2 border-dashed rounded-xl p-6 text-center transition-colors ${
                isDragging ? "border-blue-400 bg-blue-900/20" : "border-slate-700 bg-slate-950/20"
              }`}
            >
              <p className="text-slate-200 font-medium">Drag & drop a CSV here, or click to choose</p>
              <p className="text-slate-400 text-sm mt-1">Works with Hevy workouts, Hevy measurements, and steps exports</p>

              <label className="inline-block mt-4 cursor-pointer">
                <span className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg text-white text-sm inline-block">Choose CSV</span>
                <input type="file" accept=".csv" onChange={handleSmartUpload} className="hidden" />
              </label>
            </div>

            <div className="mt-4 p-4 bg-blue-900/30 rounded-lg">
              <p className="text-sm text-blue-200">
                <strong>Heavy Duty Principles:</strong> One all-out set to failure per exercise. Track RPE (aim 9–10). Rest 2–3
                days between sessions. Use double progression — add reps first, then weight once you hit the top of the range.
              </p>
            </div>
          </div>
        )}

        {/* Override Panel */}
        {showOverridePanel && (
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <Target className="w-6 h-6 text-orange-400" />
                <h3 className="text-lg font-semibold">Editable Muscle Group Mapping (Overrides)</h3>
              </div>
              <button onClick={() => setShowOverridePanel(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-sm text-slate-400 mb-4">
              The tracker infers muscle groups using keyword rules. Add an override here to force an exercise into a specific
              muscle group. Overrides apply everywhere muscle grouping is used (including the Volume pie chart).
            </p>

            <div className="grid md:grid-cols-3 gap-3 mb-4">
              <div>
                <div className="text-xs text-slate-500 mb-1">Exercise</div>
                <select
                  value={overrideExercise}
                  onChange={(e) => setOverrideExercise(e.target.value)}
                  className="w-full bg-slate-800 text-white px-3 py-2 rounded-md text-sm border border-slate-700"
                >
                  <option value="">Select an exercise…</option>
                  {allExercises.map((ex) => (
                    <option key={ex} value={ex}>
                      {ex}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <div className="text-xs text-slate-500 mb-1">Muscle Group</div>
                <select
                  value={overrideMuscleGroup}
                  onChange={(e) => setOverrideMuscleGroup(e.target.value as MuscleGroup)}
                  className="w-full bg-slate-800 text-white px-3 py-2 rounded-md text-sm border border-slate-700"
                >
                  {MUSCLE_GROUPS.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-end">
                <button
                  onClick={saveOverride}
                  disabled={!overrideExercise}
                  className={`w-full px-4 py-2 rounded-md text-sm font-semibold transition-colors ${
                    overrideExercise ? "bg-blue-600 hover:bg-blue-700" : "bg-white/10 text-slate-500 cursor-not-allowed"
                  }`}
                >
                  Save Override
                </button>
              </div>
            </div>

            <div className="border-t border-slate-800 pt-4">
              <div className="text-sm font-semibold text-slate-200 mb-2">Saved overrides</div>
              {Object.keys(muscleGroupOverrides).length === 0 ? (
                <div className="text-sm text-slate-500">No overrides yet.</div>
              ) : (
                <div className="space-y-2">
                  {Object.entries(muscleGroupOverrides)
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([ex, grp]) => (
                      <div key={ex} className="flex items-center justify-between bg-slate-800/40 border border-slate-700 rounded-lg px-3 py-2">
                        <div className="text-sm">
                          <span className="text-slate-200 font-medium">{ex}</span>
                          <span className="text-slate-500"> → </span>
                          <span className="text-orange-300 font-semibold">{grp}</span>
                        </div>
                        <button
                          onClick={() => removeOverride(ex)}
                          className="text-xs px-2 py-1 rounded bg-red-600/20 border border-red-500/30 text-red-200 hover:bg-red-600/30"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Achievements */}
        {insights.achievements.length > 0 && (
          <div className="bg-gradient-to-r from-yellow-900/40 to-orange-900/40 border border-yellow-500/30 rounded-xl p-4 mb-6">
            <div className="flex items-center gap-3 mb-3">
              <Award className="w-6 h-6 text-yellow-400" />
              <h3 className="text-lg font-semibold">Achievements</h3>
            </div>
            <div className="flex flex-wrap gap-2">
              {insights.achievements.map((ach, i) => (
                <div key={i} className="bg-slate-900/60 px-3 py-2 rounded-lg flex items-center gap-2">
                  <span className="text-2xl">{ach.icon}</span>
                  <span className="text-sm font-medium">{ach.title}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Smart Insights */}
        {showInsights && insights.totalWorkouts > 0 && (
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <Zap className="w-6 h-6 text-yellow-400" />
                <h3 className="text-lg font-semibold">Smart Insights</h3>
              </div>
              <button onClick={() => setShowInsights(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid md:grid-cols-3 gap-4 mb-6">
              <div className="bg-slate-800/50 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Calendar className="w-5 h-5 text-blue-400" />
                  <span className="text-sm text-slate-400">Training Status</span>
                </div>
                <div className="text-2xl font-bold text-blue-400 mb-1">
                  {insights.daysSinceLastWorkout !== null ? `${insights.daysSinceLastWorkout}d` : "—"}
                </div>
                <div className="text-xs text-slate-400">
                  {insights.daysSinceLastWorkout !== null && insights.daysSinceLastWorkout > 4
                    ? "Time to train!"
                    : insights.daysSinceLastWorkout !== null && insights.daysSinceLastWorkout < 2
                    ? "Still recovering"
                    : "Recovery window"}
                </div>
              </div>

              <div className="bg-slate-800/50 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Flame className="w-5 h-5 text-orange-400" />
                  <span className="text-sm text-slate-400">Training Streak</span>
                </div>
                <div className="text-2xl font-bold text-orange-400 mb-1">{insights.trainingStreak} weeks</div>
                <div className="text-xs text-slate-400">{insights.workoutFrequency ? `Every ${insights.workoutFrequency} days` : "—"}</div>
              </div>

              <div className="bg-slate-800/50 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Battery className="w-5 h-5 text-green-400" />
                  <span className="text-sm text-slate-400">Avg RPE</span>
                </div>
                <div className="text-2xl font-bold text-green-400 mb-1">{insights.avgRPE ?? "—"}</div>
                <div className="text-xs text-slate-400">
                  {insights.avgRPE && insights.avgRPE >= 9 ? "Training to failure ✓" : insights.avgRPE && insights.avgRPE < 8 ? "Increase intensity" : "—"}
                </div>
              </div>
            </div>

            {/* ✅ spacing fix: add extra bottom margin so it isn't squished */}
            <div className="bg-slate-800/30 border border-slate-700 rounded-lg p-4 mb-8">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-yellow-400 mt-0.5 flex-shrink-0" />
                <div>
                  <div className="text-sm font-semibold text-slate-200">Rest day guidance</div>
                  <p className="text-xs text-slate-400 mt-1">
                    Heavy Duty works best when you’re fully recovered. If performance is down or your RPE is dropping, extend rest days (2–4+ days)
                    before repeating the same muscle group.
                  </p>
                </div>
              </div>
            </div>

            {insights.balanceIssue && (
              <div className="mt-0 bg-yellow-900/20 border border-yellow-500/30 rounded-lg p-3">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-yellow-400 mt-0.5" />
                  <div className="text-sm">
                    <span className="font-semibold text-yellow-400">Balance Warning:</span>
                    <span className="text-slate-300 ml-2">{insights.balanceIssue}</span>
                  </div>
                </div>
              </div>
            )}

            {insights.needsDeload && (
              <div className="mt-4 bg-red-900/20 border border-red-500/30 rounded-lg p-3">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-red-400 mt-0.5" />
                  <div className="text-sm">
                    <span className="font-semibold text-red-400">Deload Recommended:</span>
                    <span className="text-slate-300 ml-2">High frequency + dropping RPE detected — consider a deload week.</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Top cards */}
        <div className="grid md:grid-cols-3 gap-4 mb-6">
          {/* Key Lifts */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <TrendingUp className="w-6 h-6 text-green-400" />
              <h3 className="text-lg font-semibold">Key Lifts</h3>
            </div>

            <div className="space-y-3">
              {Object.entries(progress).map(([key, data]) => {
                const est1 = data.weight > 0 ? epley1RM(data.weight, data.reps).toFixed(1) : "";
                const label = key.replace(/([A-Z])/g, " $1").trim();
                return (
                  <div key={key} className="space-y-1">
                    <div className="flex justify-between items-center">
                      <span className="text-slate-400 text-sm capitalize">{label}</span>
                      <span className="text-blue-400 font-semibold">{data.weight > 0 ? `${data.weight}kg × ${data.reps}` : "—"}</span>
                    </div>
                    {est1 && <div className="text-xs text-purple-400">Est 1RM: {est1}kg</div>}
                  </div>
                );
              })}
            </div>

            {insights.bodyweightRatios && latestWeight > 0 && (
              <div className="mt-4 pt-4 border-t border-slate-700">
                <h4 className="text-sm font-semibold text-slate-400 mb-2">Bodyweight Ratios</h4>
                <div className="space-y-1 text-xs">
                  {insights.bodyweightRatios.squatRatio > 0 && (
                    <div className="flex justify-between">
                      <span className="text-slate-400">Squat</span>
                      <span className={insights.bodyweightRatios.squatRatio >= 1.5 ? "text-green-400" : "text-slate-300"}>
                        {insights.bodyweightRatios.squatRatio.toFixed(2)}x BW
                      </span>
                    </div>
                  )}
                  {insights.bodyweightRatios.deadliftRatio > 0 && (
                    <div className="flex justify-between">
                      <span className="text-slate-400">Deadlift</span>
                      <span className={insights.bodyweightRatios.deadliftRatio >= 2.0 ? "text-green-400" : "text-slate-300"}>
                        {insights.bodyweightRatios.deadliftRatio.toFixed(2)}x BW
                      </span>
                    </div>
                  )}
                  {insights.bodyweightRatios.benchRatio > 0 && (
                    <div className="flex justify-between">
                      <span className="text-slate-400">Incline Bench</span>
                      <span className={insights.bodyweightRatios.benchRatio >= 1.0 ? "text-green-400" : "text-slate-300"}>
                        {insights.bodyweightRatios.benchRatio.toFixed(2)}x BW
                      </span>
                    </div>
                  )}
                </div>
                <p className="text-[11px] text-slate-500 mt-2">Standards: Squat ≥1.5×BW, Deadlift ≥2.0×BW, Incline Bench ≥1.0×BW</p>
              </div>
            )}
          </div>

          {/* Measurements */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <Target className="w-6 h-6 text-orange-400" />
              <h3 className="text-lg font-semibold">Measurements</h3>
            </div>

            <div className="space-y-3">
              {[
                { key: "chest", label: "Chest", unit: "in", value: measurements.chest },
                { key: "arms", label: "Arms", unit: "in", value: measurements.arms },
                { key: "waist", label: "Waist", unit: "in", value: measurements.waist },
                { key: "legs", label: "Legs", unit: "in", value: measurements.legs },
                { key: "calves", label: "Calves", unit: "in", value: measurements.calves },
                { key: "neck", label: "Neck", unit: "in", value: measurements.neck },
                { key: "forearms", label: "Forearms", unit: "in", value: measurements.forearms },
                // ✅ BMI from latest valid weight even if fat% missing
                { key: "bmi", label: "BMI", unit: "", value: latestBmi },
                // ✅ Fat% from latest valid fat% even if weight recorded separately
                { key: "fatPercent", label: "Body Fat", unit: "%", value: latestFatPercent },
              ].map((item) => (
                <button
                  key={item.key}
                  onClick={() => {
                    setChartMode("measurements");
                    setSelectedMeasureKey(item.key as MeasureKey);
                  }}
                  className={`w-full flex justify-between items-center text-left px-2 py-1 rounded transition-colors ${
                    selectedMeasureKey === item.key ? "bg-blue-600/20 border border-blue-500/30" : "hover:bg-slate-800/40"
                  }`}
                >
                  <span className="text-slate-400 text-sm">{item.label}</span>
                  <span className="text-orange-400 font-semibold">
                    {item.value !== null && item.value !== undefined && item.value !== 0 ? `${item.value}${item.unit}` : "—"}
                  </span>
                </button>
              ))}
            </div>

            {leanMass > 0 && latestFatPercent > 0 && (
              <div className="mt-4 pt-4 border-t border-slate-800 text-xs text-slate-400">
                Lean mass: <span className="text-green-300 font-semibold">{leanMass}kg</span> • Fat mass:{" "}
                <span className="text-orange-300 font-semibold">{fatMass}kg</span>
              </div>
            )}
          </div>

          {/* Weekly Stats */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <Activity className="w-6 h-6 text-purple-400" />
              <h3 className="text-lg font-semibold">Weekly Stats</h3>
            </div>

            <div className="space-y-4">
              <div>
                <div className="text-slate-400 text-sm mb-1">Avg Daily Steps</div>
                <div className="text-2xl font-bold text-purple-400">{weeklySteps > 0 ? weeklySteps.toLocaleString() : "—"}</div>
              </div>

              <div className="pt-4 border-t border-slate-800">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-yellow-400 mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-slate-400">
                    Recovery is growth. Don’t train until fully recovered — the goal is maximum intensity with minimum volume.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Progress Charts */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-6 mb-6">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
            <h3 className="text-lg font-semibold">Progress Charts</h3>

            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex gap-2 flex-wrap">
                {(
                  [
                    { key: "strength", label: "Strength" },
                    { key: "measurements", label: "Measurements" },
                    { key: "volume", label: "Volume" },
                    { key: "rpe", label: "RPE" },
                    { key: "heatmap", label: "Heatmap" },
                    { key: "compare", label: "Compare" },
                  ] as const
                ).map((b) => (
                  <button
                    key={b.key}
                    onClick={() => setChartMode(b.key)}
                    className={`px-3 py-1 rounded-md text-sm transition-colors ${
                      chartMode === b.key ? "bg-blue-600 text-white" : "bg-white/10 text-slate-200 hover:bg-white/20"
                    }`}
                  >
                    {b.label}
                  </button>
                ))}
              </div>

              {/* ✅ time range pills only for Strength, Measurements, RPE, Heatmap; hidden for Volume & Compare */}
              {showRangePills && (
                <div className="flex flex-wrap gap-1">
                  {availableRanges.map((r) => (
                    <button
                      key={r}
                      onClick={() => setTimeRange(r)}
                      className={`px-2 py-1 rounded-md text-xs transition-colors ${
                        timeRange === r ? "bg-blue-600 text-white" : "bg-white/10 text-slate-200 hover:bg-white/20"
                      }`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Charts content */}
          {chartMode === "strength" && (
            <div>
              <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
                <h3 className="text-lg font-semibold">Strength Progress</h3>
                <div className="flex gap-2 flex-wrap">
                  <button
                    onClick={() => setStrengthView("overall")}
                    className={`px-3 py-1 rounded-md text-sm transition-colors ${
                      strengthView === "overall" ? "bg-blue-600 text-white" : "bg-white/10 text-slate-200 hover:bg-white/20"
                    }`}
                  >
                    <span className="hidden sm:inline">Overall Compounds</span>
                    <span className="sm:hidden">Overall</span>
                  </button>
                  <button
                    onClick={() => setStrengthView("category")}
                    className={`px-3 py-1 rounded-md text-sm transition-colors ${
                      strengthView === "category" ? "bg-blue-600 text-white" : "bg-white/10 text-slate-200 hover:bg-white/20"
                    }`}
                  >
                    <span className="hidden sm:inline">{activeTab.charAt(0).toUpperCase() + activeTab.slice(1)} Average</span>
                    <span className="sm:hidden">{activeTab} avg</span>
                  </button>
                  <button
                    onClick={() => setStrengthView("exercise")}
                    className={`px-3 py-1 rounded-md text-sm transition-colors ${
                      strengthView === "exercise" ? "bg-blue-600 text-white" : "bg-white/10 text-slate-200 hover:bg-white/20"
                    }`}
                  >
                    Exercise
                  </button>
                </div>
              </div>

              {strengthView === "overall" && (() => {
                const plotData = filterByRange(strengthOverall.data);
                return (
                  <div>
                    {/* ✅ rename + clarify */}
                    <p className="text-xs text-slate-400 mb-2">
                      <span className="text-slate-300 font-semibold">Data points:</span>{" "}
                      Incline {strengthOverall.counts.Incline} • Squat {strengthOverall.counts.Squat} • Shoulder{" "}
                      {strengthOverall.counts.Shoulder} • Pulldown {strengthOverall.counts.Pulldown} • Deadlift{" "}
                      {strengthOverall.counts.Deadlift}
                      <span className="text-slate-500"> (count of entries per compound lift)</span>
                    </p>

                    {plotData.length === 0 ? (
                      <div className="h-72 flex items-center justify-center text-slate-500">No data in selected range</div>
                    ) : (
                      <div className="h-72">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={plotData}>
                            <CartesianGrid stroke="#334155" strokeDasharray="3 3" opacity={0.35} />
                            <XAxis
                              dataKey="ts"
                              type="number"
                              scale="time"
                              domain={["auto", "auto"]}
                              tickFormatter={(t) => formatTick(t, timeRange)}
                              tick={{ fill: "#94a3b8", fontSize: 12 }}
                              minTickGap={24}
                              interval="preserveStartEnd"
                            />
                            <YAxis
                              tick={{ fill: "#94a3b8", fontSize: 12 }}
                              label={{ value: "Est. 1RM (kg)", angle: -90, position: "insideLeft", fill: "#94a3b8" }}
                            />
                            <Tooltip
                              labelFormatter={(t) => new Date(Number(t)).toLocaleDateString("en-GB")}
                              contentStyle={{ backgroundColor: "#1e293b", border: "1px solid #334155" }}
                            />
                            <Legend />
                            {strengthOverall.lifts.map((l) => (
                              <Line
                                key={l.outKey}
                                type="monotone"
                                dataKey={l.outKey}
                                name={l.name}
                                stroke={l.color}
                                strokeWidth={2}
                                dot={false}
                                connectNulls
                              />
                            ))}
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                  </div>
                );
              })()}

              {strengthView === "category" && (() => {
                const plotData = filterByRange(categoryAverageSeries);
                return plotData.length === 0 ? (
                  <div className="h-72 flex items-center justify-center text-slate-500">No data in selected range</div>
                ) : (
                  <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={plotData}>
                        <CartesianGrid stroke="#334155" strokeDasharray="3 3" opacity={0.35} />
                        <XAxis
                          dataKey="ts"
                          type="number"
                          scale="time"
                          domain={["auto", "auto"]}
                          tickFormatter={(t) => formatTick(t, timeRange)}
                          tick={{ fill: "#94a3b8", fontSize: 12 }}
                        />
                        <YAxis
                          tick={{ fill: "#94a3b8", fontSize: 12 }}
                          label={{ value: "Avg Est. 1RM (kg)", angle: -90, position: "insideLeft", fill: "#94a3b8" }}
                        />
                        <Tooltip
                          labelFormatter={(t) => new Date(Number(t)).toLocaleDateString("en-GB")}
                          contentStyle={{ backgroundColor: "#1e293b", border: "1px solid #334155" }}
                        />
                        <Line type="monotone" dataKey="avg" stroke="#60a5fa" strokeWidth={2} dot={false} name={`${activeTab} average`} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                );
              })()}

              {strengthView === "exercise" && (
                <div>
                  <div className="flex items-center gap-3 mb-3 flex-wrap">
                    <span className="text-slate-300 text-sm">Exercise:</span>
                    <select
                      value={selectedExercise}
                      onChange={(e) => setSelectedExercise(e.target.value)}
                      className="bg-slate-800 text-white px-3 py-1 rounded-md text-sm border border-slate-700"
                    >
                      {allExercises.map((ex) => (
                        <option key={ex} value={ex}>
                          {ex}
                        </option>
                      ))}
                    </select>
                  </div>

                  {(() => {
                    const plotData = filterByRange(exerciseSeries);
                    return plotData.length === 0 ? (
                      <div className="h-72 flex items-center justify-center text-slate-500">No data in selected range</div>
                    ) : (
                      <div className="h-72">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={plotData}>
                            <CartesianGrid stroke="#334155" strokeDasharray="3 3" opacity={0.35} />
                            <XAxis
                              dataKey="ts"
                              type="number"
                              scale="time"
                              domain={["auto", "auto"]}
                              tickFormatter={(t) => formatTick(t, timeRange)}
                              tick={{ fill: "#94a3b8", fontSize: 12 }}
                            />
                            <YAxis
                              tick={{ fill: "#94a3b8", fontSize: 12 }}
                              label={{ value: "Est. 1RM (kg)", angle: -90, position: "insideLeft", fill: "#94a3b8" }}
                            />
                            <Tooltip
                              labelFormatter={(t) => new Date(Number(t)).toLocaleDateString("en-GB")}
                              contentStyle={{ backgroundColor: "#1e293b", border: "1px solid #334155" }}
                            />
                            <Line type="monotone" dataKey="val" stroke="#a78bfa" strokeWidth={2} dot={false} name={selectedExercise} />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
          )}

          {chartMode === "measurements" &&
            (() => {
              const plotData = filterByRange(measurementsChartData);
              if (!plotData.length) {
                return (
                  <div className="h-72 flex items-center justify-center text-slate-500">
                    No measurement data. Upload a measurements CSV.
                  </div>
                );
              }

              const rightLabel =
                selectedMeasureKey === "bmi" ? "BMI" : selectedMeasureKey === "fatPercent" ? "Body Fat %" : "Inches";

              return (
                <div>
                  <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={plotData}>
                        <CartesianGrid stroke="#334155" strokeDasharray="3 3" opacity={0.35} />
                        <XAxis
                          dataKey="ts"
                          type="number"
                          scale="time"
                          domain={["auto", "auto"]}
                          tickFormatter={(t) => formatTick(t, timeRange)}
                          tick={{ fill: "#94a3b8", fontSize: 12 }}
                        />
                        <YAxis
                          yAxisId="left"
                          tick={{ fill: "#94a3b8", fontSize: 12 }}
                          label={{ value: "Weight (kg)", angle: -90, position: "insideLeft", fill: "#94a3b8" }}
                        />
                        <YAxis
                          yAxisId="right"
                          orientation="right"
                          tick={{ fill: "#94a3b8", fontSize: 12 }}
                          label={{ value: rightLabel, angle: -90, position: "insideRight", fill: "#94a3b8" }}
                        />
                        <Tooltip
                          labelFormatter={(t) => new Date(Number(t)).toLocaleDateString("en-GB")}
                          contentStyle={{ backgroundColor: "#1e293b", border: "1px solid #334155" }}
                        />
                        <Legend />
                        <Line yAxisId="left" type="monotone" dataKey="weightKg" stroke="#a78bfa" strokeWidth={2} dot={false} name="Weight (kg)" />
                        <Line
                          yAxisId="right"
                          type="monotone"
                          dataKey={selectedMeasureKey}
                          stroke="#60a5fa"
                          strokeWidth={2}
                          dot={false}
                          name={selectedMeasureKey}
                          connectNulls
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <p className="text-xs text-slate-400 mt-3 text-center">Weight (kg) + {String(selectedMeasureKey)}</p>
                </div>
              );
            })()}

          {chartMode === "volume" && (
            <div>
              <div className="flex items-center justify-between mb-3 flex-wrap gap-3">
                <h3 className="text-lg font-semibold">Training Volume</h3>
              </div>

              {/* Summary cards */}
              <div className="grid md:grid-cols-3 gap-3 mb-4">
                <StatCard
                  title="Last 4 weeks volume"
                  value={volumeSummary.last4Vol ? volumeSummary.last4Vol.toLocaleString() : "—"}
                  sub="Tonnage = sets × reps × weight (kg-reps)"
                  tone="blue"
                />
                <StatCard
                  title="Avg weekly RPE"
                  value={volumeSummary.avgWeeklyRPE ? volumeSummary.avgWeeklyRPE : "—"}
                  sub="rolling 4 weeks"
                  tone="purple"
                />
                <StatCard
                  title="Volume change"
                  value={
                    volumeDropWarning
                      ? volumeDropWarning.type === "drop"
                        ? `↓ ${Math.abs(volumeDropWarning.pct)}%`
                        : `↑ ${volumeDropWarning.pct}%`
                      : "—"
                  }
                  sub="last 4 weeks vs previous 4"
                  tone={volumeDropWarning?.type === "drop" ? "orange" : "green"}
                />
              </div>

              {/* Explanation */}
              <div className="bg-slate-800/30 border border-slate-700 rounded-lg p-4 mb-4">
                <p className="text-sm text-slate-300">
                  <span className="font-semibold text-slate-200">Volume / tonnage</span> is calculated as{" "}
                  <span className="font-semibold text-blue-300">sets × reps × weight</span> (shown as “kg-reps”). This helps you track how much total work
                  you’re doing over time — useful for detecting overreach or under-training.
                </p>
              </div>

              {/* Pie: Volume by muscle group (percent primary) */}
              <div className="bg-slate-800/30 rounded-lg p-4">
                <h4 className="text-sm font-semibold text-slate-300 mb-2">Volume by muscle group</h4>
                <p className="text-xs text-slate-500 mb-3">
                  Each slice shows the <span className="text-slate-300 font-semibold">% share of total tonnage</span>. Tooltip includes both percent and approximate raw tonnage.
                </p>

                {muscleGroupPieData.length === 0 ? (
                  <p className="text-sm text-slate-500">Not enough data yet.</p>
                ) : (
                  <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={muscleGroupPieData}
                          cx="50%"
                          cy="50%"
                          innerRadius={55}
                          outerRadius={95}
                          dataKey="pct"
                          nameKey="name"
                          label={(e: any) => `${e.name} ${e.pct}%`}
                        >
                          {muscleGroupPieData.map((entry, i) => (
                            <Cell key={`cell-mg-${i}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip
                          formatter={(_value: any, _name: any, props: any) => {
                            const raw = props?.payload?.value ?? 0;
                            const pct = props?.payload?.pct ?? 0;
                            return [`${pct}% (≈ ${Math.round(raw).toLocaleString()} kg-reps)`, "Share"];
                          }}
                          contentStyle={{ backgroundColor: "#7f99c2ff", border: "1px solid #334155" }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ✅ RPE tab: working UI */}
          {chartMode === "rpe" && (() => {
            const plotData = filterByRange(rpeDailySeries);
            if (!plotData.length) {
              return <div className="h-72 flex items-center justify-center text-slate-500">No RPE data in selected range.</div>;
            }
            return (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-lg font-semibold">RPE & Failure Rate</h3>
                  <div className="text-xs text-slate-500">Failure% = sets with RPE ≥ 9</div>
                </div>

                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={plotData}>
                      <CartesianGrid stroke="#334155" strokeDasharray="3 3" opacity={0.35} />
                      <XAxis
                        dataKey="ts"
                        type="number"
                        scale="time"
                        domain={["auto", "auto"]}
                        tickFormatter={(t) => formatTick(t, timeRange)}
                        tick={{ fill: "#94a3b8", fontSize: 12 }}
                      />
                      <YAxis
                        yAxisId="left"
                        tick={{ fill: "#94a3b8", fontSize: 12 }}
                        domain={[6, 10]}
                        label={{ value: "Avg RPE", angle: -90, position: "insideLeft", fill: "#94a3b8" }}
                      />
                      <YAxis
                        yAxisId="right"
                        orientation="right"
                        tick={{ fill: "#94a3b8", fontSize: 12 }}
                        domain={[0, 100]}
                        label={{ value: "Failure %", angle: -90, position: "insideRight", fill: "#94a3b8" }}
                      />
                      <Tooltip
                        labelFormatter={(t) => new Date(Number(t)).toLocaleDateString("en-GB")}
                        formatter={(v: any, name: any) => (name === "Failure %" ? [`${v}%`, name] : [v, name])}
                        contentStyle={{ backgroundColor: "#1e293b", border: "1px solid #334155" }}
                      />
                      <Legend />
                      <Line yAxisId="left" type="monotone" dataKey="avgRpe" stroke="#a78bfa" strokeWidth={2} dot={false} name="Avg RPE" />
                      <Line yAxisId="right" type="monotone" dataKey="failurePct" stroke="#fb7185" strokeWidth={2} dot={false} name="Failure %" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            );
          })()}

          {/* ✅ Heatmap tab: working UI */}
          {chartMode === "heatmap" && (
            <div>
              <div className="flex items-center justify-between mb-3 flex-wrap gap-3">
                <h3 className="text-lg font-semibold">Training Heatmap</h3>
                <div className="text-xs text-slate-500">Darker = more entries on that day</div>
              </div>

              {heatmapWeeks.weeks.length === 0 ? (
                <div className="h-48 flex items-center justify-center text-slate-500">No workout data yet.</div>
              ) : (
                <div className="bg-slate-800/20 border border-slate-700 rounded-lg p-4 overflow-x-auto">
                  <div className="min-w-[720px]">
                    <div className="flex gap-1">
                      {heatmapWeeks.weeks.map((w) => (
                        <div key={w.weekTs} className="flex flex-col gap-1">
                          {w.days.map((d) => {
                            const bg =
                              d.level === 0
                                ? "bg-slate-900/40"
                                : d.level === 1
                                ? "bg-emerald-900/40"
                                : d.level === 2
                                ? "bg-emerald-700/50"
                                : d.level === 3
                                ? "bg-emerald-500/60"
                                : "bg-emerald-400/80";
                            return (
                              <div
                                key={d.ts}
                                title={`${new Date(d.ts).toLocaleDateString("en-GB")} — ${d.count} entries`}
                                className={`w-3.5 h-3.5 rounded ${bg} border border-slate-800`}
                              />
                            );
                          })}
                        </div>
                      ))}
                    </div>

                    <div className="flex items-center gap-2 mt-4 text-xs text-slate-500">
                      <span>Less</span>
                      <div className="w-3.5 h-3.5 rounded bg-slate-900/40 border border-slate-800" />
                      <div className="w-3.5 h-3.5 rounded bg-emerald-900/40 border border-slate-800" />
                      <div className="w-3.5 h-3.5 rounded bg-emerald-700/50 border border-slate-800" />
                      <div className="w-3.5 h-3.5 rounded bg-emerald-500/60 border border-slate-800" />
                      <div className="w-3.5 h-3.5 rounded bg-emerald-400/80 border border-slate-800" />
                      <span>More</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ✅ Compare tab: working UI */}
          {chartMode === "compare" && (
            <div>
              <div className="flex items-center justify-between mb-3 flex-wrap gap-3">
                <h3 className="text-lg font-semibold">Compare Date Ranges</h3>
                <div className="text-xs text-slate-500">Sessions, tonnage, avg RPE, failure%</div>
              </div>

              <div className="grid md:grid-cols-2 gap-4 mb-4">
                <div className="bg-slate-800/30 border border-slate-700 rounded-lg p-4">
                  <div className="text-sm font-semibold text-slate-200 mb-2">Range A</div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <div className="text-xs text-slate-500 mb-1">Start</div>
                      <input
                        type="date"
                        value={compareAStart}
                        onChange={(e) => setCompareAStart(e.target.value)}
                        className="w-full bg-slate-900/60 border border-slate-700 rounded-md px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <div className="text-xs text-slate-500 mb-1">End</div>
                      <input
                        type="date"
                        value={compareAEnd}
                        onChange={(e) => setCompareAEnd(e.target.value)}
                        className="w-full bg-slate-900/60 border border-slate-700 rounded-md px-3 py-2 text-sm"
                      />
                    </div>
                  </div>
                </div>

                <div className="bg-slate-800/30 border border-slate-700 rounded-lg p-4">
                  <div className="text-sm font-semibold text-slate-200 mb-2">Range B</div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <div className="text-xs text-slate-500 mb-1">Start</div>
                      <input
                        type="date"
                        value={compareBStart}
                        onChange={(e) => setCompareBStart(e.target.value)}
                        className="w-full bg-slate-900/60 border border-slate-700 rounded-md px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <div className="text-xs text-slate-500 mb-1">End</div>
                      <input
                        type="date"
                        value={compareBEnd}
                        onChange={(e) => setCompareBEnd(e.target.value)}
                        className="w-full bg-slate-900/60 border border-slate-700 rounded-md px-3 py-2 text-sm"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {(compareData.a.entries === 0 && compareData.b.entries === 0) ? (
                <div className="bg-slate-800/20 border border-slate-700 rounded-lg p-6 text-slate-400 text-sm">
                  No workouts found in either range. Try widening the date ranges or upload more workout data.
                </div>
              ) : (
                <div className="grid md:grid-cols-2 gap-4">
                  <div className="bg-slate-800/30 border border-slate-700 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="text-sm font-semibold text-slate-200">Range A summary</div>
                      <div className="text-xs text-slate-500">{compareData.a.entries} entries</div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <StatCard title="Sessions" value={compareData.a.sessions || "—"} tone="slate" />
                      <StatCard title="Total tonnage" value={compareData.a.tonnage ? Math.round(compareData.a.tonnage).toLocaleString() : "—"} sub="kg-reps" tone="blue" />
                      <StatCard title="Avg RPE" value={compareData.a.avgRPE || "—"} tone="purple" />
                      <StatCard title="Failure%" value={compareData.a.failurePct ? `${compareData.a.failurePct}%` : "—"} tone="orange" />
                    </div>
                  </div>

                  <div className="bg-slate-800/30 border border-slate-700 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="text-sm font-semibold text-slate-200">Range B summary</div>
                      <div className="text-xs text-slate-500">{compareData.b.entries} entries</div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <StatCard title="Sessions" value={compareData.b.sessions || "—"} tone="slate" />
                      <StatCard title="Total tonnage" value={compareData.b.tonnage ? Math.round(compareData.b.tonnage).toLocaleString() : "—"} sub="kg-reps" tone="blue" />
                      <StatCard title="Avg RPE" value={compareData.b.avgRPE || "—"} tone="purple" />
                      <StatCard title="Failure%" value={compareData.b.failurePct ? `${compareData.b.failurePct}%` : "—"} tone="orange" />
                    </div>

                    <div className="mt-4 pt-4 border-t border-slate-700 text-xs text-slate-400">
                      <div className="flex justify-between">
                        <span>Δ Sessions</span>
                        <span className="text-slate-200 font-semibold">{compareData.b.sessions - compareData.a.sessions}</span>
                      </div>
                      <div className="flex justify-between mt-1">
                        <span>Δ Tonnage</span>
                        <span className="text-slate-200 font-semibold">{Math.round(compareData.b.tonnage - compareData.a.tonnage).toLocaleString()} kg-reps</span>
                      </div>
                      <div className="flex justify-between mt-1">
                        <span>Δ Avg RPE</span>
                        <span className="text-slate-200 font-semibold">{+(compareData.b.avgRPE - compareData.a.avgRPE).toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between mt-1">
                        <span>Δ Failure%</span>
                        <span className="text-slate-200 font-semibold">{compareData.b.failurePct - compareData.a.failurePct}%</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Workout Table */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl overflow-hidden">
          <div className="flex border-b border-slate-800 overflow-x-auto">
            {(["push", "pull", "legs", "conditioning"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => {
                  setActiveTab(tab);
                  setChartMode("strength");
                  setStrengthView("category");
                }}
                className={`flex-1 py-4 px-6 font-medium transition-colors ${
                  activeTab === tab ? "bg-blue-600 text-white" : "text-slate-400 hover:text-white hover:bg-slate-800/50"
                }`}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>

          <div className="p-6">
            {activeTab === "conditioning" ? (
              <div className="text-center py-12 text-slate-500">
                <Activity className="w-16 h-16 mx-auto mb-4 opacity-50" />
                <p>Conditioning view</p>
                <p className="text-sm mt-2">Upload workouts with conditioning exercises, plus steps for weekly stats.</p>
              </div>
            ) : (
              renderWorkoutTable(activeTab)
            )}
          </div>
        </div>

        {/* Principles Footer */}
        <div className="mt-6 bg-gradient-to-r from-slate-900 to-blue-900/50 border border-blue-500/20 rounded-xl p-6">
          <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-blue-400" />
            Heavy Duty Training Principles
          </h3>
          <div className="grid md:grid-cols-2 gap-4 text-sm text-slate-300">
            <div>
              <strong className="text-blue-400">Intensity:</strong> Every set to positive failure (RPE 9–10)
            </div>
            <div>
              <strong className="text-blue-400">Frequency:</strong> 2–4 sessions per week, never consecutive days
            </div>
            <div>
              <strong className="text-blue-400">Volume:</strong> 1–2 working sets per exercise maximum
            </div>
            <div>
              <strong className="text-blue-400">Progression:</strong> Add reps first, then weight (double progression)
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
