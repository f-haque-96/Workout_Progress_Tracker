# 📁 File Upload Format Examples

Your fitness dashboard now supports **three file formats** for Apple Health/Fitness data uploads:

1. **XML** (Apple Health Export - native format)
2. **JSON** (Custom structured format)
3. **CSV** (Simple spreadsheet format)

---

## 📋 Format 1: XML (Apple Health Export)

### How to Get XML
1. Open **Health app** on iPhone
2. Tap **Profile** (top right)
3. Scroll down → **Export All Health Data**
4. Share/save as `export.xml`

### Upload
```bash
curl -X POST -F "file=@export.xml" http://100.80.30.43:808/api/upload/apple-health
```

### Example XML Structure
```xml
<?xml version="1.0" encoding="UTF-8"?>
<HealthData>
  <Workout workoutActivityType="HKWorkoutActivityTypeTraditionalStrengthTraining"
           startDate="2025-12-29T10:00:00-05:00"
           endDate="2025-12-29T11:15:00-05:00"
           duration="4500"
           totalEnergyBurned="450"
           totalDistance="0" />

  <Record type="HKQuantityTypeIdentifierHeartRate"
          startDate="2025-12-29T10:00:00-05:00"
          value="120" />

  <Record type="HKQuantityTypeIdentifierStepCount"
          startDate="2025-12-29T10:00:00-05:00"
          value="8500" />

  <Record type="HKQuantityTypeIdentifierDistanceWalkingRunning"
          startDate="2025-12-29T10:00:00-05:00"
          value="5000" />

  <Record type="HKQuantityTypeIdentifierActiveEnergyBurned"
          startDate="2025-12-29T10:00:00-05:00"
          value="300" />
</HealthData>
```

---

## 🔧 Format 2: JSON (Custom Format)

### Use Case
When you want to programmatically export data from:
- Apple Health via third-party apps
- Your own tracking app
- HealthKit API directly

### JSON Structure
```json
{
  "workouts": [
    {
      "type": "Strength Training",
      "start": "2025-12-29T10:00:00-05:00",
      "end": "2025-12-29T11:15:00-05:00",
      "duration": 4500,
      "calories": 450,
      "distance": 0
    },
    {
      "type": "Running",
      "start": "2025-12-28T07:00:00-05:00",
      "end": "2025-12-28T07:45:00-05:00",
      "duration": 2700,
      "calories": 350,
      "distance": 5000
    }
  ],
  "heart_rate": [
    {
      "date": "2025-12-29T10:00:00-05:00",
      "value": 120
    },
    {
      "date": "2025-12-29T10:15:00-05:00",
      "value": 135
    },
    {
      "date": "2025-12-29T10:30:00-05:00",
      "value": 142
    }
  ],
  "steps": [
    {
      "date": "2025-12-29T00:00:00-05:00",
      "value": 8500
    },
    {
      "date": "2025-12-28T00:00:00-05:00",
      "value": 12000
    }
  ],
  "distance": [
    {
      "date": "2025-12-29T00:00:00-05:00",
      "value": 5000
    }
  ],
  "calories": [
    {
      "date": "2025-12-29T00:00:00-05:00",
      "value": 2500
    }
  ]
}
```

### Upload JSON
```bash
curl -X POST -F "file=@health_data.json" http://100.80.30.43:808/api/upload/apple-health
```

### Response
```json
{
  "status": "success",
  "message": "Apple Health JSON uploaded and converted successfully",
  "format": "json",
  "records_processed": 2
}
```

---

## 📊 Format 3: CSV (Simplified Spreadsheet)

### Use Case
- Manual workout logging
- Exported from Google Sheets / Excel
- Simple tracking apps

### CSV Format

**Required columns:**
- `date` (ISO 8601 format: `2025-12-29T10:00:00-05:00`)
- `workout_type` (e.g., "Strength Training", "Running", "Cycling")
- `duration` (seconds)
- `calories` (kcal)
- `distance` (meters)
- `avg_hr` (beats per minute, optional)

### Example CSV File (`workouts.csv`)
```csv
date,workout_type,duration,calories,distance,avg_hr
2025-12-29T10:00:00-05:00,Strength Training,4500,450,0,135
2025-12-28T07:00:00-05:00,Running,2700,350,5000,145
2025-12-27T06:30:00-05:00,Cycling,3600,400,15000,128
2025-12-26T10:00:00-05:00,Strength Training,4200,430,0,132
2025-12-25T08:00:00-05:00,HIIT,1800,280,0,165
```

### Alternative Column Names (Supported)
You can also use these column names (flexible):
- `startDate` instead of `date`
- `type` instead of `workout_type`
- `duration_seconds` instead of `duration`
- `totalEnergyBurned` instead of `calories`
- `totalDistance` instead of `distance`
- `avg_heart_rate` instead of `avg_hr`

### Upload CSV
```bash
curl -X POST -F "file=@workouts.csv" http://100.80.30.43:808/api/upload/apple-health
```

### Response
```json
{
  "status": "success",
  "message": "Apple Health CSV uploaded and converted successfully",
  "format": "csv",
  "records_processed": 5
}
```

---

## 🔄 Automated Upload Examples

### From iPhone Shortcuts (JSON)

Create a shortcut that:
1. Fetches Health data (requires manual export trigger)
2. Converts to JSON format
3. Uploads via HTTP POST

**Shortcut pseudocode:**
```
1. Get Health Export (manual step)
2. Convert to JSON using Parse/Format actions
3. POST to: http://100.80.30.43:808/api/upload/apple-health
   - Method: POST
   - Body: JSON file
   - Field Name: "file"
```

### From Python Script

