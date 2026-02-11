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

# 1. Load AI Model
try:
    model = joblib.load('flood_model.pkl')
    print("✅ Advanced AI Brain Loaded (5-Feature Model)")
except:
    print("⚠️ Model not found. Run train_flood_ai.py first!")

# 2. Load LiDAR Tiles
TILE_FOLDER = "tiles"
print(f"Scanning {TILE_FOLDER}...")

tile_datasets = []
tif_files = glob(os.path.join(TILE_FOLDER, "*.tif"))
coverage_bounds = [] 

if tif_files:
    for tif_path in tif_files:
        try:
            ds = rasterio.open(tif_path)
            tile_datasets.append(ds)
            # Calculate bounds
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
    print(f"✅ SYSTEM READY: {len(tile_datasets)} Tiles Active.")

transformer = Transformer.from_crs("EPSG:4326", "EPSG:32644", always_xy=True)

# 3. Load Catchment CSV
try:
    catchment_df = pd.read_csv("catchment_points.csv")
    print(f"✅ Loaded {len(catchment_df)} Catchment Points.")
except:
    print("⚠️ CSV Not Found. Run generate_catchment_csv.py first.")
    catchment_df = pd.DataFrame()

# --- HYDROLOGICAL FUNCTIONS ---

def calculate_distributed_discharge(rain_input_mm):
    if catchment_df.empty: return []
    
    # Vectorized SCS-CN Logic
    catchment_df['local_rain'] = rain_input_mm * catchment_df['rain_weight']
    catchment_df['S'] = (25400 / catchment_df['cn']) - 254
    catchment_df['Ia'] = 0.2 * catchment_df['S']
    
    catchment_df['runoff_mm'] = np.where(
        catchment_df['local_rain'] <= catchment_df['Ia'],
        0,
        ((catchment_df['local_rain'] - catchment_df['Ia']) ** 2) / 
        (catchment_df['local_rain'] - catchment_df['Ia'] + catchment_df['S'])
    )
    
    catchment_df['status'] = np.where(catchment_df['runoff_mm'] > 35, 2, 
                             np.where(catchment_df['runoff_mm'] > 15, 1, 0))
    
    active_floods = catchment_df[catchment_df['runoff_mm'] > 5]
    result_points = active_floods[['lat', 'lon', 'runoff_mm', 'status', 'elevation']].to_dict(orient='records')
    return result_points

def calculate_scs_cn_discharge(rain_mm):
    # Calculates Total River Discharge (No Noise for stability)
    month = datetime.now().month
    is_monsoon = 6 <= month <= 9
    CN = 85 if is_monsoon else 65
    S = (25400 / CN) - 254
    Ia = 0.2 * S
    if rain_mm <= Ia: runoff_depth_mm = 0
    else: runoff_depth_mm = ((rain_mm - Ia) ** 2) / (rain_mm - Ia + S)
    
    catchment_area_sqkm = 20000
    volume_m3 = catchment_area_sqkm * runoff_depth_mm * 1000
    discharge_cumecs = volume_m3 / 86400
    
    base_flow = 500 if is_monsoon else 150
    # FIX: Cast to float to avoid NumPy JSON errors
    return float(round((discharge_cumecs + base_flow) * 35.31, 0))

