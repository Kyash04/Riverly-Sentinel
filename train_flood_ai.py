import openmeteo_requests
import requests_cache
import pandas as pd
from retry_requests import retry
import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split
import joblib

print("🌊 Connecting to Open-Meteo Historical Archive...")

# 1. SETUP API CLIENT
cache_session = requests_cache.CachedSession('.cache', expire_after = 3600)
retry_session = retry(cache_session, retries = 5, backoff_factor = 0.2)
openmeteo = openmeteo_requests.Client(session = retry_session)

# 2. FETCH 10 YEARS OF REAL RAIN (Haridwar)
# Coordinates: Bhimgoda Barrage
url = "https://archive-api.open-meteo.com/v1/archive"
params = {
	"latitude": 29.956,
	"longitude": 78.18,
	"start_date": "2014-01-01",
	"end_date": "2024-01-01",
	"daily": ["rain_sum", "precipitation_sum"],
	"timezone": "Asia/Kolkata"
}

try:
    responses = openmeteo.weather_api(url, params=params)
    response = responses[0]
    
    # Process the data
    daily = response.Daily()
    daily_rain_sum = daily.Variables(0).ValuesAsNumpy()
    
    # Create DataFrame
    date_range = pd.date_range(
        start = pd.to_datetime(daily.Time(), unit = "s", utc = True),
        end = pd.to_datetime(daily.TimeEnd(), unit = "s", utc = True),
        freq = pd.Timedelta(seconds = daily.Interval()),
        inclusive = "left"
    )
    
    df = pd.DataFrame({"date": date_range, "rain_mm": daily_rain_sum})
    print(f"✅ Downloaded {len(df)} days of real weather history.")

except Exception as e:
    print(f"❌ API Error: {e}")
    exit()

# 3. CALCULATE DISCHARGE & RISK (The Hydrology Logic)
# Since we don't have classified river data, we estimate discharge from rain.
# Formula: Base Flow + (Rain * Runoff Factor) + Random Variability
# - Monsoon (June-Sept) has higher base flow due to glacier melt.

def calculate_hydrology(row):
    month = row['date'].month
    is_monsoon = 6 <= month <= 9
    
    # Base River Flow (Glaciers + Groundwater)
    base_flow = 40000 if is_monsoon else 8000
    
    # Runoff: How much rain reaches the river?
    # In monsoon, ground is saturated, so runoff is higher (1200x).
    runoff_factor = 1200 if is_monsoon else 400
    
    # Calculate Discharge
    discharge = base_flow + (row['rain_mm'] * runoff_factor)
    
    # Add some natural noise (rivers aren't perfect math)
    discharge += np.random.normal(0, 2000)
    
    # Determine Risk Label (The "Truth" for AI)
    # > 100k cusecs = Warning
    # > 200k cusecs = Danger (2013 Kedarnath flows were ~300k+)
    risk = 0
    if discharge > 100000: risk = 1 # Warning
    if discharge > 180000: risk = 2 # Critical
    
    return pd.Series([discharge, risk])

print("⚙️ Applying Hydrological Rating Curve...")
df[['discharge_cusecs', 'risk_label']] = df.apply(calculate_hydrology, axis=1)

# Clean up (remove NaNs)
df = df.dropna()

print("📊 Training Data Summary:")
print(f"   - Total Days: {len(df)}")
print(f"   - Dry Days (0mm): {len(df[df['rain_mm'] == 0])}")
print(f"   - Flood Days (Risk 2): {len(df[df['risk_label'] == 2])}")

# 4. TRAIN THE BRAIN
X = df[["rain_mm", "discharge_cusecs"]]
y = df["risk_label"]

model = RandomForestClassifier(n_estimators=100, random_state=42)
model.fit(X, y)

joblib.dump(model, "flood_model.pkl")
print("✅ Real-Data AI Trained & Saved as 'flood_model.pkl'")