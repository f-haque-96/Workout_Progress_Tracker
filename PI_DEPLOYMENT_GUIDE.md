# 🚀 Complete Raspberry Pi Deployment Guide

## Overview
This guide walks you through deploying your fitness dashboard from GitHub to your Raspberry Pi with Tailscale networking, setting up automated Apple Health sync, and configuring everything to run on boot.

---

## 📋 Prerequisites

### On Your Raspberry Pi:
- Raspberry Pi OS (Bullseye or later)
- Tailscale installed and configured
- Python 3.9+
- Node.js 18+ (for building frontend)
- nginx
- Git

### On Your Development Machine:
- GitHub account
- Git configured
- Your code pushed to GitHub repo

---

## 🔧 Part 1: Initial Pi Setup

### 1.1 SSH into Your Pi
```bash
# From your local machine
ssh pi@100.80.30.43
# Or if using hostname:
ssh pi@your-pi-hostname.tail-scale.net
```

### 1.2 Install Required Software
```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Python and pip
sudo apt install python3 python3-pip python3-venv -y

# Install Node.js 18.x (for building frontend)
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# Install nginx
sudo apt install nginx -y

# Install git (if not already installed)
sudo apt install git -y

# Verify installations
python3 --version  # Should be 3.9+
node --version     # Should be 18+
npm --version
nginx -v
git --version
```

---

## 📦 Part 2: Deploy from GitHub

### 2.1 Clone Your Repository
```bash
# Navigate to home directory
cd ~

# Clone your repo (replace with your GitHub URL)
git clone https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git

# Example:
# git clone https://github.com/yourusername/workout-tracker.git

# Navigate into the project
cd YOUR_REPO_NAME

# Verify you're in the right directory
ls -la  # Should see Workout_Progress_Tracker-main folder
```

### 2.2 Navigate to Project Root
```bash
cd Workout_Progress_Tracker-main
pwd  # Should show: /home/pi/YOUR_REPO_NAME/Workout_Progress_Tracker-main
```

---

## 🐍 Part 3: Backend Setup (Flask API)

### 3.1 Set Up Python Environment
```bash
# Navigate to backend directory
cd ~/YOUR_REPO_NAME/Workout_Progress_Tracker-main/backend

# Create virtual environment
python3 -m venv venv

# Activate virtual environment
source venv/bin/activate

# You should see (venv) in your prompt now

# Install dependencies
pip install --upgrade pip
pip install -r requirements.txt
```

### 3.2 Configure Environment Variables
```bash
# Create .env file for your Hevy API key
nano .env
```

**Add this content** (replace with your actual Hevy API key):
```env
HEVY_API_KEY=your_actual_hevy_api_key_here
CACHE_DURATION_MINUTES=1
```

**Save and exit**: `Ctrl+X`, then `Y`, then `Enter`

### 3.3 Create Data Directory
```bash
# Still in backend directory
mkdir -p data

# Verify structure
ls -la  # Should see: app.py, requirements.txt, venv/, data/
```

### 3.4 Test Backend Manually (Optional)
```bash
# Make sure venv is activated
source venv/bin/activate

# Run Flask app
python app.py

# Should see:
# * Running on http://0.0.0.0:808
# Press Ctrl+C to stop after testing
```

**Test from another terminal**:
```bash
curl http://100.80.30.43:808/api/health
# Should return: {"status":"healthy",...}
```

---

## ⚛️ Part 4: Frontend Setup (React)

### 4.1 Build Frontend for Production
```bash
# Navigate to frontend directory
cd ~/YOUR_REPO_NAME/Workout_Progress_Tracker-main

# Install dependencies
npm install

# Build for production
npm run build

# This creates a 'dist' folder with optimized files
ls -la dist/  # Should see index.html, assets/, etc.
```

### 4.2 Optional: Set Custom API URL
If your backend is NOT at `http://100.80.30.43:808`, create `.env`:
```bash
nano .env
```

Add:
```env
VITE_API_URL=http://YOUR_TAILSCALE_IP:808
```

Then rebuild:
```bash
npm run build
```

---

## 🌐 Part 5: Nginx Configuration

