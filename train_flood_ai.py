import openmeteo_requests
import requests_cache
import pandas as pd
from retry_requests import retry
import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score, classification_report
import joblib

print("Connecting to Open-Meteo Historical Archive (ERA5-Land)...")

# SETUP API CLIENT (Unchanged)
cache_session = requests_cache.CachedSession('.cache', expire_after = 3600)
retry_session = retry(cache_session, retries = 5, backoff_factor = 0.2)
openmeteo = openmeteo_requests.Client(session = retry_session)

# FETCHING ADVANCED VARIABLES (Rain + Soil + Snow) - UPDATED
url = "https://archive-api.open-meteo.com/v1/archive"
params = {
    "latitude": 29.956,
    "longitude": 78.18,
    "start_date": "1990-01-01",
    "end_date": "2024-01-01",
    "daily": [
        "rain_sum",
        "soil_moisture_0_to_7cm_mean",
        "snowfall_sum"
    ],
    "timezone": "Asia/Kolkata"
}

try:
    responses = openmeteo.weather_api(url, params=params)
    response = responses[0]

    # Process Daily Data
    daily = response.Daily()
    
    # Extract Variables - UPDATED
    daily_rain = daily.Variables(0).ValuesAsNumpy()
    daily_soil = daily.Variables(1).ValuesAsNumpy()
    daily_snow = daily.Variables(2).ValuesAsNumpy()

    date_range = pd.date_range(
        start = pd.to_datetime(daily.Time(), unit = "s", utc = True),
        end = pd.to_datetime(daily.TimeEnd(), unit = "s", utc = True),
        freq = pd.Timedelta(seconds = daily.Interval()),
        inclusive = "left"
    )

    # DataFrame creation - UPDATED
    df = pd.DataFrame({
        "date": date_range, 
        "rain_mm": daily_rain,
        "soil_moisture": daily_soil, # Volumetric fraction (0.0 - 1.0)
        "snow_mm": daily_snow
    })
    
    # --- Antecedent Rainfall (Rolling Sum) ---
    # Adds "Memory" to the system (Last 5 days of rain)
    df['rain_last_5_days'] = df['rain_mm'].rolling(window=5).sum().fillna(0)
    
    print(f"Downloaded {len(df)} days of Hydrological Data.")
    print(df.head()) 

except Exception as e:
    print(f"API Error: {e}")
    exit()

# ADVANCED HYDROLOGY LOGIC - UPDATED
def calculate_hydrology_advanced(row):
    month = row['date'].month
    is_monsoon = 6 <= month <= 9

    # A. Soil Saturation Impact
    # If soil is wet (>0.35), runoff is much higher
    saturation_factor = 1.5 if row['soil_moisture'] > 0.35 else 0.8
    
    # B. Snow Melt Impact
    # Snow melt contributes to base flow even if it doesn't rain
    melt_contribution = row['snow_mm'] * 50 # Simplified melt physics

    # C. Base Flow & Runoff
    base_flow = 40000 if is_monsoon else 8000
    runoff_factor = 1200 if is_monsoon else 400
    
    # Total Discharge Calculation
    # Discharge = Base + (Rain * Runoff_Factor * Saturation) + Melt
    discharge = base_flow + (row['rain_mm'] * runoff_factor * saturation_factor) + melt_contribution
    
    # Add Noise (Natural variance)
    discharge += np.random.normal(0, 2000)
    
    # Risk Labeling (Calibrated)
    risk = 0
    if discharge > 100000: risk = 1
    if discharge > 180000: risk = 2
    
    return pd.Series([discharge, risk])

print("Applying Advanced Hydrological Rating Curve...")
df[['discharge_cusecs', 'risk_label']] = df.apply(calculate_hydrology_advanced, axis=1)
df = df.dropna()

# 4. We now train the AI on Rain, Soil, Snow, AND Antecedent Rain!
X = df[["rain_mm", "soil_moisture", "snow_mm", "rain_last_5_days", "discharge_cusecs"]]
y = df["risk_label"]

X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

model = RandomForestClassifier(n_estimators=100, random_state=42)
model.fit(X_train, y_train)

# Accuracy Check
predictions = model.predict(X_test)
acc = accuracy_score(y_test, predictions)
print(f"\nNew Model Accuracy: {acc * 100:.2f}%")
print(classification_report(y_test, predictions))

# Save Model
model.fit(X, y)
joblib.dump(model, "flood_model.pkl")
print("Advanced Model Saved as 'flood_model.pkl'")