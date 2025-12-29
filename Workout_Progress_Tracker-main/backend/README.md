# Fitness Dashboard Backend

Backend API for the Heavy Duty Fitness Tracker that integrates Hevy and Apple Health data.

## Setup

1. Install dependencies:
```bash
cd backend
pip install -r requirements.txt
```

2. Configure Hevy API:
```bash
cp .env.example .env
# Edit .env and add your Hevy API key
```

3. Run the server:
```bash
python app.py
```

The server will run on `http://0.0.0.0:808`

## API Endpoints

- `GET /api/health` - Health check
- `GET /api/workouts?days=90` - Get merged workout data (Hevy + Apple)
- `GET /api/workouts?refresh=1` - Force refresh cache
- `GET /api/steps` - Get daily steps from Apple Health
- `POST /api/upload/apple-health` - Upload Apple Health export XML

## Apple Health Setup

1. On your iPhone, open Health app
2. Tap your profile picture (top right)
3. Scroll down and tap "Export All Health Data"
4. Save the export.zip file
5. Extract it and find `export.xml`
6. Upload to the backend:

```bash
curl -X POST http://100.80.30.43:808/api/upload/apple-health \
  -F "file=@export.xml"
```

Or use the dashboard UI to upload.

## Deployment on Raspberry Pi

1. Copy backend folder to Pi:
```bash
scp -r backend/ pi@100.80.30.43:~/fitness-dashboard/
```

2. SSH into Pi and set up:
```bash
ssh pi@100.80.30.43
cd ~/fitness-dashboard/backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

3. Create systemd service for auto-start:
```bash
sudo nano /etc/systemd/system/fitness-api.service
```

Add:
```ini
[Unit]
Description=Fitness Dashboard API
After=network.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/fitness-dashboard/backend
Environment="PATH=/home/pi/fitness-dashboard/backend/venv/bin"
ExecStart=/home/pi/fitness-dashboard/backend/venv/bin/python app.py
Restart=always

[Install]
WantedBy=multi-user.target
```

4. Enable and start:
```bash
sudo systemctl enable fitness-api
sudo systemctl start fitness-api
sudo systemctl status fitness-api
```

## Caching

The API caches responses for 15 minutes by default to avoid hitting Hevy API rate limits. Use `?refresh=1` to force a fresh fetch.
