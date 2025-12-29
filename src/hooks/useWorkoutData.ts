import { useState, useEffect, useCallback } from 'react';
import { fitnessAPI, WorkoutsResponse } from '../api/fitnessApi';

interface UseWorkoutDataOptions {
  days?: number;
  autoRefresh?: boolean;
  refreshInterval?: number; // in milliseconds
}

interface UseWorkoutDataReturn {
  data: WorkoutsResponse | null;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
  lastUpdated: Date | null;
}

export function useWorkoutData(options: UseWorkoutDataOptions = {}): UseWorkoutDataReturn {
  const {
    days = 90,
    autoRefresh = true,
    refreshInterval = 2 * 60 * 1000, // 2 minutes (reduced from 15 for fresher data)
  } = options;

  const [data, setData] = useState<WorkoutsResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchData = useCallback(async (forceRefresh = true) => {
    try {
      setLoading(true);
      setError(null);
      // Always force refresh to bypass backend cache and get latest Hevy data
      const workouts = await fitnessAPI.getWorkouts(days, forceRefresh);
      setData(workouts);
      setLastUpdated(new Date());
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch workout data'));
      console.error('Error fetching workout data:', err);
    } finally {
      setLoading(false);
    }
  }, [days]);

  const refresh = useCallback(async () => {
    await fetchData(true);
  }, [fetchData]);

  // Initial load - always force refresh
  useEffect(() => {
    fetchData(true);
  }, [fetchData]);

  // Auto-refresh interval - always force refresh
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      fetchData(true);
    }, refreshInterval);

    return () => clearInterval(interval);
  }, [autoRefresh, refreshInterval, fetchData]);

  return {
    data,
    loading,
    error,
    refresh,
    lastUpdated,
  };
}
