from flask import Flask, request, jsonify
from flask_cors import CORS
import joblib
import numpy as np
import rasterio
import requests
import os
from glob import glob
from pyproj import Transformer
from datetime import datetime, timedelta
import pandas as pd
import math
import random

app = Flask(__name__)
CORS(app)

# Loading AI Model
try:
    model = joblib.load('flood_model.pkl')
    print("Advanced AI Brain Loaded")
except:
    print("Model not found. Run train_flood_ai.py first!")

# Load LiDAR Tiles
TILE_FOLDER = "tiles"
tile_datasets = []
tif_files = glob(os.path.join(TILE_FOLDER, "*.tif"))
coverage_bounds = [] 

if tif_files:
    for tif_path in tif_files:
        try:
            ds = rasterio.open(tif_path)
            tile_datasets.append(ds)
            left, bottom, right, top = ds.bounds
            dst_crs = 'EPSG:4326'
            if ds.crs != dst_crs:
                t = Transformer.from_crs(ds.crs, dst_crs, always_xy=True)
                min_lon, min_lat = t.transform(left, bottom)
                max_lon, max_lat = t.transform(right, top)
                coverage_bounds.append({
                    "coords": [[min_lon, max_lat], [max_lon, max_lat], [max_lon, min_lat], [min_lon, min_lat], [min_lon, max_lat]],
                    "name": os.path.basename(tif_path)
                })
        except: pass
    print(f"SYSTEM READY: {len(tile_datasets)} Tiles Active.")

transformer = Transformer.from_crs("EPSG:4326", "EPSG:32644", always_xy=True)

# Load & OPTIMIZE Catchment CSV
try:
    catchment_df = pd.read_csv("catchment_points.csv")
    print(f"Loaded {len(catchment_df)} Catchment Points.")
    # Pre-Calculate Static Physics
    catchment_df['S'] = (25400 / (catchment_df['cn'])) - 254
    catchment_df['Ia'] = 0.2 * catchment_df['S']
    print("Physics Engine Optimized & Ready.")
except:
    print("CSV Not Found. Run generate_catchment_csv.py first.")
    catchment_df = pd.DataFrame()

# --- HYDROLOGICAL FUNCTIONS ---

def get_seasonal_base_flow():
    """Returns typical base flow (cusecs) for Haridwar based on month."""
    month = datetime.now().month
    # Monsoon (Glacial Melt + Rain Base): June-Sept
    if 6 <= month <= 9: return 45000 
    # Post-Monsoon
    elif 10 <= month <= 11: return 20000
    # Winter (Dry)
    elif 12 <= month or month <= 3: return 8500
    # Pre-Summer Melt
    else: return 15000

def calculate_lag_time(rain_mm, soil_moisture):
    if rain_mm < 5: return 0
    L, Y = 30000, 5
    S_adjusted = 10 * (1 - soil_moisture) 
    numerator = (L ** 0.8) * ((S_adjusted + 1) ** 0.7)
    denominator = 1900 * (Y ** 0.5)
    return round((numerator / denominator) * (0.8 if rain_mm > 100 else 1), 1)

def calculate_impact(discharge):
    people_at_risk, crop_loss_acres = 0, 0
    if discharge > 100000:
        excess = discharge - 100000
        people_at_risk = int(excess * 0.045)
        crop_loss_acres = int(excess * 0.012)
    return people_at_risk, crop_loss_acres

def calculate_distributed_discharge(rain_input_mm):
    """Vectorized Map Visualization Logic"""
    if catchment_df.empty: return []
    local_rain = rain_input_mm * catchment_df['rain_weight']
    term1 = (local_rain - catchment_df['Ia']) ** 2
    term2 = (local_rain - catchment_df['Ia'] + catchment_df['S'])
    raw_runoff = np.where(local_rain > catchment_df['Ia'], term1 / term2, 0)
    
    active_indices = np.where(raw_runoff > 5)[0]
    if len(active_indices) == 0: return []
        
    active_df = catchment_df.iloc[active_indices].copy()
    active_df['runoff_mm'] = raw_runoff[active_indices]
    active_df['status'] = np.where(active_df['runoff_mm'] > 35, 2, np.where(active_df['runoff_mm'] > 15, 1, 0))
    
    return active_df[['lat', 'lon', 'runoff_mm', 'status']].to_dict(orient='records')