```python
import requests
import json
from datetime import datetime

# Prepare health data
health_data = {
    "workouts": [
        {
            "type": "Strength Training",
            "start": datetime.now().isoformat(),
            "end": datetime.now().isoformat(),
            "duration": 4500,
            "calories": 450,
            "distance": 0
        }
    ],
    "heart_rate": [
        {"date": datetime.now().isoformat(), "value": 135}
    ],
    "steps": [
        {"date": datetime.now().isoformat(), "value": 8500}
    ],
    "distance": [],
    "calories": []
}

# Save to file
with open('health_data.json', 'w') as f:
    json.dump(health_data, f)

# Upload
files = {'file': open('health_data.json', 'rb')}
response = requests.post('http://100.80.30.43:808/api/upload/apple-health', files=files)
print(response.json())
```

### From cURL (Any Format)

**XML:**
```bash
curl -X POST \
  -F "file=@export.xml" \
  http://100.80.30.43:808/api/upload/apple-health
```

**JSON:**
```bash
curl -X POST \
  -F "file=@health_data.json" \
  http://100.80.30.43:808/api/upload/apple-health
```

**CSV:**
```bash
curl -X POST \
  -F "file=@workouts.csv" \
  http://100.80.30.43:808/api/upload/apple-health
```

---

## ✅ Validation & Error Handling

### Successful Upload Response
```json
{
  "status": "success",
  "message": "Apple Health CSV uploaded and converted successfully",
  "format": "csv",
  "records_processed": 5
}
```

### Error Responses

**No file provided:**
```json
{
  "error": "No file provided"
}
```

**Unsupported format:**
```json
{
  "error": "Unsupported file format: .txt",
  "supported_formats": ["xml", "json", "csv"]
}
```

**Invalid JSON:**
```json
{
  "error": "Invalid JSON format: Expecting value: line 1 column 1 (char 0)"
}
```

**Invalid CSV:**
```json
{
  "error": "Invalid CSV format: missing required column 'date'"
}
```

---

## 🎯 Testing Your Upload

### 1. Create Sample CSV
```bash
cat > test_workouts.csv << EOF
date,workout_type,duration,calories,distance,avg_hr
2025-12-29T10:00:00-05:00,Strength Training,4500,450,0,135
EOF
```

### 2. Upload
```bash
curl -X POST -F "file=@test_workouts.csv" http://100.80.30.43:808/api/upload/apple-health
```

### 3. Verify
```bash
curl http://100.80.30.43:808/api/health
```

Should show:
```json
{
  "status": "healthy",
  "apple_health_available": true
}
```

### 4. Check Dashboard
Open `http://100.80.30.43:8080` and verify workout data appears.

---

## 📱 Mobile App Integration

### iOS Health Export via Third-Party Apps

**Recommended apps that export JSON/CSV:**
1. **Health Export CSV** (iOS App Store)
   - Exports to CSV format
   - Can automate weekly exports
   - Directly compatible with dashboard

2. **QS Access** (iOS App Store)
   - Exports HealthKit data as JSON
   - Granular data selection
   - Direct upload support

3. **Health Data Importer & Exporter** (iOS App Store)
   - Multiple format support
   - Scheduled exports

### Android Google Fit Export

Google Fit can export to CSV via:
1. Google Takeout → Health & Fitness
2. Convert to dashboard CSV format
3. Upload

---

## 🔐 Security Notes

### File Size Limits
- **Max upload size**: 100 MB (configured in nginx)
- Most Apple Health exports: 10-50 MB
- CSV/JSON: < 1 MB typically

### Data Privacy
- All files stored locally on your Pi at: `/backend/data/apple_health_export.xml`
- No data sent to external services
- Accessible only via Tailscale network (100.80.30.43)

### Recommended: Encrypt Sensitive Files
```bash
# Encrypt before upload
gpg -c health_data.json  # Creates health_data.json.gpg

# Decrypt on Pi
gpg health_data.json.gpg
```

---

## 🎨 Format Conversion Tools

### Convert Apple Health XML → JSON

```python
import xml.etree.ElementTree as ET
import json

tree = ET.parse('export.xml')
root = tree.getroot()

data = {
    "workouts": [],
    "heart_rate": [],
    "steps": []
}

for workout in root.findall('.//Workout'):
    data["workouts"].append({
        "type": workout.get('workoutActivityType'),
        "start": workout.get('startDate'),
        "end": workout.get('endDate'),
        "duration": float(workout.get('duration', 0)),
        "calories": float(workout.get('totalEnergyBurned', 0)),
        "distance": float(workout.get('totalDistance', 0))
    })

with open('health_data.json', 'w') as f:
    json.dump(data, f, indent=2)
```

### Convert CSV → JSON

```python
import csv
import json

with open('workouts.csv', 'r') as csvfile:
    reader = csv.DictReader(csvfile)
    workouts = []

    for row in reader:
        workouts.append({
            "type": row['workout_type'],
            "start": row['date'],
            "end": row['date'],  # Simplified
            "duration": int(row['duration']),
            "calories": float(row['calories']),
            "distance": float(row['distance'])
        })

data = {"workouts": workouts, "heart_rate": [], "steps": [], "distance": [], "calories": []}

with open('health_data.json', 'w') as f:
    json.dump(data, f, indent=2)
```

---

## 📝 Quick Reference

| Format | Use Case | File Size | Complexity | Best For |
|--------|----------|-----------|------------|----------|
| **XML** | Native Apple Health export | 10-50 MB | High | Complete health history |
| **JSON** | Programmatic/API exports | < 1 MB | Medium | Custom integrations |
| **CSV** | Manual logging, spreadsheets | < 100 KB | Low | Simple workout tracking |

**Upload any format to:** `http://100.80.30.43:808/api/upload/apple-health`

**Supported extensions:** `.xml`, `.json`, `.csv`
