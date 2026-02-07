# Riverly-Sentinel

🌊 AI-driven Floodplain Mapping &amp; Forecasting System. A real-time digital twin that combines Official Government LiDAR data with Machine Learning to predict flood risks and automate zonation alerts.

# 📡 River.ly Sentinel: AI-Driven Floodplain Mapping & Forecasting

![Project Status](https://img.shields.io/badge/Status-Hackathon_Ready-success)
![Tech Stack](https://img.shields.io/badge/Stack-React_|_Flask_|_Mapbox-blue)
![AI Model](https://img.shields.io/badge/AI-Random_Forest_Classifier-orange)

## 📖 About The Project

**River.ly Sentinel** is a precision-engineered **Digital Twin** for river health monitoring, specifically designed for the **Haridwar Ganga Basin**. Unlike traditional static maps, Sentinel combines **Real-Time Weather Telemetry**, **Historical Hydrological Data**, and **High-Resolution LiDAR Zonation** to predict floods _before_ they happen.

The system features a **"God Mode" Simulator**, allowing authorities to test disaster scenarios (e.g., Cloudbursts) and visualize the impact on specific households in real-time.

---

## 🚀 Key Features

### 1. 🌍 Real-Time & Predictive Monitoring

- **Live Telemetry:** Integrates with **Open-Meteo API** to fetch real-time precipitation, wind speed, and humidity.
- **AI Forecasting Engine:** A **Random Forest Classifier** trained on **10 years of historical climate data** (2014-2024) to predict river discharge and flood risk levels (Safe, Warning, Critical).

### 2. 🗺️ Precision Floodplain Zonation (LiDAR)

- **Sub-Meter Accuracy:** Uses official **NHP/NMCG GeoTIFF LiDAR data** to map elevation changes down to the centimeter.
- **Death Zone Detection:** Automatically scans terrain files to identify and visualize **Red Zones** (areas < 296m elevation) that are at immediate risk of inundation.
- **3D Visualization:** Interactive **Mapbox GL JS** engine renders 3D terrain for realistic situational awareness.

### 3. ⚠️ "God Mode" Simulation

- **Scenario Testing:** A dedicated simulation toggle allows users to manually inject extreme weather events (e.g., "300mm Rainfall") to test the system's response and visualization logic instantly.

### 4. 📄 Automated Reporting

- **One-Click Analysis:** Generates a professional **Floodplain Analysis PDF Report** including:
  - 12-Hour Discharge Forecast Graphs.
  - Estimated Households at Risk.
  - AI-generated Advisory text based on current Zonation.

---

## 🛠️ Tech Stack

### **Frontend (The Face)**

- **Framework:** React.js (Vite)
- **Mapping:** Mapbox GL JS (Satellite + 3D Terrain)
- **Styling:** Tailwind CSS / Glassmorphism UI
- **Visualization:** Chart.js (Forecast Graphs), html2canvas (PDF Gen)

### **Backend (The Brain)**

- **Server:** Flask (Python)
- **Geospatial Processing:** Rasterio, PyProj (Coordinate Transformation)
- **Machine Learning:** Scikit-Learn (Random Forest), Pandas, NumPy
- **Data Source:** Open-Meteo Historical & Live API

---

## ⚙️ Installation & Setup

### Prerequisites

- Python 3.9+
- Node.js 16+
- **LiDAR Data:** Due to GitHub size limits, you must manually place the `.tif` files in the `tiles/` directory.

### 1. Clone the Repo

### 2. BACKEND SETUP

# Install Python Dependencies

pip install -r requirements.txt

# Start the Intelligence Server

python app.py

### 3. FRONTEND SETUP

- cd frontend
- npm install
- npm run dev

```bash
git clone [https://github.com/Kyash04/Riverly-Sentinel](https://github.com/Kyash04/Riverly-Sentinel)
cd Riverly-Sentinel
```