### 5.1 Create Nginx Site Configuration
```bash
sudo nano /etc/nginx/sites-available/fitness-dashboard
```

**Add this configuration**:
```nginx
server {
    listen 8080;
    server_name 100.80.30.43;

    # Frontend - serve built React app
    root /home/pi/YOUR_REPO_NAME/Workout_Progress_Tracker-main/dist;
    index index.html;

    # Increase upload size for Apple Health XML files (up to 100MB)
    client_max_body_size 100M;

    # Serve frontend for all routes (React Router)
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Proxy API requests to Flask backend
    location /api {
        proxy_pass http://127.0.0.1:808;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_cache_bypass $http_upgrade;

        # Timeouts for long-running API calls
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # Enable gzip compression
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css text/xml text/javascript application/x-javascript application/xml+rss application/json application/javascript;
}
```

**Important**: Replace `/home/pi/YOUR_REPO_NAME/Workout_Progress_Tracker-main/dist` with your actual path.

### 5.2 Enable the Site
```bash
# Create symbolic link to enable site
sudo ln -s /etc/nginx/sites-available/fitness-dashboard /etc/nginx/sites-enabled/

# Remove default site (optional)
sudo rm /etc/nginx/sites-enabled/default

# Test nginx configuration
sudo nginx -t

# Should see: "syntax is ok" and "test is successful"

# Reload nginx
sudo systemctl reload nginx

# Check nginx status
sudo systemctl status nginx
```

---

## 🔄 Part 6: Auto-Start with Systemd

### 6.1 Create Backend Service
```bash
sudo nano /etc/systemd/system/fitness-backend.service
```

**Add this content**:
```ini
[Unit]
Description=Fitness Dashboard Flask Backend
After=network.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/YOUR_REPO_NAME/Workout_Progress_Tracker-main/backend
Environment="PATH=/home/pi/YOUR_REPO_NAME/Workout_Progress_Tracker-main/backend/venv/bin"
Environment="HEVY_API_KEY=your_actual_hevy_api_key_here"
Environment="CACHE_DURATION_MINUTES=1"
ExecStart=/home/pi/YOUR_REPO_NAME/Workout_Progress_Tracker-main/backend/venv/bin/python app.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

**Important**: Replace paths and `HEVY_API_KEY` with your actual values.

### 6.2 Enable and Start Backend Service
```bash
# Reload systemd to recognize new service
sudo systemctl daemon-reload

# Enable service to start on boot
sudo systemctl enable fitness-backend

# Start service now
sudo systemctl start fitness-backend

# Check status
sudo systemctl status fitness-backend

# Should show: "active (running)"

# View logs
sudo journalctl -u fitness-backend -f
# Press Ctrl+C to exit logs
```

---

## 🍎 Part 7: Apple Health/Fitness Automation

### Option A: Automated Sync via iPhone Shortcuts (Recommended)

#### 7.1 Export Apple Health Shortcut Setup

**On Your iPhone:**

1. Open **Shortcuts** app
2. Tap **+** to create new shortcut
3. Add these actions:

**Shortcut Steps:**
```
1. Get Current Date
   - Format: Custom (YYYY-MM-DD)

2. Get File from Health Export
   - Health Data Type: All Health Data
   - Export Format: XML

3. Set Variable: healthData

4. Upload File to URL
   - URL: http://100.80.30.43:808/api/upload/apple-health
   - Method: POST
   - Field Name: file
   - File: healthData

5. Show Notification
   - Title: "Health Data Synced"
   - Body: "Dashboard updated successfully"
```

**Note**: Apple doesn't provide direct export automation, so you'll need to:
- Manually trigger this shortcut weekly/monthly, OR
- Use **Shortcuts Automation** to remind you to run it

#### 7.2 Alternative: Weekly Manual Upload

**On Your iPhone:**
1. Open **Health app** → Profile → Export All Health Data
2. Save `export.xml` to Files app
3. Open Safari → Navigate to `http://100.80.30.43:8080`
4. Use dashboard upload button to upload XML

#### 7.3 Alternative: SSH Upload from Mac/PC

