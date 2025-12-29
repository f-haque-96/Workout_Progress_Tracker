from flask import Flask, jsonify, request
from flask_cors import CORS
import os
import json
import csv
from datetime import datetime, timedelta
import requests
from pathlib import Path
import xml.etree.ElementTree as ET
from collections import defaultdict
import statistics
from io import StringIO

app = Flask(__name__)
CORS(app)

# Configuration
DATA_DIR = Path("data")
DATA_DIR.mkdir(exist_ok=True)
CACHE_FILE = DATA_DIR / "cache.json"
APPLE_HEALTH_FILE = DATA_DIR / "apple_health_export.xml"

# Hevy API Configuration
HEVY_API_KEY = os.environ.get("HEVY_API_KEY", "")
HEVY_API_BASE = "https://api.hevyapp.com/v1"

# Cache settings - reduced to 1 minute for fresher data
CACHE_DURATION_MINUTES = 1

# Muscle group classification - calves merged with legs
MUSCLE_GROUP_MAPPING = {
    # Legs (including calves)
    "squat": "legs",
    "leg press": "legs",
    "lunge": "legs",
    "leg extension": "legs",
    "leg curl": "legs",
    "calf raise": "legs",  # Calves merged into legs
    "standing calf": "legs",
    "seated calf": "legs",
    "hack squat": "legs",
    "bulgarian split": "legs",
    "goblet squat": "legs",

    # Chest
    "bench press": "chest",
    "chest press": "chest",
    "push up": "chest",
    "pushup": "chest",
    "dips": "chest",
    "chest fly": "chest",
    "pec deck": "chest",
    "incline": "chest",
    "decline": "chest",

    # Back
    "pull up": "back",
    "pullup": "back",
    "chin up": "back",
    "row": "back",
    "lat pulldown": "back",
    "deadlift": "back",
    "rdl": "back",
    "romanian deadlift": "back",
    "shrug": "back",
    "face pull": "back",

    # Shoulders
    "shoulder press": "shoulders",
    "military press": "shoulders",
    "overhead press": "shoulders",
    "lateral raise": "shoulders",
    "front raise": "shoulders",
    "rear delt": "shoulders",
    "upright row": "shoulders",

    # Arms
    "bicep curl": "arms",
    "curl": "arms",
    "tricep": "arms",
    "hammer curl": "arms",
    "preacher curl": "arms",
    "skull crusher": "arms",
    "pushdown": "arms",
    "overhead extension": "arms",

    # Core
    "plank": "core",
    "crunch": "core",
    "sit up": "core",
    "ab": "core",
    "leg raise": "core",
    "russian twist": "core",
    "side bend": "core",
}


def classify_muscle_group(exercise_name):
    """Classify exercise into muscle group (calves merged with legs)"""
    exercise_lower = exercise_name.lower()

    for keyword, muscle_group in MUSCLE_GROUP_MAPPING.items():
        if keyword in exercise_lower:
            return muscle_group

    return "other"


def get_cache():
    """Load cached data if valid"""
    if not CACHE_FILE.exists():
        return None

    try:
        with open(CACHE_FILE, 'r') as f:
            cache = json.load(f)

        cache_time = datetime.fromisoformat(cache.get('timestamp', '2000-01-01'))
        if datetime.now() - cache_time < timedelta(minutes=CACHE_DURATION_MINUTES):
            return cache.get('data')
    except Exception as e:
        print(f"Cache load error: {e}")

    return None


def set_cache(data):
    """Save data to cache"""
    try:
        cache = {
            'timestamp': datetime.now().isoformat(),
            'data': data
        }
        with open(CACHE_FILE, 'w') as f:
            json.dump(cache, f)
    except Exception as e:
        print(f"Cache save error: {e}")