def calculate_scs_cn_discharge(current_rain_mm, past_rain_sum_mm, dam_release_cusecs=0):
    """
    REALISTIC Total Discharge Engine
    Q_total = Seasonal_Base + Direct_Runoff + Delayed_Runoff + Dam_Release
    """
    # Seasonal Base Flow (Nature's Default)
    base_flow_cusecs = get_seasonal_base_flow()
    
    # Direct Runoff (SCS-CN)
    CN = 85 
    S = (25400 / CN) - 254
    Ia = 0.2 * S
    
    direct_runoff_mm = 0
    if current_rain_mm > Ia:
        direct_runoff_mm = ((current_rain_mm - Ia) ** 2) / (current_rain_mm - Ia + S)
    
    # Delayed Runoff (Basin Memory)
    # 15% of previous days' rain drains into the river today
    delayed_runoff_mm = past_rain_sum_mm * 0.15 
    
    # Volume Calculation
    # Catchment Area ~ 20,000 sq km
    total_runoff_mm = direct_runoff_mm + delayed_runoff_mm
    
    # Volume (m3) = Area * Depth
    # Discharge (m3/s) = Volume / 86400 seconds
    # 1 mm over 20,000 sqkm = ~231 cusecs roughly
    discharge_from_rain_cusecs = (total_runoff_mm * 20000 * 1000 / 86400) * 35.31
    
    # Total Summation
    total_cusecs = base_flow_cusecs + discharge_from_rain_cusecs + dam_release_cusecs
    
    # Safety Check for NaN
    if math.isnan(total_cusecs): return base_flow_cusecs
    
    return float(round(total_cusecs, 0))

def calculate_gumbel_return_period(rain_mm):
    if rain_mm < 20: return "Normal"
    if rain_mm < 80: return "1-in-2 Year Event" 
    if rain_mm < 150: return "1-in-10 Year Event"
    return "1-in-100 Year Extreme Event"

def get_elevation_from_mosaic(lat, lon):
    if not tile_datasets: return None, "No Tiles"
    utmx, utmy = transformer.transform(lon, lat)
    for ds in tile_datasets:
        try:
            if (ds.bounds.left <= utmx <= ds.bounds.right) and (ds.bounds.bottom <= utmy <= ds.bounds.top):
                row, col = ds.index(utmx, utmy)
                val = ds.read(1)[row, col]
                if -100 < val < 9000: return float(val), os.path.basename(ds.name)
        except: continue
    return None, "Outside"

# --- API ROUTES ---

@app.route('/tiles-coverage', methods=['GET'])
def tiles_coverage():
    return jsonify(coverage_bounds)