def calculate_gumbel_return_period(rain_mm):
    if rain_mm < 10: return "Normal"
    if rain_mm < 80: return "1-in-2 Year Event"
    if rain_mm < 150: return "1-in-10 Year Event"
    if rain_mm < 250: return "1-in-50 Year Event"
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
    
    # Default Environment Container
    weather_info = {
        'rain': 0.0,
        'temp': 25.0,
        'humidity': 60,
        'wind': 5.0,
        'soil_moisture': 0.2, # Default Dry
        'snow_depth': 0.0,    # Default No Snow
        'past_rain_sum': 0.0  # Default No Past Rain
    }

    try:
        # 1. ALWAYS Fetch Real-Time Advanced Data
        try:
            url = "https://api.open-meteo.com/v1/forecast"
            params = {
                "latitude": 29.956,
                "longitude": 78.18,
                "current": ["temperature_2m", "relative_humidity_2m", "wind_speed_10m", "rain", "showers", "soil_moisture_0_to_7cm", "snow_depth"],
                "hourly": "rain", 
                "past_days": 5,
                "timezone": "Asia/Kolkata"
            }
            resp = requests.get(url, params=params, timeout=2).json()
            
            curr = resp['current']
            weather_info['temp'] = curr['temperature_2m']
            weather_info['humidity'] = curr['relative_humidity_2m']
            weather_info['wind'] = curr['wind_speed_10m']
            weather_info['soil_moisture'] = curr['soil_moisture_0_to_7cm']
            weather_info['snow_depth'] = curr['snow_depth']
            
            if not sim_rain:
                weather_info['rain'] = curr['rain'] + curr['showers']
            
            # Antecedent Rain
            past_rains = resp['hourly']['rain']
            if len(past_rains) >= 120:
                weather_info['past_rain_sum'] = sum(past_rains[:120])
            
        except Exception as e:
            print(f"Weather API Error: {e}")

        # 2. Simulation Override
        if sim_rain:
            weather_info['rain'] = float(sim_rain)

        real_rain = weather_info['rain']

        # 3. RUN PHYSICS ENGINE
        flood_points = calculate_distributed_discharge(real_rain)
        # Fix: Limit points to prevent lag
        if len(flood_points) > 2500:
            flood_points = random.sample(flood_points, 2500)

        est_discharge_cusecs = calculate_scs_cn_discharge(real_rain)
        
        # 4. RUN AI ENGINE
        features = np.array([[
            real_rain, 
            weather_info['soil_moisture'], 
            weather_info['snow_depth'],
            weather_info['past_rain_sum'],
            est_discharge_cusecs
        ]])
        
        try:
            risk_prediction = int(model.predict(features)[0])
            probs = model.predict_proba(features)[0]
            confidence = round(max(probs) * 100, 1)
        except:
            risk_prediction = 2 if est_discharge_cusecs > 140000 else (1 if est_discharge_cusecs > 800000 else 0)
            confidence = 0.0

        return_period = calculate_gumbel_return_period(real_rain)
        adv_text = "Normal Flow."
        if risk_prediction == 2:
            adv_text = f"CRITICAL: High Saturation ({int(weather_info['soil_moisture']*100)}%) detected. Flash flood imminent."
        elif risk_prediction == 1:
            adv_text = "WARNING: Elevated runoff due to wet soil conditions."

        return jsonify({
            'rainfall_input': real_rain,
            'temperature': weather_info['temp'],
            'humidity': weather_info['humidity'],
            'wind_speed': weather_info['wind'],
            'soil_moisture': weather_info['soil_moisture'],
            'snow_depth': weather_info['snow_depth'],
            'total_discharge_cusecs': est_discharge_cusecs,
            'distributed_points': flood_points,
            'return_period': return_period,
            'risk_level': risk_prediction,
            'confidence': confidence,
            'advisory': adv_text
        })

    except Exception as e:
        print(f"Error: {e}")
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
    
    BASE_LEVEL = 292.5
    flood_rise = discharge / 50000
    water_surface_elevation = BASE_LEVEL + flood_rise
    
    status = "Terrain"
    flood_depth = 0
    is_active_river = False
    
    if elevation < water_surface_elevation:
        is_active_river = True
        status = "Active Channel" if elevation < 294 else "Inundated Floodplain"
        flood_depth = round(water_surface_elevation - elevation, 2)
    elif elevation <= 293.5:
        is_active_river = True
        status = "Deep Channel"
        flood_depth = round(293.5 - elevation, 2)
    else: is_active_river = False; status = "Dry Terrain"
    
    return jsonify({
        'found': True, 'elevation': round(elevation, 3), 'is_river': is_active_river,
        'status': status, 'flood_depth': flood_depth, 'local_discharge': discharge if is_active_river else 0,
        'water_level': round(water_surface_elevation, 2), 'source': source
    })

@app.route('/get-forecast', methods=['GET'])
def get_forecast():
    try:
        sim_rain = request.args.get('sim_rain')
        forecast_data = []
        now = datetime.now()
        base_rain = float(sim_rain) if sim_rain else 0.0
        hourly_rains = []
        
        if not sim_rain:
             try:
                 url = "https://api.open-meteo.com/v1/forecast?latitude=29.956&longitude=78.18&hourly=rain,showers&forecast_days=2&timezone=Asia/Kolkata"
                 data = requests.get(url, timeout=2).json()
                 current_hour = now.hour
                 full_rain = [r+s for r,s in zip(data['hourly']['rain'], data['hourly']['showers'])]
                 hourly_rains = full_rain[current_hour : current_hour+12]
             except: hourly_rains = [0]*12
        else:
             for i in range(12):
                if i == 0: factor = 0.2
                elif i == 1: factor = 0.6
                elif i == 2: factor = 1.0 
                elif i == 3: factor = 0.8
                else: factor = 0.8 * (0.75 ** (i-3))
                hourly_rains.append(base_rain * factor)

        for i, rain in enumerate(hourly_rains):
            q = calculate_scs_cn_discharge(rain)
            risk = 2 if q > 250000 else (1 if q > 150000 else 0)
            forecast_data.append({
                "time": (now + timedelta(hours=i)).strftime("%H:%M"),
                "rain": round(rain, 1),
                "discharge": q,
                "risk": risk
            })
        return jsonify(forecast_data)
    except: return jsonify([])

if __name__ == '__main__':
    app.run(port=5000, debug=True)