def fetch_hevy_workouts(days=90):
    """Fetch workouts from Hevy API"""
    if not HEVY_API_KEY:
        return {"error": "HEVY_API_KEY not set", "workouts": []}

    try:
        headers = {
            "api-key": HEVY_API_KEY,
            "accept": "application/json"
        }

        # Fetch workouts
        params = {
            "page": 1,
            "pageSize": 50
        }

        all_workouts = []
        cutoff_date = datetime.now() - timedelta(days=days)

        while True:
            response = requests.get(
                f"{HEVY_API_BASE}/workouts",
                headers=headers,
                params=params,
                timeout=10
            )

            if response.status_code != 200:
                break

            data = response.json()
            workouts = data.get("workouts", [])

            if not workouts:
                break

            for workout in workouts:
                workout_date = datetime.fromisoformat(workout.get("created_at", "").replace("Z", "+00:00"))
                if workout_date < cutoff_date:
                    return all_workouts
                all_workouts.append(workout)

            # Check if there are more pages
            if len(workouts) < params["pageSize"]:
                break

            params["page"] += 1

        return all_workouts

    except Exception as e:
        print(f"Hevy API error: {e}")
        return []


def parse_apple_health_xml():
    """Parse Apple Health export XML"""
    if not APPLE_HEALTH_FILE.exists():
        return {
            "workouts": [],
            "heart_rate": [],
            "steps": [],
            "distance": [],
            "calories": []
        }

    try:
        tree = ET.parse(APPLE_HEALTH_FILE)
        root = tree.getroot()

        workouts = []
        heart_rate = []
        steps = []
        distance = []
        calories = []

        # Parse workout data
        for workout in root.findall(".//Workout"):
            workouts.append({
                "type": workout.get("workoutActivityType"),
                "start": workout.get("startDate"),
                "end": workout.get("endDate"),
                "duration": float(workout.get("duration", 0)),
                "calories": float(workout.get("totalEnergyBurned", 0)),
                "distance": float(workout.get("totalDistance", 0)),
            })

        # Parse health records
        for record in root.findall(".//Record"):
            record_type = record.get("type")
            date = record.get("startDate")
            value = float(record.get("value", 0))

            if "HeartRate" in record_type:
                heart_rate.append({"date": date, "value": value})
            elif "StepCount" in record_type:
                steps.append({"date": date, "value": value})
            elif "DistanceWalkingRunning" in record_type:
                distance.append({"date": date, "value": value})
            elif "ActiveEnergyBurned" in record_type:
                calories.append({"date": date, "value": value})

        return {
            "workouts": workouts,
            "heart_rate": heart_rate,
            "steps": steps,
            "distance": distance,
            "calories": calories
        }

    except Exception as e:
        print(f"Apple Health parse error: {e}")
        return {
            "workouts": [],
            "heart_rate": [],
            "steps": [],
            "distance": [],
            "calories": []
        }