@app.route('/predict-distributed', methods=['GET'])
def predict_distributed():
    sim_rain = request.args.get('sim_rain')
    sim_soil = request.args.get('sim_soil')
    sim_dam = request.args.get('sim_dam')
    
    weather_info = {
        'rain': 0.0, 'temp': 25.0, 'humidity': 60, 'wind': 5.0,
        'soil_moisture': 0.2, 'snow_depth': 0.0, 'past_rain_sum': 0.0, # Default to moderate history
        'dam_release': 0.0
    }

    try:
        try:
            url = "https://api.open-meteo.com/v1/forecast"
            params = {
                "latitude": 29.956, "longitude": 78.18,
                "current": ["temperature_2m", "relative_humidity_2m", "wind_speed_10m", "rain", "showers", "soil_moisture_0_to_7cm", "snow_depth"],
                "hourly": "rain", "past_days": 5, "timezone": "Asia/Kolkata"
            }
            resp = requests.get(url, params=params, timeout=1).json()
            curr = resp['current']
            weather_info.update({
                'temp': curr['temperature_2m'],
                'humidity': curr['relative_humidity_2m'],
                'wind': curr['wind_speed_10m'],
                'soil_moisture': curr['soil_moisture_0_to_7cm'],
                'snow_depth': curr['snow_depth']
            })
            
            if not sim_rain: weather_info['rain'] = curr['rain'] + curr['showers']
            past_rains = resp['hourly']['rain']
            if len(past_rains) >= 120: weather_info['past_rain_sum'] = sum(past_rains[:120])
                
        except: pass

        if sim_rain: weather_info['rain'] = float(sim_rain)
        if sim_soil: weather_info['soil_moisture'] = float(sim_soil)
        if sim_dam: weather_info['dam_release'] = float(sim_dam)

        real_rain = weather_info['rain']

        # Visualization Points (Sampled for speed)
        flood_points = calculate_distributed_discharge(real_rain)
        if len(flood_points) > 3000: flood_points = random.sample(flood_points, 3000)

        # TOTAL DISCHARGE CALCULATION (Using Past Rain)
        est_discharge_cusecs = calculate_scs_cn_discharge(
            real_rain, weather_info['past_rain_sum'], weather_info['dam_release']
        )
        
        people, crops = calculate_impact(est_discharge_cusecs)
        lag_time_hours = calculate_lag_time(real_rain, weather_info['soil_moisture'])

        features = np.array([[real_rain, weather_info['soil_moisture'], weather_info['snow_depth'], weather_info['past_rain_sum'], est_discharge_cusecs]])
        try:
            risk_prediction = int(model.predict(features)[0])
            probs = model.predict_proba(features)[0]
            confidence = round(max(probs) * 100, 1)
        except:
            risk_prediction = 2 if est_discharge_cusecs > 140000 else (1 if est_discharge_cusecs > 80000 else 0)
            confidence = 0.0

        return_period = calculate_gumbel_return_period(real_rain)
        
        adv_text = "Normal Flow."
        if risk_prediction == 2: 
            adv_text = f"CRITICAL: Capacity exceeded ({int(est_discharge_cusecs)} cusecs). Evacuate Zone A."
        elif risk_prediction == 1: 
            adv_text = f"WARNING: High flow due to antecedent rain ({int(weather_info['past_rain_sum'])}mm)."

        return jsonify({
            'rainfall_input': real_rain,
            'temperature': weather_info['temp'],
            'humidity': weather_info['humidity'],
            'wind_speed': weather_info['wind'],
            'soil_moisture': weather_info['soil_moisture'],
            'snow_depth': weather_info['snow_depth'],
            'dam_release': weather_info['dam_release'],
            'total_discharge_cusecs': est_discharge_cusecs,
            'impact_people': people,
            'impact_crops': crops,
            'lag_time_hours': lag_time_hours,
            'distributed_points': flood_points,
            'return_period': return_period,
            'risk_level': risk_prediction,
            'confidence': confidence,
            'advisory': adv_text
        })

    except Exception as e:
        print(e)
        return jsonify({'error': str(e)})