If you export Health data to your computer:
```bash
# From your local machine
scp ~/Downloads/apple_health_export.xml pi@100.80.30.43:~/YOUR_REPO_NAME/Workout_Progress_Tracker-main/backend/data/

# Or use curl
curl -X POST -F "file=@apple_health_export.xml" http://100.80.30.43:808/api/upload/apple-health
```

### Option B: Advanced - Automatic Health Kit Sync (iOS Shortcut + Automation)

**Create Automation:**
1. Shortcuts app → Automation → Create Personal Automation
2. Trigger: **Time of Day** (e.g., every Sunday at 9 AM)
3. Action: Run the shortcut created above
4. Disable "Ask Before Running" (if you trust it)

**Limitations**: iOS requires manual health export, so full automation isn't possible without jailbreak.

---

## 📱 Part 8: Apple Fitness Integration

Apple Fitness data is included in Health export. The backend automatically extracts:
- Workout heart rate (avg, max, min)
- Calories burned
- Distance
- Workout duration
- Steps

**No additional setup needed** - just export Health data regularly.

---

## 🔄 Part 9: Updating Your Dashboard (Pull from GitHub)

When you push updates to GitHub, pull them on your Pi:

### 9.1 Create Update Script
```bash
nano ~/update-dashboard.sh
```

**Add this content**:
```bash
#!/bin/bash

# Navigate to repo
cd ~/YOUR_REPO_NAME

# Pull latest changes
git pull origin main  # or 'master' depending on your branch

# Navigate to project root
cd Workout_Progress_Tracker-main

# Update backend dependencies
cd backend
source venv/bin/activate
pip install -r requirements.txt
cd ..

# Rebuild frontend
npm install
npm run build

# Restart backend service
sudo systemctl restart fitness-backend

# Reload nginx
sudo systemctl reload nginx

echo "✅ Dashboard updated successfully!"
```

Make it executable:
```bash
chmod +x ~/update-dashboard.sh
```

### 9.2 Run Update
```bash
~/update-dashboard.sh
```

---

## 🧪 Part 10: Testing Your Deployment

### 10.1 Test Backend
```bash
curl http://100.80.30.43:808/api/health
```

**Expected response**:
```json
{
  "status": "healthy",
  "timestamp": "2025-12-29T...",
  "hevy_configured": true,
  "apple_health_available": false  // true after upload
}
```

### 10.2 Test Frontend
Open browser and navigate to:
```
http://100.80.30.43:8080
```

You should see your fitness dashboard.

### 10.3 Test Auto-Start (Reboot Pi)
```bash
sudo reboot
```

Wait 1-2 minutes, then test again:
```bash
curl http://100.80.30.43:808/api/health
```

If it works, auto-start is configured correctly!

---

## 📊 Part 11: Monitoring & Logs

### View Backend Logs
```bash
# Real-time logs
sudo journalctl -u fitness-backend -f

# Last 50 lines
sudo journalctl -u fitness-backend -n 50

# Logs since today
sudo journalctl -u fitness-backend --since today
```

### View Nginx Logs
```bash
# Access logs
sudo tail -f /var/log/nginx/access.log

# Error logs
sudo tail -f /var/log/nginx/error.log
```

### Check Service Status
```bash
# Backend
sudo systemctl status fitness-backend

# Nginx
sudo systemctl status nginx

# Check if ports are listening
sudo netstat -tlnp | grep -E '808|8080'
```

---

## 🐛 Troubleshooting

### Backend Not Starting
```bash
# Check service logs
sudo journalctl -u fitness-backend -n 50

# Common issues:
# 1. Wrong path → Update WorkingDirectory in service file
# 2. Missing venv → Recreate: python3 -m venv venv
# 3. Missing API key → Add HEVY_API_KEY to service file
```

### Frontend Shows 404
```bash
# Check nginx config
sudo nginx -t

# Verify dist folder exists
ls -la ~/YOUR_REPO_NAME/Workout_Progress_Tracker-main/dist/

# Rebuild frontend
cd ~/YOUR_REPO_NAME/Workout_Progress_Tracker-main
npm run build
sudo systemctl reload nginx
```

### API Calls Fail (CORS errors)
```bash
# Check backend is running
curl http://127.0.0.1:808/api/health

# Check nginx proxy
sudo tail -f /var/log/nginx/error.log
```