def merge_workout_data(hevy_workouts, apple_data):
    """Merge Hevy and Apple Health data with improved matching"""
    merged = []

    for hevy_workout in hevy_workouts:
        workout_date = hevy_workout.get("created_at", "")
        workout_start = datetime.fromisoformat(workout_date.replace("Z", "+00:00"))

        # Estimate workout duration from Hevy data
        hevy_duration_seconds = hevy_workout.get("duration_seconds", 0)
        workout_end = workout_start + timedelta(seconds=hevy_duration_seconds) if hevy_duration_seconds else workout_start

        # Find best matching Apple workout (closest within 45 min window)
        apple_match = None
        best_time_diff = float('inf')
        for apple_workout in apple_data["workouts"]:
            apple_start = datetime.fromisoformat(apple_workout["start"].replace("Z", "+00:00"))
            time_diff = abs((workout_start - apple_start).total_seconds())
            if time_diff < 2700 and time_diff < best_time_diff:  # 45 minutes, find closest match
                apple_match = apple_workout
                best_time_diff = time_diff

        # Get average and max heart rate during workout
        avg_hr = None
        max_hr = None
        min_hr = None
        if apple_match:
            apple_end = datetime.fromisoformat(apple_match["end"].replace("Z", "+00:00"))
            # Use the broader time range for HR data
            hr_start = min(workout_start, datetime.fromisoformat(apple_match["start"].replace("Z", "+00:00")))
            hr_end = max(workout_end, apple_end)

            hr_readings = [
                hr["value"] for hr in apple_data["heart_rate"]
                if hr_start <= datetime.fromisoformat(hr["date"].replace("Z", "+00:00")) <= hr_end
            ]
            if hr_readings:
                avg_hr = round(statistics.mean(hr_readings), 1)
                max_hr = round(max(hr_readings), 1)
                min_hr = round(min(hr_readings), 1)

        # Process Hevy exercises with enhanced data
        exercises = []
        total_volume = 0
        failure_sets = 0

        for exercise_data in hevy_workout.get("exercises", []):
            exercise_title = exercise_data.get("title", "Unknown")

            for set_data in exercise_data.get("sets", []):
                weight = set_data.get("weight_kg", 0)
                reps = set_data.get("reps", 0)
                volume = weight * reps if weight and reps else 0
                total_volume += volume

                if set_data.get("to_failure", False):
                    failure_sets += 1

                exercises.append({
                    "exercise": exercise_title,
                    "reps": set_data.get("reps"),
                    "weight_kg": set_data.get("weight_kg"),
                    "rpe": set_data.get("rpe"),
                    "distance_meters": set_data.get("distance_meters"),
                    "duration_seconds": set_data.get("duration_seconds"),
                    "to_failure": set_data.get("to_failure", False),
                    "rest_seconds": set_data.get("rest_seconds"),
                    "volume": volume,
                })

        # Calculate effort score (0-100) combining RPE, HR, and failure
        effort_score = 0
        effort_factors = 0

        # RPE contribution (0-40 points)
        rpe_values = [ex.get("rpe") for ex in exercises if ex.get("rpe")]
        if rpe_values:
            avg_rpe = statistics.mean(rpe_values)
            effort_score += (avg_rpe / 10) * 40
            effort_factors += 1

        # Heart rate contribution (0-40 points) - based on % of estimated max HR
        if avg_hr:
            estimated_max_hr = 220 - 30  # Assuming age 30, adjust as needed
            hr_intensity = (avg_hr / estimated_max_hr) * 40
            effort_score += hr_intensity
            effort_factors += 1

        # Failure sets contribution (0-20 points)
        if failure_sets > 0:
            effort_score += min(failure_sets * 5, 20)
            effort_factors += 1

        if effort_factors > 0:
            effort_score = round(effort_score, 1)

        merged.append({
            "date": workout_date,
            "title": hevy_workout.get("title", "Workout"),
            "duration_seconds": hevy_workout.get("duration_seconds"),
            "exercises": exercises,
            # Apple Health data - enhanced
            "avg_heart_rate": avg_hr,
            "max_heart_rate": max_hr,
            "min_heart_rate": min_hr,
            "calories": apple_match["calories"] if apple_match else None,
            "distance_meters": apple_match["distance"] if apple_match else None,
            # Calculated metrics
            "total_volume": round(total_volume, 1),
            "failure_sets": failure_sets,
            "effort_score": effort_score,
            "apple_match_quality": "exact" if best_time_diff < 300 else "close" if best_time_diff < 1800 else "approximate" if apple_match else "none",
        })

    return merged


