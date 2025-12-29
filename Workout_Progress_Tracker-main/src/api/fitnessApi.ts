// API client for fitness dashboard backend

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://100.80.30.43:808';

export interface Exercise {
  exercise: string;
  reps: number | null;
  weight_kg: number | null;
  rpe: number | null;
  distance_meters: number | null;
  duration_seconds: number | null;
  to_failure: boolean;
  rest_seconds: number | null;
  volume: number;  // Added: weight_kg * reps
}

export interface Workout {
  date: string;
  title: string;
  duration_seconds: number | null;
  exercises: Exercise[];
  // Enhanced Apple Health data
  avg_heart_rate: number | null;
  max_heart_rate: number | null;
  min_heart_rate: number | null;
  calories: number | null;
  distance_meters: number | null;
  // Calculated metrics
  total_volume: number;
  failure_sets: number;
  effort_score: number;
  apple_match_quality: 'exact' | 'close' | 'approximate' | 'none';
}

export interface ExerciseTrend {
  // Current stats
  latest_weight: number;
  latest_reps: number;
  latest_volume: number;
  // PRs
  pr_weight: number;
  pr_weight_date: string;
  pr_volume: number;
  pr_volume_date: string;
  estimated_1rm: number;
  estimated_1rm_date: string | null;
  // Progress
  weight_trend_30d_pct: number;
  total_weight_gain_pct: number;
  // Activity
  total_sessions: number;
  frequency_per_week: number;
  days_since_last: number;
  // Intensity
  avg_rpe: number | null;
  failure_rate: number;
}

export interface ForecastWorkout {
  date: string;
  predicted_volume: number;
  confidence: 'high' | 'medium' | 'low';
}

export interface Forecast {
  next_workouts: ForecastWorkout[];
  trend: 'increasing' | 'decreasing' | 'stable';
  trend_slope_kg_per_workout: number;
  workouts_per_week: number;
  recent_avg_volume: number;
  performance_vs_average: number;
  predicted_30d_volume: number;
  expected_workouts_30d: number;
}

export interface MuscleGroupStats {
  volume_kg: number;
  volume_pct: number;
  sets: number;
}

export interface SmartSummary {
  last_7_days: {
    workouts: number;
    total_volume_kg: number;
    avg_effort: number;
    calories_burned: number;
  };
  last_30_days: {
    workouts: number;
    total_volume_kg: number;
    avg_volume_per_workout: number;
    avg_effort: number;
    avg_heart_rate: number | null;
    calories_burned: number;
    failure_sets: number;
    failure_rate_pct: number;
  };
  overall: {
    total_workouts: number;
    total_exercises_logged: number;
    unique_exercises: number;
    consistency_score: number;
  };
  top_exercises_30d: Array<{
    exercise: string;
    times_performed: number;
  }>;
  recent_prs: Array<{
    exercise: string;
    type: string;
    value: number;
    date: string;
  }>;
  muscle_distribution: Record<string, MuscleGroupStats>;  // NEW: Calves merged with legs
  apple_health_totals: {
    total_steps: number;
    total_distance_km: number;
    total_calories: number;
  };
}

export interface WorkoutsResponse {
  workouts: Workout[];
  trends: Record<string, ExerciseTrend>;
  forecast: Forecast;
  smart_summary: SmartSummary;
  // Legacy summary (for backwards compatibility)
  summary: {
    total_workouts: number;
    total_exercises: number;
    date_range: {
      start: string | null;
      end: string | null;
    };
  };
  meta: {
    fetched_at: string;
    data_source: string;
    cache_ttl_minutes: number;
    days_requested: number;
  };
}

export interface DailySteps {
  date: string;
  steps: number;
}

export interface StepsResponse {
  daily_steps: DailySteps[];
}

export interface HealthCheck {
  status: string;
  timestamp: string;
  hevy_configured: boolean;
  apple_health_available: boolean;
}

class FitnessAPI {
  private baseURL: string;

  constructor(baseURL: string = API_BASE_URL) {
    this.baseURL = baseURL;
  }

  private async request<T>(endpoint: string, options?: RequestInit): Promise<T> {
    try {
      const response = await fetch(`${this.baseURL}${endpoint}`, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...options?.headers,
        },
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error(`API request failed: ${endpoint}`, error);
      throw error;
    }
  }

  async healthCheck(): Promise<HealthCheck> {
    return this.request<HealthCheck>('/api/health');
  }

  async getWorkouts(days: number = 90, refresh: boolean = false): Promise<WorkoutsResponse> {
    const params = new URLSearchParams({
      days: days.toString(),
      ...(refresh && { refresh: '1' }),
    });
    return this.request<WorkoutsResponse>(`/api/workouts?${params}`);
  }

  async getSteps(): Promise<StepsResponse> {
    return this.request<StepsResponse>('/api/steps');
  }

  async uploadAppleHealth(file: File): Promise<{ status: string; message: string }> {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch(`${this.baseURL}/api/upload/apple-health`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Upload failed: ${response.statusText}`);
    }

    return await response.json();
  }
}

export const fitnessAPI = new FitnessAPI();