@app.route('/check-location', methods=['POST'])
def check_location():
    data = request.json
    try:
        lat, lon = round(float(data.get('lat')), 4), round(float(data.get('lon')), 4)
        discharge = float(data.get('discharge', 0))
    except: return jsonify({'found': False, 'source': "Invalid"})
    
    elevation, source = get_elevation_from_mosaic(lat, lon)
    if elevation is None: return jsonify({'found': False, 'source': source})
    
    # Rating Curve: Base 292.5m + Rise
    BASE_LEVEL = 292.5
    flood_rise = discharge / 55000 
    water_surface_elevation = BASE_LEVEL + flood_rise
    
    status = "Terrain"; flood_depth = 0; is_active_river = False
    local_flow = 0
    
    if elevation < water_surface_elevation:
        is_active_river = True
        status = "Inundated" if elevation > 294 else "Active Channel"
        flood_depth = round(water_surface_elevation - elevation, 2)
        
        # --- LOCAL FLOW CALCULATION (The Fix) ---
        # Deepest part of channel ~12m. 
        # Formula: Local Flow = Total * (Depth / Max_Depth)^1.5
        MAX_DEPTH_PROXY = 15.0 
        ratio = min(flood_depth / MAX_DEPTH_PROXY, 1.0)
        
        # Apply exponential factor (Manning's Eq approx)
        local_flow = int(discharge * (ratio ** 1.5))
        if local_flow < 100: local_flow = 100 # Minimum visible flow
    
    return jsonify({
        'found': True, 'elevation': round(elevation, 3), 'is_river': is_active_river,
        'status': status, 'flood_depth': flood_depth, 
        'local_discharge': local_flow, # <--- Sends Dynamic Local Flow
        'water_level': round(water_surface_elevation, 2), 'source': source
    })

@app.route('/get-forecast', methods=['GET'])
def get_forecast():
    try:
        sim_rain = request.args.get('sim_rain')
        forecast_data = []
        now = datetime.now()
        
        # 1. Initialize Variables
        base_rain = float(sim_rain) if sim_rain else 0.0
        hourly_rains = []
        past_rain_sum = 0.0 # Default to 0 for consistency
        
        # 2. FETCH REAL DATA (The Fix)
        # We need both Future Rain (for the curve) AND Past Rain (for the baseline level)
        try:
            url = "https://api.open-meteo.com/v1/forecast"
            params = {
                "latitude": 29.956, "longitude": 78.18,
                "hourly": "rain", 
                "forecast_days": 2, # Get next 48 hours
                "past_days": 5,     # Get past 5 days (Critical for matching live dashboard)
                "timezone": "Asia/Kolkata"
            }
            resp = requests.get(url, params=params, timeout=1).json()
            
            # A. Calculate Past Rain (The Basin Memory)
            # The API returns one big array: [Past 120 hrs] + [Future 48 hrs]
            # We assume the first 120 items are "past"
            all_rain = resp['hourly']['rain']
            if len(all_rain) >= 120:
                past_rain_sum = sum(all_rain[:120])
            
            # B. Get Future Rain (The Forecast)
            if not sim_rain:
                # Find the index for "Now" (current hour)
                # This approximates the split point between past and future
                current_hour_idx = 120 + now.hour 
                # Slice next 12 hours
                if current_hour_idx + 12 < len(all_rain):
                    hourly_rains = all_rain[current_hour_idx : current_hour_idx + 12]
                else:
                    hourly_rains = [0] * 12
        except: 
            hourly_rains = [0] * 12
            
        # 3. Simulation Override (If Simulation Mode is ON)
        if sim_rain:
            # If simulating, we ignore real weather and generate a curve
            hourly_rains = []
            for i in range(12):
                if i == 0: factor = 0.2
                elif i == 1: factor = 0.6
                elif i == 2: factor = 1.0 
                elif i == 3: factor = 0.8
                else: factor = 0.8 * (0.75 ** (i-3))
                hourly_rains.append(base_rain * factor)
            # In simulation, we assume some base wetness (e.g. 50mm) to show a "What-If" scenario
            # But in Live Mode (else), we use the real 'past_rain_sum' calculated above.
            past_rain_sum = 50.0 

        # 4. Generate Data Points
        for i, rain in enumerate(hourly_rains):
            # We use the correct 'past_rain_sum' (0 for live winter, 50 for sim)
            q = calculate_scs_cn_discharge(rain, past_rain_sum, 0)
            
            risk = 2 if q > 140000 else (1 if q > 80000 else 0)
            forecast_data.append({
                "time": (now + timedelta(hours=i)).strftime("%H:%M"),
                "rain": round(rain, 1),
                "discharge": q,
                "risk": risk
            })
            
        return jsonify(forecast_data)
    except Exception as e:
        print(e)
        return jsonify([])

if __name__ == '__main__':
    app.run(port=5000, debug=True)