def calculate_trends(workouts):
    """Calculate trends and insights with PR tracking"""
    if not workouts:
        return {}

    # Group by exercise
    exercise_data = defaultdict(list)
    for workout in workouts:
        workout_date = datetime.fromisoformat(workout["date"].replace("Z", "+00:00"))
        for exercise in workout.get("exercises", []):
            ex_name = exercise["exercise"]
            if exercise.get("weight_kg") and exercise.get("reps"):
                exercise_data[ex_name].append({
                    "date": workout["date"],
                    "date_obj": workout_date,
                    "weight": exercise["weight_kg"],
                    "reps": exercise["reps"],
                    "volume": exercise.get("volume", exercise["weight_kg"] * exercise["reps"]),
                    "rpe": exercise.get("rpe"),
                    "to_failure": exercise.get("to_failure", False)
                })

    # Calculate trends and PRs
    trends = {}
    for exercise, data in exercise_data.items():
        if not data:
            continue

        sorted_data = sorted(data, key=lambda x: x["date"])

        # Find PRs
        max_weight = max(data, key=lambda x: x["weight"])
        max_volume = max(data, key=lambda x: x["volume"])
        max_reps_at_weight = {}  # Track max reps at each weight

        for entry in data:
            weight = entry["weight"]
            if weight not in max_reps_at_weight or entry["reps"] > max_reps_at_weight[weight]["reps"]:
                max_reps_at_weight[weight] = entry

        # Calculate 1RM estimate using Epley formula: weight × (1 + reps/30)
        estimated_1rm = [
            entry["weight"] * (1 + entry["reps"] / 30)
            for entry in data
        ]
        max_estimated_1rm = max(estimated_1rm) if estimated_1rm else 0
        max_1rm_entry = data[estimated_1rm.index(max(estimated_1rm))] if estimated_1rm else None

        # Recent trend (last 30 days vs previous 30 days)
        now = datetime.now()
        recent_data = [d for d in data if (now - d["date_obj"]).days <= 30]
        previous_data = [d for d in data if 30 < (now - d["date_obj"]).days <= 60]

        recent_avg_weight = statistics.mean([d["weight"] for d in recent_data]) if recent_data else 0
        previous_avg_weight = statistics.mean([d["weight"] for d in previous_data]) if previous_data else recent_avg_weight

        weight_trend = ((recent_avg_weight - previous_avg_weight) / previous_avg_weight * 100) if previous_avg_weight > 0 else 0

        # Latest vs first (overall progress)
        latest = sorted_data[-1]
        first = sorted_data[0]
        total_weight_gain = ((latest["weight"] - first["weight"]) / first["weight"] * 100) if first["weight"] > 0 else 0

        # Frequency analysis
        total_days = (sorted_data[-1]["date_obj"] - sorted_data[0]["date_obj"]).days or 1
        frequency_per_week = (len(data) / total_days) * 7 if total_days > 0 else 0

        trends[exercise] = {
            # Current stats
            "latest_weight": latest["weight"],
            "latest_reps": latest["reps"],
            "latest_volume": latest["volume"],

            # PRs
            "pr_weight": max_weight["weight"],
            "pr_weight_date": max_weight["date"],
            "pr_volume": max_volume["volume"],
            "pr_volume_date": max_volume["date"],
            "estimated_1rm": round(max_estimated_1rm, 1),
            "estimated_1rm_date": max_1rm_entry["date"] if max_1rm_entry else None,

            # Progress
            "weight_trend_30d_pct": round(weight_trend, 1),
            "total_weight_gain_pct": round(total_weight_gain, 1),

            # Activity
            "total_sessions": len(data),
            "frequency_per_week": round(frequency_per_week, 1),
            "days_since_last": (now - sorted_data[-1]["date_obj"]).days,

            # Intensity
            "avg_rpe": round(statistics.mean([d["rpe"] for d in data if d.get("rpe")]), 1) if any(d.get("rpe") for d in data) else None,
            "failure_rate": round(sum(1 for d in data if d.get("to_failure")) / len(data) * 100, 1),
        }

    return trends