### Hevy Data Not Loading
```bash
# Test Hevy API directly
curl -H "api-key: YOUR_HEVY_KEY" https://api.hevyapp.com/v1/workouts

# Check backend logs
sudo journalctl -u fitness-backend -f
```

---

## 🔐 Security Best Practices

### 1. Use Environment Files (Don't commit secrets)
```bash
# Backend .env file
cd ~/YOUR_REPO_NAME/Workout_Progress_Tracker-main/backend
nano .env  # Add HEVY_API_KEY here, not in code

# Add to .gitignore
echo "backend/.env" >> .gitignore
echo "backend/data/" >> .gitignore
```

### 2. Firewall Configuration (Optional)
```bash
# Only allow Tailscale network
sudo ufw allow from 100.64.0.0/10 to any port 8080
sudo ufw allow from 100.64.0.0/10 to any port 808
sudo ufw enable
```

### 3. HTTPS with Let's Encrypt (Optional)
If you expose your Pi to internet, set up SSL:
```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

---

## 📈 Performance Optimization

### 1. Enable Pi Swap (for npm build)
```bash
# Check current swap
free -h

# Increase swap to 2GB (needed for large npm builds)
sudo dphys-swapfile swapoff
sudo nano /etc/dphys-swapfile
# Change CONF_SWAPSIZE=100 to CONF_SWAPSIZE=2048

sudo dphys-swapfile setup
sudo dphys-swapfile swapon
```

### 2. Cache npm Packages
```bash
npm config set cache ~/.npm-cache --global
```

### 3. Optimize Python
```bash
# Use pypy for faster execution (optional)
sudo apt install pypy3 pypy3-dev
```

---

## 🚀 Quick Reference Commands

### Start/Stop/Restart Services
```bash
# Backend
sudo systemctl start fitness-backend
sudo systemctl stop fitness-backend
sudo systemctl restart fitness-backend

# Nginx
sudo systemctl restart nginx
sudo systemctl reload nginx  # Reload config without downtime
```

### Pull Latest Updates
```bash
cd ~/YOUR_REPO_NAME
git pull origin main
~/update-dashboard.sh
```

### View Status
```bash
# All services
systemctl status fitness-backend nginx

# Listening ports
sudo netstat -tlnp | grep -E '808|8080'
```

### Clean Restart (if things break)
```bash
# Stop everything
sudo systemctl stop fitness-backend
sudo systemctl stop nginx

# Clear cache
rm -rf ~/YOUR_REPO_NAME/Workout_Progress_Tracker-main/backend/data/cache.json

# Restart
sudo systemctl start fitness-backend
sudo systemctl start nginx
```

---

## 📝 Daily Workflow

### For Regular Use:
1. **Access dashboard**: Open `http://100.80.30.43:8080` in browser
2. **Data refreshes automatically** every 2 minutes
3. **Upload Apple Health**: Use shortcut or manual upload weekly

### For Updates:
1. **Push to GitHub** from your dev machine
2. **SSH into Pi**: `ssh pi@100.80.30.43`
3. **Run update script**: `~/update-dashboard.sh`
4. **Verify**: Check `http://100.80.30.43:8080`

---

## ✅ Deployment Checklist

- [ ] Pi software installed (Python, Node, nginx, git)
- [ ] Repository cloned from GitHub
- [ ] Backend dependencies installed (venv + pip)
- [ ] Environment variables configured (.env with HEVY_API_KEY)
- [ ] Frontend built (npm run build)
- [ ] Nginx configured and reloaded
- [ ] Backend systemd service created and enabled
- [ ] Services auto-start on reboot (tested)
- [ ] Dashboard accessible at http://100.80.30.43:8080
- [ ] API responding at http://100.80.30.43:808/api/health
- [ ] Apple Health upload tested (manual or automated)
- [ ] Update script created (~/update-dashboard.sh)

---

## 🎯 Next Steps

1. **Set up Apple Health automation** (Shortcuts app)
2. **Create backup script** for your data folder
3. **Set up monitoring** (optional: Grafana + Prometheus)
4. **Add alerting** if services go down

**Your Pi fitness dashboard is now fully deployed and production-ready!** 🎉