def enhanced_forecast(workouts, days_ahead=30):
    """Enhanced forecast with exponential smoothing and trend analysis"""
    if not workouts or len(workouts) < 3:
        return {}

    # Prepare time series data
    workout_dates = []
    for workout in workouts:
        workout_date = datetime.fromisoformat(workout["date"].replace("Z", "+00:00"))
        workout_dates.append({
            "date": workout_date,
            "volume": workout.get("total_volume", 0),
            "effort": workout.get("effort_score", 0),
            "calories": workout.get("calories", 0),
        })

    workout_dates.sort(key=lambda x: x["date"])

    if len(workout_dates) < 3:
        return {}

    # Exponential smoothing for volume (alpha = 0.3 for smoothing)
    alpha = 0.3
    smoothed_volumes = []
    smoothed_volumes.append(workout_dates[0]["volume"])

    for i in range(1, len(workout_dates)):
        smoothed = alpha * workout_dates[i]["volume"] + (1 - alpha) * smoothed_volumes[-1]
        smoothed_volumes.append(smoothed)

    # Calculate trend using last 7 workouts
    recent_workouts = workout_dates[-min(7, len(workout_dates)):]
    if len(recent_workouts) >= 2:
        recent_volumes = [w["volume"] for w in recent_workouts]
        trend_slope = (recent_volumes[-1] - recent_volumes[0]) / len(recent_volumes)
    else:
        trend_slope = 0

    # Generate forecasts
    last_smoothed = smoothed_volumes[-1]
    last_date = workout_dates[-1]["date"]

    # Estimate workout frequency (workouts per week)
    total_days = (workout_dates[-1]["date"] - workout_dates[0]["date"]).days or 1
    workouts_per_week = (len(workout_dates) / total_days) * 7
    days_between_workouts = 7 / workouts_per_week if workouts_per_week > 0 else 7

    # Forecast next expected workouts
    forecast_workouts = []
    current_date = last_date
    for i in range(min(10, int(days_ahead / days_between_workouts))):  # Next 10 workouts or within days_ahead
        current_date = current_date + timedelta(days=days_between_workouts)
        if (current_date - last_date).days > days_ahead:
            break

        # Predicted volume with trend
        predicted_volume = last_smoothed + (trend_slope * (i + 1))
        forecast_workouts.append({
            "date": current_date.strftime("%Y-%m-%d"),
            "predicted_volume": max(0, round(predicted_volume, 1)),
            "confidence": "high" if i < 3 else "medium" if i < 6 else "low"
        })

    # Calculate performance metrics
    recent_7_avg = statistics.mean([w["volume"] for w in recent_workouts]) if recent_workouts else 0
    all_time_avg = statistics.mean([w["volume"] for w in workout_dates])
    performance_vs_avg = ((recent_7_avg - all_time_avg) / all_time_avg * 100) if all_time_avg > 0 else 0

    # Predict 30-day totals
    expected_workouts_in_30d = int(workouts_per_week * 4.3)  # ~4.3 weeks in a month
    predicted_30d_volume = expected_workouts_in_30d * recent_7_avg if recent_7_avg > 0 else 0

    return {
        "next_workouts": forecast_workouts,
        "trend": "increasing" if trend_slope > 10 else "decreasing" if trend_slope < -10 else "stable",
        "trend_slope_kg_per_workout": round(trend_slope, 1),
        "workouts_per_week": round(workouts_per_week, 1),
        "recent_avg_volume": round(recent_7_avg, 1),
        "performance_vs_average": round(performance_vs_avg, 1),
        "predicted_30d_volume": round(predicted_30d_volume, 1),
        "expected_workouts_30d": expected_workouts_in_30d,
    }


def calculate_smart_summary(workouts, trends, apple_data):
    """Calculate comprehensive smart summary statistics"""
    if not workouts:
        return {}

    now = datetime.now()

    # Time-based grouping
    last_7d = []
    last_30d = []
    last_90d = []

    for workout in workouts:
        workout_date = datetime.fromisoformat(workout["date"].replace("Z", "+00:00"))
        days_ago = (now - workout_date).days

        if days_ago <= 7:
            last_7d.append(workout)
        if days_ago <= 30:
            last_30d.append(workout)
        if days_ago <= 90:
            last_90d.append(workout)

    # Volume analysis
    total_volume_7d = sum(w.get("total_volume", 0) for w in last_7d)
    total_volume_30d = sum(w.get("total_volume", 0) for w in last_30d)
    avg_volume_per_workout = total_volume_30d / len(last_30d) if last_30d else 0

    # Workout frequency
    workout_frequency_7d = len(last_7d)
    workout_frequency_30d = len(last_30d)

    # Effort analysis
    avg_effort_7d = statistics.mean([w.get("effort_score", 0) for w in last_7d if w.get("effort_score")]) if last_7d else 0
    avg_effort_30d = statistics.mean([w.get("effort_score", 0) for w in last_30d if w.get("effort_score")]) if last_30d else 0

    # Heart rate analysis (from workouts with HR data)
    hr_workouts = [w for w in last_30d if w.get("avg_heart_rate")]
    avg_hr_30d = statistics.mean([w["avg_heart_rate"] for w in hr_workouts]) if hr_workouts else None

    # Failure sets
    total_failure_sets_30d = sum(w.get("failure_sets", 0) for w in last_30d)
    failure_rate_30d = (total_failure_sets_30d / sum(len(w.get("exercises", [])) for w in last_30d) * 100) if last_30d else 0

    # Muscle group balance (calves merged with legs)
    exercise_distribution = defaultdict(int)
    muscle_group_volume = defaultdict(float)
    muscle_group_frequency = defaultdict(int)

    for workout in last_30d:
        for exercise in workout.get("exercises", []):
            exercise_name = exercise["exercise"]
            exercise_distribution[exercise_name] += 1

            # Calculate muscle group volume and frequency
            muscle_group = classify_muscle_group(exercise_name)
            volume = exercise.get("volume", 0)
            muscle_group_volume[muscle_group] += volume
            muscle_group_frequency[muscle_group] += 1

    top_exercises = sorted(exercise_distribution.items(), key=lambda x: x[1], reverse=True)[:5]

    # Muscle group distribution (%)
    total_muscle_volume = sum(muscle_group_volume.values())
    muscle_distribution = {
        muscle: {
            "volume_kg": round(vol, 1),
            "volume_pct": round((vol / total_muscle_volume * 100), 1) if total_muscle_volume > 0 else 0,
            "sets": muscle_group_frequency[muscle]
        }
        for muscle, vol in muscle_group_volume.items()
    }

    # Apple Health integration
    calories_7d = sum(w.get("calories", 0) for w in last_7d if w.get("calories"))
    calories_30d = sum(w.get("calories", 0) for w in last_30d if w.get("calories"))

    # Personal records (recent PRs in last 30 days)
    recent_prs = []
    for exercise, trend_data in trends.items():
        pr_date = trend_data.get("pr_weight_date")
        if pr_date:
            pr_date_obj = datetime.fromisoformat(pr_date.replace("Z", "+00:00"))
            if (now - pr_date_obj).days <= 30:
                recent_prs.append({
                    "exercise": exercise,
                    "type": "weight",
                    "value": trend_data["pr_weight"],
                    "date": pr_date
                })

    # Consistency score (0-100)
    expected_workouts_30d = 12  # ~3 per week
    consistency_score = min((workout_frequency_30d / expected_workouts_30d) * 100, 100)

    return {
        # Current period (7 days)
        "last_7_days": {
            "workouts": workout_frequency_7d,
            "total_volume_kg": round(total_volume_7d, 1),
            "avg_effort": round(avg_effort_7d, 1),
            "calories_burned": round(calories_7d, 1),
        },

        # Last month (30 days)
        "last_30_days": {
            "workouts": workout_frequency_30d,
            "total_volume_kg": round(total_volume_30d, 1),
            "avg_volume_per_workout": round(avg_volume_per_workout, 1),
            "avg_effort": round(avg_effort_30d, 1),
            "avg_heart_rate": round(avg_hr_30d, 1) if avg_hr_30d else None,
            "calories_burned": round(calories_30d, 1),
            "failure_sets": total_failure_sets_30d,
            "failure_rate_pct": round(failure_rate_30d, 1),
        },

        # Overall stats
        "overall": {
            "total_workouts": len(workouts),
            "total_exercises_logged": sum(len(w.get("exercises", [])) for w in workouts),
            "unique_exercises": len(exercise_distribution),
            "consistency_score": round(consistency_score, 1),
        },

        # Top exercises (last 30 days)
        "top_exercises_30d": [
            {"exercise": ex, "times_performed": count}
            for ex, count in top_exercises
        ],

        # Recent achievements
        "recent_prs": recent_prs,

        # Muscle group distribution (30 days, calves merged with legs)
        "muscle_distribution": muscle_distribution,

        # Apple Health totals
        "apple_health_totals": {
            "total_steps": sum(s["value"] for s in apple_data.get("steps", [])),
            "total_distance_km": round(sum(d["value"] for d in apple_data.get("distance", [])) / 1000, 1),
            "total_calories": round(sum(c["value"] for c in apple_data.get("calories", [])), 1),
        }
    }


@app.route('/api/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        "status": "healthy",
        "timestamp": datetime.now().isoformat(),
        "hevy_configured": bool(HEVY_API_KEY),
        "apple_health_available": APPLE_HEALTH_FILE.exists()
    })


@app.route('/api/workouts', methods=['GET'])
def get_workouts():
    """Get merged workout data with smart analytics"""
    # Check cache first (now only 1 minute TTL)
    cached = get_cache()
    if cached and not request.args.get('refresh'):
        return jsonify(cached)

    # Fetch fresh data
    days = int(request.args.get('days', 90))
    hevy_workouts = fetch_hevy_workouts(days)
    apple_data = parse_apple_health_xml()

    # Merge and analyze
    merged_workouts = merge_workout_data(hevy_workouts, apple_data)
    trends = calculate_trends(merged_workouts)
    forecast = enhanced_forecast(merged_workouts)
    smart_summary = calculate_smart_summary(merged_workouts, trends, apple_data)

    response_data = {
        "workouts": merged_workouts,
        "trends": trends,
        "forecast": forecast,
        "smart_summary": smart_summary,

        # Legacy summary for backwards compatibility
        "summary": {
            "total_workouts": len(merged_workouts),
            "total_exercises": sum(len(w.get("exercises", [])) for w in merged_workouts),
            "date_range": {
                "start": merged_workouts[-1]["date"] if merged_workouts else None,
                "end": merged_workouts[0]["date"] if merged_workouts else None
            }
        },

        # Metadata
        "meta": {
            "fetched_at": datetime.now().isoformat(),
            "data_source": "hevy_api_and_apple_health",
            "cache_ttl_minutes": CACHE_DURATION_MINUTES,
            "days_requested": days,
        }
    }

    # Cache the response
    set_cache(response_data)

    return jsonify(response_data)


@app.route('/api/steps', methods=['GET'])
def get_steps():
    """Get steps data from Apple Health"""
    apple_data = parse_apple_health_xml()

    # Aggregate by day
    daily_steps = defaultdict(int)
    for step_record in apple_data["steps"]:
        date = step_record["date"][:10]  # YYYY-MM-DD
        daily_steps[date] += step_record["value"]

    return jsonify({
        "daily_steps": [
            {"date": date, "steps": int(steps)}
            for date, steps in sorted(daily_steps.items())
        ]
    })


@app.route('/api/upload/apple-health', methods=['POST'])
def upload_apple_health():
    """Upload Apple Health export - supports XML, JSON, and CSV formats"""
    if 'file' not in request.files:
        return jsonify({"error": "No file provided"}), 400

    file = request.files['file']
    if file.filename == '':
        return jsonify({"error": "No file selected"}), 400

    # Get file extension
    file_ext = file.filename.lower().split('.')[-1]

    try:
        # Handle XML (Apple Health Export format)
        if file_ext == 'xml':
            file.save(APPLE_HEALTH_FILE)
            return jsonify({
                "status": "success",
                "message": "Apple Health XML uploaded successfully",
                "format": "xml"
            })

        # Handle JSON (Custom export format)
        elif file_ext == 'json':
            content = file.read().decode('utf-8')
            data = json.loads(content)

            # Convert JSON to XML format for compatibility
            # Expected JSON format: {"workouts": [...], "heart_rate": [...], "steps": [...]}
            xml_content = convert_json_to_health_xml(data)

            with open(APPLE_HEALTH_FILE, 'w') as f:
                f.write(xml_content)

            return jsonify({
                "status": "success",
                "message": "Apple Health JSON uploaded and converted successfully",
                "format": "json",
                "records_processed": len(data.get("workouts", []))
            })

        # Handle CSV (Simplified workout log)
        elif file_ext == 'csv':
            content = file.read().decode('utf-8')
            csv_reader = csv.DictReader(StringIO(content))

            # Convert CSV to XML format
            # Expected CSV columns: date, workout_type, duration, calories, distance, avg_hr
            workouts_data = []
            for row in csv_reader:
                workouts_data.append(row)

            xml_content = convert_csv_to_health_xml(workouts_data)

            with open(APPLE_HEALTH_FILE, 'w') as f:
                f.write(xml_content)

            return jsonify({
                "status": "success",
                "message": "Apple Health CSV uploaded and converted successfully",
                "format": "csv",
                "records_processed": len(workouts_data)
            })

        else:
            return jsonify({
                "error": f"Unsupported file format: .{file_ext}",
                "supported_formats": ["xml", "json", "csv"]
            }), 400

    except json.JSONDecodeError as e:
        return jsonify({"error": f"Invalid JSON format: {str(e)}"}), 400
    except csv.Error as e:
        return jsonify({"error": f"Invalid CSV format: {str(e)}"}), 400
    except Exception as e:
        return jsonify({"error": f"Upload failed: {str(e)}"}), 500


def convert_json_to_health_xml(data):
    """Convert JSON health data to Apple Health XML format"""
    xml_lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<HealthData>']

    # Add workouts
    for workout in data.get("workouts", []):
        xml_lines.append(
            f'  <Workout workoutActivityType="{workout.get("type", "Other")}" '
            f'startDate="{workout.get("start", "")}" '
            f'endDate="{workout.get("end", "")}" '
            f'duration="{workout.get("duration", 0)}" '
            f'totalEnergyBurned="{workout.get("calories", 0)}" '
            f'totalDistance="{workout.get("distance", 0)}" />'
        )

    # Add heart rate records
    for hr in data.get("heart_rate", []):
        xml_lines.append(
            f'  <Record type="HKQuantityTypeIdentifierHeartRate" '
            f'startDate="{hr.get("date", "")}" '
            f'value="{hr.get("value", 0)}" />'
        )

    # Add steps
    for steps in data.get("steps", []):
        xml_lines.append(
            f'  <Record type="HKQuantityTypeIdentifierStepCount" '
            f'startDate="{steps.get("date", "")}" '
            f'value="{steps.get("value", 0)}" />'
        )

    # Add distance
    for dist in data.get("distance", []):
        xml_lines.append(
            f'  <Record type="HKQuantityTypeIdentifierDistanceWalkingRunning" '
            f'startDate="{dist.get("date", "")}" '
            f'value="{dist.get("value", 0)}" />'
        )

    # Add calories
    for cal in data.get("calories", []):
        xml_lines.append(
            f'  <Record type="HKQuantityTypeIdentifierActiveEnergyBurned" '
            f'startDate="{cal.get("date", "")}" '
            f'value="{cal.get("value", 0)}" />'
        )

    xml_lines.append('</HealthData>')
    return '\n'.join(xml_lines)


def convert_csv_to_health_xml(workouts_data):
    """Convert CSV workout data to Apple Health XML format"""
    xml_lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<HealthData>']

    for row in workouts_data:
        # Parse CSV row (expected columns: date, workout_type, duration, calories, distance, avg_hr)
        start_date = row.get("date", row.get("startDate", ""))
        workout_type = row.get("workout_type", row.get("type", "Other"))
        duration = row.get("duration", row.get("duration_seconds", "0"))
        calories = row.get("calories", row.get("totalEnergyBurned", "0"))
        distance = row.get("distance", row.get("totalDistance", "0"))
        avg_hr = row.get("avg_hr", row.get("avg_heart_rate", ""))

        # Calculate end date (start + duration)
        try:
            start_dt = datetime.fromisoformat(start_date.replace("Z", "+00:00"))
            duration_sec = float(duration)
            end_dt = start_dt + timedelta(seconds=duration_sec)
            end_date = end_dt.isoformat()
        except:
            end_date = start_date

        # Add workout
        xml_lines.append(
            f'  <Workout workoutActivityType="{workout_type}" '
            f'startDate="{start_date}" '
            f'endDate="{end_date}" '
            f'duration="{duration}" '
            f'totalEnergyBurned="{calories}" '
            f'totalDistance="{distance}" />'
        )

        # Add heart rate if available
        if avg_hr:
            xml_lines.append(
                f'  <Record type="HKQuantityTypeIdentifierHeartRate" '
                f'startDate="{start_date}" '
                f'value="{avg_hr}" />'
            )

    xml_lines.append('</HealthData>')
    return '\n'.join(xml_lines)


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=808, debug=True)
